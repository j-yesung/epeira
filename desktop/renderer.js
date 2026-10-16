'use strict';
/* 앱 화면: 프로젝트 사이드바 · 터미널 탭 · 궤도 패널 · 설정. 터미널 탭을 바꾸면 궤도의 HUB 도 그 탭의 세션으로 바뀐다 */
const api = window.orbit;
const $ = id => document.getElementById(id);
const ORBIT = api.orbitUrl;  // 로컬 수집기 (기본 http://127.0.0.1:47777)
const DARK = {
  background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#5cc2ff', cursorAccent: '#0a0a0a', selectionBackground: 'rgba(59,158,255,.32)',
  black: '#1a1a1a', red: '#ff6b81', green: '#34d399', yellow: '#fbbf24', blue: '#3b9eff', magenta: '#a78bfa', cyan: '#22c3ee', white: '#e5e5e5',
  brightBlack: '#6b6b6b', brightRed: '#ff8a9c', brightGreen: '#6ee7b7', brightYellow: '#fcd34d', brightBlue: '#5cc2ff',
  brightMagenta: '#c4b5fd', brightCyan: '#67e8f9', brightWhite: '#ffffff',
};
const LIGHT = {  // 흰 바탕: 프로그램이 "흰색"으로 강조한 글자도 보이게 white 계열은 진한 회색
  background: '#fbfbfb', foreground: '#1b1b1b', cursor: '#1c7ed6', cursorAccent: '#fbfbfb', selectionBackground: 'rgba(28,126,214,.22)',
  black: '#1b1b1b', red: '#c92a2a', green: '#2b8a3e', yellow: '#a86b00', blue: '#1c7ed6', magenta: '#7048e8', cyan: '#0c8599', white: '#5c5c5c',
  brightBlack: '#6b6b6b', brightRed: '#e03131', brightGreen: '#37b24d', brightYellow: '#e67700', brightBlue: '#339af0',
  brightMagenta: '#845ef7', brightCyan: '#1098ad', brightWhite: '#2b2b2b',
};
// 테마: 고른 값(시스템 · 라이트 · 다크)을 <html data-theme> 로 직접 건다
// (Electron 의 nativeTheme.themeSource 만으로는 화면의 prefers-color-scheme 이 바뀌지 않는 경우가 있어서)
const dark = matchMedia('(prefers-color-scheme: dark)');
let themePref = 'system';
const isDark = () => themePref === 'dark' || (themePref === 'system' && dark.matches);
const termTheme = () => (isDark() ? DARK : LIGHT);
function applyTheme() {
  document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
  for (const t of S.tabs) t.term.options.theme = termTheme();
}
async function chooseTheme(v) { themePref = await api.setTheme(v); applyTheme(); }
const LOGO = {claude: 'assets/claude.svg', codex: 'assets/codex.svg'};  // Codex 는 OpenAI 로고 (OpenAI 공식 저장소 openai-cookbook 의 logomark, 흑백만 → 라이트 테마에선 검게)
const kindIcon = kind => h('span', {class: 'k'}, LOGO[kind] ? h('img', {src: LOGO[kind], alt: ''}) : '›');
const fmtK = x => x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'k' : String(Math.round(x || 0));
// 터미널 단축키 기호 글꼴(Epeira Keys)을 먼저 불러 둔다 → GPU 렌더러는 글꼴이 준비된 뒤 그려야 그 글꼴을 쓴다
const fontsReady = document.fonts.load('13px "Epeira Keys"', '⌘⌥⇧⏎↑').catch(() => {});

const S = {projects: [], current: null, tabs: [], active: null, last: {}, layout: {}, zoom: {}, sessions: [], names: {}, git: {}, update: null, inbox: [], settingsTab: 'agents',
  collector: null, usage: null, orbitReady: false, restoring: false, renaming: false, pop: null};
// 터미널은 프로젝트마다 따로: 탭 줄엔 지금 프로젝트의 탭만, last 는 프로젝트별로 마지막에 보던 탭
// layout 은 프로젝트별 칸 나누기 트리 → 칸 {tab} 또는 나눔 {dir: 'cols'(좌우) | 'rows'(위아래), ratio, a, b}, zoom 은 한 칸 크게 보기
// tab = {id, dir, base, title, kind, sid, term, fit, search, el, exited, busy, waiting, unread, pendingRun}

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
const inPath = (cwd, dir) => !!cwd && (cwd === dir || cwd.startsWith(dir.endsWith('/') ? dir : dir + '/'));
const projectOf = x => S.projects.find(p => (x.cwd ? inPath(x.cwd, p.path) : x.label === p.name));  // 세션이 어느 프로젝트 것인지 (경로를 모르면 폴더 이름)
const sessionName = x => S.names[x.id] || x.title || x.text || x.label;  // 직접 붙인 이름 > 첫 질문 > 마지막 동작
function shortPath(p) {  // 홈은 ~, 길면 가운데를 줄여 마지막 폴더가 보이게
  const parts = tilde(p).split('/');
  return parts.length > 4 ? `${parts[0]}/…/${parts.slice(-2).join('/')}` : parts.join('/');
}
const ago = ts => { const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60)); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`; };
// 앱 설정 (이 컴퓨터의 이 앱에만): 알림 · 터미널
const PREFS = {notify: true, notifyDone: true, notifyWait: true, sound: true, fontSize: 13, copyOnSelect: false, optionMeta: true, fontTerm: ''};
const prefs = (() => { try { return {...PREFS, ...JSON.parse(store.get('prefs') || '{}')}; } catch { return {...PREFS}; } })();
function setPref(k, v) {
  prefs[k] = v;
  store.set('prefs', JSON.stringify(prefs));
  for (const t of S.tabs) { t.term.options.fontSize = prefs.fontSize; t.term.options.macOptionIsMeta = prefs.optionMeta; }
  if (k === 'fontTerm') return applyTermFont();
  layoutPanes();
}
// 터미널 글꼴: 설정에서 고른 글꼴을 앞에 두고, 그 글꼴에 없는 글자(예: 한글이 없는 영문 글꼴)는 기본 글꼴로
const fontName = f => String(f || '').replace(/["\\;{}<>]/g, '').trim();
const termFont = () => `"Epeira Keys", ${fontName(prefs.fontTerm) ? `"${fontName(prefs.fontTerm)}", ` : ''}"SF Mono", Menlo, D2Coding, "Apple SD Gothic Neo", monospace`;
const loadTermFont = () => (fontName(prefs.fontTerm) ? document.fonts.load(`13px "${fontName(prefs.fontTerm)}"`, '가A').catch(() => {}) : null);  // 글꼴이 준비된 뒤 칸 크기를 잰다
async function applyTermFont() {
  await loadTermFont();
  for (const t of S.tabs) t.term.options.fontFamily = termFont();
  layoutPanes();
}
const projTabs = (dir = S.current) => S.tabs.filter(t => t.dir === dir);
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
}

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
  const open = projTabs(dir), p = project(dir);
  if (open.length && !(await api.confirmRemove(p ? p.name : dir, open.map(t => t.id)))) return;
  for (const t of open) await closeTab(t.id, true);
  S.projects = await api.removeProject(dir);  // 목록에서만 뺀다 (폴더는 그대로)
  if (S.current !== dir) return renderProjects();
  const next = S.projects.find(p => p.exists);
  if (next) return selectProject(next.path);  // 다른 프로젝트의 탭 · 궤도로
  S.current = null; S.active = null;  // 남은 프로젝트가 없으면 궤도도 비운다
  layoutPanes(); renderTabs(); renderProjects(); renderWelcome(); tellOrbit(); saveTabs();
}

// 사이드바 프로젝트 메뉴: ⋯ 버튼 · 우클릭
const projectMenu = p => [
  {icon: 'shell', label: '새 터미널', disabled: !p.exists, run: () => openTab(p.path, 'shell')},
  {icon: 'claude', label: 'Claude 새 세션', disabled: !p.exists, run: () => openTab(p.path, 'claude')},
  {icon: 'codex', label: 'Codex 새 세션', disabled: !p.exists, run: () => openTab(p.path, 'codex')},
  {sep: true},
  {label: 'Finder 에서 보기', disabled: !p.exists, run: () => api.revealProject(p.path)},
  {label: '경로 복사', run: () => navigator.clipboard.writeText(p.path).then(() => toast('경로를 복사했어요'), () => {})},
  {sep: true},
  {label: '목록에서 빼기', sub: '폴더는 지우지 않아요', run: () => removeProject(p.path)},
];
const at = e => ({getBoundingClientRect: () => ({left: e.clientX, top: e.clientY, bottom: e.clientY})});  // 우클릭한 자리에 메뉴

function selectProject(dir) {  // 그 프로젝트의 터미널로 (없으면 시작 화면 → 터미널을 멋대로 열지 않는다)
  S.current = dir;
  api.touchProject(dir).then(list => { S.projects = list; renderProjects(); });
  const open = projTabs(dir), t = tab(S.last[dir]) || open[open.length - 1];
  if (t) return activate(t.id);
  S.active = null;
  layoutPanes();
  if (!$('find').hidden) closeFind();
  renderTabs(); renderProjects(); renderWelcome(); tellOrbit(); saveTabs();
}

function renderProjects() {
  const ul = $('projects');
  if (!S.projects.length) {
    const icon = h('span', {class: 'drop-icon'});
    icon.innerHTML = ICON.folder;
    return ul.replaceChildren(h('li', {class: 'side-empty'}, h('div', {class: 'drop-hint'}, icon,
      h('b', {}, '프로젝트 폴더를 여기에 끌어다 놓으세요'), h('small', {}, '또는 위의 + 버튼 · ⌘O'))));
  }
  ul.replaceChildren(...S.projects.map(p => {
    const tabs = projTabs(p.path), open = tabs.filter(t => !t.exited).length;
    // 다른 프로젝트에서 일어난 일도 보이게: 승인 대기 > 새 응답 > 일하는 중
    const state = tabs.some(t => t.waiting) ? 'wait' : tabs.some(t => t.unread) ? 'new' : tabs.some(t => t.busy) ? 'busy' : '';
    const g = S.git[p.path], sub = !p.exists ? '폴더를 찾을 수 없어요' : g ? `⎇ ${g.branch}${g.changes ? ` · 변경 ${g.changes}` : ''}` : shortPath(p.path);
    return h('li', {class: `proj${p.path === S.current ? ' on' : ''}${p.exists ? '' : ' gone'}`, title: p.path, oncontextmenu: e => { e.preventDefault(); showMenu(at(e), projectMenu(p)); }},
      h('button', {class: 'proj-main', type: 'button', onclick: () => p.exists && selectProject(p.path)},
        h('span', {class: 'tile'}, (p.name[0] || '?').toUpperCase()),
        h('span', {class: 'proj-text'}, h('b', {}, p.name), h('small', {}, sub)),
        state ? h('i', {class: `st ${state}`, title: STATE[state], 'aria-label': STATE[state]}) : null,
        open ? h('span', {class: 'count', title: `열린 터미널 ${open}개`}, open) : null),
      h('button', {class: 'proj-more', type: 'button', title: '프로젝트 메뉴 (우클릭해도 돼요)', 'aria-label': `${p.name} 메뉴`, 'aria-haspopup': 'menu', onclick: e => showMenu(e.currentTarget, projectMenu(p))}, '⋯'),
      p.path === S.current && p.exists ? projectDetail(p) : null);
  }));
}

function projectDetail(p) {  // 지금 프로젝트 아래: 오늘 쓴 토큰 + 지난 세션 (누르면 이어서 열기)
  const today = (S.usage && S.usage.today) || [], byId = new Map(today.map(x => [x.id, x]));
  let tok = 0;
  for (const x of today) { const root = x.parent ? byId.get(x.parent) || x : x; if (projectOf(root) === p) tok += x.tok; }
  const list = S.sessions.filter(x => projectOf(x) === p).slice(0, 6);
  return h('div', {class: 'proj-detail'},
    h('p', {class: 'proj-usage', title: '입력 + 출력 토큰 (서브에이전트 포함)'}, tok ? `오늘 ${fmtK(tok)} tok` : '오늘은 아직 사용 기록이 없어요'),
    list.length ? h('ul', {class: 'sess-list', 'aria-label': '지난 세션'}, ...list.map(x => {
      const open = S.tabs.find(t => t.sid === x.id);
      return h('li', {}, h('button', {class: 'sess', type: 'button', title: open ? '열려 있는 탭으로 가기' : '이 대화를 새 탭에서 이어서 열기', onclick: () => openSession(x)},
        kindIcon(x.agent), h('span', {class: 'sess-name', title: sessionName(x)}, sessionName(x)), open ? h('i', {class: 'st new', title: '탭에 열려 있어요'}) : null, h('small', {}, ago(x.last))));
    })) : null);
}

// ── 터미널 탭 ──
// 다시 켰을 때 이어 열 명령: 세션 id 를 알면 그 대화로 (모르면 셸만 → 엉뚱한 대화를 잇지 않게)
function resumeCmd(kind, sid) {
  if (!sid || !/^[\w-]+$/.test(sid)) return null;
  if (kind === 'claude') return `claude --resume ${sid}`;
  const uuid = kind === 'codex' && /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(sid);  // Codex 로그 이름 끝의 세션 id
  return uuid ? `codex resume ${uuid[0]}` : null;
}

async function openTab(dir, kind = 'shell', opts = {}) {
  dir = dir || S.current;
  if (!dir) return addProject();
  if (!['shell', 'claude', 'codex'].includes(kind)) kind = 'shell';  // 셸에 그대로 입력되는 값이라 정해진 것만
  await fontsReady;
  await loadTermFont();
  // 다시 켤 때는 대화를 바로 열지 않고 그 탭을 처음 볼 때 이어서 연다 (한꺼번에 여러 개를 띄우지 않게)
  const pendingRun = opts.resume ? resumeCmd(kind, opts.sid) : null, run = kind === 'shell' || opts.resume ? null : kind;
  if (opts.resume && !pendingRun) kind = 'shell';
  const el = h('div', {class: 'term'});
  $('terms').append(el);
  // 글꼴: 설정에서 고른 것 → SF Mono · Menlo → 한글은 D2Coding 이 있으면 그것, 없으면 macOS 기본 한글 글꼴
  const term = new Terminal({fontFamily: termFont(), fontSize: prefs.fontSize, lineHeight: 1.2, cursorBlink: true,
    scrollback: 10000, macOptionIsMeta: prefs.optionMeta, allowProposedApi: true, theme: termTheme()});
  const fit = new FitAddon.FitAddon(), search = new SearchAddon.SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon.WebLinksAddon((ev, url) => api.openExternal(url)));
  term.loadAddon(new Unicode11Addon.Unicode11Addon());
  term.unicode.activeVersion = '11';  // 이모지 · 기호 칸 폭을 요즘 터미널 프로그램과 맞춘다
  term.open(el);
  try {  // GPU 로 그린다 (Claude Code 처럼 화면을 자주 다시 그려도 가볍게). 안 되면 기본 렌더러
    const gl = new WebglAddon.WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    term.loadAddon(gl);
  } catch { /* WebGL 을 못 쓰는 환경 */ }
  fit.fit();
  const id = await api.createTerm({cwd: dir, run, cols: term.cols, rows: term.rows});
  const p = project(dir);
  const t = {id, dir, base: p ? p.name : dir.split('/').pop(), title: opts.title || null, kind, sid: opts.sid || null,
    term, fit, search, el, exited: false, busy: false, waiting: false, unread: false, pendingRun};
  S.tabs.push(t);
  if (pendingRun) term.write('\x1b[90m↻ 이 탭을 열면 이전 대화를 이어서 열어요\x1b[0m\r\n');
  // 나눈 화면에서 칸 위에 보이는 이름표 (어떤 탭인지 · 닫기)
  t.hd = h('div', {class: 'pane-hd'}, kindIcon(kind), h('span', {class: 'pane-name'}),
    h('button', {class: 'pane-x', type: 'button', title: '칸 닫기 (⌘W)', 'aria-label': '칸 닫기', onclick: e => { e.stopPropagation(); closeTab(id); }}, '×'));
  el.prepend(t.hd);
  term.onSelectionChange(() => { if (prefs.copyOnSelect && term.hasSelection()) navigator.clipboard.writeText(term.getSelection()).catch(() => {}); });
  el.addEventListener('mousedown', () => { if (S.active !== id) activate(id); });  // 나눈 화면: 누른 쪽이 지금 탭
  term.onData(d => api.write(id, d));
  term.attachCustomKeyEventHandler(e => {  // ⌘⌫: 지금 줄 지우기 (macOS 터미널처럼 Ctrl+U)
    if (e.type === 'keydown' && e.metaKey && e.key === 'Backspace') { api.write(id, '\x15'); return false; }
    return true;
  });
  term.onResize(({cols, rows}) => api.resize(id, cols, rows));
  el.addEventListener('contextmenu', e => { e.preventDefault(); api.termMenu(term.getSelection()); });
  search.onDidChangeResults(r => { if (S.active === id && !$('find').hidden) $('find-n').textContent = r.resultCount ? `${r.resultIndex + 1}/${r.resultCount}` : '없음'; });
  S.current = dir;
  if (!opts.quiet) activate(id);
  saveTabs();
  return t;
}

function activate(id) {
  const t = tab(id);
  if (!t) return;
  const root = S.layout[t.dir];
  if (root && !hasLeaf(root, id)) {  // 칸에 없는 탭을 고르면 지금 칸에 그 탭을 보여 준다
    S.layout[t.dir] = replaceLeaf(root, hasLeaf(root, S.active) ? S.active : firstLeaf(root), {tab: id});
  }
  S.active = id; S.current = t.dir; S.last[t.dir] = id; t.unread = false;
  layoutPanes();
  requestAnimationFrame(() => t.term.focus());
  if (!$('find').hidden) { for (const x of S.tabs) x.search.clearDecorations(); find(1); }
  renderTabs(); renderProjects(); renderWelcome(); tellOrbit(); updateBadge(); saveTabs();
}

async function closeTab(id = S.active, asked = false) {
  const t = tab(id);
  if (!t || (!asked && !(await api.confirmClose(id)))) return;  // claude · codex 등이 돌고 있으면 먼저 묻는다
  api.kill(id);
  t.term.dispose(); t.el.remove();
  // 터미널을 닫으면 그 세션도 끝난다 → 궤도에서 뺀다 (같은 세션을 연 다른 탭이 있으면 그대로)
  if (t.sid && S.orbitReady && !S.tabs.some(x => x !== t && x.sid === t.sid)) view.executeJavaScript(`window.aoForget && aoForget(${JSON.stringify(t.sid)})`).catch(() => {});
  const list = projTabs(t.dir), i = list.indexOf(t);
  S.tabs.splice(S.tabs.indexOf(t), 1);
  if (S.last[t.dir] === id) delete S.last[t.dir];
  let next = list[i + 1] || list[i - 1];  // 같은 프로젝트의 옆 탭으로
  const root = S.layout[t.dir];
  if (root && hasLeaf(root, id)) {  // 칸을 닫으면 옆 칸이 자리를 채운다
    let sibling = null;
    const rest = removeLeaf(root, id, s => { sibling = s; });
    S.layout[t.dir] = rest && !rest.tab ? rest : null;
    if (sibling) next = tab(firstLeaf(sibling)) || next;
  }
  saveTabs(); updateBadge();
  if (S.active !== id) return layoutPanes(), renderTabs(), renderProjects();
  if (next) return activate(next.id);
  S.active = null;
  renderTabs(); renderProjects(); renderWelcome(); tellOrbit();
}

function cycleTab(step) {  // 지금 프로젝트 안에서만
  const list = projTabs();
  if (!list.length) return;
  const i = list.findIndex(t => t.id === S.active);
  activate(list[(i + step + list.length) % list.length].id);
}

const KIND_NAME = {claude: 'Claude', codex: 'Codex', shell: '터미널'};
function tabLabel(t) {  // 세션 이름(궤도 HUB 와 같음) · 직접 붙인 이름, 아니면 종류 (같은 종류가 여럿이면 2, 3 …)
  if (t.sid && S.names[t.sid]) return S.names[t.sid];
  if (t.title) return t.title;
  const i = projTabs(t.dir).filter(x => x.kind === t.kind).indexOf(t);
  return i > 0 ? `${KIND_NAME[t.kind]} ${i + 1}` : KIND_NAME[t.kind];
}

const STATE = {wait: '입력 · 승인을 기다려요', busy: '일하는 중', new: '새 응답이 있어요'};
function renderTabs() {
  if (S.renaming) return;  // 이름을 바꾸는 중엔 다시 그리지 않는다 (입력칸이 사라지지 않게)
  // 탭은 container-type 이라 내용 너비가 0 으로 계산돼 탭 줄이 최소 폭(96px)으로 쪼그라든다 → 탭당 200px(+간격)를 미리 잡아 두고 좁으면 줄어들게
  const list = projTabs();
  $('tabs').style.flexBasis = `${list.length * 204}px`;
  $('tabs').replaceChildren(...list.map((t, i) => {
    const label = tabLabel(t), state = t.waiting ? 'wait' : t.busy ? 'busy' : t.unread ? 'new' : '';
    // 이미 보고 있는 탭을 누르면 다시 그리지 않는다 → 다시 그리면 두 번 누르기(이름 바꾸기)가 새 요소에 떨어져 안 먹는다
    const main = h('button', {class: 'tab-main', type: 'button', role: 'tab', 'aria-selected': String(t.id === S.active),
      onclick: () => (S.active === t.id ? t.term.focus() : activate(t.id)), ondblclick: () => renameTab(t, main)},
      kindIcon(t.kind), h('span', {}, label), state ? h('i', {class: `st ${state}`, title: STATE[state], 'aria-label': STATE[state]}) : null, i < 9 ? h('kbd', {}, `⌘${i + 1}`) : null);
    const pane = t.id !== S.active && !t.el.hidden;  // 나눈 화면의 다른 칸에 보이는 탭
    const div = h('div', {class: `tab${t.id === S.active ? ' on' : ''}${pane ? ' pane' : ''}${t.exited ? ' dead' : ''}`, title: `${t.dir}\n두 번 눌러 이름 바꾸기 · 끌어서 순서 바꾸기`, draggable: 'true',
      ondragstart: e => { e.dataTransfer.setData('text/epeira-tab', t.id); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: e => { if (e.dataTransfer.types.includes('text/epeira-tab')) { e.preventDefault(); div.classList.add('drop'); } },
      ondragleave: () => div.classList.remove('drop'),
      ondrop: e => { e.preventDefault(); div.classList.remove('drop'); moveTab(e.dataTransfer.getData('text/epeira-tab'), t.id); }}, main,
      h('button', {class: 'tab-x', type: 'button', title: '탭 닫기 (⌘W)', 'aria-label': `${label} 탭 닫기`, onclick: () => closeTab(t.id)}, '×'));
    return div;
  }));
  for (const t of S.tabs) t.hd.querySelector('.pane-name').textContent = tabLabel(t);
  requestAnimationFrame(() => {  // 탭이 넘치면 목록 버튼, 지금 탭은 보이게
    const el = $('tabs');
    $('tab-more').hidden = el.scrollWidth <= el.clientWidth + 1;
    const on = el.querySelector('.tab.on');
    if (on) on.scrollIntoView({block: 'nearest', inline: 'nearest'});
  });
}

function moveTab(id, beforeId) {  // 끌어 놓은 자리로 (같은 프로젝트 안에서)
  const t = tab(id), b = tab(beforeId);
  if (!t || !b || t === b || t.dir !== b.dir) return;
  S.tabs.splice(S.tabs.indexOf(t), 1);
  S.tabs.splice(S.tabs.indexOf(b), 0, t);
  renderTabs(); saveTabs();
}
const swapLeaves = (n, a, b) => (n.tab ? (n.tab === a ? {tab: b} : n.tab === b ? {tab: a} : n) : {...n, a: swapLeaves(n.a, a, b), b: swapLeaves(n.b, a, b)});
function dropTabOnPane(id, x, y) {  // 탭을 칸에 끌어 놓기: 그 칸에 보여 준다 (이미 다른 칸에 있으면 자리를 바꾼다)
  const t = tab(id), root = S.layout[S.current];
  if (!t || t.dir !== S.current) return;
  const target = projTabs().find(o => { if (o.el.hidden) return false; const r = o.el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
  if (root && target && target.id !== id) S.layout[S.current] = hasLeaf(root, id) ? swapLeaves(root, id, target.id) : replaceLeaf(root, target.id, {tab: id});
  activate(id);
}

function renameTab(t, main) {  // 탭을 두 번 누르면 이름 바꾸기 (비우면 원래 이름)
  const input = h('input', {class: 'tab-rename', value: tabLabel(t), maxlength: '40', 'aria-label': '탭 이름', spellcheck: 'false'});
  let done = false;
  const finish = async save => {
    if (done) return;
    done = true; S.renaming = false;
    const name = input.value.trim();
    if (save && t.sid) {  // 세션이 있는 탭: 수집기에 저장 → 궤도 HUB 이름도 같이 바뀐다 (못 하면 이 탭에만)
      const r = await api.post('/api/rename', {id: t.sid, name});
      if (r && r.ok) { if (r.name) S.names[t.sid] = r.name; else delete S.names[t.sid]; t.title = null; } else t.title = name || null;
      saveTabs();
    } else if (save) { t.title = name || null; saveTabs(); }
    renderTabs(); renderProjects();
    t.term.focus();
  };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
  S.renaming = true;
  main.replaceWith(input);
  input.focus(); input.select();
}

function renderWelcome() {
  $('welcome').hidden = projTabs().length > 0;
  const p = project(S.current);
  const btn = (label, onclick, primary) => h('button', {class: primary ? 'btn primary' : 'btn', type: 'button', onclick}, label);
  $('welcome-acts').replaceChildren(...[
    btn('폴더 열기', addProject, !p),
    p ? btn(`${p.name} · Claude 새 세션`, () => openTab(p.path, 'claude'), true) : null,
    p ? btn(`Codex 새 세션`, () => openTab(p.path, 'codex')) : null,
    p ? btn('터미널만 열기', () => openTab(p.path, 'shell')) : null,
  ].filter(Boolean));
}

api.onData((id, data) => { const t = tab(id); if (t) t.term.write(data); });
api.onExit(id => {
  const t = tab(id);
  if (!t) return;
  t.exited = true; t.busy = t.waiting = false;
  t.term.write('\r\n\x1b[90m[프로세스가 끝났어요 · ⌘W 로 탭을 닫을 수 있어요]\x1b[0m\r\n');
  renderTabs(); renderProjects(); updateBadge(); saveTabs();
});
new ResizeObserver(() => fitVisible()).observe($('terms'));

// ── 화면 나누기 (iTerm2 처럼): ⌘D 지금 칸을 좌우로 · ⌘⇧D 위아래로, 계속 나눠 n×n 까지 (프로젝트당 9칸) ──
const MAX_PANES = 9, MIN_W = 320, MIN_H = 150;  // 칸이 너무 작으면 Claude Code 화면이 깨진다
const leaves = n => (!n ? [] : n.tab ? [n.tab] : [...leaves(n.a), ...leaves(n.b)]);
const hasLeaf = (n, id) => leaves(n).includes(id);
const firstLeaf = n => leaves(n)[0];
const replaceLeaf = (n, id, to) => (n.tab ? (n.tab === id ? to : n) : {...n, a: replaceLeaf(n.a, id, to), b: replaceLeaf(n.b, id, to)});
function removeLeaf(n, id, onSibling) {  // 그 칸을 빼고 남은 트리 (옆 칸을 알려 준다)
  if (n.tab) return n.tab === id ? null : n;
  if (n.a.tab === id) { onSibling(n.b); return n.b; }
  if (n.b.tab === id) { onSibling(n.a); return n.a; }
  return {...n, a: removeLeaf(n.a, id, onSibling), b: removeLeaf(n.b, id, onSibling)};
}
const weight = (n, d) => (n.tab ? 1 : n.dir === d ? weight(n.a, d) + weight(n.b, d) : 1);
function equalize(n) {  // 같은 방향으로 늘어선 칸들을 같은 크기로
  if (!n || n.tab) return;
  n.ratio = weight(n.a, n.dir) / (weight(n.a, n.dir) + weight(n.b, n.dir));
  equalize(n.a); equalize(n.b);
}

function layoutPanes() {  // 지금 프로젝트의 칸 배치대로 터미널을 놓는다 (% 위치) + 경계선
  const terms = $('terms'), root = S.layout[S.current], zoomed = root && S.zoom[S.current];
  terms.querySelectorAll('.divider').forEach(d => d.remove());
  const shown = new Map(), full = {x: 0, y: 0, w: 100, h: 100};
  const place = (n, r) => {
    if (n.tab) return shown.set(n.tab, r);
    const cols = n.dir === 'cols', cut = cols ? r.w * n.ratio : r.h * n.ratio;
    place(n.a, cols ? {...r, w: cut} : {...r, h: cut});
    place(n.b, cols ? {...r, x: r.x + cut, w: r.w - cut} : {...r, y: r.y + cut, h: r.h - cut});
    terms.append(divider(n, r, cols ? r.x + cut : r.y + cut));
  };
  if (root && !zoomed) place(root, full); else if (S.active) shown.set(S.active, full);
  for (const t of S.tabs) {
    const r = shown.get(t.id);
    t.el.hidden = !r;
    t.el.classList.toggle('focus', !!r && shown.size > 1 && t.id === S.active);
    t.el.classList.toggle('paned', !!r && shown.size > 1);
    if (r) t.hd.querySelector('.pane-name').textContent = tabLabel(t);
    if (!r) continue;
    Object.assign(t.el.style, {left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`});
    if (t.pendingRun) { api.write(t.id, t.pendingRun + '\r'); t.pendingRun = null; }  // 다시 켠 뒤 처음 보일 때 대화를 이어 연다
  }
  terms.classList.toggle('zoomed', !!zoomed);
  requestAnimationFrame(fitVisible);
}
function divider(n, r, at) {  // 칸 경계선: 끌어서 크기 조절, 두 번 누르면 모두 같은 크기로
  const cols = n.dir === 'cols', el = h('div', {class: `divider ${n.dir}`, role: 'separator', 'aria-orientation': cols ? 'vertical' : 'horizontal',
    style: cols ? `left:${at}%;top:${r.y}%;height:${r.h}%` : `top:${at}%;left:${r.x}%;width:${r.w}%`});
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.classList.add('active'); e.preventDefault(); });
  el.addEventListener('pointermove', e => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const box = $('terms').getBoundingClientRect(), size = cols ? box.width * r.w / 100 : box.height * r.h / 100;
    const pos = cols ? (e.clientX - box.left) / box.width * 100 : (e.clientY - box.top) / box.height * 100;
    const min = (cols ? 160 : 90) / size;  // 한쪽이 너무 작아지지 않게
    n.ratio = Math.max(min, Math.min(1 - min, (pos - (cols ? r.x : r.y)) / (cols ? r.w : r.h)));
    layoutPanes();
  });
  el.addEventListener('lostpointercapture', () => { el.classList.remove('active'); saveTabs(); });
  el.addEventListener('dblclick', () => { equalize(S.layout[S.current]); layoutPanes(); saveTabs(); });
  return el;
}
function fitVisible() { for (const x of S.tabs) if (!x.el.hidden) x.fit.fit(); }

async function splitPane(dir) {  // 지금 칸을 나누고 새 칸에 같은 프로젝트의 새 터미널
  const p = S.current, t = tab(S.active);
  if (!p || !t) return;
  const root = S.layout[p] || {tab: t.id};
  if (S.zoom[p]) { S.zoom[p] = false; layoutPanes(); }
  if (leaves(root).length >= MAX_PANES) return toast(`한 프로젝트에 ${MAX_PANES}칸까지 나눌 수 있어요`);
  const r = (S.layout[p] ? t.el : $('terms')).getBoundingClientRect();
  if (dir === 'cols' ? r.width / 2 < MIN_W : r.height / 2 < MIN_H) return toast('나눌 공간이 부족해요 → 사이드바(⌘B)나 궤도 패널(⌘J)을 접으면 더 나눌 수 있어요');
  const nt = await openTab(p, 'shell', {quiet: true});
  S.layout[p] = replaceLeaf(root, t.id, {dir, ratio: .5, a: {tab: t.id}, b: {tab: nt.id}});
  activate(nt.id);
}
function moveFocus(way) {  // ⌘⌥ + 방향키: 그 방향의 가장 가까운 칸으로
  const cur = tab(S.active);
  if (!cur) return;
  const c = cur.el.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
  let best = null, bd = Infinity;
  for (const t of projTabs()) {
    if (t === cur || t.el.hidden) continue;
    const r = t.el.getBoundingClientRect();
    const ok = {left: r.right <= c.left + 2, right: r.left >= c.right - 2, up: r.bottom <= c.top + 2, down: r.top >= c.bottom - 2}[way];
    const d = Math.abs(r.left + r.width / 2 - cx) + Math.abs(r.top + r.height / 2 - cy);
    if (ok && d < bd) { bd = d; best = t; }
  }
  if (best) activate(best.id);
}
function toggleZoom() {  // ⌘⇧↩: 지금 칸만 크게, 다시 누르면 원래대로
  if (!S.layout[S.current]) return;
  S.zoom[S.current] = !S.zoom[S.current];
  layoutPanes(); renderTabs();
}
function unsplit() {  // ⌘⌥W: 나누기 모두 풀기 (터미널은 탭으로 남는다)
  if (!S.layout[S.current]) return;
  delete S.layout[S.current]; delete S.zoom[S.current];
  layoutPanes(); renderTabs(); saveTabs();
}
dark.addEventListener('change', applyTheme);
applyTheme();
api.getTheme().then(t => { themePref = t; applyTheme(); });

// ── 탭 저장 · 복원: 다시 켜면 탭과 Claude · Codex 대화를 이어서 연다 ──
function saveTabs() {
  if (S.restoring) return;
  const live = S.tabs.filter(t => !t.exited), index = new Map(live.map((t, i) => [t.id, i]));
  const list = live.map(t => ({dir: t.dir, kind: t.kind, title: t.title, sid: t.sid, last: S.last[t.dir] === t.id}));
  const ser = n => (n.tab ? (index.has(n.tab) ? {t: index.get(n.tab)} : null) : {dir: n.dir, ratio: n.ratio, a: ser(n.a), b: ser(n.b)});  // 탭 id 대신 순번으로
  const layouts = Object.fromEntries(Object.entries(S.layout).filter(([, n]) => n).map(([d, n]) => [d, ser(n)]));
  store.set('tabs', JSON.stringify({current: S.current, list, layouts}));
}
async function restoreTabs() {
  let saved = null;
  try { saved = JSON.parse(store.get('tabs') || 'null'); } catch { /* 깨진 값이면 새로 시작 */ }
  if (!saved || !Array.isArray(saved.list) || !saved.list.length) return false;
  S.restoring = true;
  const ids = [];
  for (const s of saved.list) {
    const p = project(s.dir);
    if (!p || !p.exists) { ids.push(null); continue; }
    const t = await openTab(s.dir, s.kind, {sid: s.sid, title: s.title, resume: true, quiet: true});
    ids.push(t.id);
    if (s.last) S.last[s.dir] = t.id;
  }
  const de = n => {  // 순번 → 탭 id (없어진 탭의 칸은 빼고 옆 칸이 채운다)
    if (!n) return null;
    if ('t' in n) return ids[n.t] ? {tab: ids[n.t]} : null;
    const a = de(n.a), b = de(n.b);
    return a && b ? {dir: n.dir, ratio: n.ratio, a, b} : a || b;
  };
  for (const [d, n] of Object.entries(saved.layouts || {})) { const l = de(n); if (l && !l.tab) S.layout[d] = l; }
  S.restoring = false;
  if (project(saved.current)) selectProject(saved.current);
  else if (S.tabs.length) activate(S.tabs[S.tabs.length - 1].id);
  saveTabs();
  return S.tabs.length > 0;
}

// ── 지난 세션 · 다른 터미널에서 하던 세션을 탭으로 이어 열기 ──
async function openSession(x) {
  const open = S.tabs.find(t => t.sid === x.id);
  if (open) return activate(open.id);
  let p = projectOf(x);
  if (!p && x.cwd) { const r = await api.addProjectPath(x.cwd); S.projects = r.list; p = project(r.added); }  // 목록에 없는 폴더면 프로젝트로 추가
  if (!p) return toast('이 세션의 폴더를 찾지 못했어요');
  if (!resumeCmd(x.agent, x.id)) return toast('이 세션은 이어서 열 수 없어요');
  const go = () => openTab(p.path, x.agent, {sid: x.id, resume: true});
  if (Date.now() / 1000 - (x.last || 0) > 120) return go();
  // 방금까지 움직이던 세션: 다른 터미널에서 아직 실행 중일 수 있다 → 같은 대화를 두 곳에서 열지 않게 확인
  showSheet('세션 이어 열기', [h('p', {}, '이 세션은 방금까지 다른 곳에서 움직였어요. 다른 터미널에서 아직 실행 중이면 같은 대화를 두 곳에서 열게 되니, 그쪽을 먼저 종료하는 게 안전해요.')],
    [h('button', {class: 'btn', type: 'button', onclick: closeModal}, '취소'), h('button', {class: 'btn primary', type: 'button', onclick: () => { closeModal(); go(); }}, '그래도 열기')]);
}
async function loadSessions() {  // 최근 7일 세션 (사이드바 지난 세션)
  const r = await api.get(`/api/summary?since=${Math.floor(Date.now() / 1000 - 7 * 86400)}`);
  S.sessions = r && r.sessions ? r.sessions.filter(x => !x.parent).sort((a, b) => b.last - a.last) : [];
  renderProjects();
}
async function loadGit() {
  S.git = await api.gitInfo(S.projects.filter(p => p.exists).map(p => p.path)) || {};
  renderProjects();
}

// ── 탭 상태 · 알림: 일하는 중 · 입력 · 승인 대기 · 안 본 응답 (수집기 이벤트로) ──
function linkTab(tabId, sid) {
  const t = tab(tabId);
  if (t && sid && t.sid !== sid) { t.sid = sid; saveTabs(); }
}
const seen = t => document.hasFocus() && S.active === t.id;
function alertTab(t, msg, detail, type) {  // type: done(응답 끝) · wait(승인 · 입력 대기) → 설정에서 끌 수 있다
  if (seen(t)) return;
  const title = `${t.base} · ${tabLabel(t)}`, body = detail ? `${msg} → ${detail}` : msg;
  S.inbox.unshift({at: Date.now(), tab: t.id, title, body, read: false});
  S.inbox.length = Math.min(S.inbox.length, 30);
  renderStatusbar();
  if (!prefs.notify || !prefs[type === 'wait' ? 'notifyWait' : 'notifyDone']) return;
  api.notify({title, body, tab: t.id, silent: !prefs.sound});
}
function updateBadge() { api.badge(S.tabs.filter(t => t.waiting || t.unread).length); }
api.onEvent(e => {
  if (e.kind === 'tab') return linkTab(e.tab, e.id);
  if (e.kind === 'name') {  // 궤도 HUB 에서 이름을 바꾸면 탭 이름도
    if (e.name) S.names[e.id] = e.name; else delete S.names[e.id];
    for (const x of S.tabs) if (x.sid === e.id) x.title = null;
    return renderTabs(), renderProjects();
  }
  const sid = e.parent || e.id, t = sid && S.tabs.find(x => x.sid === sid);
  if (!t || e.kind === 'stat' || e.kind === 'hello') return;
  if (e.replay) {  // 앱을 켜기 전부터 돌던 도구
    if (e.kind === 'start') { t.busy = true; renderTabs(); }
    return;
  }
  if (e.kind === 'notify') {
    if (!t.busy) return;  // 응답을 마친 뒤의 "입력 기다림" 알림은 이미 알렸다
    t.waiting = true;
    alertTab(t, STATE.wait, e.text, 'wait');
  } else if (e.kind === 'done') {
    if (e.parent) return;  // 서브에이전트가 끝난 건 대화가 끝난 게 아니다
    t.busy = t.waiting = false;
    if (!seen(t)) { t.unread = true; alertTab(t, '응답을 마쳤어요', null, 'done'); }
  } else if (e.kind === 'error' && e.text === 'interrupted') {
    t.busy = t.waiting = false;
  } else {
    t.busy = true; t.waiting = false;
  }
  renderTabs(); renderProjects(); updateBadge();
});
api.onActivateTab(id => { if (tab(id)) activate(id); });
addEventListener('focus', () => { tellActive(); const t = tab(S.active); if (t && t.unread) { t.unread = false; renderTabs(); updateBadge(); } });

// ── 터미널 찾기 (⌘F) ──
const FIND = {decorations: {matchBackground: '#1e4f80', activeMatchBackground: '#3b9eff', matchOverviewRuler: '#3b9eff', activeMatchColorOverviewRuler: '#5cc2ff'}};
function openFind() {
  if (!tab(S.active)) return;
  $('find').hidden = false;
  $('find-q').focus(); $('find-q').select();
  if ($('find-q').value) find(1);
}
function closeFind() {
  $('find').hidden = true; $('find-n').textContent = '';
  for (const t of S.tabs) t.search.clearDecorations();
  const t = tab(S.active);
  if (t) t.term.focus();
}
function find(dir, incremental) {
  const t = tab(S.active), q = $('find-q').value;
  if (!t) return;
  if (!q) { t.search.clearDecorations(); $('find-n').textContent = ''; return; }
  t.search[dir < 0 ? 'findPrevious' : 'findNext'](q, {...FIND, incremental});
}
$('find-q').addEventListener('input', () => find(1, true));
$('find-q').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); find(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') closeFind();
});
$('find-next').onclick = () => find(1);
$('find-prev').onclick = () => find(-1);
$('find-close').onclick = closeFind;

// 터미널 우클릭 메뉴의 동작 (복사는 메뉴가 바로 처리)
api.onTermAction((action, text) => {
  const t = tab(S.active);
  if (!t) return;
  if (action === 'paste' && text) t.term.paste(text);  // 붙여넣기 모드를 지켜 여러 줄도 한 번에
  else if (action === 'selectAll') t.term.selectAll();
  else if (action === 'clear') t.term.clear();
  else if (action === 'find') return openFind();
  t.term.focus();
});

// ── 끌어다 놓기: 폴더 → 사이드바(프로젝트 추가), 파일 → 터미널(경로 입력) ──
const dropped = e => [...(e.dataTransfer.files || [])].map(f => api.pathForFile(f)).filter(Boolean);
const shq = p => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);  // 셸에 그대로 넣어도 안전하게
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => e.preventDefault());
const sideEl = document.querySelector('.side');
sideEl.addEventListener('dragover', e => { e.preventDefault(); sideEl.classList.add('drop'); });
sideEl.addEventListener('dragleave', e => { if (!sideEl.contains(e.relatedTarget)) sideEl.classList.remove('drop'); });
sideEl.addEventListener('drop', async e => {
  e.preventDefault(); sideEl.classList.remove('drop');
  let added = null;
  for (const p of dropped(e)) { const r = await api.addProjectPath(p); S.projects = r.list; added = r.added || added; }
  renderProjects();
  if (added) selectProject(added);
  else toast('폴더를 끌어다 놓으면 프로젝트로 추가돼요');
});
$('terms').addEventListener('drop', e => {
  e.preventDefault();
  const dragged = e.dataTransfer.getData('text/epeira-tab');
  if (dragged) return dropTabOnPane(dragged, e.clientX, e.clientY);
  const t = tab(S.active), paths = dropped(e);
  if (t && paths.length) { t.term.paste(paths.map(shq).join(' ') + ' '); t.term.focus(); }
});

// ── 궤도 패널: 로컬 수집기의 대시보드를 그대로 띄운다 ──
const view = $('orbit-view');
const tellActive = () => S.orbitReady && view.executeJavaScript(`window.aoSetActive && aoSetActive(${document.hasFocus()})`).catch(() => {});
view.addEventListener('dom-ready', () => { S.orbitReady = true; tellOrbit(); tellActive(); });
addEventListener('blur', () => setTimeout(tellActive, 50));  // 앱이 뒤로 가면 궤도 애니메이션을 초당 8번으로 (배터리)
view.addEventListener('console-message', async e => {  // 궤도 패널의 "탭으로 열기 · 이 탭으로 가기" (대시보드가 콘솔로 알려 준다)
  const m = /^epeira:(open|focus) (\{.*\})$/.exec(e.message || '');
  if (!m) return;
  let x;
  try { x = JSON.parse(m[2]); } catch { return; }
  if (typeof x.id !== 'string') return;
  const open = S.tabs.find(t => t.sid === x.id);
  if (open) return activate(open.id);
  if (m[1] !== 'open') return;
  // 궤도 패널이 보낸 폴더 · 종류는 믿지 않는다: 수집기 기록에 있는 세션만, 값도 수집기 것으로
  if (!S.sessions.some(s => s.id === x.id)) await loadSessions();
  const known = S.sessions.find(s => s.id === x.id);
  if (known) openSession(known); else toast('이 세션을 기록에서 찾지 못했어요');
});

function tellOrbit() {  // 지금 프로젝트 · 탭을 대시보드에 알린다: 프로젝트마다 독립된 궤도, HUB 는 그 탭의 세션
  const p = project(S.current), name = p ? p.name : '';
  if (!S.orbitReady) return;
  const args = [name, S.active || '', p ? p.path : ''].map(x => JSON.stringify(x)).join(', ');  // 예전 수집기(aoFocusTab 만 있음)도 그대로 동작
  view.executeJavaScript(`window.aoFocusProject ? aoFocusProject(${args}) : window.aoFocusTab && aoFocusTab(${JSON.stringify(S.active || '')})`).catch(() => {});
}

// 앱이 수집기를 알아서 설치 · 업데이트 · 실행한다. 안 되면 사용자에게 명령을 시키지 않고 스스로 계속 다시 시도
let orbitRetry = null, orbitFails = 0;
const orbitWait = () => $('orbit-off').replaceChildren(h('div', {class: 'spinner', role: 'status', 'aria-label': '수집기를 준비하고 있어요'}));
async function initOrbit() {
  clearTimeout(orbitRetry);
  const off = $('orbit-off');
  if (view.hidden) { off.hidden = false; orbitWait(); }
  S.collector = await api.collector();
  await loadUsage();
  if (S.collector.ok) {
    orbitFails = 0;
    off.hidden = true; view.hidden = false;
    if (view.getAttribute('src') === 'about:blank') view.setAttribute('src', `${ORBIT}/?view=mini&embed=1`);
    else if (S.collector.updated) view.reload();  // 수집기가 새 버전으로 바뀌었으면 궤도 화면도 새로
    onboard();
    return;
  }
  orbitFails++;
  view.hidden = true; off.hidden = false;
  if (S.collector.needPython) {  // 사람이 해야 하는 단 하나: Apple 개발자 도구 설치 (설치가 끝나면 알아서 이어감)
    off.replaceChildren(h('h2', {}, 'Python 이 필요해요'), h('p', {}, 'macOS 개발자 도구를 설치하면 함께 설치돼요. 설치가 끝나면 자동으로 이어서 연결해요.'),
      h('button', {class: 'btn primary', type: 'button', onclick: () => api.installDevTools()}, '개발자 도구 설치'));
    orbitRetry = setTimeout(initOrbit, 10000);
    return;
  }
  if (orbitFails < 3) { orbitWait(); orbitRetry = setTimeout(initOrbit, 4000); return; }  // 업데이트 · 재시작 중일 수 있다 → 조용히 다시
  off.replaceChildren(h('h2', {}, '수집기에 연결하지 못했어요'), h('p', {}, '자동으로 계속 다시 시도하고 있어요. 지금 바로 해 보려면 아래 버튼을 누르세요.'),
    h('button', {class: 'btn primary', type: 'button', onclick: () => { orbitFails = 0; initOrbit(); }}, '다시 시도'));
  orbitRetry = setTimeout(initOrbit, 15000);
}

function onboard() {  // 처음 한 번: 연결 안 된 에이전트가 있으면 설정 창으로 안내
  if (store.get('onboarded')) return;
  store.set('onboarded', '1');
  const u = S.usage;
  if (u && u.ok && Object.values(u.by).some(a => a.installed && !a.connected)) {
    openSettings('에이전트를 연결하면 Claude Code · Codex 가 하는 일이 궤도에 나타나요. 연결할 때 바뀌는 설정 파일을 먼저 보여 드려요.');
  }
}

let ticks = 0;
async function loadUsage(refresh) {
  S.usage = await api.usage(refresh);
  if (S.usage && S.usage.tabs) for (const [tid, sid] of Object.entries(S.usage.tabs)) linkTab(tid, sid);
  if (S.usage && S.usage.names) S.names = S.usage.names;
  renderStatusbar(); renderTabs();
  loadGit();
  if (refresh || ticks++ % 4 === 0) loadSessions();  // 지난 세션은 1분마다 (7일치를 읽으니 덜 자주)
}

// 사용 한도: 초기화 시각이 지났으면 이미 초기화된 것으로 본다 (마지막 기록이 그 전 값이라서)
function limitWindows(L) {
  return L ? [L.primary, L.secondary].filter(w => w && w.used != null).map(w => {
    const weekly = (w.window || 300) >= 1440, reset = w.resets && w.resets * 1000 < Date.now();
    return {name: weekly ? '주간' : `${Math.round((w.window || 300) / 60)}시간`, short: weekly ? '주' : `${Math.round((w.window || 300) / 60)}h`,
      used: reset ? 0 : Math.round(w.used), resets: reset ? null : w.resets};
  }) : [];
}
const span = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}일 ${Math.floor(m % 1440 / 60)}시간` : m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
const level = p => p >= 95 ? 'err' : p >= 80 ? 'warn' : '';
function limitNote(key, L) {  // 한도를 못 보여줄 때 이유
  if (key === 'codex') return '아직 기록된 사용 한도가 없어요 · Codex 를 한 번 사용하면 나타나요';
  if (!S.usage.claudeLimits) return '설정(⌘,)에서 "Claude 사용 한도 보기"를 켜면 5시간 · 주간 한도가 보여요';
  const e = L && L.error;
  return e === 'no-login' || e === 'expired' ? 'Claude Code 로그인 정보를 읽지 못했어요 · Claude Code 를 한 번 실행하면 다시 가져와요'
    : e ? '사용 한도를 불러오지 못했어요 · 잠시 후 다시 시도해요' : '사용 한도를 불러오는 중이에요';
}

function popContent(key) {  // 상태바 항목에 마우스를 올리면 뜨는 상세: 연결 · 한도(막대 · 초기화) · 오늘 사용량
  const u = S.usage, a = u && u.by[key];
  if (!a) return null;
  const L = (u.limits || {})[key], wins = limitWindows(L);
  const state = !a.installed ? '설치 안 됨' : !a.connected ? '연결 안 됨' : key === 'codex' && a.trust && a.trust !== 'trusted' ? '승인 필요' : '연결됨';
  return [
    h('h4', {}, h('img', {src: LOGO[key], alt: ''}), a.name, L && L.plan ? h('span', {class: 'plan'}, L.plan.toUpperCase()) : null, h('span', {class: 'grow'}), h('small', {}, state)),
    ...(wins.length ? wins.flatMap(w => [
      h('div', {class: 'lim'}, h('span', {}, w.name), h('span', {class: 'bar'}, h('i', {class: level(w.used), style: `width:${w.used}%`})), h('b', {class: level(w.used)}, `${w.used}%`)),
      h('p', {class: 'reset'}, w.resets ? `${span(w.resets * 1000 - Date.now())} 후 초기화 · ${new Date(w.resets * 1000).toLocaleString('ko-KR', {month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false})}` : '초기화됨 · 다음 사용 때 새로 기록돼요'),
    ]) : [h('p', {class: 'note'}, limitNote(key, L))]),
    h('p', {class: 'meta'}, `오늘 도구 ${a.calls.toLocaleString()}회`, h('br'), `입력 ${fmtK(a.tin)} · 출력 ${fmtK(a.tout)} · 캐시 읽기 ${fmtK(a.tcache)}`),
    L && L.at ? h('p', {class: 'meta dim'}, `한도는 ${span(Date.now() - L.at * 1000)} 전 기록 기준`) : null,
  ];
}
function showPop(item, key) {
  const pop = $('sb-pop'), kids = popContent(key);
  if (!kids) return;
  pop.replaceChildren(...kids.filter(Boolean));
  pop.hidden = false; S.pop = {item, key};
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, item.getBoundingClientRect().left - 8)) + 'px';
}
function hidePop() { $('sb-pop').hidden = true; S.pop = null; }

const ICON = {
  folder: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M13 3.5V7H9.5M12.6 6.6A5 5 0 1 0 13 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bell: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4.5 11.5V7.5a3.5 3.5 0 0 1 7 0v4l1 1H3.5zM6.8 14h2.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};
// 놓친 알림: 보고 있지 않을 때 생긴 응답 끝 · 승인 대기를 모아 둔다 (macOS 알림을 꺼도)
function inboxBtn() {
  const unread = S.inbox.filter(x => !x.read).length;
  const b = iconBtn('bell', unread ? `놓친 알림 ${unread}개` : '알림 기록', () => {
    S.inbox.forEach(x => { x.read = true; });
    showMenu(b, S.inbox.length ? [...S.inbox.map(x => ({label: x.title, sub: `${x.body} · ${ago(x.at / 1000)}`, run: () => { if (tab(x.tab)) activate(x.tab); }})),
      {sep: true}, {label: '모두 지우기', run: () => { S.inbox = []; renderStatusbar(); }}] : [{label: '아직 알림이 없어요', disabled: true}], true);
    renderStatusbar();
  });
  if (unread) b.append(h('i', {class: 'sb-count'}, unread));
  return b;
}
function iconBtn(icon, label, onclick) { const b = h('button', {class: 'sb-btn', type: 'button', title: label, 'aria-label': label, onclick}); b.innerHTML = ICON[icon]; return b; }

function renderStatusbar() {  // 창 맨 아래 한 줄: 연결 · 에이전트별 오늘 사용량과 한도 요약 · 새로고침 · 설정
  const u = S.usage, bar = $('statusbar');
  const refresh = iconBtn('refresh', '새로고침', refreshAll), gear = iconBtn('gear', '설정 (⌘,)', () => openSettings());
  if (!u || !u.ok) {
    return bar.replaceChildren(h('span', {class: 'sb-item'}, h('i', {class: 'led'}), '수집기가 꺼져 있어요'), refresh, h('span', {class: 'grow'}), inboxBtn(), gear);
  }
  const agent = key => {
    const a = u.by[key];
    if (!a) return null;
    const wins = limitWindows((u.limits || {})[key]);
    const item = h('span', {class: a.connected ? 'sb-item hover' : 'sb-item hover off', tabindex: '0', onmouseenter: () => showPop(item, key), onmouseleave: hidePop, onfocus: () => showPop(item, key), onblur: hidePop},
      h('img', {src: LOGO[key], alt: a.connected ? a.name : `${a.name} (연결 안 됨)`}), h('span', {class: 'sb-dim'}, '도구'), h('b', {}, a.calls.toLocaleString()), h('span', {class: 'sb-dim'}, `· ${fmtK(a.tin + a.tout)} tok`),
      wins.length ? h('span', {class: 'sb-lim'}, ...wins.map((w, i) => h('span', {class: level(w.used)}, `${i ? ' · ' : ''}${w.short} ${w.used}%`))) : null);
    return item;
  };
  const needs = Object.values(u.by).some(a => a.installed && !a.connected);
  bar.replaceChildren(...[
    h('span', {class: 'sb-item'}, h('i', {class: 'led ok'}), 'LIVE'),
    agent('claude'), agent('codex'), refresh,
    h('span', {class: 'grow'}),
    S.update ? (S.updating ? updateBar() : h('button', {class: 'link', type: 'button', onclick: installUpdate}, `새 버전 ${S.update.version} →`)) : null,
    needs ? h('button', {class: 'link', type: 'button', onclick: () => openSettings('', 'agents')}, '에이전트 연결하기 →') : null,
    inboxBtn(), gear,
  ].filter(Boolean));
  if (S.pop) { const k = S.pop.key, el = [...bar.querySelectorAll('.sb-item.hover')].find(x => x.matches(':hover')); if (el) showPop(el, k); else hidePop(); }  // 15초마다 다시 그려도 열린 상세는 유지
}

function updateBar() {  // 업데이트 진행 막대: 받기는 퍼센트, 서명 확인 · 앱 꺼내기는 움직이는 막대
  const p = S.updateProgress || {stage: 'download', f: 0}, down = p.stage === 'download';
  return h('span', {class: 'upd', role: 'status'}, h('progress', down ? {max: 1, value: p.f} : {max: 1}),
    h('span', {}, down ? `${Math.round(p.f * 100)}%` : '확인 중…'));
}
api.onUpdateProgress((stage, f) => {
  S.updateProgress = stage ? {stage, f} : null;
  for (const el of document.querySelectorAll('.upd')) el.replaceWith(updateBar());
});

async function installUpdate() {  // 새 버전: 받아서 우리 서명을 확인하고 다시 시작 (못 하면 내려받기 페이지)
  if (S.updating) return;
  const redraw = () => { renderStatusbar(); if (!modal.hidden && modal.querySelector('.set')) openSettings(); };  // 설정이 열려 있으면 그 줄도
  S.updating = true; redraw();
  toast(`Epeira ${S.update.version} 을(를) 받고 있어요…`);
  const r = await api.installUpdate(S.update.version).catch(e => ({manual: true, error: e.message}));
  S.updating = false; S.updateProgress = null; redraw();
  if (r.manual) { toast(r.error ? `${r.error} → 내려받기 페이지를 열어요` : '내려받기 페이지를 열어요'); api.openExternal(S.update.url); }
}

async function refreshAll(e) {  // 상태·사용량 다시 읽고 궤도 패널 새로 불러오기
  const btn = e && e.currentTarget;
  if (btn) { btn.classList.add('spin'); setTimeout(() => btn.classList.remove('spin'), 600); }
  await initOrbit();
  await loadUsage(true);  // 사용 한도도 다시 조회 (수집기가 1분에 한 번까지만)
  if (S.orbitReady && !view.hidden) view.reload();
}

// ── 설정 창: 에이전트 연결 · 해제 · 승인(바뀌는 내용을 먼저 보여 주고 동의받음), 사용 한도 · 자동 실행 · 테마 ──
const modal = $('modal');
let modalClose = null;
function showSheet(title, body, actions, onClose, wide) {
  modalClose = onClose || closeModal;
  modal.hidden = false;
  modal.replaceChildren(h('div', {class: wide ? 'sheet wide' : 'sheet'},
    h('div', {class: 'sheet-hd'}, h('h2', {id: 'modal-title'}, title), h('button', {class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: () => modalClose()}, '×')),
    h('div', {class: 'sheet-body'}, ...body.filter(Boolean)),
    actions ? h('div', {class: 'sheet-acts'}, ...actions) : null));
}
function closeModal() {
  modal.hidden = true; modal.replaceChildren(); modalClose = null;
  const t = tab(S.active);
  if (t) t.term.focus();
}
modal.addEventListener('mousedown', e => { if (e.target === modal && modalClose) modalClose(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden && modalClose) { e.preventDefault(); modalClose(); } }, true);

const AGENT_ACTIONS = {
  connect: {title: n => `${n} 연결`, ok: '연결', intro: n => `아래 파일에 Epeira 훅이 추가돼요. ${n}가 도구를 실행하거나 승인 · 입력을 기다릴 때 이 컴퓨터의 수집기로만 신호를 보내요.`},
  disconnect: {title: n => `${n} 연결 해제`, ok: '연결 해제', intro: () => '추가했던 Epeira 훅을 제거해요. 연결한 뒤 설정이 바뀌지 않았다면 연결 전 파일 그대로 되돌려요.'},
  trust: {title: () => 'Codex 훅 승인', ok: '승인', intro: () => 'Codex 는 새 훅을 승인해야 실행해요. 아래 명령을 승인합니다 → Codex 의 /hooks 화면에서 승인하는 것과 같아요.'},
};
async function confirmAgent(key, action, name) {
  showSheet(AGENT_ACTIONS[action].title(name), [h('div', {class: 'spinner'})], null, () => openSettings());
  const p = await api.get(`/api/preview?agent=${key}&action=${action}`);
  if (!p || p.error) { toast((p && p.error) || '수집기에 연결할 수 없어요'); return openSettings(); }
  const diff = p.diff && h('pre', {class: 'diff'}, ...p.diff.split('\n').map(l => h('span', {class: /^\+(?!\+\+)/.test(l) ? 'add' : /^-(?!--)/.test(l) ? 'del' : null}, l + '\n')));
  const ok = h('button', {class: action === 'disconnect' ? 'btn danger' : 'btn primary', type: 'button', onclick: async () => {
    ok.disabled = true;
    const r = await api.post(`/api/${action}`, {agent: key});
    toast((r && r.message) || '완료');
    await loadUsage();
    openSettings();
  }}, AGENT_ACTIONS[action].ok);
  showSheet(AGENT_ACTIONS[action].title(name), [
    h('p', {}, AGENT_ACTIONS[action].intro(name)),
    diff || (action !== 'trust' ? h('p', {}, '설정 파일은 바뀌지 않아요.') : null),
    p.trust ? h('p', {}, action === 'connect' ? 'Codex 승인도 함께 처리해요. 승인할 명령:' : '승인할 명령:') : null,
    p.trust ? h('pre', {class: 'codebox'}, p.command) : null,
  ], [h('button', {class: 'btn', type: 'button', onclick: () => openSettings()}, '취소'), ok], () => openSettings());
}

function agentRow(key, a) {
  const untrusted = key === 'codex' && a.connected && a.trust && a.trust !== 'trusted';
  const state = !a.installed ? ['설치 안 됨', ''] : a.connected ? (untrusted ? ['승인 필요', 'warn'] : ['연결됨', 'ok']) : a.legacy ? ['업데이트 필요', 'warn'] : ['연결 안 됨', ''];
  const btn = (label, action, primary) => h('button', {class: primary ? 'btn small primary' : action === 'disconnect' ? 'btn small' : 'btn small', type: 'button', onclick: () => confirmAgent(key, action, a.name)}, label);
  const desc = !a.installed ? `${a.name}를 설치하면 연결할 수 있어요`
    : a.notify === false ? '알림을 켜면 권한 승인 · 입력을 기다릴 때 알려 드려요'
    : a.connected ? '도구 실행이 궤도에 실시간으로 나타나요' : '';
  return h('div', {class: 'row'}, h('img', {src: LOGO[key], alt: ''}),
    h('span', {class: 'grow'}, h('b', {}, a.name), desc ? h('small', {}, desc) : null),
    h('span', {class: `chip ${state[1]}`}, state[0]),
    ...(!a.installed ? [] : a.connected
      ? [untrusted ? btn('승인', 'trust', true) : null, a.notify === false ? btn('알림 켜기', 'connect', true) : null, btn('해제', 'disconnect')]
      : [btn(a.legacy ? '다시 연결' : '연결', 'connect', true)]));
}

function toggleRow(label, desc, on, flip) {
  const sw = h('button', {class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: async () => {
    sw.disabled = true;
    const r = await flip(!on);
    if (r && r.message && r.ok === false) toast(r.message);
    openSettings();
  }}, h('i'));
  return h('div', {class: 'row'}, h('span', {class: 'grow'}, h('b', {}, label), desc ? h('small', {}, desc) : null), sw);
}

const SETTINGS = [['agents', '에이전트'], ['alerts', '알림'], ['terminal', '터미널'], ['look', '화면'], ['help', '문제 해결']];
async function openSettings(intro, section) {  // 왼쪽 목차 + 오른쪽 내용 (긴 목록을 스크롤하지 않게)
  section = S.settingsTab = section || S.settingsTab || 'agents';
  if (modal.hidden || !modal.querySelector('.set')) showSheet('설정', [h('div', {class: 'spinner'})], null, null, true);
  const [st, theme] = await Promise.all([api.get('/api/status'), api.getTheme()]);
  if (modal.hidden) return;
  if (!st) return showSheet('설정', [h('p', {}, '수집기에 연결할 수 없어요. 상태바의 새로고침을 눌러 보세요.')]);
  const seg = h('span', {class: 'seg', role: 'group', 'aria-label': '테마'}, ...[['system', '시스템'], ['light', '라이트'], ['dark', '다크']].map(([v, label]) =>
    h('button', {type: 'button', 'aria-pressed': String(theme === v), onclick: async () => { await chooseTheme(v); openSettings(intro); }}, label)));
  const todo = {agents: Object.values(st.agents || {}).some(a => a.installed && (!a.connected || a.notify === false)), help: !!S.update};  // 할 일이 있는 목차엔 점
  const nav = h('nav', {class: 'set-nav', 'aria-label': '설정 목차'}, ...SETTINGS.map(([k, label]) =>
    h('button', {type: 'button', 'aria-current': k === section ? 'page' : null, onclick: () => openSettings(intro, k)}, label, todo[k] ? h('i', {class: 'st new'}) : null)));
  const page = {agents: [
    intro ? h('p', {class: 'intro'}, intro) : null,
    h('h3', {}, '에이전트'),
    ...Object.entries(st.agents || {}).map(([key, a]) => agentRow(key, a)),
    h('h3', {}, '수집기'),
    st.claudeLimits != null ? toggleRow('Claude 사용 한도 보기', 'Claude Code 로그인 정보로 5시간 · 주간 한도를 5분마다 가져와요 (비용 없음)', st.claudeLimits,
      async v => { const r = await api.post('/api/settings', {claudeLimits: v}); await loadUsage(); return r; }) : null,
    st.autostart != null ? toggleRow('로그인할 때 수집기 실행', '꺼도 Epeira 앱을 켜면 수집기가 함께 켜져요', st.autostart, v => api.post('/api/autostart', {enabled: v})) : null,
  ], alerts: [
    h('h3', {}, '알림'),
    prefRow('알림 받기', 'Epeira 를 보고 있지 않을 때 macOS 알림과 Dock 배지로 알려요', 'notify'),
    prefs.notify ? prefRow('응답을 마쳤을 때', '', 'notifyDone') : null,
    prefs.notify ? prefRow('승인 · 입력을 기다릴 때', 'Claude Code 는 알림 켜기가 필요해요 (Codex 는 아직 이 신호를 보내지 않아요)', 'notifyWait') : null,
    prefs.notify ? prefRow('소리', '', 'sound') : null,
    h('p', {class: 'set-note'}, '알림을 꺼도 놓친 알림은 상태바의 종 아이콘에 모여요.'),
  ], terminal: [
    h('h3', {}, '터미널'),
    h('div', {class: 'row'}, h('span', {class: 'grow'}, h('b', {}, '글자 크기')),
      h('span', {class: 'seg'}, h('button', {type: 'button', 'aria-label': '작게', onclick: () => { setPref('fontSize', Math.max(10, prefs.fontSize - 1)); openSettings(intro); }}, '−'),
        h('button', {type: 'button', 'aria-pressed': 'true', disabled: true}, `${prefs.fontSize}px`),
        h('button', {type: 'button', 'aria-label': '크게', onclick: () => { setPref('fontSize', Math.min(22, prefs.fontSize + 1)); openSettings(intro); }}, '+'))),
    fontRow('글꼴', '이 Mac 에 설치된 글꼴에서 골라요. 한글이 없는 글꼴이면 한글은 기본 글꼴로 보여요', 'fontTerm', '기본 (SF Mono)'),
    prefRow('선택하면 바로 복사', '터미널에서 글자를 드래그해 고르면 클립보드로', 'copyOnSelect'),
    prefRow('Option 키를 Meta 로', '켜면 Option+←/→ 로 단어 이동 (끄면 Option 으로 특수 문자 입력)', 'optionMeta'),
  ], look: [
    h('h3', {}, '화면'),
    h('div', {class: 'row'}, h('span', {class: 'grow'}, h('b', {}, '테마'), h('small', {}, '궤도 패널은 늘 어두운 밤하늘로 보여요')), seg),
    h('div', {class: 'row'}, h('span', {class: 'grow'}, h('b', {}, '단축키 안내'), h('small', {}, '⌘/ 로도 열 수 있어요')), h('button', {class: 'btn small', type: 'button', onclick: openShortcuts}, '보기')),
  ], help: [
    h('h3', {}, '문제 해결'),
    h('div', {class: 'row'}, h('span', {class: 'grow'}, h('b', {}, `Epeira v${S.appVersion || ''}`),
      h('small', {}, S.update ? `새 버전 ${S.update.version} 이 있어요 → 받아서 확인한 뒤 다시 시작하면 바뀌어요` : '6시간마다 새 버전을 확인해요')),
      S.update ? (S.updating ? updateBar() : h('button', {class: 'btn small primary', type: 'button', onclick: installUpdate}, '업데이트'))
        : h('button', {class: 'btn small', type: 'button', onclick: async e => {
          e.currentTarget.disabled = true;
          const u = await checkUpdate(true).catch(() => ({failed: true}));
          toast(u && u.failed ? '확인하지 못했어요 → 인터넷 연결을 확인해 주세요' : u ? `새 버전 ${u.version} 이 있어요` : '최신 버전이에요');
          openSettings(intro);
        }}, '업데이트 확인')),
    h('div', {class: 'row'}, h('span', {class: 'grow'}, h('b', {}, `수집기 v${st.version} · 127.0.0.1:${st.port}`), h('small', {}, '정상으로 연결돼 있어요')),
      h('button', {class: 'btn small', type: 'button', onclick: async e => { e.currentTarget.disabled = true; const out = await api.doctor(); await navigator.clipboard.writeText(out).catch(() => {}); toast('진단 정보를 복사했어요 → 문의할 때 붙여넣어 주세요'); openSettings(intro); }}, '진단 정보 복사'),
      h('button', {class: 'btn small', type: 'button', onclick: async e => { e.currentTarget.disabled = true; toast('수집기를 다시 설치하고 있어요…'); const r = await api.reinstall(); toast(r.ok ? '다시 설치했어요' : `다시 설치하지 못했어요 ${r.log || ''}`.trim()); refreshAll(); }}, '다시 설치')),
    h('button', {class: 'link', type: 'button', onclick: () => api.openExternal(ORBIT + '/')}, '대시보드 크게 보기 →'),
  ]}[section];
  showSheet('설정', [h('div', {class: 'set'}, nav, h('div', {class: 'set-body'}, ...page.filter(Boolean)))], null, null, true);
  function fontRow(label, desc, key, def) {  // 이 Mac 에 설치된 글꼴에서 고르기 (터미널 글꼴)
    const sel = h('select', {class: 'font-select', 'aria-label': label, onchange: e => setPref(key, e.target.value)}, h('option', {value: ''}, def));
    api.fonts().then(list => {
      for (const f of new Set([...list, ...(prefs[key] ? [prefs[key]] : [])])) sel.append(h('option', {value: f}, f));
      sel.value = prefs[key] || '';
    });
    return h('div', {class: 'row'}, h('span', {class: 'grow'}, h('b', {}, label), h('small', {}, desc)), sel);
  }
  function prefRow(label, desc, key) { return toggleRow(label, desc, prefs[key], v => { setPref(key, v); }); }
}

// ── 단축키 안내 (⌘/) ──
const KEYS = [
  ['프로젝트 · 탭', [['⌘O', '폴더 열기'], ['⌘T', '새 터미널'], ['⇧⌘C', 'Claude 새 세션'], ['⇧⌘X', 'Codex 새 세션'], ['⌘W', '탭 · 칸 닫기'], ['⌘1 – 9', '탭 이동'], ['⌃⇥  ⌃⇧⇥', '다음 · 이전 탭'], ['두 번 누르기', '탭 이름 바꾸기'], ['끌기', '탭 순서 바꾸기 · 칸에 놓기']]],
  ['화면 나누기', [['⌘D', '지금 칸을 좌우로'], ['⇧⌘D', '지금 칸을 위아래로'], ['⌥⌘ + 방향키', '칸 이동'], ['⇧⌘↩', '지금 칸 크게 보기'], ['⌥⌘W', '나누기 모두 풀기'], ['경계선 두 번 누르기', '칸 크기 같게']]],
  ['찾기 · 보기', [['⌘P', '명령 팔레트 (프로젝트 · 탭 · 지난 세션 · 기록)'], ['⌘F', '터미널에서 찾기'], ['⌘⌫', '터미널에서 지금 줄 지우기'], ['⌘B', '사이드바'], ['⌘J', '궤도 패널'], ['⌘,', '설정'], ['⌘/', '단축키 안내']]],
];
function openShortcuts() {
  showSheet('단축키', KEYS.flatMap(([g, rows]) => [h('h3', {}, g), h('div', {class: 'keys-grid'}, ...rows.flatMap(([k, d]) => [h('kbd', {}, k), h('span', {}, d)]))]));
}

// ── 명령 팔레트 (⌘P): 명령 · 프로젝트 · 탭 · 지난 세션 · 기록 검색 ──
function paletteItems() {
  const cmd = (label, hint, run) => ({group: '명령', label, hint, run});
  return [
    cmd('새 터미널', '⌘T', () => openTab(S.current, 'shell')), cmd('Claude 새 세션', '⇧⌘C', () => openTab(S.current, 'claude')),
    cmd('Codex 새 세션', '⇧⌘X', () => openTab(S.current, 'codex')), cmd('지금 칸을 좌우로 나누기', '⌘D', () => splitPane('cols')),
    cmd('지금 칸을 위아래로 나누기', '⇧⌘D', () => splitPane('rows')), cmd('나누기 모두 풀기', '⌥⌘W', unsplit),
    cmd('터미널에서 찾기', '⌘F', openFind), cmd('사이드바 보이기 · 숨기기', '⌘B', () => toggle('no-side')),
    cmd('궤도 패널 보이기 · 숨기기', '⌘J', () => toggle('no-orbit')), cmd('폴더 열기', '⌘O', addProject),
    cmd('설정', '⌘,', () => openSettings()), cmd('단축키 안내', '⌘/', openShortcuts),
    cmd('다크 테마', '', () => chooseTheme('dark')), cmd('라이트 테마', '', () => chooseTheme('light')), cmd('시스템 테마 따르기', '', () => chooseTheme('system')),
    ...S.projects.filter(p => p.exists).map(p => ({group: '프로젝트', label: p.name, sub: shortPath(p.path), run: () => selectProject(p.path)})),
    ...S.tabs.map(t => ({group: '탭', icon: t.kind, label: tabLabel(t), sub: t.base, run: () => activate(t.id)})),
    ...S.sessions.slice(0, 40).map(x => ({group: '지난 세션', icon: x.agent, label: sessionName(x), sub: `${(projectOf(x) || {}).name || x.label} · ${ago(x.last)}`, run: () => openSession(x)})),
  ];
}
function openPalette() {
  const input = h('input', {class: 'pal-q', type: 'text', placeholder: '명령 · 프로젝트 · 탭 · 지난 세션 · 기록 찾기', 'aria-label': '명령 팔레트', spellcheck: 'false', autocomplete: 'off'});
  const list = h('ul', {class: 'pal-list', role: 'listbox'});
  let items = [], sel = 0, found = [], timer = 0, seq = 0;
  const choose = i => { const it = items[i]; if (!it) return; closeModal(); it.run(); };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    items = [...paletteItems().filter(it => !q || `${it.label} ${it.sub || ''} ${it.group}`.toLowerCase().includes(q)).slice(0, 40), ...found];
    sel = Math.max(0, Math.min(sel, items.length - 1));
    list.replaceChildren(...(items.length ? items.map((it, i) => h('li', {role: 'option', 'aria-selected': String(i === sel), class: i === sel ? 'on' : null,
      onmousedown: e => { e.preventDefault(); choose(i); }, onmousemove: () => { if (sel !== i) { sel = i; render(); } }},
      it.icon ? kindIcon(it.icon) : h('span', {class: 'k'}, '›'), h('span', {class: 'pal-text'}, h('b', {}, it.label), it.sub ? h('small', {}, it.sub) : null),
      it.hint ? h('kbd', {}, it.hint) : h('span', {class: 'pal-g'}, it.group))) : [h('li', {class: 'pal-empty'}, '찾는 것이 없어요')]));
    const on = list.querySelector('.on');
    if (on) on.scrollIntoView({block: 'nearest'});
  };
  input.addEventListener('input', () => {
    sel = 0; found = []; render();
    clearTimeout(timer);
    const q = input.value.trim(), my = ++seq;
    if (q.length >= 2) timer = setTimeout(async () => {  // 지난 7일 기록(질문 · 명령 · 파일)도 찾는다
      const r = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq || !r) return;
      found = r.results.slice(0, 15).map(e => {
        const root = e.parent ? S.sessions.find(x => x.id === e.parent) || {id: e.parent, agent: e.agent} : e;
        return {group: '기록', icon: e.agent, label: e.text, sub: `${sessionName(root) || ''} · ${ago(e.ts)}`, run: () => openSession({...root, cwd: root.cwd || e.cwd, last: e.ts})};
      });
      render();
    }, 200);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  });
  modalClose = closeModal;
  modal.hidden = false;
  modal.replaceChildren(h('div', {class: 'palette', role: 'dialog', 'aria-label': '명령 팔레트'}, input, list));
  render();
  input.focus();
}

// ── 작은 메뉴 (탭 목록 · 놓친 알림) ──
const menuEl = $('menu');
function showMenu(anchor, items, up) {
  menuEl.replaceChildren(...items.map(it => (it.sep ? h('div', {class: 'menu-sep'}) : h('button', {type: 'button', role: 'menuitem', class: it.cls || null, disabled: it.disabled,
    onclick: () => { hideMenu(); if (it.run) it.run(); }}, it.icon ? kindIcon(it.icon) : null, h('span', {class: 'menu-text'}, it.label, it.sub ? h('small', {}, it.sub) : null), it.hint ? h('kbd', {}, it.hint) : null))));
  menuEl.hidden = false;
  const r = anchor.getBoundingClientRect();
  menuEl.style.left = `${Math.max(8, Math.min(innerWidth - menuEl.offsetWidth - 8, r.left))}px`;
  menuEl.style.top = up ? '' : `${r.bottom + 4}px`;
  menuEl.style.bottom = up ? `${innerHeight - r.top + 4}px` : '';
}
function hideMenu() { menuEl.hidden = true; }
document.addEventListener('mousedown', e => { if (!menuEl.hidden && !menuEl.contains(e.target)) hideMenu(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !menuEl.hidden) { e.preventDefault(); hideMenu(); } }, true);
$('tab-more').onclick = () => showMenu($('tab-more'), projTabs().map(t => ({icon: t.kind, label: tabLabel(t), cls: t.id === S.active ? 'on' : null,
  sub: t.waiting ? STATE.wait : t.busy ? STATE.busy : t.unread ? STATE.new : null, run: () => activate(t.id)})));

// ── 레이아웃: 패널 너비 · 열고 닫기 ──
const appEl = $('app');
function setOrbitWidth(w, save = true) {  // 터미널이 최소 360px 는 남도록, 그 안에서는 마음껏
  const side = appEl.classList.contains('no-side') ? 0 : $('projects').closest('.side').offsetWidth;
  w = Math.max(320, Math.min(window.innerWidth - side - 5 - 360, Math.round(w)));
  appEl.style.setProperty('--orbit-w', w + 'px');
  if (save) store.set('orbitW', w);
}
function setSideWidth(w, save = true) {  // 터미널 360px 와 궤도 패널 최소 폭은 남긴다
  const orbit = appEl.classList.contains('no-orbit') ? 0 : 325;
  w = Math.max(200, Math.min(360, window.innerWidth - 360 - orbit, Math.round(w)));
  appEl.style.setProperty('--side-w', w + 'px');
  if (save) store.set('sideW', w);
}
// 창 크기 · 사이드바 · 패널이 바뀌면 고른 너비 안에서 다시 맞춤 (저장값은 그대로)
const fitLayout = () => { setSideWidth(+store.get('sideW') || 248, false); setOrbitWidth(+store.get('orbitW') || 440, false); };
addEventListener('resize', fitLayout);
function toggle(cls) {
  appEl.classList.toggle(cls);
  store.set(cls, appEl.classList.contains(cls) ? '1' : '0');
  fitLayout();
  const t = tab(S.active);
  if (t) requestAnimationFrame(() => t.fit.fit());
}
function dragHandle(el, onMove, reset) {  // 포인터 캡처: 창 밖에서 버튼을 놓아도 드래그가 확실히 끝난다
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.classList.add('active'); appEl.classList.add('dragging'); e.preventDefault(); });
  el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) onMove(e.clientX); });
  el.addEventListener('lostpointercapture', () => {
    el.classList.remove('active'); appEl.classList.remove('dragging');
    const t = tab(S.active);
    if (t) t.fit.fit();
  });
  el.addEventListener('dblclick', reset);  // 두 번 누르면 기본 너비
}
dragHandle($('resizer'), x => setOrbitWidth(window.innerWidth - x), () => setOrbitWidth(440));
dragHandle($('side-resizer'), x => { setSideWidth(x); fitLayout(); }, () => { setSideWidth(248); fitLayout(); });
if (store.get('no-orbit') === '1') appEl.classList.add('no-orbit');
if (store.get('no-side') === '1') appEl.classList.add('no-side');
fitLayout();

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
  'find': openFind,
  'settings': () => openSettings(),
  'split': () => splitPane('cols'),
  'split-rows': () => splitPane('rows'),
  'pane-left': () => moveFocus('left'),
  'pane-right': () => moveFocus('right'),
  'pane-up': () => moveFocus('up'),
  'pane-down': () => moveFocus('down'),
  'pane-zoom': toggleZoom,
  'unsplit': unsplit,
  'palette': openPalette,
  'shortcuts': openShortcuts,
}[action] || (() => {}))());
addEventListener('keydown', e => {  // ⌘1–9: 지금 프로젝트의 탭 이동
  if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    const t = projTabs()[+e.key - 1];
    if (t) { e.preventDefault(); activate(t.id); }
  }
}, true);

(async () => {
  await loadProjects();
  await restoreTabs();
})();
initOrbit();
setInterval(loadUsage, 15000);  // 상태바 숫자 · 탭 ↔ 세션 · git 은 15초마다
// 새 버전 안내: 켤 때와 켜 둔 동안 6시간마다 (설정의 "업데이트 확인"은 바로)
const checkUpdate = force => api.checkUpdate(force).then(u => { if (!(u && u.failed)) { S.update = u; renderStatusbar(); } return u; });
checkUpdate().catch(() => {});
setInterval(() => checkUpdate().catch(() => {}), 6 * 36e5);
api.appVersion().then(v => { S.appVersion = v; });
