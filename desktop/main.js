// Epeira 앱 → 왼쪽 프로젝트, 가운데 터미널 탭(실제 셸), 오른쪽 궤도(로컬 수집기 대시보드)
const {app, BrowserWindow, Menu, ipcMain, dialog, shell, Notification, nativeTheme, screen, clipboard, session} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const {spawn, execFile} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const pty = require('node-pty');

const HOME_APP = path.join(os.homedir(), '.agent-orbit');
const savedPort = () => { try { return +fs.readFileSync(path.join(HOME_APP, 'port'), 'utf8') || 47777; } catch { return 47777; } };  // 수집기가 다른 포트로 설치됐으면
const ORBIT = process.env.AGENT_ORBIT_URL || `http://127.0.0.1:${savedPort()}`;  // 개발·테스트용으로만 바꾼다
const BUNDLE = app.isPackaged ? path.join(process.resourcesPath, 'collector') : path.join(__dirname, '..');  // 앱에 들어 있는 수집기 (개발 중엔 저장소)
const terms = new Map();  // 탭 id → pty
let win, seq = 0, quitting = false;
const TEST = process.env.EPEIRA_TEST === '1';  // 자동 테스트: 창을 띄우지 않는다 (사용자 화면을 가리지 않게)

app.setName('Epeira');
{  // 이름이 Tycho · Agent Orbit 이던 때의 앱 데이터(프로젝트 목록 · 탭 · 설정)를 처음 한 번 옮긴다
  const newData = path.join(app.getPath('appData'), 'Epeira');
  const oldData = ['Tycho', 'Agent Orbit'].map(n => path.join(app.getPath('appData'), n)).find(d => fs.existsSync(d));
  if (!fs.existsSync(newData) && oldData) try { fs.cpSync(oldData, newData, {recursive: true}); } catch { /* 새로 시작 */ }
}

// ── 앱 설정 (창 위치 · 테마) → 앱 데이터 폴더의 JSON 하나 ──
const confFile = () => path.join(app.getPath('userData'), 'app.json');
const conf = () => { try { return JSON.parse(fs.readFileSync(confFile(), 'utf8')); } catch { return {}; } };
const saveConf = patch => {
  const c = {...conf(), ...patch};
  fs.mkdirSync(path.dirname(confFile()), {recursive: true});
  fs.writeFileSync(confFile(), JSON.stringify(c, null, 2));
  return c;
};

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
function addProject(dir) {
  const list = loadProjects();
  if (!list.some(p => p.path === dir)) list.unshift({path: dir, name: path.basename(dir), added: Date.now(), opened: Date.now()});
  saveProjects(list);
  return {list: projectsView(), added: dir};
}

ipcMain.handle('projects:list', () => projectsView());
ipcMain.handle('projects:add', async () => {
  const r = await dialog.showOpenDialog(win, {title: '프로젝트 폴더 열기', properties: ['openDirectory', 'createDirectory']});
  if (r.canceled || !r.filePaths[0]) return {list: projectsView(), added: null};
  return addProject(r.filePaths[0]);
});
ipcMain.handle('projects:addPath', (_, dir) => {  // 폴더를 사이드바에 끌어다 놓기
  try { if (typeof dir === 'string' && path.isAbsolute(dir) && fs.statSync(dir).isDirectory()) return addProject(dir); } catch { /* 폴더가 아님 */ }
  return {list: projectsView(), added: null};
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
    // → 안의 claude 가 "중첩 세션"으로 오해하거나, 다른 앱의 훅이 이 탭을 제 것으로 착각하지 않게
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

// 탭에서 셸 말고 다른 프로그램(claude · codex · npm …)이 돌고 있으면 그 이름
const SHELLS = /^-?(zsh|bash|fish|sh|tcsh|ksh|nu|login)$/;
function busy(id) {
  const p = terms.get(id);
  try { const name = p && path.basename(p.process || ''); return name && !SHELLS.test(name) ? name : null; } catch { return null; }
}
ipcMain.handle('pty:confirmClose', async (_, id) => {  // 실행 중이면 묻고 닫는다 (작업 손실 방지)
  const name = busy(id);
  if (!name) return true;
  const r = await dialog.showMessageBox(win, {type: 'warning', buttons: ['닫기', '취소'], defaultId: 1, cancelId: 1,
    message: `${name} 이(가) 실행 중이에요`, detail: '탭을 닫으면 함께 끝나요. Claude · Codex 대화는 나중에 이어서 열 수 있어요.'});
  return r.response === 0;
});
function confirmQuit() {
  const names = [...new Set([...terms.keys()].map(busy).filter(Boolean))];
  if (!names.length) return true;
  return dialog.showMessageBoxSync(win, {type: 'warning', buttons: ['종료', '취소'], defaultId: 1, cancelId: 1,
    message: '실행 중인 작업이 있어요', detail: `${names.join(', ')} → 종료하면 함께 끝나요. 다음에 켜면 탭과 Claude · Codex 대화를 다시 열어요.`}) === 0;
}
const killAll = () => { for (const p of terms.values()) p.kill(); terms.clear(); };

// 터미널 우클릭 메뉴: 복사는 여기서, 붙여넣기 · 찾기 등은 화면이 (붙여넣기 모드를 지키려고 xterm 의 paste 로)
ipcMain.on('term:menu', (_, selection) => {
  const act = (action, text) => win.webContents.send('term:action', action, text);
  Menu.buildFromTemplate([
    {label: '복사', enabled: !!selection, click: () => clipboard.writeText(selection)},
    {label: '붙여넣기', click: () => act('paste', clipboard.readText())},
    {label: '모두 선택', click: () => act('selectAll')},
    {type: 'separator'},
    {label: '찾기…', click: () => act('find')},
    {label: '화면 지우기', click: () => act('clear')},
  ]).popup({window: win});
});

// 사이드바 프로젝트 메뉴의 "Finder 에서 보기" (목록에 있는 프로젝트만, 폴더를 실행하지 않고 보여 주기만)
ipcMain.on('project:reveal', (_, dir) => { if (loadProjects().some(p => p.path === dir)) shell.showItemInFolder(dir); });
ipcMain.handle('projects:confirmRemove', async (_, name, ids) => {  // 터미널이 열린 프로젝트를 빼기 전에 한 번 묻는다
  const running = [...new Set(ids.map(busy).filter(Boolean))];
  const r = await dialog.showMessageBox(win, {type: 'warning', buttons: ['닫고 빼기', '취소'], defaultId: 1, cancelId: 1,
    message: `${name} 의 터미널 ${ids.length}개를 닫고 목록에서 뺄까요?`,
    detail: `${running.length ? `${running.join(', ')} 이(가) 실행 중이에요 → 함께 끝나요. ` : ''}폴더는 지우지 않아요. Claude · Codex 대화는 나중에 이어서 열 수 있어요.`});
  return r.response === 0;
});

// ── 로컬 수집기 ──
function getJSON(pathname, timeout = 4000) {
  return new Promise(resolve => {
    const req = http.get(`${ORBIT}${pathname}`, {timeout}, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
function postJSON(pathname, body) {  // 수집기의 쓰기 API 는 허용된 Origin + JSON 만 받는다 → 수집기 자기 주소를 Origin 으로
  return new Promise(resolve => {
    const data = JSON.stringify(body || {});
    const req = http.request(`${ORBIT}${pathname}`, {method: 'POST', timeout: 60000,
      headers: {'Content-Type': 'application/json', Origin: ORBIT, 'Content-Length': Buffer.byteLength(data)}}, res => {
      let out = '';
      res.on('data', d => { out += d; });
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch { resolve({ok: false, message: '응답을 읽지 못했어요'}); } });
    });
    req.on('error', () => resolve({ok: false, message: '수집기에 연결할 수 없어요'}));
    req.on('timeout', () => { req.destroy(); resolve({ok: false, message: '시간이 너무 오래 걸려요'}); });
    req.end(data);
  });
}
const collectorStatus = () => getJSON('/api/status');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 앱 안 설정 화면: 상태 · 미리 보기는 읽기만, 쓰기는 정해진 동작만 (연결 · 해제 · 승인 · 설정)
ipcMain.handle('orbit:get', (_, p) => (/^\/api\/(status|preview|summary|search)(\?|$)/.test(p) ? getJSON(p, 25000) : null));
const WRITES = new Set(['/api/connect', '/api/disconnect', '/api/trust', '/api/settings', '/api/autostart', '/api/rename']);
ipcMain.handle('orbit:post', (_, p, body) => (WRITES.has(p) ? postJSON(p, body) : null));

// 하단 상태바: 오늘 에이전트별 도구 횟수 · 토큰(입력 · 출력 · 캐시 읽기) · 연결 상태 · 에이전트별 사용 한도 · 탭 ↔ 세션
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
  const todays = ((sum && sum.sessions) || []).map(x => ({id: x.id, parent: x.parent, agent: x.agent, cwd: x.cwd, label: x.label, tools: x.tools || 0, tok: (x.tin || 0) + (x.tokens || 0)}));  // 프로젝트별 오늘 사용량
  return {ok: true, version: status.version, port: status.port, by, limits: status.limits || {}, claudeLimits: status.claudeLimits, tabs: status.tabs || {}, names: status.names || {}, today: todays};  // limits: {codex|claude: {primary, secondary, plan, at} 또는 {error}}
});

// 수집기 이벤트를 화면에 전달 (탭 상태 · 알림용, 궤도 화면과 별개). 끊기면 3초 뒤 다시
let following = false;
function followEvents() {
  if (following) return;
  following = true;
  let buf = '';
  const again = () => { if (!following) return; following = false; setTimeout(followEvents, 3000); };
  const req = http.get(`${ORBIT}/api/events`, res => {
    res.setEncoding('utf8');
    res.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) {
        const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data: '));
        if (!line || !win || win.isDestroyed()) continue;
        try { win.webContents.send('orbit:event', JSON.parse(line.slice(6))); } catch { /* 깨진 줄은 건너뜀 */ }
      }
    });
    res.on('end', again);
    res.on('error', again);
  });
  req.on('error', again);
}

// 알림 · Dock 배지: 응답을 마쳤거나 권한 승인 · 입력을 기다리는 탭
ipcMain.on('notify', (_, {title, body, tab, silent}) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({title, body, silent: !!silent});
  n.on('click', () => { if (!win || win.isDestroyed()) return; win.show(); win.focus(); win.webContents.send('tab:activate', tab); });
  n.show();
});
ipcMain.on('badge', (_, count) => { app.setBadgeCount(Math.max(0, count | 0)); });

// git: 프로젝트의 브랜치와 바뀐 파일 수 (사이드바). git 저장소가 아니면 null
function gitInfo(dir) {
  return new Promise(resolve => execFile('git', ['-C', dir, 'status', '--porcelain=v1', '--branch', '--untracked-files=normal'], {timeout: 3000, maxBuffer: 4 << 20}, (err, out) => {
    if (err) return resolve(null);
    const [head, ...rest] = out.split('\n'), m = /^## (?:No commits yet on )?([^.\s]+)/.exec(head);
    resolve({branch: m ? m[1] : 'HEAD', changes: rest.filter(Boolean).length});
  }));
}
ipcMain.handle('git:info', async (_, dirs) => Object.fromEntries(await Promise.all((dirs || []).filter(d => typeof d === 'string').slice(0, 50).map(async d => [d, await gitInfo(d)]))));

// 문제 해결: 진단 정보(epeira doctor) · 수집기 다시 설치
ipcMain.handle('collector:doctor', async () => {
  const bin = path.join(HOME_APP, 'bin', 'epeira');
  if (!fs.existsSync(bin)) return '수집기가 설치되어 있지 않아요.';
  const env = {...process.env, PATH: await userPath()};
  return new Promise(resolve => execFile(bin, ['doctor'], {env, timeout: 30000}, (err, out, errOut) => resolve(`${out}${errOut}`.trim() || String(err))));
});
ipcMain.handle('collector:reinstall', async () => {
  if (process.env.AGENT_ORBIT_URL || !bundledVersion()) return {ok: false, log: '개발 · 테스트 모드에서는 다시 설치하지 않아요.'};
  const r = await installCollector();
  return {ok: !!(await collectorStatus()), log: r.out};
});

// 새 버전: 6시간마다(설정에서 바로도) 사이트의 app-version.json 을 확인하고, 누르면 GitHub Releases 의 DMG 를 받아 바꾼다
// 관리자가 릴리스할 때 비밀 키(저장소 밖)로 DMG 에 서명하고 앱엔 공개 키만 → 사이트나 내려받는 길이 털려도 우리가 서명하지 않은 파일은 설치하지 않는다
const SITE = process.env.EPEIRA_UPDATE_BASE || 'https://epeira.vercel.app';
const RELEASES = process.env.EPEIRA_UPDATE_BASE || 'https://github.com/j-yesung/epeira/releases/download';
const UPDATE_KEY = crypto.createPublicKey({key: Buffer.from((TEST && process.env.EPEIRA_UPDATE_KEY) || 'MCowBQYDK2VwAyEAWnNiV7VZ9Ba/TOrzn4zJ3AR1WUQXLw2nvZujRttGay8=', 'base64'), format: 'der', type: 'spki'});
function latestApp() {
  return new Promise(resolve => {
    const req = (SITE.startsWith('https:') ? https : http).get(`${SITE}/app-version.json`, {timeout: 8000}, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', async (_, force) => {  // 6시간에 한 번만 실제로 묻는다. force: 설정의 "업데이트 확인"
  if (TEST && !force) return null;
  const c = conf();
  if (!force && c.latest && Date.now() - (c.checkedAt || 0) < 6 * 36e5) return newer(c.latest.version, app.getVersion()) ? c.latest : null;
  const v = await latestApp();
  if (!(v && typeof v.version === 'string' && /^https:\/\//.test(v.url || ''))) return force ? {failed: true} : null;
  saveConf({latest: {version: v.version, url: v.url}, checkedAt: Date.now()});
  return newer(v.version, app.getVersion()) ? {version: v.version, url: v.url} : null;
});

const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, {timeout: 120000}, (err, out) => (err ? reject(err) : resolve(out.trim()))));
async function download(url, file, progress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`내려받지 못했어요 (${res.status})`);
  const total = +res.headers.get('content-length') || 0, body = Readable.fromWeb(res.body);
  let got = 0;
  if (progress && total) body.on('data', d => { got += d.length; progress(got / total); });
  await pipeline(body, fs.createWriteStream(file));
}
let shown = -1;
function updateProgress(stage, f) {  // 화면(상태바 · 설정)과 Dock 아이콘에 진행 막대. f: 0~1, 확인 중이면 null, 끝나면 stage = null
  if (!win || win.isDestroyed() || (stage === 'download' && f - shown < 0.01 && f < 1)) return;
  shown = stage === 'download' ? f : -1;
  win.setProgressBar(stage === 'download' ? f : stage ? 1 : -1);
  win.webContents.send('update:progress', stage, f);
}
async function stageUpdate(version) {  // 받기 → 서명 확인 → DMG 에서 앱 꺼내기 → 안의 버전 확인 (지금 앱은 아직 그대로)
  const name = `Epeira-${version}${process.arch === 'arm64' ? '-arm64' : ''}.dmg`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epeira-update-'));
  const dmg = path.join(dir, name), mnt = path.join(dir, 'mnt'), next = path.join(dir, 'Epeira.app');
  try {
    updateProgress('download', 0);
    await download(`${RELEASES}/v${version}/${name}`, dmg, f => updateProgress('download', f));
    updateProgress('verify', null);
    await download(`${RELEASES}/v${version}/${name}.sig`, `${dmg}.sig`);
    if (!crypto.verify(null, fs.readFileSync(dmg), UPDATE_KEY, Buffer.from(fs.readFileSync(`${dmg}.sig`, 'utf8').trim(), 'base64'))) throw new Error('서명이 맞지 않아요');
    await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt]);
    try { await run('ditto', [path.join(mnt, 'Epeira.app'), next]); } finally { await run('hdiutil', ['detach', mnt, '-force']).catch(() => {}); }
    const inner = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(next, 'Contents/Info.plist')]);
    if (inner !== version) throw new Error(`받은 앱이 ${inner} 버전이에요`);  // 예전 버전 DMG 를 새 버전이라고 내미는 것 막기
  } catch (e) { fs.rmSync(dir, {recursive: true, force: true}); throw e; } finally { updateProgress(null); }
  return {version, app: next, dmg};
}
// 앱이 끝난 뒤 바꾸고 다시 켠다. 못 바꾸면 원래 앱을 다시 켜고 DMG 를 열어 직접 옮기게 한다
const SWAP = 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; old="$(dirname "$2")/old.app"; ' +
  'if mv "$3" "$old"; then if mv "$2" "$3"; then rm -rf "$old"; else mv "$old" "$3"; open "$4"; fi; else open "$4"; fi; open "$3"';
let staged = null, installing = null;
async function installUpdate(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || !newer(version, app.getVersion())) return {ok: false};
  const target = path.resolve(app.getPath('exe'), '../../..');  // …/Epeira.app
  const canSwap = app.isPackaged && target.endsWith('.app') && !/^\/Volumes\/|\/AppTranslocation\//.test(target) && (() => { try { fs.accessSync(path.dirname(target), fs.constants.W_OK); return true; } catch { return false; } })();
  if (!canSwap && !TEST) return {ok: false, manual: true};  // DMG 안에서 켰거나 응용 프로그램 폴더에 쓸 수 없으면 직접 받기
  try { if (!staged || staged.version !== version) staged = await stageUpdate(version); } catch (e) { return {ok: false, manual: true, error: e.message}; }
  const {response} = await dialog.showMessageBox(win, {type: 'info', buttons: ['다시 시작', '나중에'], defaultId: 0, cancelId: 1,
    message: `Epeira ${version} 을(를) 설치할 준비가 됐어요`, detail: '다시 시작하면 새 버전으로 바뀌어요. 탭과 Claude · Codex 대화는 다시 열어요.'});
  if (response !== 0 || !canSwap || !confirmQuit()) return {ok: true, later: true};  // 테스트(개발 앱)는 바꾸지 않는다
  spawn('/bin/sh', ['-c', SWAP, 'sh', String(process.pid), staged.app, target, staged.dmg], {detached: true, stdio: 'ignore'}).unref();
  quitting = true;
  app.quit();
  return {ok: true};
}
ipcMain.handle('update:install', (_, version) => installing || (installing = installUpdate(version).finally(() => { installing = null; })));

// 테마: 시스템 · 라이트 · 다크 (궤도 패널은 밤하늘이라 늘 어둡게)
ipcMain.handle('theme:get', () => conf().theme || 'system');
ipcMain.handle('theme:set', (_, theme) => {
  if (!['system', 'light', 'dark'].includes(theme)) return conf().theme || 'system';
  nativeTheme.themeSource = theme;
  saveConf({theme});
  return theme;
});

// ── 앱이 켜지면 수집기도 바로: 없으면 설치, 앱에 든 것보다 오래됐으면 업데이트, 꺼져 있으면 깨운다 ──
// 사용자가 터미널에 설치 명령을 칠 필요가 없다. 훅 연결(설정 파일 변경)은 여전히 확인 창에서 동의를 받고 한다
const bundledVersion = () => { try { return /^VERSION = '([^']+)'/m.exec(fs.readFileSync(path.join(BUNDLE, 'agent_orbit.py'), 'utf8'))[1]; } catch { return null; } };
const newer = (a, b) => { const x = a.split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

function userPath() {  // Finder 에서 켠 앱은 PATH 가 짧다 → 로그인 셸의 PATH 를 받아 수집기에 넘긴다 (python3 · codex 를 찾게)
  return new Promise(resolve => {
    const sh = process.env.SHELL || os.userInfo().shell || '/bin/zsh';
    execFile(sh, ['-ilc', 'printf "__EPEIRA__%s__EPEIRA__" "$PATH"'], {timeout: 8000}, (err, out) => {
      const m = /__EPEIRA__(.*)__EPEIRA__/.exec(out || '');
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
// 설정의 글꼴 고르기: 이 Mac 에 설치된 글꼴 이름 (macOS 글꼴 관리자에 묻는다, 한 번만)
let fontList = null;
ipcMain.handle('fonts:list', () => fontList || (fontList = new Promise(resolve => {
  if (process.platform !== 'darwin') return resolve([]);
  execFile('osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))'], {timeout: 10000}, (err, out) => {
    try { resolve(JSON.parse(out).filter(f => !f.startsWith('.')).sort((a, b) => a.localeCompare(b))); } catch { fontList = null; resolve([]); }
  });
})));
ipcMain.on('install-devtools', () => { if (process.platform === 'darwin') execFile('xcode-select', ['--install'], () => {}); });

ipcMain.on('open-external', (_, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

// ── 창 · 메뉴 ──
function send(action) { if (win && !win.isDestroyed()) win.webContents.send('menu', action); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{label: app.name, submenu: [
      {role: 'about'}, {type: 'separator'},
      {label: '설정…', accelerator: 'CmdOrCtrl+,', click: () => send('settings')},
      {type: 'separator'}, {role: 'services'}, {type: 'separator'},
      {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'},
    ]}] : []),
    {label: '파일', submenu: [
      {label: '폴더 열기…', accelerator: 'CmdOrCtrl+O', click: () => send('add-project')},
      {type: 'separator'},
      {label: '새 터미널 탭', accelerator: 'CmdOrCtrl+T', click: () => send('new-shell')},
      {label: 'Claude 새 세션', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('new-claude')},
      {label: 'Codex 새 세션', accelerator: 'CmdOrCtrl+Shift+X', click: () => send('new-codex')},
      {type: 'separator'},
      {label: '탭 닫기', accelerator: 'CmdOrCtrl+W', click: () => send('close-tab')},
      ...(isMac ? [] : [{type: 'separator'}, {label: '설정…', accelerator: 'CmdOrCtrl+,', click: () => send('settings')}]),
    ]},
    {label: '편집', submenu: [
      {role: 'undo'}, {role: 'redo'}, {type: 'separator'},
      {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}, {type: 'separator'},
      {label: '찾기…', accelerator: 'CmdOrCtrl+F', click: () => send('find')},
    ]},
    {label: '보기', submenu: [
      {label: '명령 팔레트…', accelerator: 'CmdOrCtrl+P', click: () => send('palette')},
      {label: '단축키 안내', accelerator: 'CmdOrCtrl+/', click: () => send('shortcuts')},
      {type: 'separator'},
      {label: '사이드바', accelerator: 'CmdOrCtrl+B', click: () => send('toggle-side')},
      {label: '궤도 패널', accelerator: 'CmdOrCtrl+J', click: () => send('toggle-orbit')},
      {label: '화면 나누기', submenu: [
        {label: '좌우로 나누기', accelerator: 'CmdOrCtrl+D', click: () => send('split')},
        {label: '위아래로 나누기', accelerator: 'CmdOrCtrl+Shift+D', click: () => send('split-rows')},
        {type: 'separator'},
        {label: '왼쪽 칸', accelerator: 'CmdOrCtrl+Alt+Left', click: () => send('pane-left')},
        {label: '오른쪽 칸', accelerator: 'CmdOrCtrl+Alt+Right', click: () => send('pane-right')},
        {label: '위 칸', accelerator: 'CmdOrCtrl+Alt+Up', click: () => send('pane-up')},
        {label: '아래 칸', accelerator: 'CmdOrCtrl+Alt+Down', click: () => send('pane-down')},
        {type: 'separator'},
        {label: '지금 칸 크게 보기', accelerator: 'CmdOrCtrl+Shift+Enter', click: () => send('pane-zoom')},
        {label: '나누기 모두 풀기', accelerator: 'CmdOrCtrl+Alt+W', click: () => send('unsplit')},
      ]},
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
  // 지난번 창 크기 · 위치 (모니터가 바뀌어 화면 밖이면 기본값)
  const c = conf(), b = c.bounds;
  const onScreen = b && screen.getAllDisplays().some(({workArea: a}) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
  win = new BrowserWindow({
    ...(onScreen ? b : {width: 1480, height: 920}), minWidth: 980, minHeight: 600, title: 'Epeira', show: !TEST,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#f6f6f6',
    // 신호등 버튼(높이 16) 가운데를 상단 바(52px)의 가운데 26px 에 맞춘다 → style.css 의 .side-top 과 짝
    titleBarStyle: 'hiddenInset', trafficLightPosition: {x: 16, y: 18}, icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true, backgroundThrottling: !TEST,
      additionalArguments: [`--agent-orbit-url=${ORBIT}`]},
  });
  if (c.maximized) win.maximize();
  let timer;
  const keep = () => { if (win && !win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) saveConf({bounds: win.getNormalBounds(), maximized: win.isMaximized()}); };
  for (const ev of ['resize', 'move']) win.on(ev, () => { clearTimeout(timer); timer = setTimeout(keep, 400); });
  win.on('close', e => {  // 창을 닫으면 터미널도 끝난다 → 실행 중이면 묻는다 (앱 종료 중이면 이미 물었다)
    keep();
    if (!quitting && !confirmQuit()) return e.preventDefault();
    killAll();
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
    wc.on('will-navigate', (e, url) => { if (!url.startsWith(ORBIT + '/')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });  // 끌어다 놓은 파일(file://)은 열지 않는다
  }
});

app.whenReady().then(() => {
  // 권한: Electron 은 요청하면 다 허락한다 → 앱 화면은 알림 · 클립보드 쓰기만, 궤도 패널(webview)은 아무것도
  const allow = new Set(['notifications', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, done) => done(allow.has(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allow.has(perm));
  const orbit = session.fromPartition('persist:orbit');
  orbit.setPermissionRequestHandler((wc, perm, done) => done(false));
  orbit.setPermissionCheckHandler(() => false);
  nativeTheme.themeSource = conf().theme || 'system';
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(__dirname, 'assets/icon.png'));
  buildMenu();
  createWindow();
  followEvents();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', e => {  // 실행 중인 작업이 있으면 한 번 묻는다
  if (quitting) return;
  if (!confirmQuit()) return e.preventDefault();
  quitting = true;
});
app.on('will-quit', killAll);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
