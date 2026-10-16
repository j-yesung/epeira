# Tycho 에 참여하기

버그 제보, 제안, 코드 기여 모두 환영합니다. 보안 문제는 공개 이슈 대신 [SECURITY.md](SECURITY.md) 를 보세요.

## 구조

| 경로 | 내용 |
| --- | --- |
| `agent_orbit.py` | 수집기. Python 3.9 표준 라이브러리만 씁니다. Claude Code · Codex 로그와 훅 신호를 모아 `127.0.0.1` 에서만 API · 대시보드를 엽니다 |
| `index.html`, `app.js` | 궤도 대시보드. 사이트(Vercel)와 수집기가 같은 파일을 보여 주고, 앱의 궤도 패널도 이 화면입니다 |
| `install.sh` | 수집기 설치 · 업데이트 스크립트 (앱도 같은 스크립트를 앱에 든 파일로 실행) |
| `desktop/` | Electron 앱: `main.js`(창 · 터미널 · 수집기 관리), `preload.js`(화면에 여는 최소 API), `renderer.js` · `style.css`(화면), `test/` |
| `app-version.json` | 앱이 하루 한 번 확인하는 최신 버전 |
| `vercel.json` | 사이트 보안 헤더 |

## 개발 환경

- macOS, Node.js 22.12 이상, npm, Xcode Command Line Tools(Python 3.9 포함)
- 대시보드 테스트에는 Google Chrome 이 필요합니다 (없으면 그 테스트만 건너뜀)

```sh
git clone https://github.com/j-yesung/agent-orbit.git
cd agent-orbit/desktop
npm ci
npm start
```

`npm start` 는 저장소의 수집기 파일로 실제 수집기(`~/.agent-orbit`, 포트 47777)를 설치 · 업데이트합니다. 실제 설치를 건드리지 않으려면 따로 띄운 시험용 수집기를 쓰세요. `AGENT_ORBIT_URL` 을 주면 앱은 설치를 건드리지 않습니다.

```sh
# 저장소 맨 위에서: 가짜 HOME · 다른 포트로 시험용 수집기
HOME=/tmp/tycho-dev AGENT_ORBIT_HOME=/tmp/tycho-dev/ao AGENT_ORBIT_PORT=47778 python3 agent_orbit.py serve
# desktop/ 에서
AGENT_ORBIT_URL=http://127.0.0.1:47778 npm start -- --user-data-dir=/tmp/tycho-dev/app
```

## 테스트

```sh
python3 test_agent_orbit.py     # 수집기 (저장소 맨 위에서)
cd desktop && npm test          # 앱 · 궤도 대시보드 (창을 띄우지 않음)
```

둘 다 임시 폴더 · 임시 포트에서 돌아서 실제 설정 · 기록은 건드리지 않습니다. 동작을 바꾸면 그 동작을 확인하는 테스트도 함께 넣어 주세요.

## 지켜 주세요

- **수집기는 표준 라이브러리만.** 설치할 때 아무것도 내려받지 않게 하려는 것입니다.
- **사용자 설정 파일을 바꿀 땐 미리 보기와 동의.** `~/.claude/settings.json`, `~/.codex/hooks.json` 은 바뀌는 내용을 먼저 보여 주고, 다른 훅은 그대로 두고, 연결을 해제하면 연결 전 파일 그대로 되돌립니다. Codex 훅 승인도 실제 명령을 보여 준 뒤에만 합니다.
- **밖으로 나가는 요청을 늘리지 않기.** 수집기는 `127.0.0.1` 에서만 열고, 지금 있는 요청(README 의 "데이터와 설정")말고는 추가하지 않습니다. 꼭 필요하면 설정으로 켜게 하고 README 와 대시보드의 개인정보 안내에 적습니다.
- **수집기 API 보호 유지.** 쓰기는 허용한 Origin + JSON 만, Host 검사, 훅 요청에 Origin 이 있으면 거부.
- **앱 보안 설정 유지.** `contextIsolation` · `sandbox`, 궤도 패널(webview)의 권한 · 팝업 차단, Electron fuses(`package.json` 의 `electronFuses`).

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/ko/v1.0.0/) 형식으로, 분류는 영어 소문자 · 설명은 한국어로 씁니다.

```
<분류>(<범위>): <무엇을 했는지>
```

| 분류 | 언제 |
| --- | --- |
| `feat` | 새 기능 |
| `fix` | 버그 수정 (보안 문제 수정 포함) |
| `refactor` | 동작은 그대로 두고 코드 정리 |
| `perf` | 성능 개선 |
| `style` | 코드 모양만 (띄어쓰기 · 줄바꿈 등, 동작 변화 없음) |
| `test` | 테스트만 추가 · 수정 |
| `docs` | 문서만 (README · CONTRIBUTING 등) |
| `build` | 빌드 · 패키징 · 의존성 (electron-builder, npm 등) |
| `ci` | 자동 테스트 · 배포 설정 |
| `chore` | 그 밖의 잡일 (버전 올리기 등) |
| `revert` | 이전 커밋 되돌리기 |

- 범위는 고친 곳을 알려 줄 때만 붙입니다: `app`(데스크톱 앱), `collector`(수집기), `dashboard`(궤도 대시보드), `site`(사이트 · 설치 파일). 예: `fix(app): 테마 설정이 화면에 반영되지 않던 문제 수정`
- 제품 · 저장소 이름, 파일 이름, 명령, 약어는 영어 그대로 씁니다.
- 버전을 올린 커밋은 제목 끝에 `(0.12.0)` 처럼 앱 버전만 적습니다.

## 버전 · 릴리스 (관리자)

1. 버전 올리기: `desktop/package.json` 의 `version`(앱), 수집기나 대시보드를 바꿨다면 `agent_orbit.py` 의 `VERSION` 과 `app.js` 의 `LATEST` 를 같은 값으로.
2. `cd desktop && npm run dist` → `dist/` 에 Apple Silicon(`-arm64.dmg`) · Intel DMG. 지금은 임시 서명만 하고 공증하지 않습니다.
3. `app-version.json` 을 새 앱 버전으로 바꾸고 커밋.
4. `git push origin main` → Vercel 이 사이트(대시보드 · 설치 파일 · `app-version.json`)를 바로 배포합니다.
5. `gh release create v<버전> desktop/dist/Tycho-<버전>-arm64.dmg desktop/dist/Tycho-<버전>.dmg --target main` 으로 DMG 를 올립니다.
