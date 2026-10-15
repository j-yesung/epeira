// Agent Orbit 앱 — 왼쪽 프로젝트, 가운데 터미널 탭(실제 셸), 오른쪽 궤도(로컬 수집기 대시보드)
const {app, BrowserWindow, Menu, ipcMain, dialog, shell} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');
const pty = require('node-pty');

const ORBIT = 'http://127.0.0.1:47777';
const HOME_APP = path.join(os.homedir(), '.agent-orbit');
const terms = new Map();  // 탭 id → pty
let win, seq = 0;

app.setName('Agent Orbit');

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
function collectorStatus() {
  return new Promise(resolve => {
    const req = http.get(`${ORBIT}/api/status`, {timeout: 4000}, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

ipcMain.handle('collector:ensure', async () => {
  let st = await collectorStatus();
  if (st) return {ok: true, status: st};
  if (!fs.existsSync(path.join(HOME_APP, 'agent_orbit.py'))) return {ok: false, installed: false};
  // 설치돼 있는데 꺼져 있으면: 로그인 서비스를 깨우고, 그래도 안 되면 직접 띄운다
  if (process.platform === 'darwin') spawn('launchctl', ['kickstart', `gui/${process.getuid()}/dev.agentorbit.collector`], {stdio: 'ignore'});
  for (let i = 0; i < 8 && !st; i++) { await sleep(400); st = await collectorStatus(); }
  if (!st) {
    spawn(path.join(HOME_APP, 'bin', 'agent-orbit'), ['serve'], {detached: true, stdio: 'ignore'}).unref();
    for (let i = 0; i < 10 && !st; i++) { await sleep(400); st = await collectorStatus(); }
  }
  return st ? {ok: true, status: st} : {ok: false, installed: true};
});

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
    width: 1480, height: 920, minWidth: 980, minHeight: 600, title: 'Agent Orbit', backgroundColor: '#0a0a0a',
    // 신호등 버튼(높이 16) 가운데를 상단 바(52px)의 가운데 26px 에 맞춘다 — style.css 의 .side-top 과 짝
    titleBarStyle: 'hiddenInset', trafficLightPosition: {x: 16, y: 18}, icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true},
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
