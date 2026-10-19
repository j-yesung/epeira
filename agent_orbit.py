#!/usr/bin/env python3
"""Epeira collector → 이 컴퓨터의 Claude Code / Codex 세션을 모아 대시보드로 보낸다.

데이터는 이 컴퓨터 밖으로 나가지 않는다. 127.0.0.1 에서만 열리고, 허용한 사이트(ORIGINS)만 읽을 수 있다.

  epeira open                                 전체 대시보드를 브라우저로
  epeira serve                                수집기 실행 (자동 실행 서비스가 호출)
  epeira connect|disconnect <agent>           훅 연결/해제 (claude | codex) → 바뀔 내용을 보여주고 확인 후 적용
  epeira doctor                               진단 정보 (피드백에 그대로 붙여넣기)
  epeira uninstall                            훅·자동 실행·설치 파일·기록 모두 제거
  epeira version                              (예전 이름 tycho · agent-orbit 도 그대로 동작)
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
import webbrowser
from collections import deque
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

VERSION = '1.4.102'
PROTOCOL = 2
PORT = int(os.environ.get('AGENT_ORBIT_PORT') or 47777)
HOME = os.path.expanduser('~')
APP_DIR = os.environ.get('AGENT_ORBIT_HOME') or os.path.join(HOME, '.agent-orbit')
DATA_DIR = os.path.join(APP_DIR, 'data')
EVENTS_DIR = os.path.join(DATA_DIR, 'events')
CKPT_FILE = os.path.join(DATA_DIR, 'state.json')
RESTORE_FILE = os.path.join(DATA_DIR, 'restore.json')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')
NAMES_FILE = os.path.join(DATA_DIR, 'names.json')  # 사용자가 바꾼 세션(HUB) 이름
LIMITS_FILE = os.path.join(DATA_DIR, 'limits.json')  # Codex 요금제 사용 한도 (마지막으로 본 값)
LOG_FILE = os.path.join(APP_DIR, 'collector.log')
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://epeira.vercel.app'
# 이 주소에서 연 대시보드만 데이터를 읽고 버튼을 쓸 수 있다. 정확히 일치하는 것만 → '*' 면 아무 사이트나 로그를 읽어간다
ORIGINS = {SITE} | set(filter(None, os.environ.get('AGENT_ORBIT_ORIGINS', '').split(',')))
LOCAL_ORIGINS = {'http://127.0.0.1:%d' % PORT, 'http://localhost:%d' % PORT}
HOSTS = {'127.0.0.1:%d' % PORT, 'localhost:%d' % PORT}  # 다른 Host 는 거부: DNS 리바인딩 차단
RETENTION_DAYS = 7
BOOT = str(int(time.time() * 1000))
LABEL = 'dev.agentorbit.collector'
MAC = sys.platform == 'darwin'

AGENTS = {
    'claude': {'name': 'Claude Code', 'dir': '~/.claude', 'file': '~/.claude/settings.json',
               'events': ['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure'], 'opts': {'async': True},
               'extra': ['Notification']},  # 권한 승인 · 입력 대기 알림. 연결 여부 판단엔 안 쓴다 (예전 연결은 '알림 켜기'로 동의받고 추가)
    'codex': {'name': 'Codex', 'dir': '~/.codex', 'file': '~/.codex/hooks.json',
              'events': ['SessionStart', 'PreToolUse', 'PostToolUse'], 'opts': {'async': True, 'timeout': 2}},
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
    """원자적 쓰기 → 에이전트가 반쯤 쓴 설정 파일을 읽는 일이 없게. None 이면 파일 삭제."""
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
# 궤도 노드 이름: 같은 일을 하는 도구는 한 노드로 (Codex 셸 → Bash, apply_patch → Edit, MCP 는 서버별)
STATION = {'MultiEdit': 'Edit', 'NotebookEdit': 'Edit', 'apply_patch': 'Edit', 'exec_command': 'Bash', 'shell': 'Bash',
           'write_stdin': 'Bash', 'LS': 'Glob', 'Task': 'Agent', 'view_image': 'Read', 'web__run': 'WebSearch'}


def station(name):
    name = str(name or '')
    if name.startswith('mcp__'):
        return 'mcp:' + name.split('__')[1]
    return STATION.get(name, name) or None


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
    if o.get('cwd') and not s['parent'] and not s['label']:  # 세션을 시작한 폴더 이름으로 고정 (cd 해도 안 바뀜)
        s['label'] = base(o['cwd'])
    if o.get('cwd') and not s['parent'] and not s.get('cwd'):
        s['cwd'] = o['cwd']
    m = o.get('message') if isinstance(o.get('message'), dict) else {}
    c = m.get('content')
    if t == 'assistant':
        mid = m.get('id')
        if mid and mid not in s['msgs']:  # 응답 하나가 블록별로 여러 줄에 나뉘어 기록됨 → 토큰은 한 번만
            s['msgs'].append(mid)
            u = m.get('usage') or {}
            s['tokens'] += u.get('output_tokens') or 0
            s['tin'] += (u.get('input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0)
            s['tcache'] += u.get('cache_read_input_tokens') or 0
        for b in c if isinstance(c, list) else []:
            if b.get('type') == 'tool_use':
                raw = b.get('name', '')
                name, st = raw.split('__')[-1], station(raw)  # mcp__server__tool → tool
                if b.get('id'):  # 실패 결과가 어느 도구 것인지 알 수 있게
                    s['tids'][b['id']] = st
                    if len(s['tids']) > 256:
                        s['tids'].pop(next(iter(s['tids'])))
                out.append((tool_kind(name), (name + ' ' + tool_arg(b.get('input') or {})).strip(), st))
            elif b.get('type') == 'text' and b.get('text', '').strip():
                out.append(('say', short(b['text']), None))
        if m.get('stop_reason') == 'end_turn' and s['ended'] != mid:
            s['ended'] = mid
            out.append(('done', 'turn complete', None))
    elif t == 'user' and not o.get('isMeta') and not o.get('isCompactSummary'):  # 대화 압축 요약은 사용자 입력이 아님
        for b in c if isinstance(c, list) else [{'type': 'text', 'text': c or ''}]:
            if b.get('type') == 'tool_result' and b.get('is_error'):
                out.append(('error', short(text_of(b.get('content'))), s['tids'].get(b.get('tool_use_id'))))
            elif b.get('type') == 'text':
                txt = b.get('text', '').strip()
                if txt.startswith('[Request interrupted'):
                    out.append(('error', 'interrupted', None))
                elif txt and not txt.startswith('<') and not s['parent']:
                    out.append(('you', short(txt), None))
    return out


def parse_codex(s, o):
    p = o.get('payload') if isinstance(o.get('payload'), dict) else {}
    t = p.get('type')
    if o.get('type') == 'session_meta':
        s['label'] = base(p.get('cwd') or '') or s['label']
        s['cwd'] = p.get('cwd') or s.get('cwd', '')
        return []
    if t == 'token_count':
        u = (p.get('info') or {}).get('total_token_usage') or {}
        if u:  # 세션 누적값. 입력에는 캐시 읽기가 포함되어 있어 나눠 센다
            cached = u.get('cached_input_tokens') or 0
            s['tokens'] = u.get('output_tokens') or s['tokens']
            s['tin'] = max(0, (u.get('input_tokens') or 0) - cached) or s['tin']
            s['tcache'] = cached or s['tcache']
        note_limits(p.get('rate_limits'), ts_of(o))
        return [('stat', '', None)]
    if t == 'task_complete':
        return [('done', 'turn complete', None)]
    if t == 'turn_aborted':
        return [('error', p.get('reason') or 'aborted', None)]
    it = p.get('item') if t == 'item_completed' and isinstance(p.get('item'), dict) else {}
    k = it.get('type')
    if k == 'CommandExecution':
        cmd = it.get('command')
        cmd = cmd[-1] if isinstance(cmd, list) and cmd else str(cmd or '')
        if it.get('exit_code') not in (None, 0):
            return [('error', 'exit %s · %s' % (it['exit_code'], short(cmd, 44)), 'Bash')]
        kinds = {c.get('type') for c in it.get('parsed_cmd') or [] if isinstance(c, dict)}
        return [('read' if kinds and kinds <= {'read', 'search', 'list_files'} else 'run', short(cmd, 56), 'Bash')]
    if k == 'FileChange':
        return [('edit', short(', '.join(base(f) for f in it.get('changes') or {}), 56), 'Edit')]
    if k == 'AgentMessage':
        return [('say', short(text_of(it.get('content'))), None)]
    if k == 'UserMessage':
        return [('you', short(text_of(it.get('content'))), None)]
    if k == 'Extension':
        return [('web', short(it.get('query') or it.get('kind') or 'extension', 56), 'WebSearch')]
    if k == 'ImageView':
        return [('read', base(it.get('path') or 'image'), 'Read')]
    return []


PARSERS = {'claude': parse_claude, 'codex': parse_codex}
limits = {}  # Codex 요금제 사용 한도: primary(보통 5시간) · secondary(주간). 가장 최근 기록만


def note_limits(rl, ts):
    if not isinstance(rl, dict) or ts <= limits.get('at', 0):
        return
    win = lambda w: {'used': w.get('used_percent'), 'window': w.get('window_minutes'), 'resets': w.get('resets_at')} if isinstance(w, dict) else None
    limits.update(at=ts, primary=win(rl.get('primary')), secondary=win(rl.get('secondary')), plan=rl.get('plan_type'))
    write_text(LIMITS_FILE, json.dumps(limits))


def seed_limits():
    # 한도 기록이 없으면(이미 읽은 로그라 다시 안 읽음) 가장 최근 Codex 로그 끝에서 마지막 값을 찾는다
    paths = []
    for path, agent in scan():
        try:
            if agent == 'codex':
                paths.append((os.path.getmtime(path), path))
        except OSError:
            pass
    for _, path in sorted(paths, reverse=True)[:3]:
        try:
            with open(path, 'rb') as f:
                f.seek(max(0, os.path.getsize(path) - 262144))
                lines = f.read().split(b'\n')
        except OSError:
            continue
        for line in reversed(lines):
            if b'"rate_limits"' not in line:
                continue
            try:
                o = json.loads(line)
            except ValueError:
                continue
            note_limits((o.get('payload') or {}).get('rate_limits'), ts_of(o))
            if limits:
                return



# ---------- Claude 사용 한도 (설정에서 켰을 때만) ----------
# Claude Code 는 한도를 로그에 남기지 않는다 → Claude Code 로그인 토큰으로 Anthropic 의 사용량 조회 API 를 부른다.
# 모델 호출이 아니라 비용 · 한도 차감 없음. 토큰은 Anthropic 으로만 보내고 저장 · 기록하지 않는다.
CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
claude_limits = {}  # {at, primary(5시간), secondary(주간), plan} 또는 {error}
tried = {'claude': 0.0, 'codex': 0.0}  # 마지막으로 조회한 시각 (너무 자주 부르지 않게)


def iso_ts(v):  # '2026-10-16T05:00:00Z' · 초 · 밀리초 → 초
    if isinstance(v, (int, float)):
        return v / 1000 if v > 1e12 else v
    try:
        return datetime.fromisoformat(str(v).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def claude_login():
    raw = ''
    if MAC:  # Claude Code 는 macOS 키체인에 로그인 정보를 둔다
        raw = run('security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w').stdout or ''
    if not raw.strip():
        try:
            with open(os.path.join(HOME, '.claude', '.credentials.json'), encoding='utf-8') as f:
                raw = f.read()
        except OSError:
            return None
    try:
        o = json.loads(raw).get('claudeAiOauth') or {}
    except (ValueError, AttributeError):
        return None
    return o if o.get('accessToken') else None


def fetch_claude_limits():
    tried['claude'] = time.time()
    o = claude_login()
    if not o:
        claude_limits['error'] = 'no-login'
        return
    if o.get('expiresAt') and o['expiresAt'] / 1000 < time.time():
        claude_limits['error'] = 'expired'  # 토큰 갱신은 Claude Code 가 한다 (여기서 갱신하면 Claude Code 로그인이 풀릴 수 있음)
        return
    req = Request(CLAUDE_USAGE_URL, headers={'Authorization': 'Bearer ' + o['accessToken'], 'anthropic-beta': 'oauth-2025-04-20',
                                             'User-Agent': 'epeira/' + VERSION})
    try:
        with urlopen(req, timeout=10) as r:
            d = json.loads(r.read())
    except HTTPError as ex:
        claude_limits['error'] = {401: 'expired', 403: 'expired', 429: 'rate-limited'}.get(ex.code, 'unavailable')
        return
    except (OSError, ValueError):
        claude_limits['error'] = 'network'
        return
    win = lambda w, minutes: ({'used': w['utilization'], 'window': minutes, 'resets': iso_ts(w.get('resets_at'))}
                              if isinstance(w, dict) and isinstance(w.get('utilization'), (int, float)) else None)
    claude_limits.clear()
    claude_limits.update(at=time.time(), primary=win(d.get('five_hour'), 300), secondary=win(d.get('seven_day'), 10080),
                         plan=o.get('subscriptionType'))


def fetch_codex_limits():
    # 로그의 한도는 마지막으로 Codex 를 쓴 순간 값이라 늦다 (주간 사용량은 끝난 뒤에 서버에서 올라감)
    # → Codex 공식 app-server 로 지금 값을 읽는다. Codex 가 자기 로그인으로 묻는 것이라 Epeira 는 로그인 정보를 보지 않는다
    tried['codex'] = time.time()
    r = codex_rpc([('account/rateLimits/read', None)], timeout=30)
    rl = (((r or [None])[0] or {}).get('result') or {}).get('rateLimits')
    if not isinstance(rl, dict):
        return
    win = lambda w: {'used': w.get('usedPercent'), 'window': w.get('windowDurationMins'), 'resets': w.get('resetsAt')} if isinstance(w, dict) else None
    limits.update(at=time.time(), primary=win(rl.get('primary')), secondary=win(rl.get('secondary')), plan=rl.get('planType'))
    write_text(LIMITS_FILE, json.dumps(limits))


def limits_loop():  # 5분마다: Codex 한도(설치돼 있으면), Claude 한도(설정에서 켰을 때)
    while True:
        if time.time() - tried['codex'] > 240 and shutil.which('codex'):
            fetch_codex_limits()
        if setting('claudeLimits') and time.time() - tried['claude'] > 240:
            fetch_claude_limits()
        time.sleep(60)  # ponytail: 1분마다 확인해 5분(4분+)에 한 번 조회. 더 정확한 주기가 필요하면 다음 조회 시각을 계산


# ---------- 로그 감시 + 기록 저장 ----------

sessions, checkpoint, clients, running = {}, {}, set(), {}
tabs = {}  # 앱 터미널 탭 ID → 그 탭에서 실행 중인 세션 id
labels = {}  # 세션 id → 이름(시작 폴더). 훅도 같은 이름을 쓰게
cwds = {}  # 세션 id → 시작 폴더 전체 경로 (앱이 프로젝트별로 거를 때)
names = {}  # 세션 id → 사용자가 직접 붙인 이름 (화면에서 원래 이름보다 우선)
history, ended = deque(maxlen=300), deque(maxlen=500)
lock = threading.Lock()
seq = 0
CKPT_KEYS = ('id', 'agent', 'label', 'cwd', 'parent', 'tokens', 'tok_sent', 'tin', 'tin_sent', 'tcache', 'tcache_sent', 'ended', 'offset')
STORE_KEYS = ('id', 'parent', 'agent', 'label', 'cwd', 'kind', 'text', 'st', 'dtok', 'din', 'dcache', 'ts')


found = {'at': 0.0, 'list': []}


def watched():
    # 새 로그 파일 찾기(glob)는 3초마다, 그 사이엔 아는 파일만 (크기 확인은 poll 이 0.5초마다)
    # ponytail: 그래도 stat 은 파일 수만큼. 로그가 수천 개를 넘어 느려지면 FSEvents/inotify 로 교체
    if time.time() - found['at'] < 3:
        return found['list']
    found['at'], found['list'] = time.time(), list(scan())
    return found['list']


def scan():
    pats = [(HOME + '/.claude/projects/*/*.jsonl', 'claude'),
            (HOME + '/.claude/projects/*/*/subagents/*.jsonl', 'claude')]
    pats += [(HOME + '/.codex/sessions/%s/*.jsonl' % (date.today() - timedelta(days=d)).strftime('%Y/%m/%d'), 'codex')
             for d in range(RETENTION_DAYS)]
    for pat, agent in pats:
        for path in glob.glob(pat):
            yield path, agent


def register(path, agent, size):
    s = {'path': path, 'id': os.path.basename(path)[:-6], 'agent': agent, 'label': '', 'cwd': '', 'parent': None,
         'tokens': 0, 'tok_sent': 0, 'tin': 0, 'tin_sent': 0, 'tcache': 0, 'tcache_sent': 0,
         'msgs': deque(maxlen=16), 'ended': None, 'offset': size, 'floor': 0,
         'touched': False, 'tids': {}}
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
                for kind, text, st in parse(s, o):
                    emit(s, kind, text, ts_of(o), st)
    return dirty


def emit(s, kind, text, ts, st=None):
    if ts < s['floor']:  # 오늘 이전 토큰은 오늘 합계에 넣지 않음
        s['tok_sent'], s['tin_sent'], s['tcache_sent'] = s['tokens'], s['tin'], s['tcache']
        return
    if kind in ('say', 'you') and not text:
        return
    if s['label']:
        labels.setdefault(s['id'], s['label'])
    dtok = max(0, s['tokens'] - s['tok_sent'])  # 출력
    din = max(0, s['tin'] - s['tin_sent'])  # 입력
    dcache = max(0, s['tcache'] - s['tcache_sent'])  # 캐시 읽기
    s['tok_sent'], s['tin_sent'], s['tcache_sent'] = s['tokens'], s['tin'], s['tcache']
    if kind == 'stat' and not (dtok or din or dcache):
        return
    publish({'id': s['id'], 'parent': s['parent'], 'agent': s['agent'], 'label': s['label'] or s['agent'], 'cwd': s.get('cwd', ''),
             'kind': kind, 'text': text, 'st': st, 'dtok': dtok, 'din': din, 'dcache': dcache, 'ts': ts}, store=True)


def store_append(e):
    os.makedirs(EVENTS_DIR, exist_ok=True)
    name = datetime.fromtimestamp(e['ts']).strftime('%Y-%m-%d') + '.jsonl'
    with open(os.path.join(EVENTS_DIR, name), 'a', encoding='utf-8') as f:
        f.write(json.dumps({k: e.get(k) for k in STORE_KEYS}, ensure_ascii=False) + '\n')


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
            x = out[e['id']] = {'id': e['id'], 'agent': e['agent'], 'parent': e['parent'], 'label': e['label'], 'cwd': e.get('cwd') or '',
                                'first': e['ts'], 'last': e['ts'], 'tools': 0, 'read': 0, 'edit': 0, 'run': 0,
                                'other': 0, 'turns': 0, 'errors': 0, 'tokens': 0, 'tin': 0, 'tcache': 0, 'kind': None, 'text': '', 'st': {}}
        k = e['kind']
        x['label'], x['last'] = e['label'], max(x['last'], e['ts'])
        x['tokens'] += e.get('dtok') or 0  # 출력
        x['tin'] += e.get('din') or 0  # 입력 (캐시 쓰기 포함)
        x['tcache'] += e.get('dcache') or 0  # 캐시 읽기
        if k in TOOL_KINDS:
            x['tools'] += 1
            x[k if k in ('read', 'edit', 'run') else 'other'] += 1
            if e.get('st'):  # 도구 노드별 횟수 (새로고침해도 궤도 노드 숫자 유지)
                x['st'][e['st']] = x['st'].get(e['st'], 0) + 1
        elif k == 'done':
            x['turns'] += 1
        elif k == 'error':
            x['errors'] += 1
        if k == 'you' and not x.get('title'):
            x['title'] = e['text']  # 첫 질문 = 세션 제목 (사이드바 · 명령 팔레트)
        if k != 'stat':
            x['kind'], x['text'] = k, e['text']
    return sorted(out.values(), key=lambda x: -x['last'])


def search(q, days=7):
    """최근 기록에서 질문 · 명령 · 파일 이름 찾기 (앱의 명령 팔레트). 최근 것부터 50개"""
    q, out = q.strip().lower()[:100], deque(maxlen=50)
    if len(q) < 2:
        return []
    for e in read_events(time.time() - days * 86400):
        if e.get('kind') != 'stat' and q in (e.get('text') or '').lower():
            out.append({k: e.get(k) for k in ('id', 'parent', 'agent', 'label', 'cwd', 'kind', 'text', 'ts')})
    return list(reversed(out))


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
        elif k in ('tab', 'name'):
            pass  # 저장하지 않는 알림 (tabs · names 에 따로 보관)
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


def hook(agent, h, tab=''):
    aid, tp = h.get('agent_id'), str(h.get('transcript_path') or '')
    # 노드 id 를 로그 쪽과 맞춘다: 서브에이전트 agent-<id>, 그 외엔 로그 파일 이름
    main = base(tp)[:-6] if tp.endswith('.jsonl') else h.get('session_id', '?')
    sid = 'agent-' + aid.replace('agent-', '', 1) if aid else main
    if tab and tabs.get(tab) != main:  # 앱의 어느 탭이 어느 세션인지 (서브에이전트는 부모 세션으로)
        tabs[tab] = main
        publish({'kind': 'tab', 'tab': tab, 'id': main, 'ts': time.time()})
    if h.get('cwd') and not aid:
        cwds.setdefault(main, h['cwd'])  # 처음 본 폴더 = 시작 폴더 (cd 해도 안 바뀜)
    if h.get('hook_event_name') == 'SessionStart' and h.get('cwd'):
        labels.setdefault(main, base(h['cwd']))  # 시작 폴더 = 세션 이름
    if h.get('hook_event_name') == 'Notification':  # 권한 승인 · 입력을 기다린다 (앱이 알림 · 탭 표시)
        publish({'id': main, 'parent': None, 'agent': agent, 'label': labels.get(main) or base(h.get('cwd') or '') or agent,
                 'cwd': cwds.get(main, ''), 'kind': 'notify', 'text': short(str(h.get('message') or '입력을 기다려요')), 'ts': time.time()})
        return
    if h.get('hook_event_name') == 'SessionStart':  # 시작 폴더 · 탭만 기억 (궤도는 Epeira 앱이 보여준다)
        return
    phase, tid = HOOK_PHASE.get(h.get('hook_event_name')), h.get('tool_use_id')
    if not phase or not tid:
        return
    inp = h.get('tool_input') if isinstance(h.get('tool_input'), dict) else {}
    name = str(h.get('tool_name') or '').split('__')[-1]
    publish({'id': sid, 'parent': h.get('session_id') if aid else None, 'agent': agent,
             'label': (h.get('agent_type') if aid else labels.get(main) or base(h.get('cwd') or '')) or agent, 'cwd': '' if aid else cwds.get(main, ''),
             'kind': phase, 'tool': tid, 'st': station(h.get('tool_name')), 'ok': h.get('hook_event_name') != 'PostToolUseFailure',
             'text': (name + ' ' + tool_arg(inp)).strip(), 'ts': time.time()})


# ---------- 에이전트 설정: 연결 / 해제 / 승인 ----------

act_lock = threading.Lock()


def hook_cmd(agent):
    # 수집기가 꺼져 있어도 조용히 통과: 백그라운드(async), 1초 제한, 항상 exit 0
    # AGENT_ORBIT_TAB: Epeira 앱 터미널 탭에서 실행된 세션이면 그 탭 ID (앱 밖에선 빈 값)
    return ("curl -s -m 1 -H 'Content-Type: application/json' --data-binary @- "
            '"http://127.0.0.1:%d/hook?agent=%s&tab=${AGENT_ORBIT_TAB:-}" >/dev/null 2>&1 || true' % (PORT, agent))


def is_our_cmd(cmd):  # 이전 버전(포트 7777, 탭 없는 명령)이 넣은 훅도 우리 것으로 인식해 교체
    return isinstance(cmd, str) and 'http://127.0.0.1:' in cmd and '/hook?agent=' in cmd


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
    for ev in a['events'] + a.get('extra', []):
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


def extra_connected(agent):
    try:
        hooks = load_settings(read_text(os.path.expanduser(AGENTS[agent]['file']))).get('hooks', {})
    except ValueError:
        return False
    return all(any(is_ours(g) for g in hooks.get(ev) or []) for ev in AGENTS[agent].get('extra', []))


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
                                           else 'Epeira 훅만 제거했습니다 (그 사이 다른 설정이 바뀌어 있어서).')
        write_text(RESTORE_FILE, json.dumps(recs))
        return {'ok': True, 'trust': trust, 'message': msg}


def trust_message(trust):
    return {'trusted': '승인 완료 → 새로 시작하는 Codex 세션부터 적용됩니다.',
            'untrusted': '승인되지 않았습니다. Codex 에서 /hooks 를 열어 승인하세요.',
            'unknown': 'codex 명령을 찾지 못해 승인하지 못했습니다. Codex 에서 /hooks 를 열어 승인하세요.',
            'none': '승인할 훅이 없습니다. 먼저 연결하세요.'}.get(trust, '')


# Codex 는 새 훅을 사용자가 승인해야 실행한다. 연결 확인 창에서 명령 원문을 보고 동의한 경우에만
# 공식 app-server API(hooks/list + config/batchWrite → /hooks 화면과 같은 경로)로 승인한다.

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
        send({'id': 0, 'method': 'initialize', 'params': {'clientInfo': {'name': 'epeira', 'version': VERSION}}})
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
    if a.get('extra') and st == 'connected':
        out['notify'] = extra_connected(agent)
    if agent == 'codex' and st == 'connected':
        out['trust'] = codex_trust_state()
    return out


DEFAULTS = {'claudeLimits': False}  # Claude 사용 한도를 가져올지


def setting(key):
    return (read_json(SETTINGS_FILE) or {}).get(key, DEFAULTS[key])


def rename(sid, name):
    """세션 이름 바꾸기. 빈 이름이면 원래 이름(시작 폴더)으로. 제어 문자는 빼고 40자까지"""
    name = ''.join(ch for ch in str(name or '') if ch.isprintable()).strip()[:40]
    with lock:
        if name:
            names[sid] = name
        else:
            names.pop(sid, None)
        write_text(NAMES_FILE, json.dumps(names, ensure_ascii=False))
    publish({'kind': 'name', 'id': sid, 'name': name, 'ts': time.time()})
    return name


def save_setting(key, value):
    s = read_json(SETTINGS_FILE) or {}
    s[key] = value
    write_text(SETTINGS_FILE, json.dumps(s))
    return value


def status():
    return {'version': VERSION, 'protocol': PROTOCOL, 'port': PORT, 'boot': BOOT, 'platform': sys.platform,
            'autostart': autostart_state(), 'retentionDays': RETENTION_DAYS,
            'claudeLimits': setting('claudeLimits'), 'tabs': dict(tabs), 'names': dict(names),
            'limits': dict(({'codex': dict(limits)} if limits else {}), **({'claude': dict(claude_limits)} if claude_limits else {})),
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
    env = dict({'PATH': path_env}, **({'AGENT_ORBIT_PORT': str(PORT)} if PORT != 47777 else {}))  # 기본 포트가 아니면 서비스도 같은 포트로
    f = service_file()
    os.makedirs(os.path.dirname(f), exist_ok=True)
    if sys.platform == 'darwin':
        import plistlib
        with open(f, 'wb') as fp:
            plistlib.dump({'Label': LABEL, 'ProgramArguments': [py, script, 'serve'],
                           'EnvironmentVariables': env,  # codex 명령을 찾을 수 있게 설치 시점 PATH
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
    write_text(f, '[Unit]\nDescription=Epeira collector\n\n[Service]\nExecStart=%s %s serve\n'
                  '%sRestart=on-failure\n\n[Install]\nWantedBy=default.target\n' % (py, script, ''.join('Environment=%s=%s\n' % kv for kv in env.items())))
    run('systemctl', '--user', 'daemon-reload')
    r = run('systemctl', '--user', 'enable', '--now', 'agent-orbit.service')
    if r.returncode == 0:
        r = run('systemctl', '--user', 'restart', 'agent-orbit.service')
        return r.returncode == 0, r.stderr.strip()
    os.remove(f)  # systemd 사용자 서비스가 없는 환경: 지금만 백그라운드로 실행
    with open(LOG_FILE, 'a') as lf:
        subprocess.Popen([py, script, 'serve'], stdout=lf, stderr=lf, stdin=subprocess.DEVNULL, start_new_session=True)
    return True, '자동 실행을 등록하지 못해(systemd 사용자 서비스 없음) 지금만 실행했습니다. 재부팅 후엔 epeira serve 로 켜세요.'


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
    server_version = 'epeira/' + VERSION

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
            if q.get('refresh'):  # 앱의 새로고침 버튼: 한도를 다시 읽는다 (각각 1분에 한 번까지)
                if time.time() - tried['codex'] > 60 and shutil.which('codex'):
                    fetch_codex_limits()
                if setting('claudeLimits') and time.time() - tried['claude'] > 60:
                    fetch_claude_limits()
            return self.reply(200, status())
        if p == '/api/events':
            return self.stream()
        if p == '/api/summary':
            return self.reply(200, summary(*span(q)))
        if p == '/api/search':
            return self.reply(200, {'results': search(q.get('q', ''))})
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
            q = parse_qs(u.query)
            agent, tab = q.get('agent', [''])[0], q.get('tab', [''])[0][:64]
            try:
                if agent in AGENTS:
                    hook(agent, json.loads(body), tab)
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
        if u.path == '/api/rename':
            sid = data.get('id')
            if not isinstance(sid, str) or not sid or len(sid) > 128:
                return self.reply(400, {'error': 'bad request'})
            return self.reply(200, {'ok': True, 'id': sid, 'name': rename(sid, data.get('name'))})
        if u.path == '/api/settings':
            out = {k: save_setting(k, data[k]) for k in DEFAULTS if isinstance(data.get(k), bool)}
            if out.get('claudeLimits'):
                fetch_claude_limits()  # 켜자마자 한 번
            elif out.get('claudeLimits') is False:
                claude_limits.clear()
            if out:
                return self.reply(200, dict(out, limits=status()['limits']))
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
            backlog = [{'kind': 'hello', 'boot': BOOT, 'version': VERSION, 'protocol': PROTOCOL, 'names': dict(names)}]
            backlog += [dict(e, replay=True) for e in list(history)[-80:] if e['ts'] >= today]
            backlog += [dict(e, replay=True) for e in running.values() if now - e['ts'] < 1800]  # 끝 신호 유실 대비 30분
            backlog += [{'kind': 'tab', 'tab': k, 'id': v, 'replay': True} for k, v in tabs.items()]
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


def private():
    """기록엔 질문 · 명령이 남는다 → 이 사용자만 읽게 (같은 Mac 의 다른 계정도 못 읽게). 새로 만드는 파일도 같이"""
    os.umask(0o077)
    for root, dirs, files in os.walk(APP_DIR):
        for name in dirs + files:
            p = os.path.join(root, name)
            if not os.path.islink(p):
                os.chmod(p, 0o700 if os.path.isdir(p) or os.access(p, os.X_OK) else 0o600)
    if os.path.isdir(APP_DIR):
        os.chmod(APP_DIR, 0o700)


def serve():
    private()
    checkpoint.update((read_json(CKPT_FILE) or {}).get('files') or {})
    names.update(read_json(NAMES_FILE) or {})
    limits.update(read_json(LIMITS_FILE) or {})
    if not limits:
        seed_limits()
    os.makedirs(EVENTS_DIR, exist_ok=True)
    prune()
    load_history()
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError as ex:
        sys.exit('epeira: 포트 %d 를 열 수 없습니다 (%s)' % (PORT, ex))
    write_text(os.path.join(APP_DIR, 'port'), str(PORT))  # 앱이 수집기 주소를 알 수 있게
    threading.Thread(target=watch, daemon=True).start()
    threading.Thread(target=limits_loop, daemon=True).start()
    log('epeira %s → http://127.0.0.1:%d' % (VERSION, PORT))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


# ---------- CLI ----------

def die(msg):
    sys.exit('epeira: ' + msg)


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
    print('Epeira %s 설치' % VERSION)
    if os.path.exists(os.path.join(APP_DIR, 'mini.js')):  # 예전 미니 창 스크립트 (더 이상 쓰지 않음)
        os.remove(os.path.join(APP_DIR, 'mini.js'))
    if local_status(3) is None and port_open():
        die('포트 %d 를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄거나, 다른 포트로 설치하세요: AGENT_ORBIT_PORT=47787 epeira setup '
            '(브라우저 대시보드는 47777 만 보므로 이때는 Epeira 앱이나 http://127.0.0.1:포트 로 여세요)' % PORT)
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
    cli = 'epeira' if shutil.which('epeira') else tilde(os.path.join(APP_DIR, 'bin', 'epeira'))
    print('\n대시보드:  %s open' % cli)
    print('명령:     %s doctor | uninstall' % cli)


def cmd_open(args):
    if local_status(3) is None:
        die('수집기가 꺼져 있습니다. epeira doctor 로 확인하세요.')
    webbrowser.open('http://127.0.0.1:%d/' % PORT)


def cmd_hooks(action, args):
    agent = args[0] if args else ''
    if agent not in AGENTS:
        die('사용법: epeira %s claude|codex' % action)
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
    lines = ['Epeira doctor',
             'version     %s (protocol %d)' % (VERSION, PROTOCOL),
             'python      %s (%s)' % (sys.version.split()[0], sys.executable),
             'platform    %s' % platform.platform(),
             'install     %s' % tilde(APP_DIR),
             'collector   %s' % ('running %s on 127.0.0.1:%d' % (st['version'], PORT) if st else
                                 'NOT RUNNING (127.0.0.1:%d%s)' % (PORT, ' → port used by another program' if port_open() else '')),
             'autostart   %s' % {None: 'not installed', True: 'on', False: 'off'}[autostart_state()],
             'claude lim  %s' % ('on' if setting('claudeLimits') else 'off')]
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
    if '--yes' not in args and not confirm('Epeira 를 완전히 삭제할까요? 훅 해제, 자동 실행 해제, %s(기록 포함) 삭제 [y/N] ' % tilde(APP_DIR)):
        return
    for k in AGENTS:
        if hooks_state(k) != 'none':
            print('· ' + act(k, 'disconnect')['message'])
    remove_service()
    print('· 자동 실행 해제')
    for d in (os.path.join(HOME, '.local/bin'), os.path.join(HOME, 'bin'), '/opt/homebrew/bin', '/usr/local/bin'):
        for name in ('epeira', 'tycho', 'agent-orbit'):  # install.sh 가 만든 바로가기만
            link = os.path.join(d, name)
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
    elif cmd == 'open':
        cmd_open(args)
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
