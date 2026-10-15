'use strict';
/* 앱 화면: 프로젝트 사이드바 · 터미널 탭 · 궤도 패널. 터미널 탭을 바꾸면 궤도의 HUB 도 그 탭의 세션으로 바뀐다 */
const api = window.orbit;
const $ = id => document.getElementById(id);
const ORBIT = api.orbitUrl;  // 로컬 수집기 (기본 http://127.0.0.1:47777)
const INSTALL_CMD = 'curl -fsSL https://agent-orbit-app.vercel.app/install.sh | sh';
const THEME = {
  background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#5cc2ff', cursorAccent: '#0a0a0a', selectionBackground: 'rgba(59,158,255,.32)',
  black: '#1a1a1a', red: '#ff6b81', green: '#34d399', yellow: '#fbbf24', blue: '#3b9eff', magenta: '#a78bfa', cyan: '#22c3ee', white: '#e5e5e5',
  brightBlack: '#6b6b6b', brightRed: '#ff8a9c', brightGreen: '#6ee7b7', brightYellow: '#fcd34d', brightBlue: '#5cc2ff',
  brightMagenta: '#c4b5fd', brightCyan: '#67e8f9', brightWhite: '#ffffff',
};
const LOGO = {claude: 'assets/claude.svg', codex: 'assets/codex.svg'};  // Codex 는 중립 마크 (OpenAI 공식 로고 파일을 받으면 교체)
const kindIcon = kind => h('span', {class: 'k'}, LOGO[kind] ? h('img', {src: LOGO[kind], alt: ''}) : '›');
const fmtK = x => x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'k' : String(Math.round(x || 0));

const S = {projects: [], current: null, tabs: [], active: null, collector: null, usage: null, orbitReady: false};
// tab = {id, dir, name, kind, term, fit, el, exited}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter(x => x != null && x !== false));
  return el;
}
const store = {
  get: k => { try { return localStorage.getItem('app.' + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('app.' + k, v); } catch { /* 없어도 동작엔 지장 없음 */ } },
};
const tilde = p => p.replace(/^\/(Users|home)\/[^/]+/, '~');
const tab = id => S.tabs.find(t => t.id === id);
const project = dir => S.projects.find(p => p.path === dir);

// ── 프로젝트 ──
async function loadProjects() {
  S.projects = await api.projects();
  if (!S.current && S.projects[0]) S.current = S.projects[0].path;
  renderProjects(); renderWelcome();
}

async function addProject() {
  const r = await api.addProject();
  S.projects = r.list;
  if (r.added) selectProject(r.added);
  else renderProjects();
}

async function removeProject(dir) {
  S.projects = await api.removeProject(dir);  // 목록에서만 뺀다 (폴더는 그대로)
  if (S.current === dir) S.current = S.projects[0] ? S.projects[0].path : null;
  renderProjects(); renderWelcome();
}

function selectProject(dir) {
  S.current = dir;
  api.touchProject(dir).then(list => { S.projects = list; renderProjects(); });
  const open = S.tabs.filter(t => t.dir === dir);
  if (open.length) activate(open[open.length - 1].id);
  else openTab(dir, 'shell');
}

function renderProjects() {
  const ul = $('projects');
  if (!S.projects.length) {
    return ul.replaceChildren(h('li', {class: 'side-empty'}, '아직 프로젝트가 없어요.', h('br'),
      h('button', {class: 'link', type: 'button', onclick: addProject}, '+ 폴더 열기')));
  }
  ul.replaceChildren(...S.projects.map(p => {
    const open = S.tabs.filter(t => t.dir === p.path && !t.exited).length;
    return h('li', {class: `proj${p.path === S.current ? ' on' : ''}${p.exists ? '' : ' gone'}`, title: p.path},
      h('button', {class: 'proj-main', type: 'button', onclick: () => p.exists && selectProject(p.path)},
        h('span', {class: 'tile'}, (p.name[0] || '?').toUpperCase()),
        h('span', {class: 'proj-text'}, h('b', {}, p.name), h('small', {}, p.exists ? tilde(p.path) : '폴더를 찾을 수 없어요')),
        open ? h('span', {class: 'count', title: `열린 탭 ${open}개`}, open) : null),
      h('span', {class: 'proj-acts'},
        p.exists ? h('button', {class: 'mini-btn', type: 'button', title: 'Claude 새 세션', onclick: () => openTab(p.path, 'claude')}, 'C') : null,
        p.exists ? h('button', {class: 'mini-btn', type: 'button', title: 'Codex 새 세션', onclick: () => openTab(p.path, 'codex')}, 'X') : null,
        h('button', {class: 'mini-btn', type: 'button', title: '목록에서 빼기 (폴더는 지우지 않아요)', onclick: () => removeProject(p.path)}, '×')));
  }));
}

// ── 터미널 탭 ──
async function openTab(dir, kind = 'shell') {
  dir = dir || S.current;
  if (!dir) return addProject();
  const el = h('div', {class: 'term'});
  $('terms').append(el);
  // 한글: D2Coding 이 있으면 그것, 없으면 macOS 기본 한글 글꼴 — 지정하지 않으면 대체 글꼴 때문에 글자 사이가 벌어진다
  const term = new Terminal({fontFamily: '"SF Mono", Menlo, D2Coding, "Apple SD Gothic Neo", monospace', fontSize: 13, lineHeight: 1.2, cursorBlink: true,
    scrollback: 10000, macOptionIsMeta: true, allowProposedApi: true, theme: THEME});
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((ev, url) => api.openExternal(url)));
  term.open(el);
  fit.fit();
  const id = await api.createTerm({cwd: dir, run: kind === 'shell' ? null : kind, cols: term.cols, rows: term.rows});
  const p = project(dir);
  S.tabs.push({id, dir, name: p ? p.name : dir.split('/').pop(), kind, term, fit, el, exited: false});
  term.onData(d => api.write(id, d));
  term.onResize(({cols, rows}) => api.resize(id, cols, rows));
  S.current = dir;
  activate(id);
}

function activate(id) {
  const t = tab(id);
  if (!t) return;
  S.active = id; S.current = t.dir;
  for (const x of S.tabs) x.el.hidden = x.id !== id;
  requestAnimationFrame(() => { t.fit.fit(); t.term.focus(); });
  renderTabs(); renderProjects(); renderWelcome(); tellOrbit();
}

function closeTab(id = S.active) {
  const t = tab(id);
  if (!t) return;
  api.kill(id);
  t.term.dispose(); t.el.remove();
  const i = S.tabs.indexOf(t);
  S.tabs.splice(i, 1);
  const next = S.tabs[i] || S.tabs[i - 1];
  if (next) return activate(next.id);
  S.active = null;
  renderTabs(); renderProjects(); renderWelcome(); tellOrbit();
}

function cycleTab(step) {
  if (!S.tabs.length) return;
  const i = S.tabs.findIndex(t => t.id === S.active);
  activate(S.tabs[(i + step + S.tabs.length) % S.tabs.length].id);
}

function renderTabs() {
  $('tabs').replaceChildren(...S.tabs.map((t, i) => {
    return h('div', {class: `tab${t.id === S.active ? ' on' : ''}${t.exited ? ' dead' : ''}`, title: t.dir},
      h('button', {class: 'tab-main', type: 'button', role: 'tab', 'aria-selected': String(t.id === S.active), onclick: () => activate(t.id)},
        kindIcon(t.kind), h('span', {}, t.name), i < 9 ? h('kbd', {}, `⌘${i + 1}`) : null),
      h('button', {class: 'tab-x', type: 'button', title: '탭 닫기 (⌘W)', 'aria-label': `${t.name} 탭 닫기`, onclick: () => closeTab(t.id)}, '×'));
  }));
}

function renderWelcome() {
  $('welcome').hidden = S.tabs.length > 0;
  const p = project(S.current);
  const btn = (label, onclick, primary) => h('button', {class: primary ? 'btn primary' : 'btn', type: 'button', onclick}, label);
  $('welcome-acts').replaceChildren(
    btn('폴더 열기', addProject, !p),
    p ? btn(`${p.name} · Claude 새 세션`, () => openTab(p.path, 'claude'), true) : null,
    p ? btn(`Codex 새 세션`, () => openTab(p.path, 'codex')) : null,
    p ? btn('터미널만 열기', () => openTab(p.path, 'shell')) : null);
}

api.onData((id, data) => { const t = tab(id); if (t) t.term.write(data); });
api.onExit(id => {
  const t = tab(id);
  if (!t) return;
  t.exited = true;
  t.term.write('\r\n\x1b[90m[프로세스가 끝났어요 · ⌘W 로 탭을 닫을 수 있어요]\x1b[0m\r\n');
  renderTabs(); renderProjects();
});
new ResizeObserver(() => { const t = tab(S.active); if (t) t.fit.fit(); }).observe($('terms'));

// ── 궤도 패널: 로컬 수집기의 대시보드를 그대로 띄운다 ──
const view = $('orbit-view');
view.addEventListener('dom-ready', () => { S.orbitReady = true; tellOrbit(); });

function tellOrbit() {  // 지금 탭을 대시보드에 알려 HUB 를 그 탭의 세션으로
  if (!S.orbitReady) return;
  view.executeJavaScript(`window.aoFocusTab && window.aoFocusTab(${JSON.stringify(S.active || '')})`).catch(() => {});
}

async function initOrbit() {
  S.collector = await api.collector();
  await loadUsage();
  const off = $('orbit-off');
  if (S.collector.ok) {
    off.hidden = true; view.hidden = false;
    if (view.getAttribute('src') === 'about:blank') view.setAttribute('src', `${ORBIT}/?view=mini&embed=1`);
    return;
  }
  view.hidden = true; off.hidden = false;
  const copyBtn = h('button', {class: 'btn', type: 'button', onclick: async () => { await navigator.clipboard.writeText(INSTALL_CMD); copyBtn.textContent = '복사됨'; }}, '복사');
  off.replaceChildren(...(S.collector.installed
    ? [h('h2', {}, '수집기를 켜지 못했어요'), h('p', {}, '터미널 탭에서 tycho doctor 로 상태를 확인해 보세요.')]
    : [h('h2', {}, '수집기를 먼저 설치하세요'), h('p', {}, '궤도는 이 컴퓨터의 수집기가 모은 기록으로 그려요. 터미널 탭에 붙여넣으세요.'),
      h('div', {class: 'cmd'}, h('code', {}, INSTALL_CMD), copyBtn)]),
    h('button', {class: 'btn primary', type: 'button', onclick: initOrbit}, '다시 확인'));
}

async function loadUsage() {
  S.usage = await api.usage();
  renderStatusbar();
}

function renderStatusbar() {  // 창 맨 아래 한 줄: 연결 · 에이전트별 오늘 사용량 · Codex 한도 · 새로고침
  const u = S.usage, bar = $('statusbar');
  const refresh = h('button', {class: 'sb-btn', type: 'button', title: '새로고침', 'aria-label': '새로고침', onclick: refreshAll});
  refresh.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M13 3.5V7H9.5M12.6 6.6A5 5 0 1 0 13 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (!u || !u.ok) {
    return bar.replaceChildren(h('span', {class: 'sb-item'}, h('i', {class: 'led'}), '수집기가 꺼져 있어요'), h('span', {class: 'grow'}), refresh);
  }
  const agent = key => {
    const a = u.by[key];
    if (!a) return null;
    const state = !a.installed ? '설치 안 됨' : !a.connected ? '연결 안 됨' : key === 'codex' && a.trust && a.trust !== 'trusted' ? '승인 필요' : '연결됨';
    return h('span', {class: a.connected ? 'sb-item' : 'sb-item off',
      title: `${a.name} · ${state}\n오늘 도구 ${a.calls.toLocaleString()}회\n입력 ${fmtK(a.tin)} · 출력 ${fmtK(a.tout)} · 캐시 읽기 ${fmtK(a.tcache)} 토큰`},
      h('img', {src: LOGO[key], alt: ''}), h('b', {}, a.calls.toLocaleString()), h('span', {class: 'sb-dim'}, `${fmtK(a.tin + a.tout)} tok`), a.connected ? null : h('span', {class: 'sb-dim'}, state));
  };
  const L = u.limits, win = w => w && w.used != null ? `${w.window >= 1440 ? '주간' : `${Math.round((w.window || 300) / 60)}시간`} ${Math.round(w.used)}%` : null;
  const lim = L ? [win(L.primary), win(L.secondary)].filter(Boolean).join(' · ') : '';
  const needs = Object.values(u.by).some(a => a.installed && !a.connected);
  bar.replaceChildren(...[
    h('span', {class: 'sb-item'}, h('i', {class: 'led ok'}), 'LIVE'),
    agent('claude'), agent('codex'),
    lim ? h('span', {class: 'sb-item sb-dim', title: 'Codex 요금제 사용 한도 (마지막으로 기록된 값)'}, `Codex 한도 ${lim}`) : null,
    h('span', {class: 'grow'}),
    needs ? h('button', {class: 'link', type: 'button', onclick: () => api.openExternal(ORBIT + '/')}, '에이전트 연결하기 →') : null,
    refresh,
  ].filter(Boolean));
}

async function refreshAll(e) {  // 상태·사용량 다시 읽고 궤도 패널 새로 불러오기
  const btn = e && e.currentTarget;
  if (btn) { btn.classList.add('spin'); setTimeout(() => btn.classList.remove('spin'), 600); }
  await initOrbit();
  if (S.orbitReady && !view.hidden) view.reload();
}

// ── 레이아웃: 패널 너비 · 열고 닫기 ──
const appEl = $('app');
function setOrbitWidth(w) {  // 터미널이 최소 360px 는 남도록, 그 안에서는 마음껏
  const side = appEl.classList.contains('no-side') ? 0 : $('projects').closest('.side').offsetWidth;
  w = Math.max(320, Math.min(window.innerWidth - side - 5 - 360, Math.round(w)));
  appEl.style.setProperty('--orbit-w', w + 'px');
  store.set('orbitW', w);
}
function toggle(cls) {
  appEl.classList.toggle(cls);
  store.set(cls, appEl.classList.contains(cls) ? '1' : '0');
  const t = tab(S.active);
  if (t) requestAnimationFrame(() => t.fit.fit());
}
const resizer = $('resizer');
resizer.addEventListener('pointerdown', e => {  // 포인터 캡처: 창 밖에서 버튼을 놓아도 드래그가 확실히 끝난다
  resizer.setPointerCapture(e.pointerId);
  appEl.classList.add('dragging');
  e.preventDefault();
});
resizer.addEventListener('pointermove', e => { if (resizer.hasPointerCapture(e.pointerId)) setOrbitWidth(window.innerWidth - e.clientX); });
resizer.addEventListener('lostpointercapture', () => {
  appEl.classList.remove('dragging');
  const t = tab(S.active);
  if (t) t.fit.fit();
});
resizer.addEventListener('dblclick', () => setOrbitWidth(440));  // 두 번 누르면 기본 너비
if (store.get('orbitW')) setOrbitWidth(+store.get('orbitW'));
if (store.get('no-orbit') === '1') appEl.classList.add('no-orbit');
if (store.get('no-side') === '1') appEl.classList.add('no-side');

// ── 버튼 · 메뉴 · 단축키 ──
$('add-project').onclick = addProject;
$('new-shell').onclick = () => openTab(S.current, 'shell');
$('new-claude').onclick = () => openTab(S.current, 'claude');
$('new-codex').onclick = () => openTab(S.current, 'codex');
$('toggle-orbit').onclick = () => toggle('no-orbit');
$('orbit-big').onclick = () => api.openExternal(ORBIT + '/');
api.onMenu(action => ({
  'add-project': addProject,
  'new-shell': () => openTab(S.current, 'shell'),
  'new-claude': () => openTab(S.current, 'claude'),
  'new-codex': () => openTab(S.current, 'codex'),
  'close-tab': () => closeTab(),
  'toggle-side': () => toggle('no-side'),
  'toggle-orbit': () => toggle('no-orbit'),
  'next-tab': () => cycleTab(1),
  'prev-tab': () => cycleTab(-1),
}[action] || (() => {}))());
addEventListener('keydown', e => {  // ⌘1–9: 탭 이동
  if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    const t = S.tabs[+e.key - 1];
    if (t) { e.preventDefault(); activate(t.id); }
  }
}, true);

loadProjects();
initOrbit();
setInterval(loadUsage, 15000);  // 상태바 숫자는 15초마다
