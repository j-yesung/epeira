'use strict';
/* Agent Orbit 대시보드 — 데이터는 이 브라우저와 내 컴퓨터의 수집기(127.0.0.1) 사이에서만 오간다.
   궤도: 가운데 HUB = 지금 보고 있는 세션, 바깥 노드 = 그 세션이 쓰는 도구(Bash, Read, Edit…), 안쪽 노드 = 서브에이전트 */

// ── 설정 ──
const LATEST = '0.6.0';          // 이 화면이 기대하는 수집기 버전. 더 낮으면 업데이트 배너
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
const MINI = params.get('view') === 'mini';  // agent-orbit mini 가 여는 작은 창 · 앱의 궤도 패널
const IDLE = 120, ORBIT_WINDOW = 1800, SPARK_N = 30;
const FOLLOW_QUIET = 8;           // 보던 세션이 이만큼(초) 조용해야 다른 세션으로 HUB 를 옮긴다
const MAX_STATIONS = MINI ? 7 : 10, MAX_SUBS = 4;

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
  sess: new Map(),           // 세션(HUB 후보)과 서브에이전트. 각자 쓰는 도구 노드(stations)를 가진다
  focus: null, pinned: false, // HUB 로 보고 있는 세션, 사용자가 고정했는지
  tabs: new Map(), tab: null, // Agent Orbit 앱: 터미널 탭 → 세션, 지금 보고 있는 탭
  links: [],                 // 방금 끝난 실행: HUB(또는 서브에이전트) → 도구 노드로 쏘는 선
  feed: [], feedVer: 0, hubFlash: -9, bursts: [],
  spark: Object.fromEntries(CARDS.map(([k]) => [k, Array(SPARK_N).fill(0)])),
  drawer: null, boot: null, es: null,
  demoTimer: 0, demoSeq: 0, demoLog: [],
  dirty: true, listDirty: true, chipsDirty: true,
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
  if (MINI) { document.body.classList.add('mini'); $('bigger').hidden = false; resize(); }
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
    S.boot = e.boot; S.feed = []; S.feedVer++;
    for (const s of S.sess.values()) s.running.clear();
    loadSummary();
    if (restarted) refreshStatus();
    return;
  }
  if (e.kind === 'start' || e.kind === 'end') return onHook(e);
  if (e.kind === 'tab') { S.tabs.set(e.tab, e.id); if (e.tab === S.tab) focusTab(e.tab); return; }
  onEvent(e);
}

// Agent Orbit 앱이 지금 보고 있는 터미널 탭을 알려준다 → 그 탭의 세션을 HUB 로 고정
function focusTab(tab) {
  S.tab = tab || null;
  const id = S.tab && S.tabs.get(S.tab);
  if (id) {
    const x = S.summary.get(id) || {};
    sess({id, agent: x.agent || 'claude', label: x.label, ts: x.last || epoch()});
    S.focus = id; S.pinned = true;
  }
  else if (S.tab) S.pinned = false;  // 아직 에이전트를 실행하지 않은 탭: 자동 따라가기
  S.chipsDirty = true;
}
window.aoFocusTab = focusTab;

// ── 궤도 모델: 세션 · 도구 노드 · HUB 따라가기 ──
function sess(e) {
  let s = S.sess.get(e.id);
  if (!s) {
    S.sess.set(e.id, s = {id: e.id, agent: e.agent, parent: e.parent || null, label: e.label || e.agent, last: e.ts || 0,
      kind: null, act: '', running: new Map(), stations: new Map(), flash: -9, fail: -9, off: null});
  }
  if (e.label) s.label = e.label;
  if (e.ts) s.last = Math.max(s.last, e.ts);
  return s;
}

function rootOf(s) {  // 서브에이전트의 일은 부모 세션의 궤도에 그린다
  if (!s.parent) return s;
  const p = S.sess.get(s.parent) || sess({id: s.parent, agent: s.agent, label: (S.summary.get(s.parent) || {}).label || s.agent, ts: s.last});
  p.last = Math.max(p.last, s.last);
  return p;
}

function stKey(e) {  // 이벤트가 어느 도구 노드 것인지. 수집기가 붙인 st, 없으면(예전 기록) 짐작
  if (e.st) return e.st;
  if (!TOOL.has(e.kind) && e.kind !== 'start') return null;
  if (e.agent === 'codex') return e.kind === 'edit' ? 'Edit' : e.kind === 'web' ? 'WebSearch' : 'Bash';
  return (e.text || '').split(' ')[0] || null;
}

function station(root, key) {
  let n = root.stations.get(key);
  if (!n) {
    root.stations.set(key, n = {key, label: key.startsWith('mcp:') ? key.slice(4) : key, mcp: key.startsWith('mcp:'),
      count: 0, sub: '', last: 0, kind: null, flash: -9, fail: -9, off: null, order: root.stations.size, live: false, since: 0});
  }
  return n;
}
const argOf = (text, key) => !text || text === key ? '' : text.startsWith(key + ' ') ? text.slice(key.length + 1) : text;

function activity(root) {  // 세션과 그 서브에이전트 중 가장 최근 움직임 (실행 중이면 지금)
  let t = root.last;
  for (const x of S.sess.values()) {
    if (x !== root && x.parent !== root.id) continue;
    if (x.running.size) return epoch();
    t = Math.max(t, x.last);
  }
  return t;
}

function follow(root) {  // 자동 따라가기: 보던 세션이 잠잠할 때만 새로 움직인 세션으로 HUB 를 옮긴다 (번갈아 튀지 않게)
  if (S.pinned || root.id === S.focus) return;
  const cur = S.sess.get(S.focus);
  if (!cur || epoch() - activity(cur) > FOLLOW_QUIET) { S.focus = root.id; S.chipsDirty = true; }
}

function ensureFocus() {
  const cur = S.sess.get(S.focus), t = epoch();
  if (cur && (S.pinned || t - activity(cur) < ORBIT_WINDOW)) return;
  let best = null, bestAt = 0;
  for (const s of S.sess.values()) if (!s.parent) { const a = activity(s); if (a > bestAt) { best = s; bestAt = a; } }
  if (best && t - bestAt < ORBIT_WINDOW && best !== cur) { S.focus = best.id; S.pinned = false; S.chipsDirty = true; }
}

function pickFocus(id) {  // 칩 클릭: 그 세션을 HUB 로 고정. 고정된 칩을 다시 누르면 자동 따라가기
  if (S.focus === id && S.pinned) S.pinned = false;
  else { S.focus = id; S.pinned = true; }
  S.chipsDirty = true;
}

function onHook(e) {  // 훅: 도구 실행 시작/끝 → 선을 붙잡아 두고 점이 흐르게
  const s = sess(e), root = rootOf(s);
  if (e.kind === 'start') {
    const key = stKey(e), k = key && key !== 'Agent' ? key : null;
    s.running.set(e.tool, {text: e.text, t: e.ts, key: k});
    if (k) { const n = station(root, k); n.sub = argOf(e.text, k); n.last = Math.max(n.last, e.ts); }
    if (!e.replay) {
      if (k) { const n = station(root, k); n.flash = now(); burst(n); }
      s.flash = now();
      if (root.id === S.focus) S.hubFlash = now();
      follow(root);
      tape({label: s.label, text: '▶ ' + e.text}, true);
    }
  } else {
    const r = s.running.get(e.tool);
    s.running.delete(e.tool);
    if (!e.ok) { s.fail = now(); if (r && r.key) station(root, r.key).fail = now(); }
  }
  S.chipsDirty = S.dirty = true;
}

function onEvent(e) {
  const live = !e.replay;
  if (e.kind !== 'stat') {
    const s = sess(e), root = rootOf(s), key = stKey(e);
    s.kind = e.kind; s.act = e.text;
    if (e.kind === 'done') s.running.clear();
    if (key && key !== 'Agent') {
      const n = station(root, key);
      n.last = Math.max(n.last, e.ts); n.sub = argOf(e.text, key); n.kind = e.kind;
      if (live) n.count++;
      if (e.kind === 'error') n.fail = now();
      else if (live) { n.flash = now(); burst(n); S.links.push({root: root.id, from: s.id, to: key, t: now()}); }
    }
    if (live) {
      s.flash = now();
      if (root.id === S.focus) S.hubFlash = now();
      follow(root);
    }
    S.feed.unshift(e);
    S.feed.length = Math.min(S.feed.length, 6);
    S.feedVer++;
    tape(e, live);
    S.chipsDirty = true;
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
    if (key === 'today') seedOrbit(r.sessions);
  } catch {
    toast('수집기에서 기록을 불러오지 못했어요');
  }
  S.pending = []; S.summaryReady = true; S.dirty = S.listDirty = S.chipsDirty = true;
  ensureFocus();
}

function seedOrbit(list) {  // 새로고침해도 최근 30분 세션과 그 도구 노드 숫자가 그대로
  const t = epoch(), counts = new Map();
  for (const x of list) {
    if (t - x.last > ORBIT_WINDOW) continue;
    const s = sess({id: x.id, agent: x.agent, parent: x.parent, label: x.label, ts: x.last});
    if (!s.act) { s.kind = x.kind; s.act = x.text; }
    const root = rootOf(s), c = counts.get(root) || {};
    for (const [k, v] of Object.entries(x.st || {})) if (k !== 'Agent') c[k] = (c[k] || 0) + v;
    counts.set(root, c);
  }
  for (const [root, c] of counts) for (const [k, v] of Object.entries(c)) station(root, k).count = v;
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

const activeCount = () => { let a = 0; const t = epoch(); for (const s of S.sess.values()) if (t - s.last < IDLE || s.running.size) a++; return a; };

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

let feedDrawn = {ver: -1, mode: null, top: null};
function renderPanels() {
  const t = totals(), act = activeCount();
  const v = {claude: t.claude.toLocaleString(), codex: t.codex.toLocaleString(), active: `${act}/${S.summary.size}`,
    tokens: fmtK(t.tokens), turns: t.turns.toLocaleString(), errors: t.errors.toLocaleString()};
  for (const k in v) $(`v-${k}`).textContent = v[k];
  $('judged').textContent = `${t.tools.toLocaleString()} tool calls`;
  const sum = t.read + t.edit + t.run + t.other || 1;
  for (const [k] of BARS) { const pc = Math.round(t[k] / sum * 100); $(`p-${k}`).textContent = pc + '%'; $(`f-${k}`).style.width = pc + '%'; }
  if (S.feedVer === feedDrawn.ver && S.mode === feedDrawn.mode) return;  // 목록이 바뀔 때만 다시 그림 (깜빡임 방지)
  const feed = $('feed');
  feed.replaceChildren(...S.feed.map((e, i) => h('li', {class: i === 0 && e !== feedDrawn.top && !e.replay ? 'new' : null, style: `--c:${(KIND[e.kind] || KIND.tool).c}`},
    h('span', {class: 'dot'}), h('b', {}, e.kind), h('p', {}, `${e.label} · ${e.text}`))));
  if (!S.feed.length) feed.append(h('li', {class: 'empty'}, S.mode === 'live' ? '에이전트가 일하면 여기에 바로 나타나요' : '…'));
  feedDrawn = {ver: S.feedVer, mode: S.mode, top: S.feed[0]};
}

function renderChips() {  // 지금 움직이는 세션들: 누르면 그 세션이 HUB 가 된다
  const t = epoch();
  const roots = [...S.sess.values()].filter(s => !s.parent && (t - activity(s) < ORBIT_WINDOW || s.id === S.focus))
    .sort((a, b) => activity(b) - activity(a)).slice(0, MINI ? 4 : 7);
  const box = $('chips');
  if (roots.length < 2 && !S.pinned) return box.replaceChildren();  // 세션이 하나뿐이면 고를 필요가 없다
  box.replaceChildren(...roots.map(s => {
    const a = AGENTS[s.agent] || AGENTS.claude, on = s.id === S.focus;
    const busy = [...S.sess.values()].some(x => (x === s || x.parent === s.id) && x.running.size);
    return h('button', {class: on ? 'chip-btn on' : 'chip-btn', type: 'button', 'aria-pressed': String(on), onclick: () => pickFocus(s.id),
      title: on && S.pinned ? '고정됨 — 다시 누르면 자동으로 따라가요' : `${s.label}를 HUB로 보기`},
      h('span', {class: 'mark', style: `--c:${a.c}`}, a.mark), clip(s.label, 18), busy ? h('i', {class: 'spin'}) : null, on && S.pinned ? h('b', {}, '고정') : null);
  }));
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
  box.hidden = MINI || !(S.onboard || (live && !connectedAny()));
  if (box.hidden) return box.replaceChildren();
  const st = S.onboard;
  const step = (n, title, state, ...body) => h('div', {class: `step ${state}`}, h('h3', {}, h('b', {}, state === 'done' ? '✓' : n), title), ...body);
  const check = h('button', {class: 'btn primary', type: 'button', onclick: checkCollector, disabled: S.checking},
    S.checking ? '확인 중…' : st === 'install' ? '설치했어요 · 연결하기' : '다시 확인');
  const s2 = st === 'safari' ? [h('p', {}, 'Safari는 보안 정책상 배포된 사이트에서 내 컴퓨터의 수집기에 접속할 수 없어요. 설치한 뒤 로컬 주소로 열면 같은 화면을 쓸 수 있어요.'),
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
    step(1, '수집기 설치', st === 'install' || st === 'safari' ? 'active' : '',
      h('p', {}, '터미널에 붙여넣으세요. macOS · Linux, Python 3.9 이상.'), cmdBox(),
      h('p', {class: 'note'}, '에이전트 기록은 이 컴퓨터 밖으로 나가지 않아요. 바뀌는 파일은 아래 "개인정보와 설치 내용"에 있어요.')),
    step(2, '이 브라우저와 연결', st && st !== 'install' && st !== 'safari' ? 'active' : '', ...s2),
    step(3, '에이전트 연결', '', h('p', {}, '연결되면 여기서 Claude Code · Codex를 한 번에 연결할 수 있어요.')));
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
  const toggle = (label, on, flip) => {
    const sw = h('button', {class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on)}, h('i'), label);
    sw.onclick = async () => { try { await flip(); renderFooter(); } catch { toast('설정을 바꾸지 못했어요'); } };
    return sw;
  };
  if (st && st.autoMini != null) {
    kids.push(toggle('세션 시작 시 미니 창', st.autoMini, async () => {
      st.autoMini = (await postJSON('/api/settings', {autoMini: !st.autoMini})).autoMini;
      toast(st.autoMini ? 'Claude · Codex 세션이 시작되면 미니 창이 떠요' : '세션이 시작돼도 미니 창을 띄우지 않아요. 터미널에서 agent-orbit mini 로 열 수 있어요');
    }));
  }
  if (st && st.autostart != null) {
    kids.push(toggle('로그인할 때 자동 실행', st.autostart, async () => {
      st.autostart = (await postJSON('/api/autostart', {enabled: !st.autostart})).autostart;
      toast(st.autostart ? '로그인할 때 자동으로 켜져요' : '자동 실행을 껐어요. 지금 실행 중인 수집기는 그대로예요');
    }));
  }
  if (S.mode === 'live') kids.push(h('span', {}, '미니 창: agent-orbit mini'));
  if (!LOCAL && S.mode === 'live') kids.push(h('a', {href: LOCAL_URL}, '로컬 주소로 열기'));
  if (FEEDBACK_URL) kids.push(h('a', {href: FEEDBACK_URL, target: '_blank', rel: 'noopener'}, '피드백'));
  kids.push(h('a', {href: '#privacy', onclick: () => { $('privacy').open = true; }}, '개인정보'));
  $('footer').replaceChildren(...kids);
}

function renderAll() {
  setMode(); renderBanners(); renderOnboard(); renderAgents(); renderFooter();
  S.dirty = S.listDirty = S.chipsDirty = true;
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
    {id: 'demo-api', agent: 'claude', label: 'api-server', w: 6},
    {id: 'demo-sub', agent: 'claude', label: 'Explore', parent: 'demo-api', w: 3},
    {id: 'demo-sub2', agent: 'claude', label: 'general-purpose', parent: 'demo-api', w: 1},
    {id: 'demo-web', agent: 'claude', label: 'web-frontend', w: 1},
    {id: 'demo-bill', agent: 'codex', label: 'billing', w: 1},
  ],
  acts: {
    claude: [['read', 'Read src/routes.ts'], ['edit', 'Edit auth.ts'], ['run', 'Bash npm test -- auth'], ['read', 'Grep useSession'],
      ['read', 'Glob src/**/*.ts'], ['web', 'WebSearch zod discriminated union'], ['web', 'WebFetch nextjs.org/docs'],
      ['say', '인증 흐름을 정리했어요. 테스트를 돌려볼게요'], ['tool', 'TodoWrite'], ['tool', 'get_tasks', 'mcp:asana'], ['edit', 'Write api/session.ts']],
    codex: [['run', 'pytest -q'], ['read', 'rg invoice'], ['edit', 'invoice.py'], ['say', '테스트 통과, 다음은 마이그레이션'], ['run', 'terraform plan']],
  },
};
const demoPick = () => { let r = Math.random() * DEMO.sessions.reduce((a, s) => a + s.w, 0); for (const s of DEMO.sessions) if ((r -= s.w) < 0) return s; return DEMO.sessions[0]; };

function demoEvent(sess0, kind, text, ts = epoch(), st) {
  const key = st || (TOOL.has(kind) ? (sess0.agent === 'codex' ? (kind === 'edit' ? 'Edit' : 'Bash') : text.split(' ')[0]) : null);
  return {id: sess0.id, agent: sess0.agent, parent: sess0.parent || null, label: sess0.label, kind, text, ts, st: key,
    dtok: kind === 'say' || kind === 'done' ? 0 : 40 + (Math.random() * 600 | 0), seq: ++S.demoSeq};
}

function startDemo() {
  S.mode = 'demo';
  S.demoLog = [];
  const t0 = epoch() - 3 * 3600;  // 오늘 몇 시간치 기록이 있는 것처럼
  for (let i = 0; i < 180; i++) {
    const s = demoPick(), [k, t, st] = pick(DEMO.acts[s.agent]);
    S.demoLog.push(demoEvent(s, i % 19 === 0 ? 'done' : i % 41 === 0 ? 'error' : k, i % 41 === 0 ? 'exit 1 · npm test' : t, t0 + i * 55, st));
  }
  for (const e of S.demoLog) if (e.st) station(rootOf(sess(e)), e.st).count++;  // 노드 숫자도 오늘치가 쌓인 것처럼
  renderAll(); loadSummary(); demoTick();
}

function demoTick() {
  if (S.mode !== 'demo') return;
  const s = demoPick(), r = Math.random();
  const [kind, text, st] = r < .04 ? ['error', 'exit 1 · npm test', 'Bash'] : r < .1 ? ['done', 'turn complete'] : pick(DEMO.acts[s.agent]);
  const base = {id: s.id, agent: s.agent, parent: s.parent || null, label: s.label};
  if (TOOL.has(kind) && (kind === 'run' || Math.random() < .75)) {  // 실제 훅처럼 "실행 중"을 먼저 보여준다 → 선이 여러 개 겹친다
    const ev = demoEvent(s, kind, text, epoch(), st), tool = `demo-${ev.seq}`;
    onMessage({...base, kind: 'start', tool, text, st: ev.st, ts: epoch()});
    setTimeout(() => {
      if (S.mode !== 'demo') return;
      onMessage({...base, kind: 'end', tool, ok: true, text, st: ev.st, ts: epoch()});
      demoEmit({...ev, ts: epoch()});
    }, 1200 + Math.random() * 3600);
  } else demoEmit(demoEvent(s, kind, text, epoch(), st));
  S.demoTimer = setTimeout(demoTick, 180 + Math.random() * 380);
}

function demoEmit(e) {
  S.demoLog.push(e);
  if (S.demoLog.length > 600) S.demoLog.shift();
  onEvent(e);
}

function stopDemo() {
  clearTimeout(S.demoTimer);
  S.sess.clear(); S.summary.clear(); S.links = []; S.focus = null; S.pinned = false;
  S.feed = []; S.feedVer++; S.demoLog = [];
  for (const k in S.spark) S.spark[k].fill(0);
  $('tape').textContent = 'waiting for agents';
}

function loadAnalytics() {  // 배포 사이트에서만: 쿠키 없는 페이지 조회 수 (에이전트 데이터는 수집하지 않음)
  document.head.append(h('script', {src: '/_vercel/insights/script.js', defer: true}));
}

// ── 2초마다: 스파크라인 · HUB 확인 · 날짜 바뀜 · 상대 시간 ──
function tick() {
  const t = epoch();
  for (const s of S.sess.values()) for (const [id, r] of s.running) if (t - r.t > 1800) s.running.delete(id);  // 끝 신호 유실 대비
  ensureFocus();
  S.spark.active[SPARK_N - 1] = activeCount();
  for (const k in S.spark) {
    const a = S.spark[k], max = Math.max(...a) || 1;
    const pl = $(`sp-${k}`);
    if (pl) pl.setAttribute('points', a.map((x, i) => `${(i / (SPARK_N - 1) * 56).toFixed(1)},${(14 - x / max * 12).toFixed(1)}`).join(' '));
    a.push(0); a.shift();
  }
  if (dayStart(0) !== S.day) { S.day = dayStart(0); loadSummary(); }  // 자정이 지나면 "오늘"을 새로
  S.dirty = S.listDirty = S.chipsDirty = true;
}

// ── 궤도 캔버스 ──
const cv = $('orbit'), ctx = cv.getContext('2d');
const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono');
const SANS = getComputedStyle(document.documentElement).getPropertyValue('--sans');
const PAL = ['#3b9eff', '#3b9eff', '#5cc2ff', '#22c3ee', '#a78bfa', '#ffffff'];
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const parts = Array.from({length: 72}, () => ({a: Math.random() * 6.283, sp: (Math.random() * .12 + .03) * (Math.random() < .2 ? -1 : 1), j: (Math.random() - .5) * 14, r: Math.random() * 1.6 + .8, c: pick(PAL)}));
let W = 0, H = 0, Z = 1, stars = [], rot = 0, lastFrame = now(), working = false, lastList = 0, lastChips = 0;

function resize() {
  const dpr = devicePixelRatio || 1;
  W = cv.clientWidth; Z = Math.max(.62, Math.min(1, W / 760));
  if (MINI) {  // 미니 창: 다른 요소를 뺀 나머지 높이를 궤도가 채운다
    const rest = document.querySelector('.top').offsetHeight + document.querySelector('main').offsetHeight - cv.offsetHeight;
    H = Math.max(200, Math.round(innerHeight - rest));
  } else H = Math.round(W < 600 ? W * 1.1 : Math.max(340, Math.min(540, W * .56)));
  cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stars = Array.from({length: 90}, () => [Math.random() * W, Math.random() * H, Math.random() * .35 + .05]);
}
addEventListener('resize', resize);

const geo = () => ({cx: W / 2, cy: H * .52, rx: W * .41, ry: H * .37});
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

function place(list, k, dt, g) {  // 궤도 위에 균등 배치, 노드가 늘거나 줄면 부드럽게 재배치
  list.forEach((n, i) => {
    const target = i / list.length * 6.283;
    if (n.off === null) n.off = target;
    n.off += (target - n.off) * Math.min(1, dt * 3);
    n.a = rot * (k < 1 ? -1.4 : 1) + n.off;
    n.x = g.cx + g.rx * k * Math.cos(n.a); n.y = g.cy + g.ry * k * Math.sin(n.a); n.depth = (Math.sin(n.a) + 1) / 2;
  });
}

function burst(n) {
  const c = (KIND[n.kind] || KIND.tool).c;
  for (let i = 0; i < 7; i++) S.bursts.push({a: n.a ?? Math.random() * 6.283, sp: (Math.random() * .9 + .3) * (i % 2 ? 1 : -1), j: (Math.random() - .5) * 10, c, k: 1, t: now()});
}

function drawHub(g, t, focus, toolCount) {
  const thinking = focus && !working && epoch() - focus.last < 60 && focus.kind !== 'done';  // 도구 사이: 모델이 다음 행동을 생각하는 중
  const f = Math.max(0, 1 - (t - S.hubFlash) / .8, working ? (Math.sin(t * 5) + 1) * .3 : 0, thinking ? (Math.sin(t * 2.4) + 1) * .22 : 0);
  const label = focus ? clip(focus.label || focus.agent, 16) : 'HUB';
  ctx.save(); ctx.translate(g.cx, g.cy); ctx.scale(Z, Z);
  ctx.font = `700 ${focus ? 21 : 30}px ${SANS}`;
  const bw = Math.max(108, ctx.measureText(label).width + 40), bh = 96, rx = bw / 2 + 10, ry = bh / 2 + 10;
  ctx.strokeStyle = 'rgba(59,158,255,.55)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * 6.283 + .2, len = 8 + (i % 3) * 6 + f * 10, c = Math.cos(a), s = Math.sin(a);
    line(c * rx, s * ry, c * (rx + len), s * (ry + len));
    circle(c * (rx + len), s * (ry + len), 2.2, '#3b9eff');
  }
  ctx.shadowColor = '#3b9eff'; ctx.shadowBlur = 22 + f * 24;
  rrect(-bw / 2, -bh / 2, bw, bh, 12, '#071428', '#3b9eff', 2.5);
  ctx.shadowBlur = 0;
  rrect(-bw / 2 + 7, -bh / 2 + 7, bw - 14, bh - 14, 8, null, 'rgba(59,158,255,.35)', 1);
  ctx.textAlign = 'center';
  if (focus) {
    const a = AGENTS[focus.agent] || AGENTS.claude;
    ctx.fillStyle = a.c; ctx.font = `600 10px ${MONO}`; ctx.fillText(a.name.toUpperCase(), 0, -20);
  }
  ctx.fillStyle = '#fff'; ctx.font = `700 ${focus ? 21 : 30}px ${SANS}`; ctx.fillText(label, 0, focus ? 6 : 6);
  ctx.fillStyle = '#9db6d8'; ctx.font = `11px ${MONO}`;
  ctx.fillText(thinking ? 'thinking…' : '#' + String(toolCount).padStart(4, '0'), 0, 28);
  ctx.restore();
}

function drawCard(n, t, title, sub, o) {  // 노드 카드: 도구 노드와 서브에이전트 노드 공통
  const s = Z * (.86 + .14 * n.depth), hot = o.live || t - n.flash < 2.5, failed = t - n.fail < 1.5;
  ctx.save(); ctx.globalAlpha = (o.idle && !o.live ? .45 : 1) * (.7 + .3 * n.depth);
  title = clip(title, Math.round(22 * Z)); sub = clip(sub, Math.round(30 * Z));
  ctx.font = `600 ${14 * s}px ${SANS}`; const w1 = ctx.measureText(title).width;
  ctx.font = `${11 * s}px ${MONO}`; const w2 = ctx.measureText(sub).width;
  const bw = Math.max(w1, w2) + 24 * s, bh = 44 * s;
  const bx = Math.min(Math.max(n.x - bw / 2, 4), W - bw - 34), by = n.y - bh / 2;
  n.bx = bx; n.bw = bw;
  const edge = failed ? '#ff6b81' : o.color || '#3b9eff';
  if (hot || failed) { ctx.shadowColor = edge; ctx.shadowBlur = o.live ? 12 + 12 * (Math.sin(t * 6) + 1) / 2 : 18; }
  rrect(bx, by, bw, bh, 6, hot ? 'rgba(10,42,84,.95)' : 'rgba(9,18,34,.92)', hot || failed ? edge : o.idleEdge || 'rgba(255,255,255,.14)', hot ? 1.6 : 1);
  ctx.shadowBlur = 0; ctx.textAlign = 'center';
  ctx.fillStyle = '#e7f0ff'; ctx.font = `600 ${14 * s}px ${SANS}`; ctx.fillText(title, bx + bw / 2, by + 19 * s);
  ctx.fillStyle = o.live ? '#a9d6ff' : '#8aa0c2'; ctx.font = `${11 * s}px ${MONO}`; ctx.fillText(sub, bx + bw / 2, by + 35 * s);
  if (o.live || o.code) {  // 배지: 실행 중엔 스피너, 아니면 마지막 동작 (영상의 SCO / CHO / NOU 박스)
    const x = bx + bw + 6, y = by - 6, c = o.live ? '#3b9eff' : o.codeColor;
    rrect(x, y, 24, 14, 2, 'rgba(5,10,20,.9)', c, 1);
    ctx.fillStyle = c; ctx.font = `600 ${o.live ? 10 : 8}px ${MONO}`; ctx.fillText(o.live ? SPIN[Math.floor(t * 12) % 10] : o.code, x + 12, y + 10);
  }
  ctx.restore();
}

function frame() {
  const t = now(), dt = Math.min(.1, t - lastFrame), nowS = epoch(), g = geo();
  lastFrame = t;
  if (!CALM) rot += dt * .03;
  const focus = S.sess.get(S.focus) || null;

  // HUB 의 노드: 최근에 쓴 도구(바깥 궤도, 처음 쓰인 순서로 자리 고정) + 일하는 서브에이전트(안쪽 궤도)
  let stations = [], subs = [];
  const runs = [];  // 실행 중: [보내는 쪽 세션, 실행 정보]
  if (focus) {
    for (const x of S.sess.values()) if (x === focus || x.parent === focus.id) for (const r of x.running.values()) runs.push([x, r]);
    stations = [...focus.stations.values()].sort((a, b) => b.last - a.last).slice(0, MAX_STATIONS).sort((a, b) => a.order - b.order);
    for (const n of stations) { n.live = false; n.since = 0; }
    const byKey = new Map(stations.map(n => [n.key, n]));
    for (const [, r] of runs) { const n = r.key && byKey.get(r.key); if (n) { n.live = true; n.since = n.since ? Math.min(n.since, r.t) : r.t; n.arg = argOf(r.text, n.key); } }
    subs = [...S.sess.values()].filter(x => x.parent === focus.id && (nowS - x.last < ORBIT_WINDOW || x.running.size)).slice(-MAX_SUBS);
  }
  place(stations, 1, dt, g);
  place(subs, .62, dt, g);
  const byKey = new Map(stations.map(n => [n.key, n])), subSet = new Set(subs);
  const from = x => (x && subSet.has(x) ? x : {x: g.cx, y: g.cy});

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

  // 선: HUB(또는 서브에이전트) → 도구 노드. 방금 끝난 실행은 빛나다 사라지고, 실행 중이면 선이 남아 점이 흐른다
  S.links = S.links.filter(l => t - l.t < 2.5);
  ctx.lineWidth = 1.5;
  for (const sub of subs) {  // HUB ↔ 서브에이전트
    const age = t - sub.flash;
    if (!sub.running.size && age > 2.5) continue;
    ctx.strokeStyle = `rgba(167,139,250,${sub.running.size ? .7 : (1 - age / 2.5) * .8})`;
    line(g.cx, g.cy, sub.x, sub.y);
  }
  for (const l of S.links) {
    const to = focus && l.root === focus.id && byKey.get(l.to);
    if (!to) continue;
    const a = from(S.sess.get(l.from)), age = t - l.t;
    ctx.strokeStyle = `rgba(59,158,255,${(1 - age / 2.5) * .9})`;
    line(a.x, a.y, to.x, to.y);
    if (age < .7) circle(a.x + (to.x - a.x) * age / .7, a.y + (to.y - a.y) * age / .7, 3, '#d6ebff');
  }
  working = false;
  for (const [x, r] of runs) {
    const to = r.key && byKey.get(r.key);
    if (!to) continue;
    working = true;
    const a = from(x);
    ctx.strokeStyle = 'rgba(59,158,255,.85)';
    line(a.x, a.y, to.x, to.y);
    for (let i = 0; i < 3; i++) { const q = (t * .9 + i / 3) % 1; circle(a.x + (to.x - a.x) * q, a.y + (to.y - a.y) * q, 3, '#d6ebff'); }
  }

  let tools = 0;
  if (focus) for (const n of focus.stations.values()) tools += n.count;
  drawHub(g, t, focus, tools);
  const cards = [...stations.map(n => ['st', n]), ...subs.map(x => ['sub', x])].sort((a, b) => a[1].y - b[1].y);
  for (const [type, n] of cards) {
    if (type === 'st') {
      const k = KIND[n.kind] || KIND.tool;
      drawCard(n, t, (n.mcp ? 'MCP · ' : '') + n.label,
        n.live ? `▶ ${Math.max(0, Math.floor(nowS - n.since))}s ${n.arg || ''}` : [n.count ? `×${n.count}` : '', n.sub].filter(Boolean).join(' · ') || 'idle',
        {live: n.live, idle: nowS - n.last > IDLE, code: n.kind ? k.code : null, codeColor: k.c, idleEdge: focus.agent === 'codex' ? 'rgba(139,156,255,.45)' : null});
    } else {
      const job = n.running.size && [...n.running.values()].pop();
      drawCard(n, t, '↳ ' + n.label, job ? `▶ ${job.text}` : n.act || 'idle',
        {live: !!job, idle: nowS - n.last > IDLE, color: '#a78bfa', idleEdge: 'rgba(167,139,250,.4)', code: 'SUB', codeColor: '#a78bfa'});
    }
  }
  if (!focus && S.mode === 'live') {
    ctx.fillStyle = '#8aa0c2'; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText(connectedAny() ? '최근 30분 동안 움직인 에이전트가 없어요' : '에이전트를 연결하면 여기에 나타나요', g.cx, g.cy + g.ry * .62 + 30);
  } else if (focus && !stations.length && !subs.length) {
    ctx.fillStyle = '#8aa0c2'; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText('도구를 실행하면 여기에 노드가 생겨요', g.cx, g.cy + g.ry * .62 + 30);
  }
  if (S.dirty) {
    S.dirty = false; renderPanels();
    if (MINI && Math.abs(document.querySelector('.top').offsetHeight + document.querySelector('main').offsetHeight - innerHeight) > 2) resize();  // 미니 창은 스크롤 없이 꽉 차게
  }
  if (S.listDirty && t - lastList > .5) { S.listDirty = false; lastList = t; renderSessions(); }
  if (S.chipsDirty && t - lastChips > .3) { S.chipsDirty = false; lastChips = t; renderChips(); }
  requestAnimationFrame(frame);
}

resize();
boot();
tick(); setInterval(tick, 2000);
requestAnimationFrame(frame);
