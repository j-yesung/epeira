#!/usr/bin/env python3
"""agent-orbit — Claude Code / Codex 세션 로그를 tail 해서 대시보드로 실시간 스트리밍.

  python3 server.py          → http://127.0.0.1:7777
  python3 server.py --test   → 파서 셀프 체크

에이전트는 평소처럼 아무 터미널에서 `claude`, `codex` 로 실행하면 된다.
두 CLI 가 이미 남기는 세션 로그(~/.claude/projects, ~/.codex/sessions)를 읽기만 한다.
"""
import glob
import json
import os
import queue
import sys
import threading
import time
from collections import deque
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

HOME = os.path.expanduser('~')
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', '7777'))
REPLAY_WINDOW = 15 * 60  # 최근 15분 안에 움직인 세션은 시작할 때 꼬리를 재생
REPLAY_BYTES = 256 * 1024
BOOT = str(int(time.time()))
# 배포된 대시보드(다른 출처)가 이 로컬 서버의 /events 를 읽도록 허용할 주소. 정확히 일치하는 것만 허용:
# '*' 로 열면 내가 방문한 아무 웹사이트나 에이전트 로그를 읽어갈 수 있다.
ORIGINS = set(filter(None, os.environ.get('ORBIT_ORIGINS', '').split(',')))

READ = {'Read', 'Grep', 'Glob', 'LS'}
EDIT = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit'}
WEB = {'WebFetch', 'WebSearch'}
SUB = {'Agent', 'Task'}
ARG_KEYS = ('command', 'cmd', 'pattern', 'query', 'url', 'file_path', 'notebook_path', 'description', 'path', 'prompt')
PATH_KEYS = {'file_path', 'notebook_path', 'path'}


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
# kind: read edit run web sub tool say you done error stat(화면 피드에는 안 나오는 수치 갱신)

def claude_kind(name):
    if name in READ:
        return 'read'
    if name in EDIT:
        return 'edit'
    if name == 'Bash':
        return 'run'
    if name in WEB:
        return 'web'
    if name in SUB:
        return 'sub'
    return 'tool'


def claude_arg(inp):
    for k in ARG_KEYS:
        if inp.get(k):
            return base(inp[k]) if k in PATH_KEYS else short(inp[k], 48)
    return ''


def parse_claude(s, o):
    t, out = o.get('type'), []
    if o.get('cwd') and not s['parent']:  # 훅과 같은 기준: 지금 작업 폴더 (서브에이전트는 agentType 유지)
        s['label'] = base(o['cwd'])
    m =o.get('message') if isinstance(o.get('message'), dict) else {}
    c = m.get('content')
    if t == 'assistant':
        mid = m.get('id')
        if mid and mid not in s['msgs']:  # 응답 하나가 블록별로 여러 줄에 나뉘어 기록됨 → 토큰은 한 번만
            s['msgs'].add(mid)
            s['tokens'] += (m.get('usage') or {}).get('output_tokens') or 0
        for b in c if isinstance(c, list) else []:
            if b.get('type') == 'tool_use':
                name = b.get('name', '').split('__')[-1]  # mcp__server__tool → tool
                out.append((claude_kind(name), (name + ' ' + claude_arg(b.get('input') or {})).strip()))
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


# ---------- 로그 파일 감시 ----------

sessions, stats, clients, running = {}, {}, set(), {}
history, ended = deque(maxlen=300), deque(maxlen=500)
lock = threading.Lock()
seq = 0


def watched():
    # ponytail: 0.5초마다 glob+stat 전체 스캔. 로그가 수천 개를 넘어 느려지면 FSEvents/watchdog 으로 교체
    pats = [(HOME + '/.claude/projects/*/*.jsonl', 'claude'),
            (HOME + '/.claude/projects/*/*/subagents/*.jsonl', 'claude')]
    pats += [(HOME + '/.codex/sessions/%s/*.jsonl' % (date.today() - timedelta(days=d)).strftime('%Y/%m/%d'), 'codex')
             for d in (0, 1)]
    for pat, agent in pats:
        for path in glob.glob(pat):
            yield path, agent


def register(path, agent, size):
    s = {'id': os.path.basename(path)[:-6], 'agent': agent, 'label': '', 'tokens': 0,
         'msgs': set(), 'ended': None, 'parent': None}
    if os.path.basename(os.path.dirname(path)) == 'subagents':
        s['parent'] = os.path.basename(os.path.dirname(os.path.dirname(path)))
        try:
            with open(path[:-6] + '.meta.json', encoding='utf-8') as f:
                s['label'] = json.load(f).get('agentType', '')
        except (OSError, ValueError):
            pass
    if agent == 'codex':  # cwd 는 첫 줄(session_meta)에만 있음
        try:
            with open(path, encoding='utf-8') as f:
                parse_codex(s, json.loads(f.readline()))
        except (OSError, ValueError):
            pass
    recent = time.time() - os.path.getmtime(path) < REPLAY_WINDOW
    s['offset'] = max(0, size - REPLAY_BYTES) if recent else size  # 오래된 세션은 끝에서부터
    s['skip'] = recent and s['offset'] > 0  # 중간부터 읽으면 첫 줄은 잘려 있음
    sessions[path] = s
    return s


def poll():
    for path, agent in watched():
        try:
            size = os.path.getsize(path)
            s = sessions.get(path) or register(path, agent, size)
        except OSError:
            continue
        if size < s['offset']:
            s['offset'] = 0
        if size == s['offset']:
            continue
        with open(path, 'rb') as f:
            f.seek(s['offset'])
            data = f.read(size - s['offset'])
        end = data.rfind(b'\n')
        if end < 0:
            continue  # 아직 쓰는 중인 줄
        s['offset'] += end + 1
        lines = data[:end].split(b'\n')
        if s['skip']:
            lines, s['skip'] = lines[1:], False
        parse = parse_claude if agent == 'claude' else parse_codex
        for line in lines:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if isinstance(o, dict):
                for kind, text in parse(s, o):
                    emit(s, kind, text, ts_of(o))


def emit(s, kind, text, ts):
    if kind in ('say', 'you') and not text:
        return
    publish({'id': s['id'], 'parent': s['parent'], 'agent': s['agent'], 'label': s['label'] or s['agent'],
             'kind': kind, 'text': text, 'tokens': s['tokens'], 'ts': ts})


def publish(e):
    global seq
    with lock:
        k = e['kind']
        if k == 'stat':
            stats[e['id']] = e
        elif k == 'start':
            if e['tool'] in ended:
                return  # async 훅이라 끝 신호가 먼저 도착한 경우
            running[e['tool']] = e
        elif k == 'end':
            running.pop(e['tool'], None)
            ended.append(e['tool'])
        else:
            seq += 1
            e['seq'] = seq
            history.append(e)
        for q in clients:
            q.put(e)


# ---------- 훅: 도구 실행 시작/끝 (실시간). 완료 기록·토큰은 계속 로그에서 ----------

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
             'text': (name + ' ' + claude_arg(inp)).strip(), 'ts': time.time()})


def watch():
    while True:
        try:
            poll()
        except Exception as ex:  # 감시 스레드가 죽으면 대시보드가 조용히 멈추므로 로그만 남기고 계속
            print('poll error:', ex, file=sys.stderr)
        time.sleep(0.5)


# ---------- HTTP: index.html + SSE ----------

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/events':
            return self.stream()
        if path not in ('/', '/index.html'):
            return self.send_error(404)
        with open(os.path.join(HERE, 'index.html'), 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def cors(self):
        origin = self.headers.get('Origin')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Private-Network', 'true')  # Chrome 사설망 접근 preflight

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header('Access-Control-Allow-Methods', 'GET')
        self.end_headers()

    def stream(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.cors()
        self.end_headers()
        q = queue.Queue()
        with lock:
            backlog = [{'kind': 'hello', 'boot': BOOT}]
            live = [e for e in running.values() if time.time() - e['ts'] < 1800]  # 끝 신호를 못 받은 건 30분 뒤 버림
            backlog += [dict(e, replay=True) for e in list(history) + list(stats.values()) + live]
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

    def do_POST(self):
        path, _, qs = self.path.partition('?')
        if path != '/hook':
            return self.send_error(404)
        try:
            body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
            hook(parse_qs(qs).get('agent', ['claude'])[0], json.loads(body))
        except (ValueError, AttributeError):
            pass  # 깨진 payload 는 무시 — 에이전트 쪽엔 영향 없음
        self.send_response(204)
        self.end_headers()

    def send_event(self, e):
        self.wfile.write(b'data: ' + json.dumps(e, ensure_ascii=False).encode() + b'\n\n')
        self.wfile.flush()

    def log_message(self, *a):
        pass


def selftest():
    s = {'label': '', 'tokens': 0, 'msgs': set(), 'ended': None, 'parent': None}
    a = {'type': 'assistant', 'cwd': '/x/proj', 'message': {
        'id': 'm1', 'stop_reason': 'end_turn', 'usage': {'output_tokens': 7},
        'content': [{'type': 'tool_use', 'name': 'Edit', 'input': {'file_path': '/x/proj/a.ts'}},
                    {'type': 'text', 'text': 'hi'}]}}
    assert parse_claude(s, a) == [('edit', 'Edit a.ts'), ('say', 'hi'), ('done', 'turn complete')]
    assert parse_claude(s, a) == [('edit', 'Edit a.ts'), ('say', 'hi')]  # 같은 응답의 다음 줄: 토큰·done 중복 없음
    assert s['tokens'] == 7 and s['label'] == 'proj'
    err = {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'is_error': True, 'content': 'boom'}]}}
    assert parse_claude(s, err) == [('error', 'boom')]
    assert parse_claude(s, {'type': 'user', 'message': {'content': '<command-name>/x'}}) == []

    c = dict(s, label='', tokens=0)
    item = lambda it: {'type': 'event_msg', 'payload': {'type': 'item_completed', 'item': it}}
    assert parse_codex(c, {'type': 'session_meta', 'payload': {'cwd': '/y/app'}}) == [] and c['label'] == 'app'
    assert parse_codex(c, item({'type': 'CommandExecution', 'command': ['zsh', '-lc', 'cat a'],
                                'exit_code': 0, 'parsed_cmd': [{'type': 'read'}]})) == [('read', 'cat a')]
    assert parse_codex(c, item({'type': 'CommandExecution', 'command': ['zsh', '-lc', 'npm test'],
                                'exit_code': 1}))[0][0] == 'error'
    assert parse_codex(c, item({'type': 'FileChange', 'changes': {'/y/app/b.py': {}}})) == [('edit', 'b.py')]
    parse_codex(c, {'payload': {'type': 'token_count', 'info': {'total_token_usage': {'output_tokens': 42}}}})
    assert c['tokens'] == 42

    pre = {'hook_event_name': 'PreToolUse', 'tool_use_id': 't1', 'session_id': 'S', 'agent_id': 'a1', 'agent_type': 'Explore',
           'transcript_path': '/p/S.jsonl', 'cwd': '/x/proj', 'tool_name': 'Bash', 'tool_input': {'command': 'ls'}}
    hook('claude', pre)
    assert running['t1']['id'] == 'agent-a1' and running['t1']['parent'] == 'S' and running['t1']['text'] == 'Bash ls'
    hook('claude', dict(pre, hook_event_name='PostToolUseFailure'))
    assert 't1' not in running
    hook('codex', {'hook_event_name': 'PostToolUse', 'tool_use_id': 't2', 'transcript_path': '/s/rollout-x.jsonl'})
    hook('codex', {'hook_event_name': 'PreToolUse', 'tool_use_id': 't2', 'transcript_path': '/s/rollout-x.jsonl'})
    assert 't2' not in running  # 끝이 먼저 오면 늦게 온 시작은 무시
    hook('codex', {'hook_event_name': 'PreToolUse', 'tool_use_id': 't3', 'transcript_path': '/s/rollout-x.jsonl', 'tool_input': {'cmd': 'pytest'}})
    assert running['t3']['id'] == 'rollout-x' and running['t3']['text'] == 'pytest'
    print('ok')


if __name__ == '__main__':
    if '--test' in sys.argv:
        selftest()
        sys.exit()
    threading.Thread(target=watch, daemon=True).start()
    print('agent-orbit → http://127.0.0.1:%d' % PORT)
    try:
        ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()  # 로그에 프롬프트·명령이 담겨 있으니 로컬 전용
    except KeyboardInterrupt:
        pass
