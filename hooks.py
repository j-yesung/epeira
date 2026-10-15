#!/usr/bin/env python3
"""agent-orbit 훅을 Claude Code / Codex 설정에 추가·제거.

  python3 hooks.py           → 바뀔 내용만 미리 보기 (파일은 안 건드림)
  python3 hooks.py --apply   → 적용 (원본은 *.orbit-bak 으로 백업)
  python3 hooks.py --remove  → agent-orbit 훅만 제거 (다른 훅은 그대로)
"""
import difflib
import json
import os
import shutil
import sys

URL = 'http://127.0.0.1:7777/hook?agent='
TARGETS = [  # (설정 파일, 에이전트, 이벤트, 훅 옵션)
    ('~/.claude/settings.json', 'claude', ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'], {'async': True}),
    ('~/.codex/hooks.json', 'codex', ['PreToolUse', 'PostToolUse'], {'async': True, 'timeout': 2}),
]


def command(agent):
    # 대시보드가 꺼져 있어도 조용히 통과: 백그라운드(async), 1초 제한, 항상 exit 0
    return "curl -s -m 1 -H 'Content-Type: application/json' --data-binary @- '%s%s' >/dev/null 2>&1 || true" % (URL, agent)


def ours(group):
    return any(URL in h.get('command', '') for h in group.get('hooks', []))


def main():
    mode = (sys.argv[1:] or ['--preview'])[0]
    for path, agent, events, opts in TARGETS:
        path = os.path.expanduser(path)
        with open(path, encoding='utf-8') as f:
            before = f.read()
        d = json.loads(before)
        hooks = d.setdefault('hooks', {})
        for ev in events:
            groups = [g for g in hooks.get(ev, []) if not ours(g)]  # 기존 훅은 순서 그대로, 우리 것은 맨 뒤에
            if mode != '--remove':
                groups.append({'hooks': [dict({'type': 'command', 'command': command(agent)}, **opts)]})
            if groups:
                hooks[ev] = groups
            else:
                hooks.pop(ev, None)
        after = json.dumps(d, indent=2, ensure_ascii=False) + '\n'
        diff = ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), path, path + ' (after)', n=2))
        print(diff or '%s: 변경 없음\n' % path)
        if mode in ('--apply', '--remove') and diff:
            shutil.copy(path, path + '.orbit-bak')
            with open(path + '.tmp', 'w', encoding='utf-8') as f:
                f.write(after)
            os.replace(path + '.tmp', path)  # 쓰는 도중 에이전트가 반쯤 쓴 파일을 읽지 않게
            print('→ 적용됨 (백업: %s.orbit-bak)\n' % path)


if __name__ == '__main__':
    main()
