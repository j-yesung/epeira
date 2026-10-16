# 앱 화면을 React 로 옮기는 계획

> 상태: **방향만 정함** (2026-10-16). 아직 시작하지 않았습니다.

## 왜 옮기나

- 앱 화면이 `desktop/renderer.js` 한 파일(약 1,200줄)과 `style.css` 에 다 들어 있고, 메뉴 · 팝오버 · 설정 창 · 명령 팔레트를 모두 직접 만들었습니다.
- 직접 만든 부품에서 같은 종류의 버그가 되풀이됐습니다. 예: 메뉴 버튼을 다시 누르면 닫히지 않음, 팔레트 입력을 터미널이 가져감, 커서가 칸마다 다름.
- Orca 처럼 검증된 부품(shadcn/ui · Radix)에 키보드 · 포커스 · 접근성 처리를 맡기고, 새 기능은 부품을 조립해서 빠르게 만듭니다.

## 범위

| 대상 | 계획 |
| --- | --- |
| 앱 화면 (`desktop/renderer.js`, `index.html`, `style.css`) | **React 로 옮김** |
| 앱 메인 · preload (`main.js`, `preload.js`) | 역할은 그대로. 옮기는 김에 TypeScript 로 (정할 것 참고) |
| 수집기 (`agent_orbit.py`) | 그대로 → Python 표준 라이브러리만 |
| 궤도 대시보드 (`app.js`, `index.html`) | 화면을 옮긴 **뒤에 따로** 판단 (정할 것 참고) |

## 쓸 라이브러리 (Orca 참고)

| 역할 | 쓸 것 | 지금 |
| --- | --- | --- |
| 빌드 | electron-vite (Vite) + TypeScript | 빌드 없음 |
| 화면 | React 19 | 직접 만든 `h()` |
| 스타일 · 부품 | Tailwind CSS 4 + shadcn/ui (Radix) | `style.css` + CSS 변수 |
| 아이콘 | lucide-react (Claude · OpenAI 로고는 지금 파일) | 직접 그린 SVG |
| 상태 | zustand | 전역 `S` 객체 |
| 명령 팔레트 | cmdk (shadcn Command) | `openPalette` |
| 메뉴 | shadcn DropdownMenu · ContextMenu | `showMenu` |
| 설정 창 | shadcn Dialog · Tabs · Switch · Select | `showSheet` |
| 알림 토스트 | sonner | `toast()` |
| 상태바 상세 · 툴팁 | shadcn HoverCard · Tooltip | `showPop` |
| 진행 막대 | shadcn Progress | `<progress>` |
| 탭 끌기 | dnd-kit | HTML 끌어 놓기 |
| 칸 나누기 | react-resizable-panels (shadcn Resizable) | 직접 만든 칸 트리 (최대 9칸) |
| 터미널 | **xterm.js + node-pty 그대로** | 그대로 |
| 테스트 | Playwright 그대로 (+ 부품 단위는 Vitest) | node:test + Playwright |

shadcn/ui 부품은 패키지가 아니라 저장소에 복사되는 코드라서, 필요하면 우리 식으로 고쳐 씁니다.

## 지켜야 할 것

- **보안 설정 그대로**: `contextIsolation` · `sandbox` · Electron fuses · 권한 핸들러. preload 로 여는 API 는 지금처럼 최소로.
- **CSP**: 배포본은 지금처럼 `'self'` 만. 원격 글꼴 · CDN 없이 모두 번들. 개발 서버(HMR)일 때만 완화.
- **터미널은 React 상태 밖에**: 화면을 다시 그릴 때 터미널이 새로 만들어지면 안 됩니다. xterm 인스턴스와 DOM 노드는 따로 관리하고, 탭 · 칸을 옮길 때 노드를 옮기는 지금 방식을 유지합니다.
- **저장된 값 그대로**: `localStorage` 의 `app.*` 키(탭 · 칸 배치 · 설정 · 펼침 상태)와 `app.json` · `projects.json` 형식. 업데이트해도 탭과 설정이 그대로여야 합니다.
- **동작 그대로**: 한국어 문구, 라이트 · 다크 테마(`<html data-theme>`), 단축키, 알림 · Dock 배지, 앱 안 업데이트(서명 확인).
- **배포**: electron-builder 의 `files` 를 빌드 결과(`out/`)로 바꾸고, GitHub Actions 릴리스에 빌드 단계를 넣습니다.

## 순서

1. **도구 준비**: `desktop/` 에 electron-vite · TypeScript · Tailwind · shadcn 을 들이고, 빈 React 화면이 지금 `main.js` · `preload.js` 로 뜨는지, 빌드 · 서명 · 테스트가 통과하는지 확인.
2. **뼈대**: 사이드바 · 탭 줄 · 칸 · 궤도 패널 · 상태바 배치와 테마.
3. **터미널 탭 · 칸 나누기** (가장 까다로워서 먼저): xterm 을 담는 부품, 칸 트리, 탭 끌기.
4. **나머지 화면**: 사이드바(프로젝트 · 세션 · ⋯ 메뉴), 명령 팔레트, 설정, 놓친 알림, 업데이트.
5. **테스트 바꾸기**: 지금 테스트는 화면 내부 이름(`S`, `openTab`, `selectProject` 등)을 직접 부르는 곳이 20곳이 넘습니다. 화면 요소(역할 · 이름 · `data-testid`) 기준으로 바꿉니다.
6. **옛 코드 삭제**: `renderer.js` · `style.css` 를 지우고 릴리스.

옛 화면과 React 를 섞어 조금씩 바꾸면 상태가 두 곳에 생깁니다. 브랜치에서 한 번에 옮긴 뒤, 지금 테스트 시나리오를 모두 통과하면 합치는 방식을 추천합니다.

## 정할 것

- **main · preload 도 TypeScript 로?** 추천: 같이 옮김 (작고, 화면과 주고받는 API 타입을 맞출 수 있음).
- **궤도 대시보드도 옮길까?** 사이트와 수집기가 빌드 없이 파일 두 개(`index.html` · `app.js`)를 그대로 내보내는 구조라, 옮기면 수집기 설치(`install.sh`)가 받는 파일 목록도 바뀝니다. 추천: 앱 화면을 옮긴 뒤 따로 판단.
- **칸 나누기**: react-resizable-panels 로 지금의 칸 트리(좌우 · 위아래 중첩, 최대 9칸)를 그대로 표현할 수 있는지 먼저 시험. 안 되면 칸 트리 로직은 지금 것을 React 로 옮김.
- **패키지 관리자**: Orca 는 pnpm 이지만, 추천은 npm 유지(지금 CI · 문서 그대로).

## 참고

- Orca ([stablyai/orca](https://github.com/stablyai/orca), MIT): Electron 43 · electron-vite · React 19 · Tailwind CSS 4 · shadcn/ui(Radix) · zustand · cmdk · sonner · dnd-kit · xterm.js 6 · node-pty.
