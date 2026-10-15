'use strict';
/* Agent Orbit 대시보드 — 데이터는 이 브라우저와 내 컴퓨터의 수집기(127.0.0.1) 사이에서만 오간다. */

// ── 설정 ──
const LATEST = '0.2.1';          // 이 화면이 기대하는 수집기 버전. 더 낮으면 업데이트 배너
const MIN_PROTOCOL = 2;
const PORT = 47777;
const SITE = 'https://agent-orbit-app.vercel.app';
const INSTALL_CMD = `curl -fsSL ${SITE}/install.sh | sh`;
const FEEDBACK_URL = '';         // 피드백 폼 주소. 비어 있으면 링크를 숨긴다
const params = new URLSearchParams(location.search);
const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
const API = LOCAL ? '' : /^http:\/\/127\.0\.0\.1:\d+$/.test(params.get('api') || '') ? params.get('api') : `http://127.0.0.1:${PORT}`;
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const SAFARI = !LOCAL && /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);
const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HUB = (params.get('hub') || 'HUB').slice(0, 6).toUpperCase();
const IDLE = 120, ORBIT_WINDOW = 1800, SPARK_N = 30;

const KIND = {
  read: {c: '#8fb3ff', code: 'RD'}, edit: {c: '#3b9eff', code: 'EDT'}, run: {c: '#22c3ee', code: 'RUN'},
  web: {c: '#818cf8', code: 'WEB'}, sub: {c: '#a78bfa', code: 'SUB'}, tool: {c: '#94a8c9', code: 'TL'},
  say: {c: '#34d399', code: 'SAY'}, you: {c: '#e7f0ff', code: 'YOU'}, done: {c: '#34d399', code: 'END'},
  error: {c: '#ff6b81', code: 'ERR'}, stat: {c: '#94a8c9', code: '··'},
};
const TOOL = new Set(['read', 'edit', 'run', 'web', 'sub', 'tool']);
const bucket = k => ['read', 'edit', 'run'].includes(k) ? k : 'other';
const AGENTS = {
  claude: {name: 'Claude Code', mark: 'C', c: '#3b9eff', file: '~/.claude/settings.json'},
  codex: {name: 'Codex', mark: 'X', c: '#8b9cff', file: '~/.codex/hooks.json'},
};
const SOON = ['Gemini CLI', 'GitHub Copilot CLI', 'Cursor CLI'];
const CARDS = [
  ['claude', 'CLAUDE', '#3b9eff', 'tool calls'],
  ['codex', 'CODEX', '#8b9cff', 'tool calls'],
  ['active', 'ACTIVE', '#22c3ee', 'sessions · 2 min'],
  ['tokens', 'TOKENS', '#34d399', 'output tokens'],
  ['turns', 'TURNS', '#7dd3fc', 'completed turns'],
  ['errors', 'ERRORS', '#ff6b81', 'failed · interrupted'],
];
const BARS = [
  ['read', 'read · search', '#8fb3ff,#a78bfa'],
  ['edit', 'edit · write', '#3b9eff,#5cc2ff'],
  ['run', 'run · exec', '#22c3ee,#3b9eff'],
  ['other', 'web · agents · tools', '#818cf8,#a78bfa'],
];
const dayStart = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d.getTime() / 1000; };
const RANGES = {
  today: {list: '오늘의 세션', bounds: () => [dayStart(0), null]},
  yesterday: {list: '어제의 세션', bounds: () => [dayStart(1), dayStart(0)]},
  '7d': {list: '최근 7일 세션', bounds: () => [dayStart(6), null]},
};

// ── 상태 ──
const S = {
  mode: 'boot',              // boot | demo | live
  onboard: null,             // install | notfound | stopped | denied | safari
  checking: false,
  status: null,              // 수집기 /api/status
  connected: false,          // 이벤트 스트림 연결 여부
  range: 'today', bounds: [dayStart(0), null], day: dayStart(0),
  summary: new Map(), summarySeq: 0, summaryReady: false, pending: [],
  nodes: new Map(), feed: [], hubFlash: -9, bursts: [],
  spark: Object.fromEntries(CARDS.map(([k]) => [k, Array(SPARK_N).fill(0)])),
  drawer: null, boot: null, es: null,
  demoTimer: 0, demoSeq: 0, demoLog: [],
  dirty: true, listDirty: true,
};

// ── 도우미 ──
const $ = id => document.getElementById(id);
const now = () => performance.now() / 1000;
const epoch = () => Date.now() / 1000;
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const fmtK = x => x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'k' : String(Math.round(x));
const pick = a => a[Math.random() * a.length | 0];
const store = {
  get: k => { try { return localStorage.getItem('ao.' + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('ao.' + k, v); } catch { /* 저장 못 해도 동작엔 지장 없음 */ } },
};

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

function ago(ts) {
  const s = epoch() - ts;
  if (s < 60) return '방금';
  if (s < 3600) return `${s / 60 | 0}분 전`;
  if (s < 86400) return `${s / 3600 | 0}시간 전`;
  return `${s / 86400 | 0}일 전`;
}
const hhmm = ts => new Date(ts * 1000).toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function getJSON(path, timeout = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(API + path, {cache: 'no-store', signal: ctl.signal});
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}

async function postJSON(path, body) {
  const r = await fetch(API + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = h('textarea', {style: 'position:fixed;opacity:0'}, text);
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (btn) { const old = btn.textContent; btn.textContent = '복사됨'; setTimeout(() => { btn.textContent = old; }, 1400); }
}
const cmdBox = (text = INSTALL_CMD) => {
  const b = h('button', {class: 'btn small', type: 'button'}, '복사');
  b.onclick = () => copy(text, b);
  return h('div', {class: 'cmd'}, h('code', {}, text), b);
};

// ── 시작: 로컬 모드 / 배포 사이트 ──
async function lnaPermission() {
  for (const name of ['loopback-network', 'local-network-access']) {
    try { return (await navigator.permissions.query({name})).state; } catch { /* 이 이름을 모르는 브라우저 */ }
  }
  return 'unknown';
}

async function refreshStatus() {
  try { S.status = await getJSON('/api/status', 20000); } catch { return false; }
  renderAgents(); renderBanners(); renderOnboard(); renderFooter();
  return true;
}

async function boot() {
  renderStatic();
  if (!LOCAL) loadAnalytics();
  if (LOCAL) return goLive();
  if (SAFARI) { S.onboard = 'safari'; return startDemo(); }
  // 설치 전 방문자에게 곧바로 "이 기기 접근" 권한을 묻지 않는다: 허용돼 있거나 전에 설치를 확인한 경우만 자동 접속
  const perm = await lnaPermission();
  if (perm === 'granted' || store.get('installed') === '1') {
    if (await refreshStatus()) return goLive();
    S.onboard = perm === 'denied' ? 'denied' : 'stopped';
  } else {
    S.onboard = perm === 'denied' ? 'denied' : 'install';
  }
  startDemo();
}

async function checkCollector() {  // 2단계 버튼: 여기서 처음 내 컴퓨터에 접속 → 브라우저가 권한을 묻는다
  S.checking = true; renderOnboard();
  const ok = await refreshStatus();
  S.checking = false;
  if (ok) { store.set('installed', '1'); stopDemo(); return goLive(); }
  S.onboard = (await lnaPermission()) === 'denied' ? 'denied' : S.onboard === 'stopped' ? 'stopped' : 'notfound';
  renderOnboard();
}

async function goLive() {
  S.mode = 'live'; S.onboard = null;
  if (!S.status) await refreshStatus();
  renderAll();
  openStream();
}

// ── 이벤트 스트림 ──
function openStream() {
  if (S.es) S.es.close();
  const es = S.es = new EventSource(API + '/api/events');
  es.onopen = () => { S.connected = true; setMode(); };
  es.onerror = () => { S.connected = false; setMode(); };
  es.onmessage = m => { try { onMessage(JSON.parse(m.data)); } catch (err) { console.error(err); } };
}

function onMessage(e) {
  if (e.kind === 'hello') {
    const restarted = S.boot && S.boot !== e.boot;
    S.boot = e.boot; S.feed = [];
    for (const n of S.nodes.values()) n.running.clear();
    loadSummary();
    if (restarted) refreshStatus();
    return;
  }
  if (e.kind === 'start' || e.kind === 'end') return onHook(e);
  onEvent(e);
}

function node(e) {
  let n = S.nodes.get(e.id);
  if (!n) S.nodes.set(e.id, n = {id: e.id, agent: e.agent, parent: e.parent, label: e.label, act: '', kind: null, last: e.ts, flash: -9, fail: -9, off: null, running: new Map()});
  n.label = e.label || n.label;
  n.last = Math.max(n.last, e.ts);
  return n;
}

function onHook(e) {  // 훅: 도구 실행 시작/끝 → 노드 "작업 중" 상태
  const n = node(e);
  if (e.kind === 'start') {
    n.running.set(e.tool, {text: e.text, t: e.ts});
    if (!e.replay) { n.flash = S.hubFlash = now(); burst(n); tape({label: n.label, text: '▶ ' + e.text}, true); }
  } else {
    n.running.delete(e.tool);
    if (!e.ok) n.fail = now();
  }
  S.dirty = true;
}

function onEvent(e) {
  const live = !e.replay;
  if (e.kind !== 'stat') {
    const n = node(e);
    n.kind = e.kind; n.act = e.text;
    if (e.kind === 'done') n.running.clear();
    if (live) { n.flash = S.hubFlash = now(); burst(n); }
    S.feed.unshift(e);
    S.feed.length = Math.min(S.feed.length, 6);
    tape(e, live);
  }
  if (live) {
    bumpSpark(e);
    if (!S.summaryReady) S.pending.push(e);
    else if (e.seq > S.summarySeq) applySummary(e);
    if (S.drawer && S.drawer.id === e.id && e.kind !== 'stat') drawerAdd(e, true);
  }
  S.dirty = true;
}

function bumpSpark(e) {
  const T = SPARK_N - 1;
  if (TOOL.has(e.kind) && S.spark[e.agent]) S.spark[e.agent][T]++;
  if (e.dtok) S.spark.tokens[T] += e.dtok;
  if (e.kind === 'done') S.spark.turns[T]++;
  if (e.kind === 'error') S.spark.errors[T]++;
}

// ── 기간 요약: 수집기가 저장해 둔 기록 + 이후 실시간 이벤트 ──
async function loadSummary() {
  const key = S.range;
  S.bounds = RANGES[key].bounds();
  S.summaryReady = false; S.pending = [];
  if (S.mode === 'demo') {
    S.summary = new Map(); S.summarySeq = 0;
    for (const e of S.demoLog) applySummary(e);
    S.summaryReady = true; S.dirty = S.listDirty = true;
    return;
  }
  const [since, until] = S.bounds;
  try {
    const r = await getJSON(`/api/summary?since=${since}${until ? `&until=${until}` : ''}`);
    if (key !== S.range) return;  // 그 사이 다른 탭을 눌렀다
    S.summary = new Map(r.sessions.map(x => [x.id, x]));
    S.summarySeq = r.seq;
    for (const e of S.pending) if (e.seq > S.summarySeq) applySummary(e);
    if (until === null) for (const x of S.summary.values()) if (epoch() - x.last < ORBIT_WINDOW) seedNode(x);
  } catch {
    toast('수집기에서 기록을 불러오지 못했어요');
  }
  S.pending = []; S.summaryReady = true; S.dirty = S.listDirty = true;
}

function seedNode(x) {  // 새로고침해도 최근 30분 안에 움직인 세션은 궤도에 그대로
  const fresh = !S.nodes.has(x.id), n = node({id: x.id, agent: x.agent, parent: x.parent, label: x.label, ts: x.last});
  if (fresh || !n.act) { n.kind = x.kind; n.act = x.text; }
}

function applySummary(e) {  // 수집기의 summarize()와 같은 규칙
  const [since, until] = S.bounds;
  if (until !== null || e.ts < since) return;
  let x = S.summary.get(e.id);
  if (!x) S.summary.set(e.id, x = {id: e.id, agent: e.agent, parent: e.parent, label: e.label, first: e.ts, last: e.ts, tools: 0, read: 0, edit: 0, run: 0, other: 0, turns: 0, errors: 0, tokens: 0, kind: null, text: ''});
  x.label = e.label; x.last = Math.max(x.last, e.ts); x.tokens += e.dtok || 0;
  if (TOOL.has(e.kind)) { x.tools++; x[bucket(e.kind)]++; }
  else if (e.kind === 'done') x.turns++;
  else if (e.kind === 'error') x.errors++;
  if (e.kind !== 'stat') { x.kind = e.kind; x.text = e.text; }
  S.listDirty = true;
}

function totals() {
  const t = {claude: 0, codex: 0, tokens: 0, turns: 0, errors: 0, tools: 0, read: 0, edit: 0, run: 0, other: 0};
  for (const x of S.summary.values()) {
    t[x.agent] = (t[x.agent] || 0) + x.tools;
    for (const k of ['tokens', 'turns', 'errors', 'tools', 'read', 'edit', 'run', 'other']) t[k] += x[k] || 0;
  }
  return t;
}

const activeCount = () => { let a = 0; const t = epoch(); for (const n of S.nodes.values()) if (t - n.last < IDLE || n.running.size) a++; return a; };

// ── 화면 ──
function renderStatic() {
  $('cards').replaceChildren(...CARDS.map(([k, n, c, s]) => {
    const card = h('div', {class: 'card', style: `--c:${c}`},
      h('div', {class: 'h'}, n), h('div', {class: 'v', id: `v-${k}`}, '0'), h('div', {class: 's'}, s));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 56 16'); svg.setAttribute('aria-hidden', 'true');
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.id = `sp-${k}`; pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', c); pl.setAttribute('stroke-width', '1.2');
    svg.append(pl); card.firstChild.append(svg);
    return card;
  }));
  $('bars').replaceChildren(...BARS.map(([k, l, g]) => h('div', {class: 'bar'},
    h('div', {class: 'r'}, h('span', {}, l), h('span', {id: `p-${k}`}, '0%')),
    h('div', {class: 'track'}, h('div', {class: 'fill', id: `f-${k}`, style: `background:linear-gradient(90deg,${g})`})))));
  for (const b of document.querySelectorAll('.seg button')) b.onclick = () => setRange(b.dataset.range);
  renderAgents(); renderFooter(); setMode();
}

function setRange(key) {
  if (key === S.range) return;
  S.range = key;
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-selected', String(b.dataset.range === key));
  $('sessions-title').textContent = RANGES[key].list;
  closeDrawer();
  loadSummary();
}

function setMode() {
  const el = $('mode');
  const [cls, text] = S.mode === 'demo' ? ['demo', 'DEMO'] : S.mode === 'live' && S.connected ? ['live', 'LIVE'] : ['off', S.mode === 'boot' ? '…' : 'OFFLINE'];
  el.className = 'pill ' + cls;
  el.lastChild.textContent = text;
  $('demo-mark').hidden = S.mode !== 'demo';
}

function renderPanels() {
  const t = totals(), act = activeCount();
  const v = {claude: t.claude.toLocaleString(), codex: t.codex.toLocaleString(), active: `${act}/${S.summary.size}`,
    tokens: fmtK(t.tokens), turns: t.turns.toLocaleString(), errors: t.errors.toLocaleString()};
  for (const k in v) $(`v-${k}`).textContent = v[k];
  $('judged').textContent = `${t.tools.toLocaleString()} tool calls`;
  const sum = t.read + t.edit + t.run + t.other || 1;
  for (const [k] of BARS) { const pc = Math.round(t[k] / sum * 100); $(`p-${k}`).textContent = pc + '%'; $(`f-${k}`).style.width = pc + '%'; }
  const feed = $('feed');
  feed.replaceChildren(...S.feed.map(e => h('li', {style: `--c:${(KIND[e.kind] || KIND.tool).c}`},
    h('span', {class: 'dot'}), h('b', {}, e.kind), h('p', {}, `${e.label} · ${e.text}`))));
  if (!S.feed.length) feed.append(h('li', {class: 'empty'}, S.mode === 'live' ? '에이전트가 일하면 여기에 바로 나타나요' : '…'));
}

function renderSessions() {
  const list = [...S.summary.values()].sort((a, b) => b.last - a.last);
  $('sessions-count').textContent = list.length ? `${list.length}개` : '';
  const box = $('sessions');
  if (!list.length) {
    const msg = S.mode === 'live' ? (S.bounds[1] === null ? '아직 기록이 없어요. 에이전트를 연결하고 일을 시켜 보세요.' : '이 기간에는 기록이 없어요.') : '수집기에 연결하면 내 세션 기록이 여기에 쌓여요.';
    return box.replaceChildren(h('div', {class: 'empty'}, msg));
  }
  box.replaceChildren(...list.slice(0, 200).map(x => {
    const k = KIND[x.kind] || KIND.tool, a = AGENTS[x.agent] || AGENTS.claude;
    return h('button', {class: 'row', type: 'button', onclick: () => openDrawer(x.id)},
      h('span', {class: 'mark', style: `--c:${a.c}`, title: a.name}, a.mark),
      h('span', {class: 'label'}, x.parent ? h('small', {}, '↳ ') : null, x.label),
      h('span', {class: 'act', style: `--c:${k.c}`}, x.kind ? h('b', {}, x.kind) : null, x.text || ''),
      h('span', {class: 'nums'}, h('span', {}, h('b', {}, x.tools), ' tools'), h('span', {}, h('b', {}, fmtK(x.tokens)), ' tok'),
        x.errors ? h('span', {}, h('b', {}, x.errors), ' err') : null),
      h('span', {class: 'ago'}, ago(x.last)));
  }));
}

function renderBanners() {
  const box = $('banners'), out = [];
  const st = S.status;
  if (st && (st.protocol < MIN_PROTOCOL || newer(LATEST, st.version))) {
    out.push(h('div', {class: 'banner'},
      h('p', {}, st.protocol < MIN_PROTOCOL ? `수집기(v${st.version})가 오래되어 업데이트가 필요해요.` : `수집기 업데이트가 있어요 (v${st.version} → v${LATEST}). 설치할 때와 같은 명령으로 업데이트돼요.`),
      cmdBox()));
  }
  box.replaceChildren(...out);
}

function connectedAny() { const a = S.status && S.status.agents; return !!a && Object.values(a).some(x => x.connected); }

function renderOnboard() {
  const box = $('onboard');
  const live = S.mode === 'live' && S.status;
  box.hidden = !(S.onboard || (live && !connectedAny()));
  if (box.hidden) return box.replaceChildren();
  const st = S.onboard;
  const step = (n, title, state, ...body) => h('div', {class: `step ${state}`}, h('h3', {}, h('b', {}, state === 'done' ? '✓' : n), title), ...body);
  const check = h('button', {class: 'btn primary', type: 'button', onclick: checkCollector, disabled: S.checking},
    S.checking ? '확인 중…' : st === 'install' ? '설치했어요 · 연결하기' : '다시 확인');
  const s2 = live ? [h('p', {}, `수집기 v${S.status.version}에 연결됐어요.`)] :
    st === 'safari' ? [h('p', {}, 'Safari는 보안 정책상 배포된 사이트에서 내 컴퓨터의 수집기에 접속할 수 없어요. 설치한 뒤 로컬 주소로 열면 같은 화면을 쓸 수 있어요.'),
      h('div', {class: 'actions'}, h('a', {class: 'btn primary', href: LOCAL_URL}, '로컬 주소로 열기'))] :
    st === 'denied' ? [h('p', {class: 'warn'}, '이 사이트의 로컬 접근이 차단되어 있어요.'),
      h('p', {}, '주소창 왼쪽 아이콘 → 사이트 설정에서 "이 기기의 앱"(로컬 네트워크 액세스)을 허용으로 바꾼 뒤 다시 확인하세요.'), h('div', {class: 'actions'}, check)] :
    st === 'stopped' ? [h('p', {class: 'warn'}, '수집기가 꺼져 있어요.'),
      h('p', {}, '터미널에서 agent-orbit doctor 로 상태를 확인하거나, 설치 명령을 다시 실행하세요.'), h('div', {class: 'actions'}, check)] :
    st === 'notfound' ? [h('p', {class: 'warn'}, '수집기를 찾지 못했어요.'), h('p', {}, '설치 명령이 끝까지 실행됐는지 확인하고 다시 눌러 주세요.'), h('div', {class: 'actions'}, check)] :
    [h('p', {}, '설치가 끝나면 아래 버튼을 누르세요. 브라우저가 "이 기기의 앱 및 서비스 액세스"를 물으면 허용을 눌러 주세요.'), h('div', {class: 'actions'}, check)];
  box.classList.toggle('single', !!live);
  if (live) {  // 수집기까지 끝났으면 남은 한 단계만 크게
    return box.replaceChildren(step(3, '에이전트를 연결하세요', 'active',
      h('p', {}, `✓ 수집기 v${S.status.version}에 연결됐어요. 연결할 에이전트를 고르면 바뀔 내용을 먼저 보여드려요.`),
      h('div', {class: 'mini'}, ...Object.keys(AGENTS).map(agentCard))));
  }
  box.replaceChildren(
    step(1, '수집기 설치', live ? 'done' : st === 'install' || st === 'safari' ? 'active' : '',
      h('p', {}, '터미널에 붙여넣으세요. macOS · Linux, Python 3.9 이상.'), cmdBox(),
      h('p', {class: 'note'}, '에이전트 기록은 이 컴퓨터 밖으로 나가지 않아요. 바뀌는 파일은 아래 "개인정보와 설치 내용"에 있어요.')),
    step(2, '이 브라우저와 연결', live ? 'done' : st && st !== 'install' && st !== 'safari' ? 'active' : '', ...s2),
    step(3, '에이전트 연결', live ? 'active' : '',
      live ? h('div', {class: 'mini'}, ...Object.keys(AGENTS).map(agentCard)) : h('p', {}, '연결되면 여기서 Claude Code · Codex를 한 번에 연결할 수 있어요.')));
}

function agentCard(key) {
  const a = AGENTS[key], st = S.status && S.status.agents && S.status.agents[key];
  let chip = h('span', {class: 'chip'}, '—'), desc = '수집기에 연결하면 쓸 수 있어요.', acts = [];
  if (st) {
    if (!st.installed) { chip = h('span', {class: 'chip'}, '설치 안 됨'); desc = '이 컴퓨터에서 찾지 못했어요.'; }
    else if (st.connected) {
      const untrusted = key === 'codex' && st.trust && st.trust !== 'trusted';
      chip = untrusted ? h('span', {class: 'chip warn'}, '승인 필요') : h('span', {class: 'chip ok'}, '연결됨');
      desc = untrusted ? 'Codex가 이 훅을 실행하려면 승인이 필요해요.' : '도구를 실행하는 순간 궤도에 나타나요.';
      if (untrusted) acts.push(h('button', {class: 'btn small primary', type: 'button', onclick: () => openAction(key, 'trust')}, '승인'));
      acts.push(h('button', {class: 'btn small', type: 'button', onclick: () => openAction(key, 'disconnect')}, '연결 해제'));
    } else {
      chip = h('span', {class: st.legacy ? 'chip warn' : 'chip'}, st.legacy ? '업데이트 필요' : '연결 안 됨');
      desc = st.legacy ? '이전 버전 훅이 있어요. 다시 연결하면 새 버전으로 바뀌어요.' : '';
      acts.push(h('button', {class: 'btn small primary', type: 'button', onclick: () => openAction(key, 'connect')}, st.legacy ? '다시 연결' : '연결'));
    }
  }
  return h('div', {class: 'agent'},
    h('div', {class: 'hd'}, h('span', {class: 'mark', style: `--c:${a.c}`}, a.mark), h('span', {class: 'name'}, a.name), chip),
    h('div', {class: 'desc'}, desc || h('code', {}, a.file)),
    acts.length ? h('div', {class: 'acts'}, ...acts) : null);
}

function renderAgents() {
  $('agents').replaceChildren(...Object.keys(AGENTS).map(agentCard),
    ...SOON.map(name => h('div', {class: 'agent soon'}, h('div', {class: 'hd'}, h('span', {class: 'mark', style: '--c:#55688a'}, name[0]), h('span', {class: 'name'}, name), h('span', {class: 'chip'}, '준비 중')))));
  $('agents-note').textContent = S.mode === 'live' ? '' : '수집기 연결 후 사용';
}

function renderFooter() {
  const st = S.status, kids = [h('span', {class: 'grow'}, `Agent Orbit · 화면 v${LATEST}` + (st ? ` · 수집기 v${st.version}` : ''))];
  if (st && st.autostart != null) {
    const sw = h('button', {class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(st.autostart)}, h('i'), '로그인할 때 자동 실행');
    sw.onclick = async () => {
      try { const r = await postJSON('/api/autostart', {enabled: !st.autostart}); st.autostart = r.autostart; renderFooter(); toast(r.autostart ? '로그인할 때 자동으로 켜져요' : '자동 실행을 껐어요. 지금 실행 중인 수집기는 그대로예요'); }
      catch { toast('설정을 바꾸지 못했어요'); }
    };
    kids.push(sw);
  }
  if (!LOCAL && S.mode === 'live') kids.push(h('a', {href: LOCAL_URL}, '로컬 주소로 열기'));
  if (FEEDBACK_URL) kids.push(h('a', {href: FEEDBACK_URL, target: '_blank', rel: 'noopener'}, '피드백'));
  kids.push(h('a', {href: '#privacy', onclick: () => { $('privacy').open = true; }}, '개인정보'));
  $('footer').replaceChildren(...kids);
}

function renderAll() {
  setMode(); renderBanners(); renderOnboard(); renderAgents(); renderFooter();
  S.dirty = S.listDirty = true;
}

// ── 연결 · 해제 · 승인 확인 창 ──
async function openAction(agent, action) {
  let p;
  try { p = await getJSON(`/api/preview?agent=${agent}&action=${action}`, 20000); } catch { return toast('수집기에 연결할 수 없어요'); }
  if (p.error) return toast(p.error);
  const name = AGENTS[agent].name;
  const intro = {
    connect: `아래 파일에 agent-orbit 훅이 추가돼요. ${name}가 도구를 실행할 때마다 이 컴퓨터의 수집기(127.0.0.1:${(S.status && S.status.port) || PORT})로만 신호를 보내요.`,
    disconnect: '추가했던 agent-orbit 훅을 제거해요. 연결한 뒤 설정이 바뀌지 않았다면 연결 전 파일 그대로 되돌려요.',
    trust: 'Codex는 새 훅을 승인해야 실행해요. 아래 명령을 승인합니다 — Codex의 /hooks 화면에서 승인하는 것과 같아요.',
  }[action];
  const body = [h('p', {}, intro)];
  if (p.diff) body.push(diffView(p.diff));
  else if (action !== 'trust') body.push(h('p', {}, '설정 파일은 바뀌지 않아요.'));
  if (p.trust) body.push(h('p', {}, action === 'connect' ? 'Codex 승인도 함께 처리해요. 승인할 명령:' : '승인할 명령:'), h('pre', {class: 'codebox'}, p.command));
  modal({
    title: {connect: `${name} 연결`, disconnect: `${name} 연결 해제`, trust: 'Codex 훅 승인'}[action],
    body, confirm: {connect: '연결', disconnect: '연결 해제', trust: '승인'}[action], danger: action === 'disconnect',
    onConfirm: async () => {
      const r = await postJSON(`/api/${action}`, {agent});
      toast(r.message || '완료');
      await refreshStatus();
    },
  });
}

function diffView(text) {
  const box = h('div', {class: 'diff', tabindex: '0', 'aria-label': '바뀌는 내용'});
  for (const line of text.split('\n')) {
    if (!line) continue;
    const cls = line.startsWith('+++') || line.startsWith('---') ? 'meta' : line.startsWith('@@') ? 'hunk' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx';
    box.append(h('div', {class: cls}, cls === 'ctx' ? clip(line, 140) : line));
  }
  return box;
}

function modal({title, body, confirm, danger, onConfirm}) {
  const m = $('modal'), prev = document.activeElement;
  const ok = h('button', {class: danger ? 'btn danger' : 'btn primary', type: 'button'}, confirm);
  const cancel = h('button', {class: 'btn', type: 'button'}, '취소');
  const sheet = h('div', {class: 'sheet'}, h('h2', {id: 'modal-title'}, title), ...body, h('div', {class: 'actions'}, cancel, ok));
  const close = () => { m.hidden = true; m.replaceChildren(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  const onKey = ev => {
    if (ev.key === 'Escape' && !ok.disabled) close();
    if (ev.key === 'Tab') {  // 확인 창 안에서만 포커스가 돈다
      const f = [...sheet.querySelectorAll('button, [tabindex="0"]')].filter(x => !x.disabled);
      const i = f.indexOf(document.activeElement);
      if (ev.shiftKey && i <= 0) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus(); }
    }
  };
  cancel.onclick = close;
  ok.onclick = async () => {
    ok.disabled = cancel.disabled = true; ok.textContent = '적용 중…';
    try { await onConfirm(); } catch (err) { toast('실패했어요: ' + err.message); }
    close();
  };
  m.onclick = ev => { if (ev.target === m && !ok.disabled) close(); };
  m.replaceChildren(sheet);
  m.hidden = false;
  document.addEventListener('keydown', onKey);
  ok.focus();
}

// ── 세션 기록 패널 ──
async function openDrawer(id) {
  const x = S.summary.get(id);
  if (!x) return;
  const d = $('drawer'), prev = document.activeElement, a = AGENTS[x.agent] || AGENTS.claude;
  const list = h('ol', {}, h('li', {class: 'empty'}, '불러오는 중…'));
  const close = h('button', {class: 'btn small', type: 'button', 'aria-label': '닫기'}, '닫기');
  S.drawer = {id, list, prev};
  close.onclick = closeDrawer;
  d.replaceChildren(
    h('div', {class: 'hd'}, h('span', {class: 'mark', style: `--c:${a.c}`}, a.mark),
      h('div', {}, h('h2', {}, (x.parent ? '↳ ' : '') + x.label), h('div', {class: 'sub'}, `${a.name} · ${RANGES[S.range].list.replace('의 세션', '').replace(' 세션', '')} · 마지막 활동 ${ago(x.last)}`)), close),
    h('div', {class: 'nums'}, h('span', {}, h('b', {}, x.tools), ' tools'), h('span', {}, h('b', {}, fmtK(x.tokens)), ' tokens'),
      h('span', {}, h('b', {}, x.turns), ' turns'), h('span', {}, h('b', {}, x.errors), ' errors')),
    list);
  d.hidden = false;
  close.focus();
  let events;
  if (S.mode === 'demo') events = S.demoLog.filter(e => e.id === id && e.kind !== 'stat');
  else {
    const [since, until] = S.bounds;
    try { events = (await getJSON(`/api/sessions/${encodeURIComponent(id)}?since=${since}${until ? `&until=${until}` : ''}`)).events; }
    catch { events = null; }
  }
  if (!S.drawer || S.drawer.id !== id) return;
  list.replaceChildren();
  if (!events) return list.append(h('li', {class: 'empty'}, '기록을 불러오지 못했어요'));
  for (const e of events) drawerAdd(e, false);
  if (!events.length) list.append(h('li', {class: 'empty'}, '이 기간에 남은 동작이 없어요'));
}

function drawerAdd(e, live) {
  const list = S.drawer.list, k = KIND[e.kind] || KIND.tool;
  if (live && list.firstChild && list.firstChild.classList.contains('empty')) list.firstChild.remove();
  list.prepend(h('li', {style: `--c:${k.c}`}, h('time', {}, hhmm(e.ts)), h('b', {}, e.kind), h('span', {}, e.text)));
}

function closeDrawer() {
  if (!S.drawer) return;
  const prev = S.drawer.prev;
  S.drawer = null;
  $('drawer').hidden = true;
  $('drawer').replaceChildren();
  if (prev && prev.focus) prev.focus();
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.drawer && $('modal').hidden) closeDrawer(); });

// ── 테이프 ──
let tapeTimer;
function tape(e, animate) {
  const full = `${e.label}  ${e.text}`;
  clearInterval(tapeTimer);
  if (!animate || CALM) { $('tape').textContent = full; return; }
  let i = 0;
  tapeTimer = setInterval(() => { i += 2; $('tape').textContent = full.slice(0, i); if (i >= full.length) clearInterval(tapeTimer); }, 16);
}

// ── 데모: 설치 전 방문자에게 영상처럼 움직이는 예시를 보여준다 ──
const DEMO = {
  sessions: [
    {id: 'demo-api', agent: 'claude', label: 'api-server'},
    {id: 'demo-web', agent: 'claude', label: 'web-frontend'},
    {id: 'demo-sub', agent: 'claude', label: 'Explore', parent: 'demo-api'},
    {id: 'demo-bill', agent: 'codex', label: 'billing'},
    {id: 'demo-infra', agent: 'codex', label: 'infra'},
  ],
  acts: {
    claude: [['read', 'Read src/routes.ts'], ['edit', 'Edit auth.ts'], ['run', 'Bash npm test -- auth'], ['read', 'Grep useSession'],
      ['web', 'WebSearch zod discriminated union'], ['sub', 'Agent find callers'], ['say', '인증 흐름을 정리했어요. 테스트를 돌려볼게요'], ['tool', 'TodoWrite']],
    codex: [['run', 'pytest -q'], ['read', 'rg invoice'], ['edit', 'invoice.py'], ['say', '테스트 통과, 다음은 마이그레이션'], ['run', 'terraform plan'], ['read', 'cat alembic.ini']],
  },
};

function demoEvent(sess, kind, text, ts = epoch()) {
  return {id: sess.id, agent: sess.agent, parent: sess.parent || null, label: sess.label, kind, text, ts,
    dtok: kind === 'say' || kind === 'done' ? 0 : 40 + (Math.random() * 600 | 0), seq: ++S.demoSeq};
}

function startDemo() {
  S.mode = 'demo';
  S.demoLog = [];
  const t0 = epoch() - 3 * 3600;  // 오늘 몇 시간치 기록이 있는 것처럼
  for (let i = 0; i < 180; i++) {
    const sess = pick(DEMO.sessions), [k, t] = pick(DEMO.acts[sess.agent]);
    S.demoLog.push(demoEvent(sess, i % 19 === 0 ? 'done' : i % 41 === 0 ? 'error' : k, i % 41 === 0 ? 'exit 1 · npm test' : t, t0 + i * 55));
  }
  renderAll(); loadSummary(); demoTick();
}

function demoTick() {
  if (S.mode !== 'demo') return;
  const sess = pick(DEMO.sessions), r = Math.random();
  const [kind, text] = r < .05 ? ['error', 'exit 1 · npm test'] : r < .13 ? ['done', 'turn complete'] : pick(DEMO.acts[sess.agent]);
  const base = {id: sess.id, agent: sess.agent, parent: sess.parent || null, label: sess.label};
  if (kind === 'run' || (TOOL.has(kind) && Math.random() < .4)) {  // 실제 훅처럼 "실행 중"을 먼저 보여준다
    const tool = `demo-${S.demoSeq}-${r}`;
    onMessage({...base, kind: 'start', tool, text, ts: epoch()});
    setTimeout(() => {
      if (S.mode !== 'demo') return;
      onMessage({...base, kind: 'end', tool, ok: true, text, ts: epoch()});
      demoEmit(demoEvent(sess, kind, text));
    }, 1200 + Math.random() * 3800);
  } else demoEmit(demoEvent(sess, kind, text));
  S.demoTimer = setTimeout(demoTick, 450 + Math.random() * 900);
}

function demoEmit(e) {
  S.demoLog.push(e);
  if (S.demoLog.length > 600) S.demoLog.shift();
  onEvent(e);
}

function stopDemo() {
  clearTimeout(S.demoTimer);
  S.nodes.clear(); S.summary.clear(); S.feed = []; S.demoLog = [];
  for (const k in S.spark) S.spark[k].fill(0);
  $('tape').textContent = 'waiting for agents';
}

function loadAnalytics() {  // 배포 사이트에서만: 쿠키 없는 페이지 조회 수 (에이전트 데이터는 수집하지 않음)
  document.head.append(h('script', {src: '/_vercel/insights/script.js', defer: true}));
}

// ── 2초마다: 스파크라인 · 날짜 바뀜 · 상대 시간 ──
function tick() {
  const t = epoch();
  for (const n of S.nodes.values()) for (const [id, r] of n.running) if (t - r.t > 1800) n.running.delete(id);  // 끝 신호 유실 대비
  S.spark.active[SPARK_N - 1] = activeCount();
  for (const k in S.spark) {
    const a = S.spark[k], max = Math.max(...a) || 1;
    const pl = $(`sp-${k}`);
    if (pl) pl.setAttribute('points', a.map((x, i) => `${(i / (SPARK_N - 1) * 56).toFixed(1)},${(14 - x / max * 12).toFixed(1)}`).join(' '));
    a.push(0); a.shift();
  }
  if (dayStart(0) !== S.day) { S.day = dayStart(0); loadSummary(); }  // 자정이 지나면 "오늘"을 새로
  S.dirty = S.listDirty = true;
}

// ── 궤도 캔버스 ──
const cv = $('orbit'), ctx = cv.getContext('2d');
const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono');
const SANS = getComputedStyle(document.documentElement).getPropertyValue('--sans');
const PAL = ['#3b9eff', '#3b9eff', '#5cc2ff', '#22c3ee', '#a78bfa', '#ffffff'];
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const parts = Array.from({length: 72}, () => ({a: Math.random() * 6.283, sp: (Math.random() * .12 + .03) * (Math.random() < .2 ? -1 : 1), j: (Math.random() - .5) * 14, r: Math.random() * 1.6 + .8, c: pick(PAL)}));
let W = 0, H = 0, Z = 1, stars = [], rot = 0, lastFrame = now(), working = false, lastList = 0;

function resize() {
  const dpr = devicePixelRatio || 1;
  W = cv.clientWidth; Z = Math.max(.62, Math.min(1, W / 760));
  H = Math.round(W < 600 ? W * 1.1 : Math.max(340, Math.min(540, W * .56)));
  cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stars = Array.from({length: 90}, () => [Math.random() * W, Math.random() * H, Math.random() * .35 + .05]);
}
addEventListener('resize', resize);

const geo = () => ({cx: W / 2, cy: H * .5, rx: W * .41, ry: H * .37});
function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function circle(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
function ellipse(g, k, c, lw) { ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.ellipse(g.cx, g.cy, g.rx * k, g.ry * k, 0, 0, 6.283); ctx.stroke(); }
function rrect(x, y, w, hh, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.roundRect(x, y, w, hh, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function dotOn(g, a, j, r, c, alpha, k = 1) {
  ctx.globalAlpha = alpha; circle(g.cx + (g.rx * k + j) * Math.cos(a), g.cy + (g.ry * k + j * .6) * Math.sin(a), r, c); ctx.globalAlpha = 1;
}

function place(list, k, dt, g) {  // 궤도 위에 균등 배치, 세션이 늘거나 줄면 부드럽게 재배치
  list.forEach((n, i) => {
    const target = i / list.length * 6.283;
    if (n.off === null) n.off = target;
    n.off += (target - n.off) * Math.min(1, dt * 3);
    n.a = rot * (k < 1 ? -1.4 : 1) + n.off;
    n.x = g.cx + g.rx * k * Math.cos(n.a); n.y = g.cy + g.ry * k * Math.sin(n.a); n.depth = (Math.sin(n.a) + 1) / 2;
  });
}

function burst(n) {
  const c = (KIND[n.kind] || KIND.tool).c, k = n.parent ? .62 : 1;
  for (let i = 0; i < 7; i++) S.bursts.push({a: n.a ?? 0, sp: (Math.random() * .9 + .3) * (i % 2 ? 1 : -1), j: (Math.random() - .5) * 10, c, k, t: now()});
}

function drawHub(g, t) {
  const f = Math.max(0, 1 - (t - S.hubFlash) / .8, working ? (Math.sin(t * 5) + 1) * .3 : 0);
  ctx.save(); ctx.translate(g.cx, g.cy); ctx.scale(Z, Z);
  ctx.strokeStyle = 'rgba(59,158,255,.55)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * 6.283 + .2, r0 = 64, r1 = r0 + 8 + (i % 3) * 6 + f * 10, c = Math.cos(a), s = Math.sin(a) * .9;
    line(c * r0, s * r0, c * r1, s * r1);
    circle(c * r1, s * r1, 2.2, '#3b9eff');
  }
  ctx.shadowColor = '#3b9eff'; ctx.shadowBlur = 22 + f * 24;
  rrect(-54, -48, 108, 96, 12, '#071428', '#3b9eff', 2.5);
  ctx.shadowBlur = 0;
  rrect(-47, -41, 94, 82, 8, null, 'rgba(59,158,255,.35)', 1);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff'; ctx.font = `700 30px ${SANS}`; ctx.fillText(HUB, 0, 6);
  ctx.fillStyle = '#9db6d8'; ctx.font = `11px ${MONO}`; ctx.fillText('#' + String(totals().tools).padStart(4, '0'), 0, 28);
  ctx.restore();
}

function drawNode(n, t, nowS) {
  const work = n.running.size > 0, job = work && [...n.running.values()].pop();
  const s = Z * (.86 + .14 * n.depth), hot = work || t - n.flash < 2.5, failed = t - n.fail < 1.5, k = KIND[n.kind] || KIND.tool;
  const act = job ? `▶ ${n.running.size > 1 ? n.running.size + '× ' : ''}${Math.max(0, Math.floor(nowS - job.t))}s ${job.text}` : n.act || 'idle';
  const title = clip((n.parent ? '↳ ' : '') + (n.label || n.agent), Math.round(24 * Z)), sub = clip(`${n.agent} · ${act}`, Math.round(32 * Z));
  ctx.save(); ctx.globalAlpha = (nowS - n.last > IDLE && !work ? .45 : 1) * (.7 + .3 * n.depth);
  ctx.font = `600 ${14 * s}px ${SANS}`; const w1 = ctx.measureText(title).width;
  ctx.font = `${11 * s}px ${MONO}`; const w2 = ctx.measureText(sub).width;
  const bw = Math.max(w1, w2) + 24 * s, bh = 44 * s;
  const bx = Math.min(Math.max(n.x - bw / 2, 4), W - bw - 34), by = n.y - bh / 2;
  const edge = failed ? '#ff6b81' : '#3b9eff';
  if (hot || failed) { ctx.shadowColor = edge; ctx.shadowBlur = work ? 12 + 12 * (Math.sin(t * 6) + 1) / 2 : 18; }
  rrect(bx, by, bw, bh, 6, hot ? 'rgba(10,42,84,.95)' : 'rgba(9,18,34,.92)',
    hot || failed ? edge : n.agent === 'codex' ? 'rgba(139,156,255,.45)' : 'rgba(255,255,255,.14)', hot ? 1.6 : 1);
  ctx.shadowBlur = 0; ctx.textAlign = 'center';
  ctx.fillStyle = '#e7f0ff'; ctx.font = `600 ${14 * s}px ${SANS}`; ctx.fillText(title, bx + bw / 2, by + 19 * s);
  ctx.fillStyle = work ? '#a9d6ff' : '#8aa0c2'; ctx.font = `${11 * s}px ${MONO}`; ctx.fillText(sub, bx + bw / 2, by + 35 * s);
  if (work || n.kind) {  // 배지: 실행 중엔 스피너, 아니면 마지막 동작 (영상의 SCO / CHO / NOU 박스)
    const x = bx + bw + 6, y = by - 6, c = work ? '#3b9eff' : k.c;
    rrect(x, y, 24, 14, 2, 'rgba(5,10,20,.9)', c, 1);
    ctx.fillStyle = c; ctx.font = `600 ${work ? 10 : 8}px ${MONO}`; ctx.fillText(work ? SPIN[Math.floor(t * 12) % 10] : k.code, x + 12, y + 10);
  }
  ctx.restore();
}

function frame() {
  const t = now(), dt = Math.min(.1, t - lastFrame), nowS = epoch(), g = geo();
  lastFrame = t;
  if (!CALM) rot += dt * .03;
  const vis = [...S.nodes.values()].filter(n => nowS - n.last < ORBIT_WINDOW || n.running.size), visSet = new Set(vis);
  place(vis.filter(n => !n.parent || !visSet.has(S.nodes.get(n.parent))), 1, dt, g);
  place(vis.filter(n => n.parent && visSet.has(S.nodes.get(n.parent))), .62, dt, g);  // 서브에이전트는 안쪽 궤도

  ctx.clearRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.rx);
  glow.addColorStop(0, 'rgba(59,158,255,.16)'); glow.addColorStop(1, 'rgba(59,158,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  for (const [x, y, o] of stars) { ctx.fillStyle = `rgba(200,225,255,${o})`; ctx.fillRect(x, y, 1, 1); }
  ellipse(g, 1, 'rgba(59,158,255,.06)', 20); ellipse(g, 1, 'rgba(120,190,255,.24)', 1);
  ctx.setLineDash([10, 8]); ellipse(g, .62, 'rgba(59,158,255,.35)', 1.2); ctx.setLineDash([]);
  for (const p of parts) { if (!CALM) p.a += p.sp * dt; dotOn(g, p.a, p.j, p.r, p.c, .75); }
  S.bursts = S.bursts.filter(b => t - b.t < 1.6);
  for (const b of S.bursts) { b.a += b.sp * dt; dotOn(g, b.a, b.j, 2.2, b.c, 1 - (t - b.t) / 1.6, b.k); }

  working = false;
  for (const n of vis) {  // 움직인 세션: 허브(서브에이전트면 부모)에서 선. 실행 중이면 선 유지 + 점이 계속 흐름
    const age = t - n.flash, work = n.running.size > 0;
    if (age > 2.5 && !work) continue;
    working = working || work;
    const par = n.parent && S.nodes.get(n.parent), from = par && visSet.has(par) ? par : {x: g.cx, y: g.cy};
    ctx.strokeStyle = `rgba(59,158,255,${work ? .85 : (1 - age / 2.5) * .9})`; ctx.lineWidth = 1.5;
    line(from.x, from.y, n.x, n.y);
    const qs = work ? [0, 1, 2].map(i => (t * .9 + i / 3) % 1) : age < .7 ? [age / .7] : [];
    for (const q of qs) circle(from.x + (n.x - from.x) * q, from.y + (n.y - from.y) * q, 3, '#d6ebff');
  }
  drawHub(g, t);
  vis.sort((a, b) => a.y - b.y).forEach(n => drawNode(n, t, nowS));
  if (!vis.length && S.mode === 'live') {
    ctx.fillStyle = '#8aa0c2'; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText(connectedAny() ? '최근 30분 동안 움직인 에이전트가 없어요' : '에이전트를 연결하면 여기에 나타나요', g.cx, g.cy + g.ry * .62 + 30);
  }
  if (S.dirty) { S.dirty = false; renderPanels(); }
  if (S.listDirty && t - lastList > .5) { S.listDirty = false; lastList = t; renderSessions(); }
  requestAnimationFrame(frame);
}

resize();
boot();
tick(); setInterval(tick, 2000);
requestAnimationFrame(frame);
