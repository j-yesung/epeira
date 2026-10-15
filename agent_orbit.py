#!/usr/bin/env python3
"""Agent Orbit collector — 이 컴퓨터의 Claude Code / Codex 세션을 모아 대시보드로 보낸다.

데이터는 이 컴퓨터 밖으로 나가지 않는다. 127.0.0.1 에서만 열리고, 허용한 사이트(ORIGINS)만 읽을 수 있다.

  agent-orbit serve                          수집기 실행 (자동 실행 서비스가 호출)
  agent-orbit connect|disconnect <agent>     훅 연결/해제 (claude | codex) — 바뀔 내용을 보여주고 확인 후 적용
  agent-orbit doctor                         진단 정보 (피드백에 그대로 붙여넣기)
  agent-orbit uninstall                      훅·자동 실행·설치 파일·기록 모두 제거
  agent-orbit version
"""
import difflib
import glob
import hashlib
import json
import os
import platform
import queue
import select
import shutil
import socket
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import urlopen

VERSION = '0.2.0'
PROTOCOL = 2
PORT = int(os.environ.get('AGENT_ORBIT_PORT') or 47777)
HOME = os.path.expanduser('~')
APP_DIR = os.environ.get('AGENT_ORBIT_HOME') or os.path.join(HOME, '.agent-orbit')
DATA_DIR = os.path.join(APP_DIR, 'data')
EVENTS_DIR = os.path.join(DATA_DIR, 'events')
CKPT_FILE = os.path.join(DATA_DIR, 'state.json')
RESTORE_FILE = os.path.join(DATA_DIR, 'restore.json')
LOG_FILE = os.path.join(APP_DIR, 'collector.log')
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://agent-orbit-app.vercel.app'
# 이 주소에서 연 대시보드만 데이터를 읽고 버튼을 쓸 수 있다. 정확히 일치하는 것만 — '*' 면 아무 사이트나 로그를 읽어간다
ORIGINS = {SITE} | set(filter(None, os.environ.get('AGENT_ORBIT_ORIGINS', '').split(',')))
LOCAL_ORIGINS = {'http://127.0.0.1:%d' % PORT, 'http://localhost:%d' % PORT}
HOSTS = {'127.0.0.1:%d' % PORT, 'localhost:%d' % PORT}  # 다른 Host 는 거부: DNS 리바인딩 차단
RETENTION_DAYS = 7
BOOT = str(int(time.time() * 1000))
LABEL = 'dev.agentorbit.collector'

AGENTS = {
    'claude': {'name': 'Claude Code', 'dir': '~/.claude', 'file': '~/.claude/settings.json',
               'events': ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'], 'opts': {'async': True}},
    'codex': {'name': 'Codex', 'dir': '~/.codex', 'file': '~/.codex/hooks.json',
              'events': ['PreToolUse', 'PostToolUse'], 'opts': {'async': True, 'timeout': 2}},
}
CODEX_CONFIG = '~/.codex/config.toml'


# ---------- 공통 ----------

def log(*a):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), *a, file=sys.stderr, flush=True)


def sha(text):
    return None if text is None else hashlib.sha256(text.encode()).hexdigest()


def read_text(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return None


def read_json(path):
    try:
        return json.loads(read_text(path) or 'null')
    except ValueError:
        return None


def write_text(path, text):
    """원자적 쓰기 — 에이전트가 반쯤 쓴 설정 파일을 읽는 일이 없게. None 이면 파일 삭제."""
    if text is None:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        return
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = path + '.agent-orbit.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    if os.path.exists(path):
        shutil.copymode(path, tmp)
    os.replace(tmp, path)


def tilde(path):
    return '~' + path[len(HOME):] if path.startswith(HOME + os.sep) else path


def day_start(days_ago=0):
    return datetime.combine(date.today() - timedelta(days=days_ago), datetime.min.time()).timestamp()


def short(s, n=60):
    s = ' '.join(str(s).split())
    return s if len(s) <= n else s[:n - 1] + '…'


def base(p):
    return os.path.basename(str(p).rstrip('/')) or str(p)


def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return ' '.join(text_of(b.get('text', '')) for b in c if isinstance(b, dict))
    return ''


def ts_of(o):
    try:
        return datetime.fromisoformat(o['timestamp'].replace('Z', '+00:00')).timestamp()
    except (KeyError, AttributeError, ValueError):
        return time.time()


# ---------- 파서: 로그 한 줄 → [(kind, text)] ----------
# kind: read edit run web sub tool say you done error stat(토큰만 바뀜)

READ = {'Read', 'Grep', 'Glob', 'LS'}
EDIT = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit'}
WEB = {'WebFetch', 'WebSearch'}
SUB = {'Agent', 'Task'}
ARG_KEYS = ('command', 'cmd', 'pattern', 'query', 'url', 'file_path', 'notebook_path', 'description', 'path', 'prompt')
PATH_KEYS = {'file_path', 'notebook_path', 'path'}
TOOL_KINDS = {'read', 'edit', 'run', 'web', 'sub', 'tool'}


def tool_kind(name):
    if name in READ:
        return 'read'
    if name in EDIT:
        return 'edit'
    if name in ('Bash', 'exec_command', 'shell'):
        return 'run'
    if name in WEB:
        return 'web'
    if name in SUB:
        return 'sub'
    return 'tool'


def tool_arg(inp):
    for k in ARG_KEYS:
        if inp.get(k):
            return base(inp[k]) if k in PATH_KEYS else short(inp[k], 48)
    return ''


def parse_claude(s, o):
    t, out = o.get('type'), []
    if o.get('cwd') and not s['parent']:  # 훅과 같은 기준: 지금 작업 폴더 (서브에이전트는 agentType 유지)
        s['label'] = base(o['cwd'])
    m = o.get('message') if isinstance(o.get('message'), dict) else {}
    c = m.get('content')
    if t == 'assistant':
        mid = m.get('id')
        if mid and mid not in s['msgs']:  # 응답 하나가 블록별로 여러 줄에 나뉘어 기록됨 → 토큰은 한 번만
            s['msgs'].append(mid)
            s['tokens'] += (m.get('usage') or {}).get('output_tokens') or 0
        for b in c if isinstance(c, list) else []:
            if b.get('type') == 'tool_use':
                name = b.get('name', '').split('__')[-1]  # mcp__server__tool → tool
                out.append((tool_kind(name), (name + ' ' + tool_arg(b.get('input') or {})).strip()))
            elif b.get('type') == 'text' and b.get('text', '').strip():
                out.append(('say', short(b['text'])))
        if m.get('stop_reason') == 'end_turn' and s['ended'] != mid:
            s['ended'] = mid
            out.append(('done', 'turn complete'))
    elif t == 'user' and not o.get('isMeta'):
        for b in c if isinstance(c, list) else [{'type': 'text', 'text': c or ''}]:
            if b.get('type') == 'tool_result' and b.get('is_error'):
                out.append(('error', short(text_of(b.get('content')))))
            elif b.get('type') == 'text':
                txt = b.get('text', '').strip()
                if txt.startswith('[Request interrupted'):
                    out.append(('error', 'interrupted'))
                elif txt and not txt.startswith('<') and not s['parent']:
                    out.append(('you', short(txt)))
    return out


def parse_codex(s, o):
    p = o.get('payload') if isinstance(o.get('payload'), dict) else {}
    t = p.get('type')
    if o.get('type') == 'session_meta':
        s['label'] = base(p.get('cwd') or '') or s['label']
        return []
    if t == 'token_count':
        s['tokens'] = ((p.get('info') or {}).get('total_token_usage') or {}).get('output_tokens') or s['tokens']
        return [('stat', '')]
    if t == 'task_complete':
        return [('done', 'turn complete')]
    if t == 'turn_aborted':
        return [('error', p.get('reason') or 'aborted')]
    it = p.get('item') if t == 'item_completed' and isinstance(p.get('item'), dict) else {}
    k = it.get('type')
    if k == 'CommandExecution':
        cmd = it.get('command')
        cmd = cmd[-1] if isinstance(cmd, list) and cmd else str(cmd or '')
        if it.get('exit_code') not in (None, 0):
            return [('error', 'exit %s · %s' % (it['exit_code'], short(cmd, 44)))]
        kinds = {c.get('type') for c in it.get('parsed_cmd') or [] if isinstance(c, dict)}
        return [('read' if kinds and kinds <= {'read', 'search', 'list_files'} else 'run', short(cmd, 56))]
    if k == 'FileChange':
        return [('edit', short(', '.join(base(f) for f in it.get('changes') or {}), 56))]
    if k == 'AgentMessage':
        return [('say', short(text_of(it.get('content'))))]
    if k == 'UserMessage':
        return [('you', short(text_of(it.get('content'))))]
    if k == 'Extension':
        return [('web', short(it.get('query') or it.get('kind') or 'extension', 56))]
    if k == 'ImageView':
        return [('read', base(it.get('path') or 'image'))]
    return []


PARSERS = {'claude': parse_claude, 'codex': parse_codex}


# ---------- 로그 감시 + 기록 저장 ----------

sessions, checkpoint, clients, running = {}, {}, set(), {}
history, ended = deque(maxlen=300), deque(maxlen=500)
lock = threading.Lock()
seq = 0
CKPT_KEYS = ('id', 'agent', 'label', 'parent', 'tokens', 'tok_sent', 'ended', 'offset')
STORE_KEYS = ('id', 'parent', 'agent', 'label', 'kind', 'text', 'dtok', 'ts')


def watched():
    # ponytail: 0.5초마다 glob+stat 전체 스캔. 로그가 수천 개를 넘어 느려지면 FSEvents/inotify 로 교체
    pats = [(HOME + '/.claude/projects/*/*.jsonl', 'claude'),
            (HOME + '/.claude/projects/*/*/subagents/*.jsonl', 'claude')]
    pats += [(HOME + '/.codex/sessions/%s/*.jsonl' % (date.today() - timedelta(days=d)).strftime('%Y/%m/%d'), 'codex')
             for d in range(RETENTION_DAYS)]
    for pat, agent in pats:
        for path in glob.glob(pat):
            yield path, agent


def register(path, agent, size):
    s = {'path': path, 'id': os.path.basename(path)[:-6], 'agent': agent, 'label': '', 'parent': None,
         'tokens': 0, 'tok_sent': 0, 'msgs': deque(maxlen=16), 'ended': None, 'offset': size, 'floor': 0,
         'touched': False}
    if os.path.basename(os.path.dirname(path)) == 'subagents':
        s['parent'] = os.path.basename(os.path.dirname(os.path.dirname(path)))
        s['label'] = (read_json(path[:-6] + '.meta.json') or {}).get('agentType', '')
    if agent == 'codex':  # cwd 는 첫 줄(session_meta)에만 있다
        try:
            with open(path, encoding='utf-8') as f:
                parse_codex(s, json.loads(f.readline()))
        except (OSError, ValueError):
            pass
    saved = checkpoint.get(path)
    if saved:  # 전에 읽던 파일: 읽은 곳부터 이어서 (꺼져 있던 동안의 기록도 빠짐없이)
        s.update({k: saved[k] for k in CKPT_KEYS if k in saved})
        s['msgs'].extend(saved.get('msgs', []))
        s['touched'] = True
    elif os.path.getmtime(path) >= day_start():  # 처음 보는 오늘 파일: 오늘 기록만 채워 넣음
        s['offset'], s['floor'] = 0, day_start()
    sessions[path] = s
    return s


def poll():
    dirty = False
    for path, agent in watched():
        try:
            size = os.path.getsize(path)
            s = sessions.get(path) or register(path, agent, size)
        except OSError:
            continue
        if size < s['offset']:  # 잘리거나 새로 쓰인 파일
            s['offset'] = 0
        if size == s['offset']:
            continue
        # ponytail: 새로 붙은 부분을 한 번에 읽음. 수백 MB 로그를 처음 채울 때 메모리가 문제면 청크로
        with open(path, 'rb') as f:
            f.seek(s['offset'])
            data = f.read(size - s['offset'])
        end = data.rfind(b'\n')
        if end < 0:
            continue  # 아직 쓰는 중인 줄
        s['offset'] += end + 1
        s['touched'] = dirty = True
        parse = PARSERS[agent]
        for line in data[:end].split(b'\n'):
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if isinstance(o, dict):
                for kind, text in parse(s, o):
                    emit(s, kind, text, ts_of(o))
    return dirty


def emit(s, kind, text, ts):
    if ts < s['floor']:
        s['tok_sent'] = s['tokens']  # 오늘 이전 토큰은 오늘 합계에 넣지 않음
        return
    if kind in ('say', 'you') and not text:
        return
    dtok = max(0, s['tokens'] - s['tok_sent'])
    s['tok_sent'] = s['tokens']
    if kind == 'stat' and not dtok:
        return
    publish({'id': s['id'], 'parent': s['parent'], 'agent': s['agent'], 'label': s['label'] or s['agent'],
             'kind': kind, 'text': text, 'dtok': dtok, 'ts': ts}, store=True)


def store_append(e):
    os.makedirs(EVENTS_DIR, exist_ok=True)
    name = datetime.fromtimestamp(e['ts']).strftime('%Y-%m-%d') + '.jsonl'
    with open(os.path.join(EVENTS_DIR, name), 'a', encoding='utf-8') as f:
        f.write(json.dumps({k: e[k] for k in STORE_KEYS}, ensure_ascii=False) + '\n')


def read_events(since, until=None):
    d, last = date.fromtimestamp(since), date.fromtimestamp(until or time.time())
    while d <= last:
        try:
            with open(os.path.join(EVENTS_DIR, d.isoformat() + '.jsonl'), encoding='utf-8') as f:
                for line in f:
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    if since <= e['ts'] and (until is None or e['ts'] < until):
                        yield e
        except FileNotFoundError:
            pass
        d += timedelta(days=1)


def summarize(events):
    out = {}
    for e in events:
        x = out.get(e['id'])
        if x is None:
            x = out[e['id']] = {'id': e['id'], 'agent': e['agent'], 'parent': e['parent'], 'label': e['label'],
                                'first': e['ts'], 'last': e['ts'], 'tools': 0, 'read': 0, 'edit': 0, 'run': 0,
                                'other': 0, 'turns': 0, 'errors': 0, 'tokens': 0, 'kind': None, 'text': ''}
        k = e['kind']
        x['label'], x['last'] = e['label'], max(x['last'], e['ts'])
        x['tokens'] += e.get('dtok') or 0
        if k in TOOL_KINDS:
            x['tools'] += 1
            x[k if k in ('read', 'edit', 'run') else 'other'] += 1
        elif k == 'done':
            x['turns'] += 1
        elif k == 'error':
            x['errors'] += 1
        if k != 'stat':
            x['kind'], x['text'] = k, e['text']
    return sorted(out.values(), key=lambda x: -x['last'])


def summary(since, until):
    with lock:  # 파일에 쓰기와 seq 부여가 같은 잠금 안에서 일어나므로, seq 이후 이벤트만 더하면 중복이 없다
        return {'sessions': summarize(read_events(since, until)), 'seq': seq, 'since': since, 'until': until}


def session_events(sid, since, until, limit=500):
    with lock:
        evs = [e for e in read_events(since, until) if e['id'] == sid and e['kind'] != 'stat']
    return evs[-limit:]


def publish(e, store=False):
    global seq
    with lock:
        k = e['kind']
        if k == 'start':
            if e['tool'] in ended:
                return  # async 훅이라 끝 신호가 먼저 도착한 경우
            running[e['tool']] = e
        elif k == 'end':
            running.pop(e['tool'], None)
            ended.append(e['tool'])
        else:
            seq += 1
            e['seq'] = seq
            if store:
                store_append(e)
            if k != 'stat':
                history.append(e)
        for q in clients:
            q.put(e)


def save_checkpoint():
    files = {p: dict({k: s[k] for k in CKPT_KEYS}, msgs=list(s['msgs'])) for p, s in sessions.items() if s['touched']}
    write_text(CKPT_FILE, json.dumps({'version': 1, 'files': files}))


def prune():
    cutoff = (date.today() - timedelta(days=RETENTION_DAYS - 1)).isoformat()
    for f in glob.glob(os.path.join(EVENTS_DIR, '*.jsonl')):
        if os.path.basename(f)[:10] < cutoff:
            os.remove(f)
    old = time.time() - RETENTION_DAYS * 86400
    for p in [p for p, s in sessions.items() if not os.path.exists(p) or os.path.getmtime(p) < old]:
        sessions[p]['touched'] = False  # 보관 기간이 지난 로그는 체크포인트에서도 뺀다


def load_history():
    global seq
    for e in list(read_events(day_start()))[-history.maxlen:]:
        if e['kind'] != 'stat':
            seq += 1
            e['seq'] = seq
            history.append(e)


def watch():
    last_save = last_prune = 0.0
    pending = False
    while True:
        try:
            pending = poll() or pending
            now = time.time()
            if pending and now - last_save > 1:
                save_checkpoint()
                last_save, pending = now, False
            if now - last_prune > 3600:
                prune()
                last_prune = now
        except Exception as ex:  # 감시 스레드가 죽으면 대시보드가 조용히 멈추므로 로그만 남기고 계속
            log('watch error:', repr(ex))
        time.sleep(0.5)


# ---------- 훅: 도구 실행 시작/끝 (실시간, 저장 안 함) ----------

HOOK_PHASE = {'PreToolUse': 'start', 'PostToolUse': 'end', 'PostToolUseFailure': 'end'}


def hook(agent, h):
    phase, tid = HOOK_PHASE.get(h.get('hook_event_name')), h.get('tool_use_id')
    if not phase or not tid:
        return
    aid, tp = h.get('agent_id'), str(h.get('transcript_path') or '')
    # 노드 id 를 로그 쪽과 맞춘다: 서브에이전트 agent-<id>, 그 외엔 로그 파일 이름
    sid = 'agent-' + aid.replace('agent-', '', 1) if aid else (base(tp)[:-6] if tp.endswith('.jsonl') else h.get('session_id', '?'))
    inp = h.get('tool_input') if isinstance(h.get('tool_input'), dict) else {}
    name = str(h.get('tool_name') or '').split('__')[-1]
    publish({'id': sid, 'parent': h.get('session_id') if aid else None, 'agent': agent,
             'label': (h.get('agent_type') if aid else base(h.get('cwd') or '')) or agent,
             'kind': phase, 'tool': tid, 'ok': h.get('hook_event_name') != 'PostToolUseFailure',
             'text': (name + ' ' + tool_arg(inp)).strip(), 'ts': time.time()})


# ---------- 에이전트 설정: 연결 / 해제 / 승인 ----------

act_lock = threading.Lock()


def hook_cmd(agent):
    # 수집기가 꺼져 있어도 조용히 통과: 백그라운드(async), 1초 제한, 항상 exit 0
    return ("curl -s -m 1 -H 'Content-Type: application/json' --data-binary @- "
            "'http://127.0.0.1:%d/hook?agent=%s' >/dev/null 2>&1 || true" % (PORT, agent))


def is_our_cmd(cmd):  # 이전 버전(포트 7777)이 넣은 훅도 우리 것으로 인식해 교체
    return isinstance(cmd, str) and "'http://127.0.0.1:" in cmd and '/hook?agent=' in cmd


def is_ours(group):
    return isinstance(group, dict) and any(isinstance(h, dict) and is_our_cmd(h.get('command'))
                                           for h in group.get('hooks') or [])


def load_settings(text):
    d = json.loads(text) if text and text.strip() else {}
    if not isinstance(d, dict) or not isinstance(d.get('hooks', {}), dict):
        raise ValueError('unexpected settings shape')
    return d


def render(agent, text, connect):
    a, d = AGENTS[agent], load_settings(text)
    hooks = d.setdefault('hooks', {})
    for ev in a['events']:
        groups = [g for g in hooks.get(ev) or [] if not is_ours(g)]  # 다른 훅은 순서 그대로, 우리 것은 맨 뒤
        if connect:
            groups.append({'hooks': [dict({'type': 'command', 'command': hook_cmd(agent)}, **a['opts'])]})
        if groups:
            hooks[ev] = groups
        else:
            hooks.pop(ev, None)
    if not hooks:
        d.pop('hooks')
    return json.dumps(d, indent=2, ensure_ascii=False) + '\n'


def has_ours(text):
    hooks = load_settings(text).get('hooks', {})
    return any(is_ours(g) for groups in hooks.values() if isinstance(groups, list) for g in groups)


def hooks_state(agent):
    try:
        hooks = load_settings(read_text(os.path.expanduser(AGENTS[agent]['file']))).get('hooks', {})
    except ValueError:
        return 'none'
    cmds = {ev: [h.get('command') for g in hooks.get(ev) or [] if is_ours(g) for h in g['hooks'] if isinstance(h, dict)]
            for ev in AGENTS[agent]['events']}
    if all(cmds[ev] == [hook_cmd(agent)] for ev in cmds):
        return 'connected'
    return 'legacy' if any(cmds.values()) else 'none'


def plan(agent, connect):
    path = os.path.expanduser(AGENTS[agent]['file'])
    before = read_text(path)
    rec = (read_json(RESTORE_FILE) or {}).get(agent)
    if not connect and rec and before is not None and sha(before) == rec.get('after'):
        return path, before, rec.get('before')  # 연결한 뒤 아무도 안 건드렸으면 원래 바이트 그대로 복원
    after = render(agent, before, connect)
    if before is None and not connect:
        after = None
    return path, before, after


def preview(agent, action):
    a = AGENTS[agent]
    out = {'agent': agent, 'name': a['name'], 'action': action, 'command': hook_cmd(agent),
           'trust': agent == 'codex' and action in ('connect', 'trust'), 'diff': '', 'path': tilde(os.path.expanduser(a['file']))}
    if action != 'trust':
        path, before, after = plan(agent, action == 'connect')
        out['diff'] = ''.join(difflib.unified_diff((before or '').splitlines(True), (after or '').splitlines(True),
                                                   tilde(path), tilde(path), n=1))
    return out


def act(agent, action):
    name = AGENTS[agent]['name']
    with act_lock:
        recs = read_json(RESTORE_FILE) or {}
        if action == 'trust':
            rec = recs.setdefault(agent, {})
            trust = codex_trust_with_record(rec)
            write_text(RESTORE_FILE, json.dumps(recs))
            return {'ok': trust == 'trusted', 'trust': trust, 'message': trust_message(trust)}
        connect = action == 'connect'
        try:
            path, before, after = plan(agent, connect)
        except ValueError:
            return {'ok': False, 'message': '%s 설정 파일이 올바른 JSON이 아니라서 건드리지 않았습니다.' % name}
        rec = recs.get(agent)
        fresh = not (rec and before is not None and sha(before) == rec.get('after'))
        if connect:
            if fresh:  # 처음 연결: 우리 옛 훅을 뺀 원본을 기억해 두었다가 해제할 때 그대로 되돌린다
                rec = {'before': render(agent, before, False) if before is not None and has_ours(before) else before}
            if before is not None and not os.path.exists(path + '.orbit-bak'):
                shutil.copy2(path, path + '.orbit-bak')  # 최초 원본은 삭제 후에도 남는다
            write_text(path, after)
            rec['after'] = sha(after)
            recs[agent] = rec
            trust = codex_trust_with_record(rec) if agent == 'codex' else None
            msg = '%s 연결됨.' % name + (' ' + trust_message(trust) if agent == 'codex' else ' 실행 중인 세션에도 바로 적용됩니다.')
        else:
            if after != before:
                write_text(path, after)
            exact = not fresh
            recs.pop(agent, None)
            if agent == 'codex' and rec:
                codex_restore_config(rec)
            trust = None
            msg = '%s 연결 해제됨. ' % name + ('설정 파일을 연결 전 그대로 되돌렸습니다.' if exact
                                           else 'agent-orbit 훅만 제거했습니다 (그 사이 다른 설정이 바뀌어 있어서).')
        write_text(RESTORE_FILE, json.dumps(recs))
        return {'ok': True, 'trust': trust, 'message': msg}


def trust_message(trust):
    return {'trusted': '승인 완료 — 새로 시작하는 Codex 세션부터 적용됩니다.',
            'untrusted': '승인되지 않았습니다. Codex 에서 /hooks 를 열어 승인하세요.',
            'unknown': 'codex 명령을 찾지 못해 승인하지 못했습니다. Codex 에서 /hooks 를 열어 승인하세요.',
            'none': '승인할 훅이 없습니다. 먼저 연결하세요.'}.get(trust, '')


# Codex 는 새 훅을 사용자가 승인해야 실행한다. 연결 확인 창에서 명령 원문을 보고 동의한 경우에만
# 공식 app-server API(hooks/list + config/batchWrite — /hooks 화면과 같은 경로)로 승인한다.

_trust_cache = [0.0, None]


def codex_rpc(calls, timeout=20):
    exe = shutil.which('codex')
    if not exe:
        return None
    try:
        p = subprocess.Popen([exe, 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return None
    deadline, buf = time.time() + timeout, [b'']

    def send(o):
        p.stdin.write((json.dumps(o) + '\n').encode())
        p.stdin.flush()

    def wait(i):
        while True:
            while b'\n' in buf[0]:
                line, buf[0] = buf[0].split(b'\n', 1)
                try:
                    m = json.loads(line)
                except ValueError:
                    continue
                if isinstance(m, dict) and m.get('id') == i:
                    return m
            left = deadline - time.time()
            if left <= 0 or not select.select([p.stdout], [], [], left)[0]:
                raise TimeoutError
            chunk = os.read(p.stdout.fileno(), 65536)
            if not chunk:
                raise EOFError
            buf[0] += chunk

    try:
        send({'id': 0, 'method': 'initialize', 'params': {'clientInfo': {'name': 'agent-orbit', 'version': VERSION}}})
        wait(0)
        send({'method': 'initialized'})
        out = []
        for i, (method, params) in enumerate(calls, 1):
            send({'id': i, 'method': method, 'params': params})
            out.append(wait(i))
        return out
    except (OSError, TimeoutError, EOFError):
        return None
    finally:
        p.kill()
        p.wait()


def codex_our_hooks(extra_calls=()):
    r = codex_rpc(list(extra_calls) + [('hooks/list', {'cwds': [HOME]})])
    if not r or 'result' not in r[-1]:
        return None
    return [h for e in r[-1]['result'].get('data') or [] for h in e.get('hooks') or []
            if h.get('command') == hook_cmd('codex')]


def trust_of(hooks):
    if hooks is None:
        return 'unknown'
    if not hooks:
        return 'none'
    ok = all(h.get('enabled') and h.get('trustStatus') in ('trusted', 'managed') for h in hooks)
    return 'trusted' if ok else 'untrusted'


def codex_trust_state(fresh=False):
    if fresh or time.time() - _trust_cache[0] > 15:
        _trust_cache[:] = [time.time(), trust_of(codex_our_hooks())]
    return _trust_cache[1]


def codex_trust():
    hooks = codex_our_hooks()
    if hooks:
        value = {h['key']: {'trusted_hash': h['currentHash'], 'enabled': True} for h in hooks}
        hooks = codex_our_hooks([('config/batchWrite', {'edits': [
            {'keyPath': 'hooks.state', 'mergeStrategy': 'upsert', 'value': value}]})])
    _trust_cache[:] = [time.time(), trust_of(hooks)]
    return _trust_cache[1]


def codex_trust_with_record(rec):
    cfg = os.path.expanduser(CODEX_CONFIG)
    before = read_text(cfg)
    trust = codex_trust()
    if 'cfg_after' not in rec or sha(before) != rec['cfg_after']:  # 처음 승인할 때의 원본만 기억
        rec['cfg_before'] = before
    rec['cfg_after'] = sha(read_text(cfg))
    return trust


def codex_restore_config(rec):
    cfg = os.path.expanduser(CODEX_CONFIG)
    if 'cfg_before' in rec and sha(read_text(cfg)) == rec.get('cfg_after') and rec['cfg_before'] != read_text(cfg):
        write_text(cfg, rec['cfg_before'])  # 승인 뒤 아무도 안 건드렸으면 승인 기록까지 원래대로
    _trust_cache[0] = 0


def agent_state(agent):
    a, st = AGENTS[agent], hooks_state(agent)
    out = {'name': a['name'], 'installed': os.path.isdir(os.path.expanduser(a['dir'])),
           'connected': st == 'connected', 'legacy': st == 'legacy'}
    if agent == 'codex' and st == 'connected':
        out['trust'] = codex_trust_state()
    return out


def status():
    return {'version': VERSION, 'protocol': PROTOCOL, 'port': PORT, 'boot': BOOT, 'platform': sys.platform,
            'autostart': autostart_state(), 'retentionDays': RETENTION_DAYS,
            'agents': {k: agent_state(k) for k in AGENTS}}


# ---------- 자동 실행 (macOS launchd / Linux systemd 사용자 서비스) ----------

def run(*cmd):
    try:
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as ex:
        return subprocess.CompletedProcess(cmd, 1, '', str(ex))


def service_file():
    if sys.platform == 'darwin':
        return os.path.join(HOME, 'Library/LaunchAgents/%s.plist' % LABEL)
    return os.path.join(HOME, '.config/systemd/user/agent-orbit.service')


def launchd_target():
    return 'gui/%d/%s' % (os.getuid(), LABEL)


def autostart_state():
    if not os.path.exists(service_file()):
        return None
    if sys.platform == 'darwin':
        for line in run('launchctl', 'print-disabled', 'gui/%d' % os.getuid()).stdout.splitlines():
            if '"%s"' % LABEL in line:
                return not line.rstrip().endswith(('disabled', 'true'))
        return True
    return run('systemctl', '--user', 'is-enabled', 'agent-orbit.service').stdout.strip() == 'enabled'


def set_autostart(on):
    """로그인할 때 켜질지만 바꾼다. 지금 실행 중인 수집기는 그대로 둔다."""
    if not os.path.exists(service_file()):
        return None
    if sys.platform == 'darwin':
        run('launchctl', 'enable' if on else 'disable', launchd_target())
    else:
        run('systemctl', '--user', 'enable' if on else 'disable', 'agent-orbit.service')
    return autostart_state()


def install_service():
    py, script, path_env = sys.executable, os.path.join(APP_DIR, 'agent_orbit.py'), os.environ.get('PATH', '/usr/bin:/bin')
    f = service_file()
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if sys.platform == 'darwin':
        import plistlib
        with open(f, 'wb') as fp:
            plistlib.dump({'Label': LABEL, 'ProgramArguments': [py, script, 'serve'],
                           'EnvironmentVariables': {'PATH': path_env},  # codex 명령을 찾을 수 있게 설치 시점 PATH
                           'RunAtLoad': True, 'KeepAlive': True,
                           'StandardOutPath': LOG_FILE, 'StandardErrorPath': LOG_FILE}, fp)
        run('launchctl', 'bootout', launchd_target())
        run('launchctl', 'enable', launchd_target())
        for _ in range(10):  # bootout 직후엔 잠깐 실패할 수 있다
            r = run('launchctl', 'bootstrap', 'gui/%d' % os.getuid(), f)
            if r.returncode == 0:
                return True, ''
            time.sleep(0.5)
        return False, r.stderr.strip()
    write_text(f, '[Unit]\nDescription=Agent Orbit collector\n\n[Service]\nExecStart=%s %s serve\n'
                  'Environment=PATH=%s\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n' % (py, script, path_env))
    run('systemctl', '--user', 'daemon-reload')
    r = run('systemctl', '--user', 'enable', '--now', 'agent-orbit.service')
    if r.returncode == 0:
        r = run('systemctl', '--user', 'restart', 'agent-orbit.service')
        return r.returncode == 0, r.stderr.strip()
    os.remove(f)  # systemd 사용자 서비스가 없는 환경: 지금만 백그라운드로 실행
    with open(LOG_FILE, 'a') as lf:
        subprocess.Popen([py, script, 'serve'], stdout=lf, stderr=lf, stdin=subprocess.DEVNULL, start_new_session=True)
    return True, '자동 실행을 등록하지 못해(systemd 사용자 서비스 없음) 지금만 실행했습니다. 재부팅 후엔 agent-orbit serve 로 켜세요.'


def remove_service():
    f = service_file()
    if sys.platform == 'darwin':
        run('launchctl', 'bootout', launchd_target())
    elif os.path.exists(f):
        run('systemctl', '--user', 'disable', '--now', 'agent-orbit.service')
    if os.path.exists(f):
        os.remove(f)
        if sys.platform != 'darwin':
            run('systemctl', '--user', 'daemon-reload')


# ---------- HTTP: 대시보드 파일 + API + SSE ----------

STATIC = {'/': ('index.html', 'text/html; charset=utf-8'), '/index.html': ('index.html', 'text/html; charset=utf-8'),
          '/app.js': ('app.js', 'text/javascript; charset=utf-8')}
LOCAL_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
             "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


def span(q):
    try:
        since = float(q.get('since') or day_start())
        until = float(q['until']) if q.get('until') else None
    except ValueError:
        since, until = day_start(), None
    return max(since, day_start(RETENTION_DAYS)), until


class Handler(BaseHTTPRequestHandler):
    server_version = 'agent-orbit/' + VERSION

    def log_message(self, *a):
        pass

    def host_ok(self):
        if self.headers.get('Host') in HOSTS:
            return True
        self.send_error(403)
        return False

    def cors(self):
        o = self.headers.get('Origin')
        if o in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', o)
            self.send_header('Vary', 'Origin')

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.host_ok():
            return
        self.send_response(204)
        self.cors()
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Max-Age', '600')
        self.end_headers()

    def do_GET(self):
        if not self.host_ok():
            return
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        p = u.path
        if p in STATIC:
            return self.static(*STATIC[p])
        if p == '/api/status':
            return self.reply(200, status())
        if p == '/api/events':
            return self.stream()
        if p == '/api/summary':
            return self.reply(200, summary(*span(q)))
        if p.startswith('/api/sessions/'):
            return self.reply(200, {'events': session_events(unquote(p[len('/api/sessions/'):]), *span(q))})
        if p == '/api/preview':
            agent, action = q.get('agent'), q.get('action')
            if agent not in AGENTS or action not in ('connect', 'disconnect', 'trust') or (action == 'trust' and agent != 'codex'):
                return self.reply(400, {'error': 'bad request'})
            try:
                return self.reply(200, preview(agent, action))
            except ValueError:
                return self.reply(200, {'error': '설정 파일이 올바른 JSON이 아닙니다.'})
        self.send_error(404)

    def do_POST(self):
        if not self.host_ok():
            return
        u = urlparse(self.path)
        n = int(self.headers.get('Content-Length') or 0)
        if n > 16 * 1024 * 1024:
            return self.send_error(413)
        body = self.rfile.read(n)
        if u.path == '/hook':
            # 훅은 에이전트가 curl 로만 보낸다. 브라우저발 요청(Origin 있음)은 거부: 다른 사이트의 가짜 이벤트 주입 차단
            if self.headers.get('Origin'):
                return self.send_error(403)
            agent = parse_qs(u.query).get('agent', [''])[0]
            try:
                if agent in AGENTS:
                    hook(agent, json.loads(body))
            except (ValueError, AttributeError):
                pass
            self.send_response(204)
            self.end_headers()
            return
        # 설정을 바꾸는 요청: 허용한 사이트 + JSON 만 (JSON 이면 브라우저가 반드시 사전 확인을 거친다)
        if self.headers.get('Origin') not in ORIGINS | LOCAL_ORIGINS:
            return self.reply(403, {'error': 'origin not allowed'})
        if not (self.headers.get('Content-Type') or '').startswith('application/json'):
            return self.reply(415, {'error': 'json only'})
        try:
            data = json.loads(body or b'{}')
        except ValueError:
            data = None
        if not isinstance(data, dict):
            return self.reply(400, {'error': 'bad request'})
        action = u.path.rsplit('/', 1)[-1]
        if u.path in ('/api/connect', '/api/disconnect', '/api/trust'):
            agent = data.get('agent')
            if agent not in AGENTS or (action == 'trust' and agent != 'codex'):
                return self.reply(400, {'error': 'bad request'})
            return self.reply(200, act(agent, action))
        if u.path == '/api/autostart':
            return self.reply(200, {'autostart': set_autostart(bool(data.get('enabled')))})
        self.reply(404, {'error': 'not found'})

    def static(self, name, ctype):
        try:
            with open(os.path.join(HERE, name), 'rb') as f:
                body = f.read()
        except OSError:
            return self.send_error(404)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Content-Security-Policy', LOCAL_CSP)
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def stream(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.cors()
        self.end_headers()
        q = queue.Queue()
        with lock:
            now, today = time.time(), day_start()
            backlog = [{'kind': 'hello', 'boot': BOOT, 'version': VERSION, 'protocol': PROTOCOL}]
            backlog += [dict(e, replay=True) for e in list(history)[-80:] if e['ts'] >= today]
            backlog += [dict(e, replay=True) for e in running.values() if now - e['ts'] < 1800]  # 끝 신호 유실 대비 30분
            clients.add(q)
        try:
            for e in backlog:
                self.send_event(e)
            while True:
                try:
                    self.send_event(q.get(timeout=15))
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with lock:
                clients.discard(q)

    def send_event(self, e):
        self.wfile.write(b'data: ' + json.dumps(e, ensure_ascii=False).encode() + b'\n\n')
        self.wfile.flush()


def serve():
    checkpoint.update((read_json(CKPT_FILE) or {}).get('files') or {})
    os.makedirs(EVENTS_DIR, exist_ok=True)
    prune()
    load_history()
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError as ex:
        sys.exit('agent-orbit: 포트 %d 를 열 수 없습니다 (%s)' % (PORT, ex))
    threading.Thread(target=watch, daemon=True).start()
    log('agent-orbit %s → http://127.0.0.1:%d' % (VERSION, PORT))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


# ---------- CLI ----------

def die(msg):
    sys.exit('agent-orbit: ' + msg)


def confirm(prompt):
    try:
        return input(prompt).strip().lower() in ('y', 'yes')
    except EOFError:
        return False


def local_status(timeout=10):
    try:
        with urlopen('http://127.0.0.1:%d/api/status' % PORT, timeout=timeout) as r:
            return json.load(r)
    except (OSError, ValueError):
        return None


def port_open():
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', PORT)) == 0


def cmd_setup(args):
    print('Agent Orbit %s 설치' % VERSION)
    if local_status(3) is None and port_open():
        die('포트 %d 를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끈 뒤 다시 설치하세요.' % PORT)
    for agent in AGENTS:
        if hooks_state(agent) == 'legacy':
            act(agent, 'connect')
            print('· 이전 버전 %s 훅을 새 버전으로 옮겼습니다' % AGENTS[agent]['name'])
    ok, err = install_service()
    st = None
    for _ in range(40):
        st = local_status(3)
        if st and st.get('version') == VERSION:
            break
        time.sleep(0.3)
    if not st:
        die('수집기가 시작되지 않았습니다. %s\n로그: %s' % (err, tilde(LOG_FILE)))
    if err:
        print('· ' + err)
    print('✓ 수집기 실행 중 · http://127.0.0.1:%d%s' % (PORT, ' (로그인할 때 자동 실행)' if st.get('autostart') else ''))
    print('\n다음: 브라우저에서 %s 를 열고 Claude Code · Codex 를 연결하세요.' % SITE)
    print('      Safari 라면 http://127.0.0.1:%d 로 여세요.' % PORT)
    cli = shutil.which('agent-orbit') or os.path.join(APP_DIR, 'bin', 'agent-orbit')
    print('명령:  %s doctor | uninstall' % ('agent-orbit' if shutil.which('agent-orbit') else tilde(cli)))


def cmd_hooks(action, args):
    agent = args[0] if args else ''
    if agent not in AGENTS:
        die('사용법: agent-orbit %s claude|codex' % action)
    try:
        p = preview(agent, action)
    except ValueError:
        die('%s 설정 파일이 올바른 JSON이 아닙니다.' % AGENTS[agent]['name'])
    print(p['diff'] or '설정 파일은 바뀌지 않습니다.')
    if p['trust']:
        print('Codex 훅 승인도 함께 처리합니다 (Codex 의 /hooks 에서 승인하는 것과 같음).')
    if (p['diff'] or p['trust']) and '--yes' not in args and not confirm('적용할까요? [y/N] '):
        return
    print(act(agent, action)['message'])


def cmd_doctor(args):
    st = local_status()
    lines = ['Agent Orbit doctor',
             'version     %s (protocol %d)' % (VERSION, PROTOCOL),
             'python      %s (%s)' % (sys.version.split()[0], sys.executable),
             'platform    %s' % platform.platform(),
             'install     %s' % tilde(APP_DIR),
             'collector   %s' % ('running %s on 127.0.0.1:%d' % (st['version'], PORT) if st else
                                 'NOT RUNNING (127.0.0.1:%d%s)' % (PORT, ' — port used by another program' if port_open() else '')),
             'autostart   %s' % {None: 'not installed', True: 'on', False: 'off'}[autostart_state()]]
    for k in AGENTS:
        a = (st or {}).get('agents', {}).get(k) or agent_state(k)
        lines.append('%-11s installed=%s hooks=%s%s' % (k, a['installed'], 'connected' if a['connected'] else 'legacy' if a.get('legacy') else 'off',
                                                       ' trust=%s' % a['trust'] if a.get('trust') else ''))
    days = sorted(glob.glob(os.path.join(EVENTS_DIR, '*.jsonl')))
    size = sum(os.path.getsize(f) for f in days)
    lines.append('history     %d days, %.1f KB' % (len(days), size / 1024))
    lines.append('site        %s' % SITE)
    print('\n'.join(lines))


def cmd_uninstall(args):
    if '--yes' not in args and not confirm('Agent Orbit 을 완전히 삭제할까요? 훅 해제, 자동 실행 해제, %s(기록 포함) 삭제 [y/N] ' % tilde(APP_DIR)):
        return
    for k in AGENTS:
        if hooks_state(k) != 'none':
            print('· ' + act(k, 'disconnect')['message'])
    remove_service()
    print('· 자동 실행 해제')
    link = os.path.join(HOME, '.local/bin/agent-orbit')
    if os.path.islink(link) and os.readlink(link).startswith(APP_DIR):
        os.remove(link)
    shutil.rmtree(APP_DIR, ignore_errors=True)
    print('· %s 삭제' % tilde(APP_DIR))
    print('설정 파일의 최초 백업(*.orbit-bak)은 남겨 두었습니다.')


def main(argv):
    cmd, args = (argv[0] if argv else 'help'), argv[1:]
    if cmd == 'serve':
        serve()
    elif cmd == 'setup':
        cmd_setup(args)
    elif cmd in ('connect', 'disconnect'):
        cmd_hooks(cmd, args)
    elif cmd == 'doctor':
        cmd_doctor(args)
    elif cmd == 'uninstall':
        cmd_uninstall(args)
    elif cmd in ('version', '--version', '-v'):
        print(VERSION)
    else:
        print(__doc__.strip())


if __name__ == '__main__':
    main(sys.argv[1:])
