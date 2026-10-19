'use strict';
/* Epeira 대시보드 → 데이터는 이 브라우저와 내 컴퓨터의 수집기(127.0.0.1) 사이에서만 오간다.
   궤도: 가운데 HUB = 지금 보고 있는 세션, 바깥 노드 = 그 세션이 쓰는 도구(Bash, Read, Edit…), 안쪽 노드 = 서브에이전트 */

// ── 설정 ──
const LATEST = '1.4.104';          // 이 화면이 기대하는 수집기 버전. 더 낮으면 업데이트 배너
const MIN_PROTOCOL = 2;
const PORT = 47777;
const SITE = 'https://epeira.vercel.app';
const INSTALL_CMD = `curl -fsSL ${SITE}/install.sh | sh`;
const FEEDBACK_URL = '';         // 피드백 폼 주소. 비어 있으면 링크를 숨긴다
const params = new URLSearchParams(location.search);
const LOCAL = ['127.0.0.1', 'localhost'].includes(location.hostname);
const API = LOCAL ? '' : /^http:\/\/127\.0\.0\.1:\d+$/.test(params.get('api') || '') ? params.get('api') : `http://127.0.0.1:${PORT}`;
const LOCAL_URL = `http://127.0.0.1:${PORT}`;
const SAFARI = !LOCAL && /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent);
const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MINI = params.get('view') === 'mini';  // 작은 레이아웃 (Epeira 앱의 궤도 패널)
const EMBED = !!params.get('embed');          // 앱의 궤도 패널: 요약·상태바는 앱이 그린다
const IDLE = 120, ORBIT_WINDOW = 1800, SPARK_N = 30;
const FOLLOW_QUIET = 8;           // 보던 세션이 이만큼(초) 조용해야 다른 세션으로 HUB 를 옮긴다
const WORK_WINDOW = 600;          // 응답 끝 신호가 없어도 이만큼(초) 조용하면 쉬는 중으로 본다 (끝 신호 유실 대비)
const MAX_SUBS = 4;

// 종류 색: 에이전트 색(Claude #3b9eff · Codex #8b9cff)은 에이전트 표시에만 쓰고, 종류끼리는 색상(hue)으로 구분 (ΔE ≥ 20)
const KIND = {
  read: {c: '#7dd3fc', code: 'RD'}, edit: {c: '#fbbf24', code: 'EDT'}, run: {c: '#2dd4bf', code: 'RUN'},
  web: {c: '#fb923c', code: 'WEB'}, sub: {c: '#c084fc', code: 'SUB'}, tool: {c: '#94a3b8', code: 'TL'},
  say: {c: '#34d399', code: 'SAY'}, you: {c: '#ededed', code: 'YOU'}, done: {c: '#34d399', code: 'END'},
  error: {c: '#ff6b81', code: 'ERR'}, stat: {c: '#94a3b8', code: '··'},
};
const TOOL = new Set(['read', 'edit', 'run', 'web', 'sub', 'tool']);
const bucket = k => ['read', 'edit', 'run'].includes(k) ? k : 'other';
const AGENTS = {
  claude: {name: 'Claude Code', c: '#D97757', file: '~/.claude/settings.json'},
  codex: {name: 'Codex', c: '#8b9cff', file: '~/.codex/hooks.json'},
};
// 에이전트 마크 (24×24). Claude 는 simple-icons(CC0)의 Claude 로고.
// Codex 는 OpenAI 로고가 공개 아이콘 모음에서 빠져 있어 중립 마크(터미널 프롬프트) → 공식 로고 파일을 받으면 이 경로만 바꾸면 된다
const LOGO = {
  claude: {d: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'},
  codex: {d: 'm297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z', vb: 320, fill: '#fff'},  // OpenAI 로고 (공식 저장소 openai-cookbook 의 logomark). 색을 바꾸지 않고 흰색으로만
};
function agentIcon(key) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path'), L = LOGO[key] || LOGO.codex;
  svg.setAttribute('viewBox', `0 0 ${L.vb || 24} ${L.vb || 24}`); svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', L.d);
  path.setAttribute('fill', L.fill || 'currentColor');
  svg.append(path);
  return svg;
}
const mark = key => h('span', {class: 'mark', style: `--c:${(AGENTS[key] || AGENTS.claude).c}`, title: (AGENTS[key] || AGENTS.claude).name}, agentIcon(key));
const SOON = ['Gemini CLI', 'GitHub Copilot CLI', 'Cursor CLI'];
const CARDS = [
  ['claude', 'CLAUDE', '#D97757', 'tool calls'],
  ['codex', 'CODEX', '#8b9cff', 'tool calls'],
  ['active', 'ACTIVE', '#7dd3fc', 'sessions · 2 min'],
  ['tokens', 'TOKENS', '#34d399', 'output tokens'],
  ['turns', 'TURNS', '#a3e635', 'completed turns'],
  ['errors', 'ERRORS', '#ff6b81', 'failed · interrupted'],
];
const BARS = [
  ['read', 'read · search', '#7dd3fc,#7dd3fc'],
  ['edit', 'edit · write', '#fbbf24,#fbbf24'],
  ['run', 'run · exec', '#2dd4bf,#2dd4bf'],
  ['other', 'web · agents · tools', '#fb923c,#c084fc'],
];
const dayStart = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d.getTime() / 1000; };
const RANGES = {
  today: {label: '오늘', bounds: () => [dayStart(0), null]},
  yesterday: {label: '어제', bounds: () => [dayStart(1), dayStart(0)]},
  '7d': {label: '최근 7일', bounds: () => [dayStart(6), null]},
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
  tabs: new Map(), tab: null, // Epeira 앱: 터미널 탭 → 세션, 지금 보고 있는 탭
  project: null, projectPath: '', views: new Map(), // Epeira 앱: 지금 프로젝트의 세션만 궤도에. HUB 선택은 프로젝트마다 따로 기억
  names: new Map(),          // 사용자가 직접 붙인 세션 이름 (수집기에 저장)
  hubRect: null,             // 캔버스 위 HUB 위치 (더블클릭으로 이름 바꾸기)
  links: [],                 // 방금 끝난 실행: HUB(또는 서브에이전트) → 도구 노드로 쏘는 선
  feed: [], feedVer: 0, hubFlash: -9, bursts: [],
  flows: [],                 // HUB 에서 바깥 궤도로 흘러나가는 입자: 쓴 토큰만큼
  spark: Object.fromEntries(CARDS.map(([k]) => [k, Array(SPARK_N).fill(0)])),
  drawer: null, boot: null, es: null, drawn: [],
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
const nameOf = (id, fallback) => S.names.get(id) || fallback;  // 바꾼 이름이 있으면 그 이름
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
  if (MINI) { document.body.classList.add('mini'); resize(); }
  if (EMBED) { document.body.classList.add('embed'); resize(); }  // 앱의 궤도 패널: 헤더·요약·상태바는 앱이 그린다
  $('refresh').onclick = refreshAll;
  $('refresh').append(refreshIcon());
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
    S.names = new Map(Object.entries(e.names || {}));
    for (const s of S.sess.values()) s.running.clear();
    loadSummary();
    if (restarted) refreshStatus();
    return;
  }
  if (e.kind === 'start' || e.kind === 'end') return onHook(e);
  if (e.kind === 'tab') { S.tabs.set(e.tab, e.id); if (e.tab === S.tab) focusTab(e.tab); return; }
  if (e.kind === 'name') { setName(e.id, e.name); return; }
  onEvent(e);
}

// Epeira 앱이 지금 보고 있는 터미널 탭을 알려준다 → 그 탭의 세션을 HUB 로 고정
function focusTab(tab) {
  S.tab = tab || null;
  const id = S.tab && S.tabs.get(S.tab);
  if (id) {
    const x = S.summary.get(id) || {};
    sess({id, agent: x.agent || 'claude', label: x.label, cwd: x.cwd, ts: x.last || epoch()});
    S.focus = id; S.pinned = true;
  }
  else if (S.tab) S.pinned = false;  // 아직 에이전트를 실행하지 않은 탭: 자동 따라가기
  S.chipsDirty = true;
}
window.aoFocusTab = focusTab;

// 프로젝트마다 독립된 궤도: 그 폴더(하위 폴더 포함)에서 시작한 세션 + 그 프로젝트 탭의 세션만 HUB · 칩 · 피드에
// 시작 폴더 경로를 모르는 예전 기록은 폴더 이름으로 가른다
const inPath = (cwd, dir) => cwd === dir || cwd.startsWith(dir.endsWith('/') ? dir : dir + '/');
// 앱의 궤도 패널(EMBED)은 고른 프로젝트가 없으면 아무것도 보이지 않는다 (프로젝트를 빼거나 닫으면 궤도도 사라지게)
const inProject = s => (S.project ? !!s && (S.tabs.get(S.tab) === s.id || (s.cwd && S.projectPath ? inPath(s.cwd, S.projectPath) : s.label === S.project)) : !EMBED);

// Epeira 앱에서 탭(터미널)을 닫은 세션은 궤도에서 뺀다. 닫은 뒤에 다시 움직이면(다른 곳에서 이어 열면) 돌아온다
const forgot = (() => { try { return new Map(Object.entries(JSON.parse(store.get('forgot') || '{}'))); } catch { return new Map(); } })();
const forgotten = (id, ts) => forgot.has(id) && (ts || 0) <= forgot.get(id);
function forget(id) {
  const t = epoch();
  forgot.set(id, t);
  for (const [k, at] of forgot) if (t - at > ORBIT_WINDOW) forgot.delete(k);  // 30분 지나면 어차피 궤도에서 빠진다
  store.set('forgot', JSON.stringify(Object.fromEntries(forgot)));
  for (const [k, s] of S.sess) if (k === id || s.parent === id) S.sess.delete(k);
  if (S.focus === id) { S.focus = null; S.pinned = false; }
  S.feedVer++; S.dirty = S.chipsDirty = true;
  ensureFocus();
}
window.aoForget = forget;
function focusProject(name, tab, path) {  // 탭도 함께 받는다: 이전 프로젝트의 탭 세션이 새 궤도에 끼지 않게
  name = name || null;
  S.projectPath = path || '';
  if (name !== S.project) {
    S.views.set(S.project, {focus: S.focus, pinned: S.pinned});
    ({focus: S.focus, pinned: S.pinned} = S.views.get(name) || {focus: null, pinned: false});
    S.project = name; S.feedVer++; S.dirty = true;
  }
  focusTab(tab);
  ensureFocus();
}
window.aoFocusProject = focusProject;

// ── 궤도 모델: 세션 · 도구 노드 · HUB 따라가기 ──
function sess(e) {
  let s = S.sess.get(e.id);
  if (!s) {
    S.sess.set(e.id, s = {id: e.id, agent: e.agent, parent: e.parent || null, label: e.label || e.agent, last: e.ts || 0,
      kind: null, act: '', running: new Map(), stations: new Map(), flash: -9, fail: -9, off: null});
  }
  if (e.label) s.label = e.label;
  if (e.cwd && !s.cwd) s.cwd = e.cwd;
  if (e.ts) s.last = Math.max(s.last, e.ts);
  return s;
}

function rootOf(s) {  // 서브에이전트의 일은 부모 세션의 궤도에 그린다
  if (!s.parent) return s;
  const x = S.summary.get(s.parent) || {};
  const p = S.sess.get(s.parent) || sess({id: s.parent, agent: s.agent, label: x.label || s.agent, cwd: x.cwd, ts: s.last});
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
      count: 0, sub: '', last: 0, kind: null, flash: -9, fail: -9, hold: 0, off: null, order: root.stations.size, live: false, since: 0});
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

/** HUB 의 상태. work: 질문을 받고 응답을 마칠 때까지(도구 사이 · 생각 중 포함) · wait: 응답 중에 승인 · 입력을 기다림 · idle */
function phaseOf(root) {
  if (!root) return 'idle';
  if (root.wait) return 'wait';
  for (const x of S.sess.values()) if ((x === root || x.parent === root.id) && x.running.size) return 'work';
  const ended = root.kind === 'done' || (root.kind === 'error' && /interrupt|abort/i.test(root.act || ''));
  return root.kind && !ended && epoch() - activity(root) < WORK_WINDOW ? 'work' : 'idle';
}

function flow(e, root) {  // 쓴 토큰(출력 + 입력의 1/4)만큼 HUB 에서 입자를 내보낸다 → 방금 쓴 도구 노드로 (도구를 안 썼으면 바깥 궤도로). 한 번에 12개까지
  const n = Math.min(12, Math.round(((e.dtok || 0) + (e.din || 0) / 4) / 80));
  let to = null;
  for (const x of root.stations.values()) if (!to || x.last > to.last) to = x;
  for (let i = 0; i < n; i++) S.flows.push({t: now() + i * .06, to: to && to.key, a: Math.random() * 6.283, sp: (Math.random() - .5) * .8, c: pick(PAL)});
}

function follow(root) {  // 자동 따라가기: 보던 세션이 잠잠할 때만 새로 움직인 세션으로 HUB 를 옮긴다 (번갈아 튀지 않게)
  if (S.pinned || root.id === S.focus || !inProject(root)) return;
  const cur = S.sess.get(S.focus);
  if (!cur || epoch() - activity(cur) > FOLLOW_QUIET) { S.focus = root.id; S.chipsDirty = true; }
}

function ensureFocus() {
  const cur = S.sess.get(S.focus), t = epoch();
  if (cur && inProject(cur) && (S.pinned || t - activity(cur) < ORBIT_WINDOW)) return;
  let best = null, bestAt = 0;
  for (const s of S.sess.values()) if (!s.parent && inProject(s)) { const a = activity(s); if (a > bestAt) { best = s; bestAt = a; } }
  if (best && t - bestAt < ORBIT_WINDOW) { if (best !== cur) { S.focus = best.id; S.pinned = false; S.chipsDirty = true; } }
  else if (cur && !inProject(cur)) { S.focus = null; S.pinned = false; S.chipsDirty = true; }  // 이 프로젝트엔 아직 움직인 세션이 없다
}

function pickFocus(id) {  // 칩 클릭: 그 세션을 HUB 로 고정. 고정된 칩을 다시 누르면 자동 따라가기
  if (S.focus === id && S.pinned) S.pinned = false;
  else { S.focus = id; S.pinned = true; }
  S.chipsDirty = true;
}

function onHook(e) {  // 훅: 도구 실행 시작/끝 → 선을 붙잡아 두고 점이 흐르게
  if (forgotten(e.parent || e.id, e.ts)) return;
  const s = sess(e), root = rootOf(s);
  if (e.kind === 'start') {
    root.wait = false;
    const key = stKey(e), k = key && key !== 'Agent' ? key : null;
    s.running.set(e.tool, {text: e.text, t: e.ts, key: k});
    if (k) { const n = station(root, k); n.sub = argOf(e.text, k); n.last = Math.max(n.last, e.ts); }
    if (!e.replay) {
      if (k) { const n = station(root, k); n.flash = now(); n.hold = now() + 2.5; burst(n); }
      s.flash = now();
      if (root.id === S.focus) S.hubFlash = now();
      follow(root);
    }
  } else {
    const r = s.running.get(e.tool);
    s.running.delete(e.tool);
    root.wait = false;  // 승인 뒤 실행이 끝났다
    if (!e.ok) { s.fail = now(); if (r && r.key) station(root, r.key).fail = now(); }
  }
  S.chipsDirty = S.dirty = true;
}

function onEvent(e) {
  if (forgotten(e.parent || e.id, e.ts)) return;
  const live = !e.replay;
  if (e.kind !== 'stat') {
    const s = sess(e), root = rootOf(s), key = stKey(e);
    if (e.kind === 'notify') {  // 응답 중에 온 "승인 · 입력을 기다려요"만 (응답을 마친 뒤의 알림은 이미 쉬는 중)
      if (live && phaseOf(root) === 'work') root.wait = true;
    } else { s.kind = e.kind; s.act = e.text; root.wait = false; }
    if (e.kind === 'done') s.running.clear();
    if (key && key !== 'Agent') {
      const n = station(root, key);
      n.last = Math.max(n.last, e.ts); n.sub = argOf(e.text, key); n.kind = e.kind;
      if (live) n.count++;
      if (e.kind === 'error') n.fail = now();
      else if (live) { n.flash = now(); n.hold = now() + 2.5; burst(n); S.links.push({root: root.id, from: s.id, to: key, t: now()}); }
    }
    if (live) {
      s.flash = now();
      if (root.id === S.focus) { S.hubFlash = now(); if (!CALM) flow(e, root); }
      follow(root);
    }
    e.root = root.id;  // 피드도 프로젝트별로 거른다
    S.feed.unshift(e);
    S.feed.length = Math.min(S.feed.length, 40);
    S.feedVer++;
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
    if (t - x.last > ORBIT_WINDOW || forgotten(x.parent || x.id, x.last)) continue;
    const s = sess({id: x.id, agent: x.agent, parent: x.parent, label: x.label, cwd: x.cwd, ts: x.last});
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
  if (!x) S.summary.set(e.id, x = {id: e.id, agent: e.agent, parent: e.parent, label: e.label, first: e.ts, last: e.ts, tools: 0, read: 0, edit: 0, run: 0, other: 0, turns: 0, errors: 0, tokens: 0, tin: 0, tcache: 0, kind: null, text: ''});
  x.label = e.label; x.last = Math.max(x.last, e.ts); x.tokens += e.dtok || 0; x.tin += e.din || 0; x.tcache += e.dcache || 0;
  if (TOOL.has(e.kind)) { x.tools++; x[bucket(e.kind)]++; }
  else if (e.kind === 'done') x.turns++;
  else if (e.kind === 'error') x.errors++;
  if (e.kind !== 'stat') { x.kind = e.kind; x.text = e.text; }
  S.listDirty = true;
}

function totals() {  // tokens = 출력, tin = 입력, tcache = 캐시 읽기. by = 에이전트별 {도구 횟수, 입력+출력 토큰}
  const t = {claude: 0, codex: 0, tokens: 0, tin: 0, tcache: 0, turns: 0, errors: 0, tools: 0, read: 0, edit: 0, run: 0, other: 0,
    by: {claude: {calls: 0, tok: 0}, codex: {calls: 0, tok: 0}}};
  for (const x of S.summary.values()) {
    t[x.agent] = (t[x.agent] || 0) + x.tools;
    for (const k of ['tokens', 'tin', 'tcache', 'turns', 'errors', 'tools', 'read', 'edit', 'run', 'other']) t[k] += x[k] || 0;
    const b = t.by[x.agent];
    if (b) { b.calls += x.tools; b.tok += (x.tokens || 0) + (x.tin || 0); }
  }
  return t;
}

function limitText() {  // Codex 요금제 사용 한도 → 로그에 남은 마지막 값
  const L = S.status && S.status.limits && S.status.limits.codex;
  if (!L) return '';
  const w = x => x && x.used != null ? `${x.window >= 1440 ? '주간' : x.window ? `${Math.round(x.window / 60)}시간` : ''} ${Math.round(x.used)}%` : null;
  return [w(L.primary), w(L.secondary)].filter(Boolean).join(' · ');
}

const activeCount = () => { let a = 0; const t = epoch(); for (const s of S.sess.values()) if (t - s.last < IDLE || s.running.size) a++; return a; };

// ── 화면 ──
function renderStatic() {
  $('cards').replaceChildren(...CARDS.map(([k, n, c, s]) => {
    const card = h('div', {class: 'card', style: `--c:${c}`},
      h('div', {class: 'h'}, n), h('div', {class: 'v', id: `v-${k}`}, '0'), h('div', {class: 's', id: `s-${k}`}, s));
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
    tokens: fmtK(t.tin + t.tokens), turns: t.turns.toLocaleString(), errors: t.errors.toLocaleString()};
  for (const k in v) $(`v-${k}`).textContent = v[k];
  $('s-tokens').textContent = `입력 ${fmtK(t.tin)} · 출력 ${fmtK(t.tokens)}`;
  $('s-tokens').title = `캐시에서 읽은 토큰 ${fmtK(t.tcache)}`;
  $('s-codex').textContent = limitText() || 'tool calls';
  $('s-codex').title = limitText() ? 'Codex 요금제 사용 한도 (마지막으로 기록된 값)' : '';
  $('judged').textContent = `${t.tools.toLocaleString()} tool calls`;
  const sum = t.read + t.edit + t.run + t.other || 1;
  for (const [k] of BARS) { const pc = Math.round(t[k] / sum * 100); $(`p-${k}`).textContent = pc + '%'; $(`f-${k}`).style.width = pc + '%'; }
  if (S.feedVer === feedDrawn.ver && S.mode === feedDrawn.mode) return;  // 목록이 바뀔 때만 다시 그림 (깜빡임 방지)
  const feed = $('feed'), list = S.feed.filter(e => inProject(S.sess.get(e.root))).slice(0, 6);
  feed.replaceChildren(...list.map((e, i) => h('li', {class: i === 0 && e !== feedDrawn.top && !e.replay ? 'new' : null, style: `--c:${(KIND[e.kind] || KIND.tool).c}`},
    h('span', {class: 'dot'}), h('b', {}, e.kind), h('p', {}, `${nameOf(e.id, e.label)} · ${e.text}`))));
  if (!list.length) feed.append(h('li', {class: 'empty'}, S.mode === 'live' ? '에이전트가 일하면 여기에 바로 나타나요' : '…'));
  feedDrawn = {ver: S.feedVer, mode: S.mode, top: list[0]};
}

function renderChips() {  // 지금 움직이는 세션들: 누르면 그 세션이 HUB 가 된다
  const t = epoch();
  const roots = [...S.sess.values()].filter(s => !s.parent && inProject(s) && (t - activity(s) < ORBIT_WINDOW || s.id === S.focus))
    .sort((a, b) => activity(b) - activity(a)).slice(0, MINI ? 4 : 7);
  const box = $('chips');
  if (roots.length < 2 && !S.pinned) return box.replaceChildren();  // 세션이 하나뿐이면 고를 필요가 없다
  box.replaceChildren(...roots.map(s => {
    const a = AGENTS[s.agent] || AGENTS.claude, on = s.id === S.focus;
    const busy = [...S.sess.values()].some(x => (x === s || x.parent === s.id) && x.running.size);
    return h('button', {class: on ? 'chip-btn on' : 'chip-btn', type: 'button', 'aria-pressed': String(on), onclick: () => pickFocus(s.id),
      title: on && S.pinned ? '고정됨 → 다시 누르면 자동으로 따라가요' : `${nameOf(s.id, s.label)} → HUB로 보기`},
      mark(s.agent), clip(nameOf(s.id, s.label), 18), busy ? h('i', {class: 'spin'}) : null, on && S.pinned ? h('b', {}, '고정') : null);
  }));
}

function renderSessions() {
  const list = [...S.summary.values()].sort((a, b) => b.last - a.last);
  $('sessions-count').textContent = `${RANGES[S.range].label}${list.length ? ` · ${list.length}개` : ''}`;
  const box = $('sessions');
  if (!list.length) {
    const msg = S.mode === 'live' ? (S.bounds[1] === null ? '아직 기록이 없어요. 에이전트를 연결하고 일을 시켜 보세요.' : '이 기간에는 기록이 없어요.') : '수집기에 연결하면 내 세션 기록이 여기에 쌓여요.';
    return box.replaceChildren(h('div', {class: 'empty'}, msg));
  }
  box.replaceChildren(...list.slice(0, 200).map(x => {
    const k = KIND[x.kind] || KIND.tool, a = AGENTS[x.agent] || AGENTS.claude;
    return h('button', {class: 'row', type: 'button', onclick: () => openDrawer(x.id)},
      mark(x.agent),
      h('span', {class: 'label'}, x.parent ? h('small', {}, '↳ ') : null, nameOf(x.id, x.label)),
      h('span', {class: 'act', style: `--c:${k.c}`}, x.kind ? h('b', {}, x.kind) : null, x.text || ''),
      h('span', {class: 'nums'}, h('span', {}, h('b', {}, x.tools), ' tools'), h('span', {title: `입력 ${fmtK(x.tin || 0)} · 출력 ${fmtK(x.tokens)} · 캐시 ${fmtK(x.tcache || 0)}`}, h('b', {}, fmtK((x.tin || 0) + x.tokens)), ' tok'),
        h('span', {}, x.errors ? [h('b', {}, x.errors), ' err'] : '')),
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
      h('p', {}, '터미널에서 epeira doctor 로 상태를 확인하거나, 설치 명령을 다시 실행하세요.'), h('div', {class: 'actions'}, check)] :
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
      h('p', {class: 'note'}, '에이전트 기록은 이 컴퓨터 밖으로 나가지 않아요. 바뀌는 파일은 맨 아래 PRIVACY & INSTALL 에 있어요.')),
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
      if (st.notify === false) acts.push(h('button', {class: 'btn small', type: 'button', title: '권한 승인 · 입력을 기다릴 때 Epeira 앱이 알려 줘요', onclick: () => openAction(key, 'connect')}, '알림 켜기'));
      acts.push(h('button', {class: 'btn small', type: 'button', onclick: () => openAction(key, 'disconnect')}, '연결 해제'));
    } else {
      chip = h('span', {class: st.legacy ? 'chip warn' : 'chip'}, st.legacy ? '업데이트 필요' : '연결 안 됨');
      desc = st.legacy ? '이전 버전 훅이 있어요. 다시 연결하면 새 버전으로 바뀌어요.' : '';
      acts.push(h('button', {class: 'btn small primary', type: 'button', onclick: () => openAction(key, 'connect')}, st.legacy ? '다시 연결' : '연결'));
    }
  }
  return h('div', {class: 'agent'},
    h('div', {class: 'hd'}, mark(key), h('span', {class: 'name'}, a.name), chip),
    h('div', {class: 'desc'}, desc || h('code', {}, a.file)),
    acts.length ? h('div', {class: 'acts'}, ...acts) : null);
}

function renderAgents() {
  $('agents').replaceChildren(...Object.keys(AGENTS).map(agentCard));
  $('agents-soon').replaceChildren(h('b', {}, '준비 중'), ...SOON.map(name => h('span', {}, name)));
  $('agents-note').textContent = S.mode === 'live' ? '' : '수집기 연결 후 사용';
}

function renderFooter() {
  const st = S.status, kids = [h('span', {class: 'grow'}, 'Epeira')];
  const toggle = (label, on, flip) => {
    const sw = h('button', {class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on)}, h('i'), label);
    sw.onclick = async () => { try { await flip(); renderFooter(); } catch { toast('설정을 바꾸지 못했어요'); } };
    return sw;
  };
  if (st && st.claudeLimits != null) {
    kids.push(toggle('Claude 사용 한도 보기', st.claudeLimits, async () => {
      const r = await postJSON('/api/settings', {claudeLimits: !st.claudeLimits});
      st.claudeLimits = r.claudeLimits; st.limits = r.limits;
      const err = st.claudeLimits && (r.limits.claude || {}).error;
      toast(!st.claudeLimits ? 'Claude 사용 한도를 더 가져오지 않아요'
        : err ? 'Claude Code 로그인 정보를 읽지 못했어요. Claude Code 를 한 번 실행한 뒤 다시 켜 보세요'
        : 'Claude Code 로그인 정보로 5시간 · 주간 한도를 5분마다 가져와요 (비용 없음)');
    }));
  }
  if (st && st.autostart != null) {
    kids.push(toggle('로그인할 때 자동 실행', st.autostart, async () => {
      st.autostart = (await postJSON('/api/autostart', {enabled: !st.autostart})).autostart;
      toast(st.autostart ? '로그인할 때 자동으로 켜져요' : '자동 실행을 껐어요. 지금 실행 중인 수집기는 그대로예요');
    }));
  }
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
    connect: `아래 파일에 Epeira 훅이 추가돼요. ${name}가 도구를 실행할 때마다 이 컴퓨터의 수집기(127.0.0.1:${(S.status && S.status.port) || PORT})로만 신호를 보내요.`,
    disconnect: '추가했던 Epeira 훅을 제거해요. 연결한 뒤 설정이 바뀌지 않았다면 연결 전 파일 그대로 되돌려요.',
    trust: 'Codex는 새 훅을 승인해야 실행해요. 아래 명령을 승인합니다 → Codex의 /hooks 화면에서 승인하는 것과 같아요.',
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

// ── 새로고침 ──
async function refreshAll() {
  if (S.mode !== 'live') return;
  const ok = await refreshStatus();
  if (!S.connected) openStream(); else loadSummary();
  toast(ok ? '새로고침했어요' : '수집기에 연결할 수 없어요');
}

function refreshIcon() {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
  p.setAttribute('d', 'M13 3.5V7H9.5M12.6 6.6A5 5 0 1 0 13 9.5'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

// ── 세션(HUB) 이름 바꾸기 ──
function setName(id, name) {
  if (name) S.names.set(id, name); else S.names.delete(id);
  if (S.drawer && S.drawer.id === id) S.drawer.title.textContent = (S.drawer.parent ? '↳ ' : '') + nameOf(id, S.drawer.label);
  S.feedVer++; S.dirty = S.listDirty = S.chipsDirty = true;
}

function renameSession(id) {
  const s = S.sess.get(id), x = S.summary.get(id), original = (s && s.label) || (x && x.label) || id;
  const input = h('input', {class: 'text-input', type: 'text', maxlength: '40', value: nameOf(id, original), 'aria-label': '새 이름', spellcheck: 'false'});
  modal({
    title: 'HUB 이름 바꾸기',
    body: [h('p', {}, `이 세션에만 적용돼요. 비우고 저장하면 원래 이름(${original})으로 돌아가요.`), input],
    confirm: '저장', focus: input,
    onConfirm: async () => {
      const name = input.value.trim();
      if (S.mode === 'demo') return setName(id, name);  // 데모: 이 화면에서만
      const r = await postJSON('/api/rename', {id, name});
      setName(id, r.name);
      toast(r.name ? `이름을 "${r.name}"(으)로 바꿨어요` : '원래 이름으로 돌아갔어요');
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

function modal({title, body, confirm, danger, onConfirm, focus}) {
  const m = $('modal'), prev = document.activeElement;
  const ok = h('button', {class: danger ? 'btn danger' : 'btn primary', type: 'button'}, confirm);
  const cancel = h('button', {class: 'btn', type: 'button'}, '취소');
  const sheet = h('div', {class: 'sheet'}, h('h2', {id: 'modal-title'}, title), ...body, h('div', {class: 'actions'}, cancel, ok));
  const close = () => { m.hidden = true; m.replaceChildren(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  const onKey = ev => {
    if (ev.key === 'Escape' && !ok.disabled) close();
    if (ev.key === 'Tab') {  // 확인 창 안에서만 포커스가 돈다
      const f = [...sheet.querySelectorAll('button, input, [tabindex="0"]')].filter(x => !x.disabled);
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
  if (focus) {  // 입력 칸이 있는 창: 바로 입력하고 Enter 로 저장
    focus.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ok.click(); } });
    focus.focus(); if (focus.select) focus.select();
  } else ok.focus();
}

// ── 세션 기록 패널 ──
async function openDrawer(id, st) {  // st: 도구 노드를 눌렀을 때 그 도구로 한 일만
  const s0 = S.sess.get(id);
  const x = S.summary.get(id) || (s0 && {id, agent: s0.agent, label: s0.label, parent: s0.parent, last: s0.last, tools: 0, turns: 0, errors: 0, tokens: 0});
  if (!x) return;
  const d = $('drawer'), prev = document.activeElement, a = AGENTS[x.agent] || AGENTS.claude;
  const list = h('ol', {}, h('li', {class: 'empty'}, '불러오는 중…'));
  const close = h('button', {class: 'btn small', type: 'button', 'aria-label': '닫기'}, '닫기');
  const ren = h('button', {class: 'btn small', type: 'button', onclick: () => renameSession(id)}, '이름 바꾸기');
  const title = h('h2', {}, (x.parent ? '↳ ' : '') + nameOf(id, x.label) + (st ? ` · ${st.startsWith('mcp:') ? 'MCP ' + st.slice(4) : st}` : ''));
  S.drawer = {id, list, prev, title, label: x.label, parent: x.parent, st};
  close.onclick = closeDrawer;
  d.replaceChildren(
    h('div', {class: 'hd'}, mark(x.agent),
      h('div', {}, title, h('div', {class: 'sub'}, `${a.name} · ${RANGES[S.range].label} · 마지막 활동 ${ago(x.last)}`)), ren, close),
    h('div', {class: 'nums'}, h('span', {}, h('b', {}, x.tools), ' tools'), h('span', {}, h('b', {}, x.turns), ' turns'), h('span', {}, h('b', {}, x.errors), ' errors')),
    h('div', {class: 'nums'}, h('span', {}, '입력 ', h('b', {}, fmtK(x.tin || 0))), h('span', {}, '출력 ', h('b', {}, fmtK(x.tokens))), h('span', {}, '캐시 ', h('b', {}, fmtK(x.tcache || 0)))),
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
  if (!list.children.length) list.append(h('li', {class: 'empty'}, st ? '이 기간에 남은 기록이 없어요 (실행 중인 것은 끝나면 남아요)' : '이 기간에 남은 동작이 없어요'));
}

function drawerAdd(e, live) {
  if (S.drawer.st && e.st !== S.drawer.st) return;
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
}

function loadAnalytics() {  // 배포 사이트에서만: 쿠키 없는 페이지 조회 수 (에이전트 데이터는 수집하지 않음)
  document.head.append(h('script', {src: '/_vercel/insights/script.js', defer: true}));
}

// ── 2초마다: 스파크라인 · HUB 확인 · 날짜 바뀜 · 상대 시간 ──
function describeOrbit() {  // 궤도는 그림이라 화면 읽기 프로그램용 글 요약을 따로 둔다
  const f = S.sess.get(S.focus);
  if (!f) return EMBED && !S.project ? '프로젝트를 고르면 그 프로젝트의 궤도가 보여요' : '최근 30분 동안 움직인 에이전트가 없어요';
  const a = AGENTS[f.agent] || AGENTS.claude, tools = [...f.stations.values()].sort((x, y) => y.last - x.last);
  const running = [...S.sess.values()].filter(x => x === f || x.parent === f.id).flatMap(x => [...x.running.values()].map(r => r.text));
  const subs = [...S.sess.values()].filter(x => x.parent === f.id && x.running.size).map(x => nameOf(x.id, x.label));
  const phase = {work: '일하는 중', wait: '승인 · 입력을 기다려요', idle: '쉬는 중'}[phaseOf(f)];
  return [`${a.name} 세션 ${nameOf(f.id, f.label)} · ${phase}`,
    running.length ? `실행 중: ${running.slice(0, 3).join(', ')}` : '지금 실행 중인 도구 없음',
    subs.length ? `일하는 서브에이전트: ${subs.join(', ')}` : '',
    tools.length ? `최근 도구: ${tools.slice(0, 5).map(n => `${n.label}${n.count ? ` ${n.count}회` : ''}`).join(', ')}` : ''].filter(Boolean).join('. ');
}

function tick() {
  const t = epoch();
  for (const s of S.sess.values()) for (const [id, r] of s.running) if (t - r.t > 1800) s.running.delete(id);  // 끝 신호 유실 대비
  ensureFocus();
  const text = describeOrbit();
  if ($('orbit-text').textContent !== text) $('orbit-text').textContent = text;
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
const PAL = ['#ffffff', '#d4d4d4', '#a3a3a3', '#3b9eff', '#7dd3fc', '#c084fc'];  // 궤도 입자: 무채색 위주 + 약간의 강조색
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const logoPath = L => { const p = new Path2D(); p.addPath(new Path2D(L.d), new DOMMatrix().scale(24 / (L.vb || 24))); return p; };  // 모두 24 칸 기준으로
const LOGO_PATH = {claude: logoPath(LOGO.claude), codex: logoPath(LOGO.codex)};
const parts = Array.from({length: 72}, () => ({a: Math.random() * 6.283, sp: (Math.random() * .12 + .03) * (Math.random() < .2 ? -1 : 1), j: (Math.random() - .5) * 14, r: Math.random() * 1.6 + .8, c: pick(PAL)}));
let W = 0, H = 0, Z = 1, stars = [], rot = 0, spin = .03, lastFrame = now(), working = false, lastList = 0, lastChips = 0;

function resize() {
  const dpr = devicePixelRatio || 1;
  W = cv.clientWidth; Z = W < 600 ? Math.min(.82, .5 + W / 1400) : Math.max(.7, Math.min(1, W / 760));  // 좁은 화면도 노드 글자가 읽히게, 아주 좁은 패널은 조금 더 작게 (노드가 HUB 를 덮지 않게)
  if (MINI) {  // 작은 레이아웃: 다른 요소를 뺀 나머지 높이를 궤도가 채운다
    const rest = document.querySelector('.top').offsetHeight + document.querySelector('main').offsetHeight - cv.offsetHeight;
    H = Math.max(200, Math.round(innerHeight - rest));
  } else H = Math.round(W < 600 ? W * 1.1 : Math.max(340, Math.min(540, W * .56)));
  cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stars = Array.from({length: 90}, () => [Math.random() * W, Math.random() * H, Math.random() * .35 + .05]);
}
addEventListener('resize', resize);
const onHub = ev => { const r = cv.getBoundingClientRect(), h0 = S.hubRect, x = ev.clientX - r.left, y = ev.clientY - r.top;
  return h0 && x >= h0.x && x <= h0.x + h0.w && y >= h0.y && y <= h0.y + h0.h; };
const cardAt = ev => {  // 마우스 아래 노드 카드 (위에 그려진 것부터)
  const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  return [...S.drawn].reverse().find(([, n]) => n.bw && x >= n.bx && x <= n.bx + n.bw && y >= n.by && y <= n.by + n.bh);
};
cv.addEventListener('mousemove', ev => {  // HUB 위에선 손가락 커서 + 안내, 노드 위에선 눌러서 기록 보기 (앱의 궤도 패널은 기록을 열지 않는다)
  const on = onHub(ev) && S.focus, card = !on && !EMBED && cardAt(ev);
  cv.style.cursor = on || card ? 'pointer' : '';
  cv.title = on ? (EMBED ? '두 번 눌러 이름 바꾸기' : '눌러서 세션 기록 · 두 번 눌러 이름 바꾸기') : card ? (card[0] === 'st' ? `눌러서 ${card[1].label} 기록 보기` : '눌러서 서브에이전트 기록 보기') : '';
});
let hubClick = 0;  // HUB 한 번 = 세션 기록, 두 번 = 이름 바꾸기 (두 번 누르면 한 번짜리는 취소)
cv.addEventListener('click', ev => {
  if (EMBED) return;
  const card = cardAt(ev);
  if (card) return card[0] === 'st' ? openDrawer(S.focus, card[1].key) : openDrawer(card[1].id);
  if (onHub(ev) && S.focus) { const id = S.focus; clearTimeout(hubClick); hubClick = setTimeout(() => openDrawer(id), 260); }
});
cv.addEventListener('dblclick', ev => { if (onHub(ev) && S.focus) { clearTimeout(hubClick); renameSession(S.focus); } });

const geo = () => {  // 앱의 궤도 패널은 크기가 바뀌어도 원형 유지, 넓은 대시보드는 납작한 타원
  const r = Math.min(W * .41, H * .37);
  return {cx: W / 2, cy: H * .52, rx: MINI ? r : W * .41, ry: MINI ? r : H * .37};
};
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

const RAYS = Array.from({length: 18}, (_, i) => i / 18 * 6.283 + .2);  // HUB 둘레의 가시 방향
function drawHub(g, t, focus, toolCount, reaching, phase) {  // reaching: 노드까지 뻗어 나간 가시 번호 (짧은 가시는 그리지 않음)
  const thinking = phase === 'work' && !working;  // 도구 사이: 모델이 다음 행동을 생각하는 중
  const f = Math.max(0, 1 - (t - S.hubFlash) / .8, working ? (Math.sin(t * 5) + 1) * .3 : 0, thinking ? (Math.sin(t * 2.4) + 1) * .22 : 0);
  const label = focus ? clip(nameOf(focus.id, focus.label || focus.agent), W < 600 ? 9 : 16) : 'HUB';  // 좁으면 짧게 (전체 이름은 칩·테이프에)
  ctx.save(); ctx.translate(g.cx, g.cy); ctx.scale(Z, Z);
  ctx.font = `700 ${focus ? 21 : 30}px ${SANS}`;
  const bw = Math.max(108, ctx.measureText(label).width + 40), bh = 96, rx = bw / 2 + 10, ry = bh / 2 + 10;
  S.hubRect = focus ? {x: g.cx - bw * Z / 2, y: g.cy - bh * Z / 2, w: bw * Z, h: bh * Z} : null;
  S.hubR = {rx: rx * Z, ry: ry * Z};  // 다음 프레임에 가시 뿌리 위치를 계산하려고 (선은 HUB 보다 먼저 그린다)
  ctx.strokeStyle = 'rgba(59,158,255,.55)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 18; i++) {
    if (reaching.has(i)) continue;
    const a = RAYS[i], len = 8 + (i % 3) * 6 + f * 10, c = Math.cos(a), s = Math.sin(a);
    line(c * rx, s * ry, c * (rx + len), s * (ry + len));
    circle(c * (rx + len), s * (ry + len), 2.2, '#3b9eff');
  }
  if (phase === 'work' && !CALM) {  // 일하는 동안: HUB 둘레를 빛 줄기 셋과 위성이 돈다 (이벤트가 없는 생각 중에도)
    const hx = rx + 24, hy = ry + 24, a0 = t * 1.6;
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = a0 + i * 2.094;
      ctx.strokeStyle = 'rgba(59,158,255,.45)'; ctx.beginPath(); ctx.ellipse(0, 0, hx, hy, 0, a, a + .8); ctx.stroke();
      circle(Math.cos(a + .8) * hx, Math.sin(a + .8) * hy, 2.6, '#ffffff');
    }
    ctx.lineCap = 'butt';
  }
  if (phase === 'wait') {  // 승인 · 입력을 기다림: 노란 고리가 천천히 맥박친다 (앱 탭의 노란 점과 같은 뜻)
    ctx.strokeStyle = `rgba(251,191,36,${CALM ? .7 : .35 + .35 * (Math.sin(t * 2.2) + 1) / 2})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, 0, rx + 24, ry + 24, 0, 0, 6.283); ctx.stroke();
  }
  ctx.shadowColor = '#3b9eff'; ctx.shadowBlur = 22 + f * 24;
  rrect(-bw / 2, -bh / 2, bw, bh, 12, '#0d0d0d', '#3b9eff', 2.5);
  ctx.shadowBlur = 0;
  rrect(-bw / 2 + 7, -bh / 2 + 7, bw - 14, bh - 14, 8, null, 'rgba(59,158,255,.35)', 1);
  ctx.textAlign = 'center';
  if (focus) {  // 에이전트 로고 + 이름
    const a = AGENTS[focus.agent] || AGENTS.claude, L = LOGO[focus.agent] || LOGO.codex, name = a.name.toUpperCase();
    ctx.font = `600 10px ${MONO}`;
    const tw = ctx.measureText(name).width, x0 = -(tw + 15) / 2;
    ctx.save(); ctx.translate(x0, -29); ctx.scale(11 / 24, 11 / 24);
    ctx.fillStyle = L.fill || a.c; ctx.fill(LOGO_PATH[focus.agent]);
    ctx.restore();
    ctx.fillStyle = a.c; ctx.textAlign = 'left'; ctx.fillText(name, x0 + 15, -20); ctx.textAlign = 'center';
  }
  ctx.fillStyle = '#fff'; ctx.font = `700 ${focus ? 21 : 30}px ${SANS}`; ctx.fillText(label, 0, focus ? 6 : 6);
  ctx.fillStyle = phase === 'wait' ? '#fbbf24' : '#a3a3a3'; ctx.font = `11px ${MONO}`;  // 상태 또는 이 세션이 지금까지 실행한 도구 횟수 (노드 숫자의 합)
  if (focus) ctx.fillText(phase === 'wait' ? 'waiting…' : thinking ? 'thinking…' : `${toolCount.toLocaleString()} ${toolCount === 1 ? 'tool' : 'tools'}`, 0, 28);
  ctx.restore();
}

function drawCard(n, t, title, sub, o) {  // 노드 카드: 도구 노드와 서브에이전트 노드 공통
  const s = Z * (.86 + .14 * n.depth), hot = o.live || t - n.flash < 2.5, failed = t - n.fail < 1.5;
  ctx.save(); ctx.globalAlpha = (o.idle && !o.live ? .72 : 1) * (.85 + .15 * n.depth);  // 쉬는 노드도 읽힐 만큼
  title = clip(title, Math.round(22 * Z)); sub = clip(sub, Math.round(30 * Z));
  ctx.font = `600 ${14 * s}px ${SANS}`; const w1 = ctx.measureText(title).width;
  ctx.font = `${11 * s}px ${MONO}`; const w2 = ctx.measureText(sub).width;
  const bw = Math.max(w1, w2) + 24 * s, bh = 44 * s;
  const bx = Math.min(Math.max(n.x - bw / 2, 4), W - bw - 34), by = n.y - bh / 2;
  n.bx = bx; n.bw = bw; n.by = by; n.bh = bh;  // 눌렀을 때 어느 노드인지
  const edge = failed ? '#ff6b81' : o.color || '#3b9eff';
  if (hot || failed) { ctx.shadowColor = edge; ctx.shadowBlur = o.live ? 12 + 12 * (Math.sin(t * 6) + 1) / 2 : 18; }
  rrect(bx, by, bw, bh, 6, hot ? 'rgba(19,30,44,.96)' : 'rgba(17,17,17,.92)', hot || failed ? edge : o.idleEdge || 'rgba(255,255,255,.14)', hot ? 1.6 : 1);
  ctx.shadowBlur = 0; ctx.textAlign = 'center';
  ctx.fillStyle = '#ededed'; ctx.font = `600 ${14 * s}px ${SANS}`; ctx.fillText(title, bx + bw / 2, by + 19 * s);
  ctx.fillStyle = o.live ? '#bfe0ff' : '#a3a3a3'; ctx.font = `${11 * s}px ${MONO}`; ctx.fillText(sub, bx + bw / 2, by + 35 * s);
  if (o.live || o.code) {  // 배지: 실행 중엔 스피너, 아니면 마지막 동작 (영상의 SCO / CHO / NOU 박스)
    const x = bx + bw + 6, y = by - 6, c = o.live ? '#3b9eff' : o.codeColor;
    rrect(x, y, 24, 14, 2, 'rgba(10,10,10,.92)', c, 1);
    ctx.fillStyle = c; ctx.font = `600 ${o.live ? 10 : 8}px ${MONO}`; ctx.fillText(o.live ? SPIN[Math.floor(t * 12) % 10] : o.code, x + 12, y + 10);
  }
  ctx.restore();
}

// 배터리: Epeira 앱이 뒤에 있으면(앱이 알려 준다) 초당 8번만 그린다. 브라우저 탭이 숨으면 브라우저가 알아서 멈춘다
let slow = false;
window.aoSetActive = on => { slow = !on; };
function frame() {
  if (slow && now() - lastFrame < 1 / 8) return requestAnimationFrame(frame);
  const t = now(), dt = Math.min(.1, t - lastFrame), nowS = epoch(), g = geo();
  lastFrame = t;
  const focus = S.sess.get(S.focus) || null, phase = phaseOf(focus);
  spin += ((phase === 'work' ? .12 : .03) - spin) * Math.min(1, dt * 1.5);  // 일하는 동안 궤도가 빨리 돈다 (부드럽게 빨라지고 느려짐)
  if (!CALM) rot += dt * spin;

  // HUB 의 노드: 최근에 쓴 도구(바깥 궤도, 처음 쓰인 순서로 자리 고정) + 일하는 서브에이전트(안쪽 궤도)
  let stations = [], subs = [];
  const runs = [];  // 실행 중: [보내는 쪽 세션, 실행 정보]
  if (focus) {
    for (const x of S.sess.values()) if (x === focus || x.parent === focus.id) for (const r of x.running.values()) runs.push([x, r]);
    const maxStations = W < 600 ? 6 : 10;  // 좁으면 노드를 줄여 겹치지 않게
    stations = [...focus.stations.values()].sort((a, b) => b.last - a.last).slice(0, maxStations).sort((a, b) => a.order - b.order);
    for (const n of stations) { n.live = false; n.since = 0; }
    const byKey = new Map(stations.map(n => [n.key, n]));
    for (const [, r] of runs) { const n = r.key && byKey.get(r.key); if (n) { n.live = true; n.since = n.since ? Math.min(n.since, r.t) : r.t; n.arg = argOf(r.text, n.key); } }
    subs = [...S.sess.values()].filter(x => x.parent === focus.id && (nowS - x.last < ORBIT_WINDOW || x.running.size)).slice(-MAX_SUBS);
  }
  place(stations, 1, dt, g);
  place(subs, .62, dt, g);
  const byKey = new Map(stations.map(n => [n.key, n])), subSet = new Set(subs);
  // HUB 에서 나가는 선은 그 노드 쪽을 향한 HUB 가시의 뿌리에서 시작한다 → 일하는 동안 가시가 길어져 노드에 닿는 것처럼
  const hub = S.hubR || {rx: 64, ry: 58}, reaching = new Set();
  const edge = to => {
    const dx = to.x - g.cx, dy = to.y - g.cy, d = Math.hypot(dx, dy) || 1;
    let best = 0, bk = -2;
    RAYS.forEach((a, i) => { const x = Math.cos(a) * hub.rx, y = Math.sin(a) * hub.ry, k = (x * dx + y * dy) / (Math.hypot(x, y) * d); if (k > bk) { bk = k; best = i; } });
    reaching.add(best);
    return {x: g.cx + Math.cos(RAYS[best]) * hub.rx, y: g.cy + Math.sin(RAYS[best]) * hub.ry};
  };
  const from = (x, to) => (x && subSet.has(x) ? x : edge(to));
  for (const n of stations) {  // 뻗을 땐 빠르게, 거둘 땐 천천히. 1초 안에 끝난 도구도 2.5초는 노드에 닿아 있다
    const on = n.live || t < n.hold;
    n.reach = (n.reach || 0) + ((on ? 1 : 0) - (n.reach || 0)) * Math.min(1, dt * (on ? 5 : 1.5));
  }

  ctx.clearRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.rx);
  glow.addColorStop(0, 'rgba(59,158,255,.09)'); glow.addColorStop(1, 'rgba(59,158,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  for (const [x, y, o] of stars) { ctx.fillStyle = `rgba(235,235,235,${o})`; ctx.fillRect(x, y, 1, 1); }
  ellipse(g, 1, 'rgba(255,255,255,.035)', 20); ellipse(g, 1, 'rgba(255,255,255,.16)', 1);
  ctx.setLineDash([10, 8]); ellipse(g, .62, 'rgba(255,255,255,.16)', 1.2); ctx.setLineDash([]);
  const pace = Math.sqrt(spin / .03);
  for (const p of parts) { if (!CALM) p.a += p.sp * dt * pace; dotOn(g, p.a, p.j, p.r, p.c, .75); }
  S.bursts = S.bursts.filter(b => t - b.t < 1.6);
  for (const b of S.bursts) { b.a += b.sp * dt; dotOn(g, b.a, b.j, 2.2, b.c, 1 - (t - b.t) / 1.6, b.k); }
  S.flows = S.flows.filter(f => t - f.t < 1.6);
  for (const f of S.flows) {  // HUB 가장자리에서 도구 노드(없으면 바깥 궤도)까지 살짝 휘며 가고, 나타났다 사라진다
    const p = (t - f.t) / 1.6;
    if (p < 0) continue;
    const e = 1 - (1 - p) ** 2, to = f.to && byKey.get(f.to);
    let x, y;
    if (to) {
      const a = edge(to), dx = to.x - a.x, dy = to.y - a.y, bend = Math.sin(p * Math.PI) * f.sp * 30 / (Math.hypot(dx, dy) || 1);
      x = a.x + dx * e - dy * bend; y = a.y + dy * e + dx * bend;
    } else {
      const a = f.a + f.sp * p, hr = S.hubR || {rx: 64, ry: 58};
      x = g.cx + (hr.rx + (g.rx - hr.rx) * e) * Math.cos(a); y = g.cy + (hr.ry + (g.ry - hr.ry) * e) * Math.sin(a);
    }
    ctx.globalAlpha = Math.sin(p * Math.PI) * .9;
    circle(x, y, 1.8, f.c);
  }
  ctx.globalAlpha = 1;

  // 거미줄: 응답하는 동안 쓴 도구마다 옅은 선이 남아 1분에 걸쳐 흐려진다 (쉬면 궤도가 느려지는 만큼 같이 걷힌다)
  const web = Math.min(1, Math.max(0, (spin - .03) / .09));
  ctx.lineWidth = 1;
  for (const n of stations) {
    const o = .3 * (1 - (nowS - n.last) / 60) * web;
    if (o < .04) continue;
    ctx.strokeStyle = `rgba(59,158,255,${o})`;
    const a = edge(n);
    line(a.x, a.y, n.x, n.y);
  }

  // 선: HUB(또는 서브에이전트) → 도구 노드. 방금 끝난 실행은 빛나다 사라지고, 실행 중이면 선이 남아 점이 흐른다
  S.links = S.links.filter(l => t - l.t < 2.5);
  ctx.lineWidth = 1.5;
  for (const sub of subs) {  // HUB ↔ 서브에이전트
    const age = t - sub.flash;
    if (!sub.running.size && age > 2.5) continue;
    ctx.strokeStyle = `rgba(167,139,250,${sub.running.size ? .7 : (1 - age / 2.5) * .8})`;
    const e = edge(sub);
    line(e.x, e.y, sub.x, sub.y);
  }
  for (const l of S.links) {
    const to = focus && l.root === focus.id && byKey.get(l.to);
    if (!to) continue;
    const a = from(S.sess.get(l.from), to), age = t - l.t;
    ctx.strokeStyle = `rgba(59,158,255,${(1 - age / 2.5) * .9})`;
    line(a.x, a.y, to.x, to.y);
    if (age < .7) circle(a.x + (to.x - a.x) * age / .7, a.y + (to.y - a.y) * age / .7, 3, '#ffffff');
  }
  working = false;
  const reachLine = (a, to, k, dots) => {  // a → to 의 k 만큼만: 끝에 가시 끝처럼 점, 닿은 뒤엔 점이 흐른다
    const x = a.x + (to.x - a.x) * k, y = a.y + (to.y - a.y) * k;
    line(a.x, a.y, x, y);
    circle(x, y, 2.4, '#3b9eff');
    if (dots) for (let i = 0; i < 3; i++) { const q = ((t * .9 + i / 3) % 1) * k; circle(a.x + (to.x - a.x) * q, a.y + (to.y - a.y) * q, 3, '#ffffff'); }
  };
  ctx.strokeStyle = 'rgba(59,158,255,.85)';
  for (const [x, r] of runs) {
    const to = r.key && byKey.get(r.key);
    if (!to) continue;
    working = true;
    reachLine(from(x, to), to, to.reach, to.reach > .9);
  }
  for (const n of stations) if (!n.live && n.reach > .02) reachLine(edge(n), n, n.reach, false);  // 도구가 끝나면 가시가 다시 줄어든다

  let tools = 0;
  if (focus) for (const n of focus.stations.values()) tools += n.count;
  drawHub(g, t, focus, tools, reaching, phase);
  const cards = [...stations.map(n => ['st', n]), ...subs.map(x => ['sub', x])].sort((a, b) => a[1].y - b[1].y);
  S.drawn = cards;
  for (const [type, n] of cards) {
    if (type === 'st') {
      const k = KIND[n.kind] || KIND.tool;
      drawCard(n, t, (n.mcp ? 'MCP · ' : '') + n.label,
        n.live ? `▶ ${Math.max(0, Math.floor(nowS - n.since))}s ${n.arg || ''}` : [n.count ? `×${n.count}` : '', n.sub].filter(Boolean).join(' · ') || 'idle',
        {live: n.live, idle: nowS - n.last > IDLE, code: n.kind ? k.code : null, codeColor: k.c, idleEdge: focus.agent === 'codex' ? 'rgba(139,156,255,.45)' : null});
    } else {
      const job = n.running.size && [...n.running.values()].pop();
      drawCard(n, t, '↳ ' + nameOf(n.id, n.label), job ? `▶ ${job.text}` : n.act || 'idle',
        {live: !!job, idle: nowS - n.last > IDLE, color: '#a78bfa', idleEdge: 'rgba(167,139,250,.4)', code: 'SUB', codeColor: '#a78bfa'});
    }
  }
  if (!focus && S.mode === 'live') {
    ctx.fillStyle = '#a3a3a3'; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText(EMBED && !S.project ? '프로젝트를 고르면 그 프로젝트의 궤도가 보여요' : connectedAny() ? '최근 30분 동안 움직인 에이전트가 없어요' : '에이전트를 연결하면 여기에 나타나요', g.cx, g.cy + g.ry * .62 + 30);
  } else if (focus && !stations.length && !subs.length) {
    ctx.fillStyle = '#a3a3a3'; ctx.font = `13px ${SANS}`; ctx.textAlign = 'center';
    ctx.fillText('도구를 실행하면 여기에 노드가 생겨요', g.cx, g.cy + g.ry * .62 + 30);
  }
  if (S.dirty) {
    S.dirty = false; renderPanels();
    if (MINI && Math.abs(document.querySelector('.top').offsetHeight + document.querySelector('main').offsetHeight - innerHeight) > 2) resize();  // 궤도 패널은 스크롤 없이 꽉 차게
  }
  if (S.listDirty && t - lastList > .5) { S.listDirty = false; lastList = t; renderSessions(); }
  if (S.chipsDirty && t - lastChips > .3) { S.chipsDirty = false; lastChips = t; renderChips(); }
  requestAnimationFrame(frame);
}

resize();
boot();
tick(); setInterval(tick, 2000);
requestAnimationFrame(frame);
