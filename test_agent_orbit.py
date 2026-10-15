"""agent_orbit 셀프 체크: python3 test_agent_orbit.py  (가짜 HOME 에서 돌아서 실제 설정은 건드리지 않음)"""
import http.client
import json
import os
import socket
import tempfile
import threading
import time
from datetime import datetime

TMP = tempfile.mkdtemp(prefix='agent-orbit-test-')
with socket.socket() as _s:
    _s.bind(('127.0.0.1', 0))
    PORT = _s.getsockname()[1]
os.environ.update(HOME=TMP, AGENT_ORBIT_HOME=os.path.join(TMP, 'app'), AGENT_ORBIT_PORT=str(PORT),
                  AGENT_ORBIT_ORIGINS='https://allowed.test')

import agent_orbit as ao  # noqa: E402  (환경 변수를 먼저 정해야 함)

ao.codex_rpc = lambda calls, timeout=20: None  # 실제 codex 를 띄우지 않음 → 승인 상태 'unknown'
NOW = datetime.now().isoformat()


def new_session(**kw):
    return dict({'id': 'S', 'agent': 'claude', 'label': '', 'tokens': 0, 'tok_sent': 0, 'msgs': ao.deque(maxlen=16),
                 'ended': None, 'parent': None, 'floor': 0}, **kw)


def test_parsers():
    s = new_session()
    a = {'type': 'assistant', 'cwd': '/x/proj', 'message': {
        'id': 'm1', 'stop_reason': 'end_turn', 'usage': {'output_tokens': 7},
        'content': [{'type': 'tool_use', 'name': 'Edit', 'input': {'file_path': '/x/proj/a.ts'}}, {'type': 'text', 'text': 'hi'}]}}
    assert ao.parse_claude(s, a) == [('edit', 'Edit a.ts'), ('say', 'hi'), ('done', 'turn complete')]
    assert ao.parse_claude(s, a) == [('edit', 'Edit a.ts'), ('say', 'hi')]  # 같은 응답의 다음 줄: 토큰·done 중복 없음
    assert s['tokens'] == 7 and s['label'] == 'proj'
    assert ao.parse_claude(s, {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'is_error': True, 'content': 'boom'}]}}) == [('error', 'boom')]
    assert ao.parse_claude(s, {'type': 'user', 'message': {'content': '<command-name>/x'}}) == []
    assert ao.parse_claude(s, {'type': 'user', 'isCompactSummary': True, 'message': {'content': 'This session is being continued'}}) == []
    assert ao.parse_claude(s, {'type': 'user', 'message': {'content': '버튼 색 바꿔줘'}}) == [('you', '버튼 색 바꿔줘')]
    c = new_session(agent='codex')
    item = lambda it: {'type': 'event_msg', 'payload': {'type': 'item_completed', 'item': it}}
    assert ao.parse_codex(c, {'type': 'session_meta', 'payload': {'cwd': '/y/app'}}) == [] and c['label'] == 'app'
    assert ao.parse_codex(c, item({'type': 'CommandExecution', 'command': ['zsh', '-lc', 'cat a'], 'exit_code': 0,
                                   'parsed_cmd': [{'type': 'read'}]})) == [('read', 'cat a')]
    assert ao.parse_codex(c, item({'type': 'CommandExecution', 'command': ['zsh', '-lc', 'npm test'], 'exit_code': 1}))[0][0] == 'error'
    assert ao.parse_codex(c, item({'type': 'FileChange', 'changes': {'/y/app/b.py': {}}})) == [('edit', 'b.py')]
    ao.parse_codex(c, {'payload': {'type': 'token_count', 'info': {'total_token_usage': {'output_tokens': 42}}}})
    assert c['tokens'] == 42


def test_hook_mapping():
    pre = {'hook_event_name': 'PreToolUse', 'tool_use_id': 't1', 'session_id': 'S', 'agent_id': 'a1', 'agent_type': 'Explore',
           'transcript_path': '/p/S.jsonl', 'cwd': '/x/proj', 'tool_name': 'Bash', 'tool_input': {'command': 'ls'}}
    ao.hook('claude', pre)
    r = ao.running['t1']
    assert (r['id'], r['parent'], r['label'], r['text']) == ('agent-a1', 'S', 'Explore', 'Bash ls')
    ao.hook('claude', dict(pre, hook_event_name='PostToolUseFailure'))
    assert 't1' not in ao.running
    ao.hook('codex', {'hook_event_name': 'PostToolUse', 'tool_use_id': 't2', 'transcript_path': '/s/rollout-x.jsonl'})
    ao.hook('codex', {'hook_event_name': 'PreToolUse', 'tool_use_id': 't2', 'transcript_path': '/s/rollout-x.jsonl'})
    assert 't2' not in ao.running  # 끝이 먼저 오면 늦게 온 시작은 무시


def write_lines(path, *objs):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'a') as f:
        for o in objs:
            f.write(json.dumps(o) + '\n')


def test_store_and_resume():
    log = os.path.join(TMP, '.claude/projects/-w/sess-1.jsonl')
    turn = lambda mid, tok, tool: {'type': 'assistant', 'cwd': '/w/api', 'timestamp': NOW, 'message': {
        'id': mid, 'usage': {'output_tokens': tok}, 'stop_reason': 'tool_use',
        'content': [{'type': 'tool_use', 'name': tool, 'input': {'command': 'npm test'}}]}}
    write_lines(log, turn('m1', 100, 'Bash'), turn('m2', 50, 'Read'))
    ao.poll()
    x = ao.summary(ao.day_start(), None)['sessions'][0]
    assert (x['id'], x['label'], x['tools'], x['run'], x['read'], x['tokens']) == ('sess-1', 'api', 2, 1, 1, 150)
    # 재시작: 체크포인트에서 이어 읽기 → 꺼져 있던 동안의 줄만 새로, 중복 없음
    ao.save_checkpoint()
    ao.sessions.clear()
    ao.checkpoint.clear()
    ao.checkpoint.update(ao.read_json(ao.CKPT_FILE)['files'])
    write_lines(log, turn('m3', 25, 'Edit'))
    ao.poll()
    x = ao.summary(ao.day_start(), None)['sessions'][0]
    assert (x['tools'], x['edit'], x['tokens']) == (3, 1, 175), x
    # 처음 보는 오늘 파일은 오늘 기록만 채워 넣는다 (어제 줄과 그 토큰은 제외)
    old = os.path.join(TMP, '.claude/projects/-w/sess-2.jsonl')
    yesterday = datetime.fromtimestamp(ao.day_start() - 3600).isoformat()
    write_lines(old, dict(turn('y1', 999, 'Bash'), timestamp=yesterday), turn('t1', 10, 'Bash'))
    ao.poll()
    y = [s for s in ao.summary(ao.day_start(), None)['sessions'] if s['id'] == 'sess-2'][0]
    assert (y['tools'], y['tokens']) == (1, 10), y


SETTINGS = '{\n    "theme": "dark",\n    "hooks": {\n        "PreToolUse": [{"hooks": [{"type": "command", "command": "orca"}]}]\n    }\n}'


def test_connect_restores_bytes():
    path = os.path.join(TMP, '.claude/settings.json')
    ao.write_text(path, SETTINGS)
    r = ao.act('claude', 'connect')
    assert r['ok'] and ao.hooks_state('claude') == 'connected'
    assert ao.act('claude', 'connect')['ok'] and ao.hooks_state('claude') == 'connected'  # 다시 눌러도 그대로
    ao.act('claude', 'disconnect')
    assert ao.read_text(path) == SETTINGS, '연결→해제 후 원본 바이트 그대로'
    assert ao.read_text(path + '.orbit-bak') == SETTINGS
    # 연결한 뒤 다른 설정이 바뀌었으면: 우리 훅만 빼고 나머지는 보존
    ao.act('claude', 'connect')
    d = json.loads(ao.read_text(path))
    d['effortLevel'] = 'high'
    ao.write_text(path, json.dumps(d, indent=2))
    ao.act('claude', 'disconnect')
    d = json.loads(ao.read_text(path))
    assert d['effortLevel'] == 'high' and d['hooks'] == {'PreToolUse': [{'hooks': [{'type': 'command', 'command': 'orca'}]}]}
    assert ao.hooks_state('claude') == 'none'


def test_legacy_and_missing_file():
    path = os.path.join(TMP, '.codex/hooks.json')
    legacy = {'hooks': {'PreToolUse': [{'hooks': [{'type': 'command', 'command': ao.hook_cmd('codex').replace(str(ao.PORT), '7777')}]}]}}
    ao.write_text(path, json.dumps(legacy, indent=2) + '\n')
    assert ao.hooks_state('codex') == 'legacy'
    r = ao.act('codex', 'connect')
    assert ao.hooks_state('codex') == 'connected' and r['trust'] == 'unknown' and '7777' not in ao.read_text(path)
    ao.act('codex', 'disconnect')
    assert not ao.has_ours(ao.read_text(path)), '옛 훅까지 정리'
    os.remove(path)
    ao.act('codex', 'connect')
    ao.act('codex', 'disconnect')
    assert not os.path.exists(path), '없던 파일은 해제하면 다시 없어진다'


def request(method, path, headers=None, body=None):
    c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=5)
    c.request(method, path, body=body, headers=dict({'Host': '127.0.0.1:%d' % PORT}, **(headers or {})))
    r = c.getresponse()
    data = r.read() if path != '/api/events' else b''
    c.close()
    return r.status, {k.lower(): v for k, v in r.getheaders()}, data


def test_http_security():
    srv = ao.ThreadingHTTPServer(('127.0.0.1', PORT), ao.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok, evil = {'Origin': 'https://allowed.test'}, {'Origin': 'https://evil.test'}
    js = {'Content-Type': 'application/json'}
    assert request('GET', '/api/status', {'Host': 'evil.test:%d' % PORT})[0] == 403, 'DNS 리바인딩 차단'
    st, h, body = request('GET', '/api/status', ok)
    assert st == 200 and h.get('access-control-allow-origin') == 'https://allowed.test' and json.loads(body)['protocol'] == ao.PROTOCOL
    assert 'access-control-allow-origin' not in request('GET', '/api/status', evil)[1], '다른 사이트는 못 읽음'
    pre = request('OPTIONS', '/api/connect', dict(ok, **{'Access-Control-Request-Method': 'POST'}))
    assert pre[0] == 204 and pre[1]['access-control-allow-origin'] == 'https://allowed.test'
    body = json.dumps({'agent': 'claude'})
    assert request('POST', '/api/connect', dict(evil, **js), body)[0] == 403
    assert request('POST', '/api/connect', js, body)[0] == 403, 'Origin 없는 요청 거부'
    assert request('POST', '/api/connect', dict(ok, **{'Content-Type': 'text/plain'}), body)[0] == 415, 'JSON 만'
    assert request('POST', '/api/connect', dict(ok, **js), json.dumps({'agent': 'rm -rf'}))[0] == 400
    hook = json.dumps({'hook_event_name': 'PreToolUse', 'tool_use_id': 'h1', 'transcript_path': '/p/X.jsonl'})
    assert request('POST', '/hook?agent=claude', evil, hook)[0] == 403, '브라우저발 훅 거부'
    assert request('POST', '/hook?agent=claude', None, hook)[0] == 204 and 'h1' in ao.running
    st, _, body = request('GET', '/api/preview?agent=claude&action=connect', ok)
    assert st == 200 and '+' in json.loads(body)['diff']
    srv.shutdown()


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn()
            print('✓', name)
    print('ok')
