// Tycho 앱 — 왼쪽 프로젝트, 가운데 터미널 탭(실제 셸), 오른쪽 궤도(로컬 수집기 대시보드)
const {app, BrowserWindow, Menu, ipcMain, dialog, shell} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const {spawn, execFile} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const pty = require('node-pty');

const ORBIT = process.env.AGENT_ORBIT_URL || 'http://127.0.0.1:47777';  // 개발·테스트용으로만 바꾼다
const HOME_APP = path.join(os.homedir(), '.agent-orbit');
const BUNDLE = app.isPackaged ? path.join(process.resourcesPath, 'collector') : path.join(__dirname, '..');  // 앱에 들어 있는 수집기 (개발 중엔 저장소)
const terms = new Map();  // 탭 id → pty
let win, seq = 0;

app.setName('Tycho');
{  // 이름이 Agent Orbit 이던 때의 앱 데이터(프로젝트 목록 · 패널 폭)를 처음 한 번 옮긴다
  const oldData = path.join(app.getPath('appData'), 'Agent Orbit'), newData = path.join(app.getPath('appData'), 'Tycho');
  if (!fs.existsSync(newData) && fs.existsSync(oldData)) try { fs.cpSync(oldData, newData, {recursive: true}); } catch { /* 새로 시작 */ }
}

// ── 프로젝트 목록 (앱 데이터 폴더의 JSON 하나) ──
const storeFile = () => path.join(app.getPath('userData'), 'projects.json');
function loadProjects() {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { return []; }
}
function saveProjects(list) {
  fs.mkdirSync(path.dirname(storeFile()), {recursive: true});
  fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2));
}
const projectsView = () => loadProjects().map(p => ({...p, exists: fs.existsSync(p.path)}));

ipcMain.handle('projects:list', () => projectsView());
ipcMain.handle('projects:add', async () => {
  const r = await dialog.showOpenDialog(win, {title: '프로젝트 폴더 열기', properties: ['openDirectory', 'createDirectory']});
  if (r.canceled || !r.filePaths[0]) return {list: projectsView(), added: null};
  const dir = r.filePaths[0], list = loadProjects();
  if (!list.some(p => p.path === dir)) list.unshift({path: dir, name: path.basename(dir), added: Date.now(), opened: Date.now()});
  saveProjects(list);
  return {list: projectsView(), added: dir};
});
ipcMain.handle('projects:remove', (_, dir) => { saveProjects(loadProjects().filter(p => p.path !== dir)); return projectsView(); });
ipcMain.handle('projects:touch', (_, dir) => {
  const list = loadProjects(), p = list.find(x => x.path === dir);
  if (p) { p.opened = Date.now(); saveProjects(list); }
  return projectsView();
});

// ── 터미널: 탭마다 로그인 셸 하나. AGENT_ORBIT_TAB 으로 수집기가 탭 ↔ 세션을 짝짓는다 ──
function shellEnv(id) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    // 앱을 띄운 환경(npm·Electron·다른 에이전트 세션·다른 터미널 앱)의 흔적은 넘기지 않는다
    // — 안의 claude 가 "중첩 세션"으로 오해하거나, 다른 앱의 훅이 이 탭을 제 것으로 착각하지 않게
    if (/^(ELECTRON_|npm_|CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|CODEX_|ORCA_|ITERM_|VSCODE_|TMUX|KITTY_|WEZTERM_|GHOSTTY_|TERM_PROGRAM_VERSION$)/.test(k)) continue;
    env[k] = v;
  }
  return {...env, AGENT_ORBIT_TAB: id, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'AgentOrbit', LANG: env.LANG || 'ko_KR.UTF-8'};
}

ipcMain.handle('pty:create', (_, {cwd, run, cols, rows}) => {
  const id = `ao-${process.pid}-${++seq}`;
  const sh = process.env.SHELL || os.userInfo().shell || '/bin/zsh';
  const p = pty.spawn(sh, ['-l'], {name: 'xterm-256color', cols: cols || 100, rows: rows || 30,
    cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(), env: shellEnv(id)});
  terms.set(id, p);
  p.onData(d => win && !win.isDestroyed() && win.webContents.send('pty:data', id, d));
  p.onExit(({exitCode}) => { terms.delete(id); if (win && !win.isDestroyed()) win.webContents.send('pty:exit', id, exitCode); });
  if (run) p.write(run + '\r');  // 셸이 준비되면 입력으로 읽힌다
  return id;
});
ipcMain.on('pty:write', (_, id, data) => { const p = terms.get(id); if (p) p.write(data); });
ipcMain.on('pty:resize', (_, id, cols, rows) => { const p = terms.get(id); if (p && cols > 0 && rows > 0) p.resize(cols, rows); });
ipcMain.on('pty:kill', (_, id) => { const p = terms.get(id); if (p) { p.kill(); terms.delete(id); } });

// ── 로컬 수집기 ──
function getJSON(pathname) {
  return new Promise(resolve => {
    const req = http.get(`${ORBIT}${pathname}`, {timeout: 4000}, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
const collectorStatus = () => getJSON('/api/status');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 하단 상태바: 오늘 에이전트별 도구 횟수 · 토큰(입력 · 출력 · 캐시 읽기) · 연결 상태 · 에이전트별 사용 한도
ipcMain.handle('collector:usage', async (_, refresh) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [status, sum] = await Promise.all([getJSON(refresh ? '/api/status?refresh=1' : '/api/status'), getJSON(`/api/summary?since=${today.getTime() / 1000}`)]);  // 새로고침 버튼이면 한도도 다시
  if (!status) return {ok: false};
  const by = {};
  for (const [k, a] of Object.entries(status.agents || {})) by[k] = {name: a.name, installed: a.installed, connected: a.connected, trust: a.trust, calls: 0, tin: 0, tout: 0, tcache: 0};
  for (const x of (sum && sum.sessions) || []) {
    const b = by[x.agent];
    if (b) { b.calls += x.tools || 0; b.tin += x.tin || 0; b.tout += x.tokens || 0; b.tcache += x.tcache || 0; }
  }
  return {ok: true, version: status.version, by, limits: status.limits || {}, claudeLimits: status.claudeLimits};  // limits: {codex|claude: {primary, secondary, plan, at} 또는 {error}}
});

// ── 앱이 켜지면 수집기도 바로: 없으면 설치, 앱에 든 것보다 오래됐으면 업데이트, 꺼져 있으면 깨운다 ──
// 사용자가 터미널에 설치 명령을 칠 필요가 없다. 훅 연결(설정 파일 변경)은 여전히 대시보드에서 동의를 받고 한다
const bundledVersion = () => { try { return /^VERSION = '([^']+)'/m.exec(fs.readFileSync(path.join(BUNDLE, 'agent_orbit.py'), 'utf8'))[1]; } catch { return null; } };
const newer = (a, b) => { const x = a.split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

function userPath() {  // Finder 에서 켠 앱은 PATH 가 짧다 → 로그인 셸의 PATH 를 받아 수집기에 넘긴다 (python3 · codex 를 찾게)
  return new Promise(resolve => {
    const sh = process.env.SHELL || os.userInfo().shell || '/bin/zsh';
    execFile(sh, ['-ilc', 'printf "__TYCHO__%s__TYCHO__" "$PATH"'], {timeout: 8000}, (err, out) => {
      const m = /__TYCHO__(.*)__TYCHO__/.exec(out || '');
      resolve(m ? m[1] : process.env.PATH);
    }).stdin.end();  // 셸 설정이 무언가를 물어도 기다리지 않게
  });
}

async function installCollector() {  // install.sh 와 같은 절차를 앱에 든 파일로 (내려받지 않음)
  const env = {...process.env, PATH: await userPath(), AGENT_ORBIT_BASE: pathToFileURL(BUNDLE).href.replace(/\/$/, '')};
  return new Promise(resolve => execFile('/bin/sh', [path.join(BUNDLE, 'install.sh')], {env, timeout: 120000},
    (err, stdout, stderr) => resolve({ok: !err, out: `${stdout}${stderr}`.slice(-2000)})));
}

async function ensureCollector() {
  let st = await collectorStatus();
  const want = bundledVersion();
  if (st && !(want && newer(want, st.version))) return {ok: true, status: st};
  if (!st && fs.existsSync(path.join(HOME_APP, 'agent_orbit.py')) && process.platform === 'darwin') {  // 설치돼 있는데 꺼져 있으면 먼저 깨워 본다
    spawn('launchctl', ['kickstart', `gui/${process.getuid()}/dev.agentorbit.collector`], {stdio: 'ignore'});
    for (let i = 0; i < 8 && !st; i++) { await sleep(400); st = await collectorStatus(); }
    if (st && !(want && newer(want, st.version))) return {ok: true, status: st};
  }
  // 개발 · 테스트로 다른 수집기 주소를 쓰면 실제 설치(~/.agent-orbit)는 건드리지 않는다
  if (!want || process.env.AGENT_ORBIT_URL) return st ? {ok: true, status: st} : {ok: false, installed: fs.existsSync(path.join(HOME_APP, 'agent_orbit.py'))};
  const r = await installCollector();
  st = await collectorStatus();
  if (st) return {ok: true, status: st, updated: true};
  return {ok: false, installed: fs.existsSync(path.join(HOME_APP, 'agent_orbit.py')), needPython: /Python 3\.9/.test(r.out), log: r.out};
}
let ensuring = null;  // 동시에 두 번 설치하지 않게
ipcMain.handle('collector:ensure', () => ensuring || (ensuring = ensureCollector().finally(() => { ensuring = null; })));
ipcMain.on('install-devtools', () => { if (process.platform === 'darwin') execFile('xcode-select', ['--install'], () => {}); });

ipcMain.on('open-external', (_, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

// ── 창 · 메뉴 ──
function send(action) { if (win && !win.isDestroyed()) win.webContents.send('menu', action); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{role: 'appMenu'}] : []),
    {label: '파일', submenu: [
      {label: '폴더 열기…', accelerator: 'CmdOrCtrl+O', click: () => send('add-project')},
      {type: 'separator'},
      {label: '새 터미널 탭', accelerator: 'CmdOrCtrl+T', click: () => send('new-shell')},
      {label: 'Claude 새 세션', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('new-claude')},
      {label: 'Codex 새 세션', accelerator: 'CmdOrCtrl+Shift+X', click: () => send('new-codex')},
      {type: 'separator'},
      {label: '탭 닫기', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab')},
    ]},
    {role: 'editMenu'},
    {label: '보기', submenu: [
      {label: '사이드바', accelerator: 'CmdOrCtrl+B', click: () => send('toggle-side')},
      {label: '궤도 패널', accelerator: 'CmdOrCtrl+J', click: () => send('toggle-orbit')},
      {label: '대시보드 크게 보기', click: () => shell.openExternal(ORBIT + '/')},
      {type: 'separator'},
      {label: '다음 탭', accelerator: 'Ctrl+Tab', click: () => send('next-tab')},
      {label: '이전 탭', accelerator: 'Ctrl+Shift+Tab', click: () => send('prev-tab')},
      {type: 'separator'},
      {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'},
      {type: 'separator'},
      {role: 'reload'}, {role: 'toggleDevTools'}, {role: 'togglefullscreen'},
    ]},
    {role: 'windowMenu'},
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 980, minHeight: 600, title: 'Tycho', backgroundColor: '#0a0a0a',
    // 신호등 버튼(높이 16) 가운데를 상단 바(52px)의 가운데 26px 에 맞춘다 — style.css 의 .side-top 과 짝
    titleBarStyle: 'hiddenInset', trafficLightPosition: {x: 16, y: 18}, icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true,
      additionalArguments: [`--agent-orbit-url=${ORBIT}`]},
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  // 궤도 패널(webview)은 로컬 수집기 대시보드만 열 수 있다
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    if (params.src !== 'about:blank' && !params.src.startsWith(ORBIT + '/')) e.preventDefault();
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
}

app.on('web-contents-created', (_, wc) => {
  wc.setWindowOpenHandler(({url}) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return {action: 'deny'}; });
  if (wc.getType() === 'webview') {
    wc.on('will-navigate', (e, url) => { if (!url.startsWith(ORBIT + '/')) { e.preventDefault(); shell.openExternal(url); } });
  }
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(__dirname, 'assets/icon.png'));
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', () => { for (const p of terms.values()) p.kill(); terms.clear(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
