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
    return dict({'id': 'S', 'agent': 'claude', 'label': '', 'tokens': 0, 'tok_sent': 0, 'tin': 0, 'tin_sent': 0, 'tcache': 0, 'tcache_sent': 0, 'msgs': ao.deque(maxlen=16),
                 'ended': None, 'parent': None, 'floor': 0, 'tids': {}}, **kw)


def test_parsers():
    s = new_session()
    a = {'type': 'assistant', 'cwd': '/x/proj', 'message': {
        'id': 'm1', 'stop_reason': 'end_turn', 'usage': {'output_tokens': 7, 'input_tokens': 3, 'cache_creation_input_tokens': 100, 'cache_read_input_tokens': 900},
        'content': [{'type': 'tool_use', 'id': 'tu1', 'name': 'MultiEdit', 'input': {'file_path': '/x/proj/a.ts'}}, {'type': 'text', 'text': 'hi'}]}}
    assert ao.parse_claude(s, a) == [('edit', 'MultiEdit a.ts', 'Edit'), ('say', 'hi', None), ('done', 'turn complete', None)]
    assert ao.parse_claude(s, a) == [('edit', 'MultiEdit a.ts', 'Edit'), ('say', 'hi', None)]  # 같은 응답의 다음 줄: 토큰·done 중복 없음
    assert (s['tokens'], s['tin'], s['tcache'], s['label']) == (7, 103, 900, 'proj'), '입력(캐시 쓰기 포함)·캐시 읽기·출력'
    ao.parse_claude(s, {'type': 'user', 'cwd': '/x/proj/sub', 'message': {'content': 'cd 했어요'}})
    assert s['label'] == 'proj', 'cd 해도 세션 이름은 시작 폴더 그대로'
    err = {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 'tu1', 'is_error': True, 'content': 'boom'}]}}
    assert ao.parse_claude(s, err) == [('error', 'boom', 'Edit')], '실패한 도구의 노드를 안다'
    mcp = {'type': 'assistant', 'message': {'id': 'm2', 'content': [{'type': 'tool_use', 'name': 'mcp__asana__get_tasks', 'input': {}}]}}
    assert ao.parse_claude(s, mcp) == [('tool', 'get_tasks', 'mcp:asana')]
    assert ao.parse_claude(s, {'type': 'user', 'message': {'content': '<command-name>/x'}}) == []
    assert ao.parse_claude(s, {'type': 'user', 'isCompactSummary': True, 'message': {'content': 'This session is being continued'}}) == []
    assert ao.parse_claude(s, {'type': 'user', 'message': {'content': '버튼 색 바꿔줘'}}) == [('you', '버튼 색 바꿔줘', None)]
    c = new_session(agent='codex')
    item = lambda it: {'type': 'event_msg', 'payload': {'type': 'item_completed', 'item': it}}
    assert ao.parse_codex(c, {'type': 'session_meta', 'payload': {'cwd': '/y/app'}}) == [] and c['label'] == 'app'
    assert ao.parse_codex(c, item({'type': 'CommandExecution', 'command': ['zsh', '-lc', 'cat a'], 'exit_code': 0,
                                   'parsed_cmd': [{'type': 'read'}]})) == [('read', 'cat a', 'Bash')]
    assert ao.parse_codex(c, item({'type': 'CommandExecution', 'command': ['zsh', '-lc', 'npm test'], 'exit_code': 1}))[0][0] == 'error'
    assert ao.parse_codex(c, item({'type': 'FileChange', 'changes': {'/y/app/b.py': {}}})) == [('edit', 'b.py', 'Edit')]
    tc = lambda used, ts: {'timestamp': ts, 'payload': {'type': 'token_count', 'info': {'total_token_usage': {'output_tokens': 42, 'input_tokens': 1000, 'cached_input_tokens': 800}},
                                                     'rate_limits': {'primary': {'used_percent': used, 'window_minutes': 300, 'resets_at': 1}, 'secondary': {'used_percent': 41.0, 'window_minutes': 10080}}}}
    ao.parse_codex(c, tc(23.0, '2026-10-15T10:00:00Z'))
    assert (c['tokens'], c['tin'], c['tcache']) == (42, 200, 800)
    assert ao.limits['primary']['used'] == 23.0 and ao.limits['secondary']['window'] == 10080
    ao.parse_codex(c, tc(5.0, '2026-10-15T09:00:00Z'))
    assert ao.limits['primary']['used'] == 23.0, '옛 기록이 최신 한도를 덮지 않음'


def test_hook_mapping():
    pre = {'hook_event_name': 'PreToolUse', 'tool_use_id': 't1', 'session_id': 'S', 'agent_id': 'a1', 'agent_type': 'Explore',
           'transcript_path': '/p/S.jsonl', 'cwd': '/x/proj', 'tool_name': 'Bash', 'tool_input': {'command': 'ls'}}
    ao.hook('claude', pre)
    r = ao.running['t1']
    assert (r['id'], r['parent'], r['label'], r['text'], r['st']) == ('agent-a1', 'S', 'Explore', 'Bash ls', 'Bash')
    ao.hook('codex', {'hook_event_name': 'PreToolUse', 'tool_use_id': 't9', 'transcript_path': '/s/r.jsonl', 'tool_name': 'apply_patch'})
    assert ao.running['t9']['st'] == 'Edit'
    ao.hook('claude', {'hook_event_name': 'SessionStart', 'transcript_path': '/p/L1.jsonl', 'cwd': '/w/start-dir'})
    ao.hook('claude', {'hook_event_name': 'PreToolUse', 'tool_use_id': 't10', 'transcript_path': '/p/L1.jsonl', 'cwd': '/w/start-dir/deep'})
    assert ao.running['t10']['label'] == 'start-dir', '훅도 시작 폴더 이름'
    ao.hook('claude', dict(pre, hook_event_name='PostToolUseFailure'))
    assert 't1' not in ao.running
    ao.hook('codex', {'hook_event_name': 'PostToolUse', 'tool_use_id': 't2', 'transcript_path': '/s/rollout-x.jsonl'})
    ao.hook('codex', {'hook_event_name': 'PreToolUse', 'tool_use_id': 't2', 'transcript_path': '/s/rollout-x.jsonl'})
    assert 't2' not in ao.running  # 끝이 먼저 오면 늦게 온 시작은 무시


def test_session_start_opens_mini():
    opened = []
    ao.open_mini, real = (lambda top=True: opened.append(top) or True), ao.open_mini
    ao.MAC = True
    try:
        for source in ('startup', 'resume', 'compact', 'clear', None):
            h = {'hook_event_name': 'SessionStart', 'session_id': 'S'}
            if source:
                h['source'] = source
            ao.hook('claude', h)
        assert len(opened) == 3, '새로 시작·이어 열기·source 없음(Codex)만 띄운다'
        ao.save_setting('autoMini', False)
        ao.hook('codex', {'hook_event_name': 'SessionStart'})
        assert len(opened) == 3, '사용자가 끄면 띄우지 않는다'
        ao.save_setting('autoMini', True)
        ao.hook('claude', {'hook_event_name': 'SessionStart', 'transcript_path': '/p/T1.jsonl'}, tab='tab-1')
        assert len(opened) == 3, '앱 터미널 탭에서 시작한 세션은 미니 창을 띄우지 않는다'
        assert ao.tabs['tab-1'] == 'T1'
        ao.hook('claude', {'hook_event_name': 'PreToolUse', 'tool_use_id': 'x1', 'agent_id': 'a9', 'session_id': 'T1',
                           'transcript_path': '/p/T1.jsonl', 'tool_name': 'Read'}, tab='tab-1')
        assert ao.tabs['tab-1'] == 'T1', '서브에이전트 실행도 부모 세션으로 짝지음'
    finally:
        ao.open_mini = real


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
    ao.found["at"] = 0; ao.poll()  # 새 파일을 바로 찾게 (평소엔 3초마다)
    x = ao.summary(ao.day_start(), None)['sessions'][0]
    assert (x['id'], x['label'], x['tools'], x['run'], x['read'], x['tokens']) == ('sess-1', 'api', 2, 1, 1, 150)
    assert x['st'] == {'Bash': 1, 'Read': 1}, '노드별 횟수'
    assert 'tin' in x and 'tcache' in x
    # 재시작: 체크포인트에서 이어 읽기 → 꺼져 있던 동안의 줄만 새로, 중복 없음
    ao.save_checkpoint()
    ao.sessions.clear()
    ao.checkpoint.clear()
    ao.checkpoint.update(ao.read_json(ao.CKPT_FILE)['files'])
    write_lines(log, turn('m3', 25, 'Edit'))
    ao.found["at"] = 0; ao.poll()  # 새 파일을 바로 찾게 (평소엔 3초마다)
    x = ao.summary(ao.day_start(), None)['sessions'][0]
    assert (x['tools'], x['edit'], x['tokens']) == (3, 1, 175), x
    # 처음 보는 오늘 파일은 오늘 기록만 채워 넣는다 (어제 줄과 그 토큰은 제외)
    old = os.path.join(TMP, '.claude/projects/-w/sess-2.jsonl')
    yesterday = datetime.fromtimestamp(ao.day_start() - 3600).isoformat()
    write_lines(old, dict(turn('y1', 999, 'Bash'), timestamp=yesterday), turn('t1', 10, 'Bash'))
    ao.found["at"] = 0; ao.poll()  # 새 파일을 바로 찾게 (평소엔 3초마다)
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
    old_cmd = "curl -s -m 1 -H 'Content-Type: application/json' --data-binary @- 'http://127.0.0.1:7777/hook?agent=codex' >/dev/null 2>&1 || true"
    legacy = {'hooks': {'PreToolUse': [{'hooks': [{'type': 'command', 'command': old_cmd}]}]}}
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
    r = request('POST', '/api/rename', dict(ok, **js), json.dumps({'id': 'sess-1', 'name': '  백엔드\u0007 리팩터링' + 'x' * 60}))
    assert r[0] == 200 and json.loads(r[2])['name'] == ('백엔드 리팩터링' + 'x' * 60)[:40], '제어 문자 제거 · 40자'
    assert ao.read_json(ao.NAMES_FILE) == {'sess-1': ao.names['sess-1']}, '재시작해도 남게 저장'
    assert request('POST', '/api/rename', dict(evil, **js), json.dumps({'id': 'sess-1', 'name': 'x'}))[0] == 403
    request('POST', '/api/rename', dict(ok, **js), json.dumps({'id': 'sess-1', 'name': ''}))
    assert 'sess-1' not in ao.names, '빈 이름 = 원래 이름으로'
    st, _, body = request('GET', '/api/preview?agent=claude&action=connect', ok)
    assert st == 200 and '+' in json.loads(body)['diff']
    srv.shutdown()



def test_seed_limits():  # 이미 읽은 Codex 로그라도 처음 켤 때 마지막 한도 값을 찾아 둔다
    d = os.path.join(TMP, '.codex', 'sessions', datetime.now().strftime('%Y/%m/%d'))
    os.makedirs(d, exist_ok=True)
    rl = lambda used: {'primary': {'used_percent': used, 'window_minutes': 300, 'resets_at': 2000000000},
                       'secondary': {'used_percent': 7.0, 'window_minutes': 10080, 'resets_at': 2000500000}, 'plan_type': 'plus'}
    write_lines(os.path.join(d, 'rollout-seed.jsonl'), {'type': 'session_meta', 'payload': {'cwd': '/w/x'}},
                {'timestamp': NOW, 'type': 'event_msg', 'payload': {'type': 'token_count', 'rate_limits': rl(10.0)}},
                {'timestamp': NOW, 'type': 'event_msg', 'payload': {'type': 'token_count', 'rate_limits': None}},
                {'timestamp': NOW, 'type': 'event_msg', 'payload': {'type': 'token_count', 'rate_limits': rl(42.0)}})
    ao.limits.clear()
    ao.seed_limits()
    assert ao.limits['primary']['used'] == 42.0 and ao.limits['secondary']['window'] == 10080 and ao.limits['plan'] == 'plus', ao.limits



def test_claude_limits():  # 사용량 응답 → 5시간 · 주간 한도. 만료된 토큰은 부르지도 갱신하지도 않는다
    import io
    calls = []
    ao.claude_login = lambda: {'accessToken': 'tok', 'expiresAt': (time.time() + 3600) * 1000, 'subscriptionType': 'max'}
    ao.urlopen = lambda req, timeout=10: calls.append(req.get_header('Authorization')) or io.BytesIO(json.dumps(
        {'five_hour': {'utilization': 23.0, 'resets_at': '2030-01-01T05:00:00+00:00'}, 'seven_day': {'utilization': 41, 'resets_at': None}}).encode())
    ao.fetch_claude_limits()
    L = ao.claude_limits
    assert calls == ['Bearer tok'] and L['primary']['used'] == 23.0 and L['primary']['window'] == 300 and L['primary']['resets'] == 1893474000.0, L
    assert L['secondary'] == {'used': 41, 'window': 10080, 'resets': None} and L['plan'] == 'max' and 'error' not in L, L
    ao.claude_login = lambda: {'accessToken': 'tok', 'expiresAt': (time.time() - 60) * 1000}
    ao.fetch_claude_limits()
    assert len(calls) == 1 and L['error'] == 'expired' and L['primary']['used'] == 23.0, '만료: 조회 안 하고 이전 값은 유지'



def test_codex_limits():  # Codex 공식 app-server 의 지금 한도로 로그 값을 덮는다
    ao.codex_rpc = lambda calls, timeout=20: [{'id': 1, 'result': {'rateLimits': {'planType': 'plus',
        'primary': {'usedPercent': 0, 'windowDurationMins': 300, 'resetsAt': 2000000000},
        'secondary': {'usedPercent': 3, 'windowDurationMins': 10080, 'resetsAt': 2000500000}}}}] if calls == [('account/rateLimits/read', None)] else None
    ao.fetch_codex_limits()
    assert ao.limits['secondary'] == {'used': 3, 'window': 10080, 'resets': 2000500000} and ao.limits['plan'] == 'plus', ao.limits
    ao.codex_rpc = lambda calls, timeout=20: None  # codex 가 없으면 이전 값 그대로
    ao.fetch_codex_limits()
    assert ao.limits['secondary']['used'] == 3



def test_notify_cwd_and_extra_hook():  # 권한 · 입력 대기 알림, 시작 폴더 경로, 알림 훅은 예전 연결을 바꾸지 않음
    tp = os.path.join(TMP, 'n', 'sess-n.jsonl')
    ao.hook('claude', {'hook_event_name': 'SessionStart', 'session_id': 'sess-n', 'transcript_path': tp, 'cwd': '/w/proj'}, 'tab-n')
    ao.hook('claude', {'hook_event_name': 'Notification', 'session_id': 'sess-n', 'transcript_path': tp, 'cwd': '/w/proj/sub',
                       'message': 'Claude needs your permission to use Bash'})
    e = ao.history[-1]
    assert e['kind'] == 'notify' and e['id'] == 'sess-n' and e['cwd'] == '/w/proj' and 'permission' in e['text'], e
    assert ao.status()['tabs'].get('tab-n') == 'sess-n'
    old = json.dumps({'hooks': {ev: [{'hooks': [{'type': 'command', 'command': ao.hook_cmd('claude')}]}] for ev in ao.AGENTS['claude']['events']}})
    f = os.path.expanduser(ao.AGENTS['claude']['file'])
    os.makedirs(os.path.dirname(f), exist_ok=True)
    with open(f, 'w') as fp:
        fp.write(old)
    assert ao.hooks_state('claude') == 'connected' and ao.agent_state('claude')['notify'] is False, '알림 훅이 없어도 연결된 것으로'
    assert 'Notification' in json.loads(ao.render('claude', old, True))['hooks'], '다시 연결하면 알림 훅 추가'


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn()
            print('✓', name)
    print('ok')
