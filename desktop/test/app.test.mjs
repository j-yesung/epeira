// 앱 기본 시나리오 자동 테스트: npm test
// 임시 앱 데이터 폴더 + 없는 수집기 주소로 띄워서 실제 프로젝트 목록 · 수집기 설치는 건드리지 않는다
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {generateKeyPairSync, sign} from 'node:crypto';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {_electron as electron} from 'playwright-core';
import {execFileSync} from 'node:child_process';

const require = createRequire(import.meta.url);
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'epeira-test-'));
const data = path.join(tmp, 'data'), alpha = path.join(tmp, 'alpha'), beta = path.join(tmp, 'beta');
for (const d of [data, alpha, beta]) mkdirSync(d);
execFileSync('git', ['init', '-q', beta]);  // beta 는 git 저장소 (사이드바 브랜치 표시)
writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{path: alpha, name: 'alpha'}, {path: beta, name: 'beta'}]));

// 릴리스 서버 흉내: 시험용 키로 서명한 DMG 를 준다 (앱에 든 공개 키는 EPEIRA_TEST 일 때만 바꿀 수 있다)
const testKey = generateKeyPairSync('ed25519'), releases = new Map();
const updates = createServer((req, res) => { const f = releases.get(req.url); res.writeHead(f ? 200 : 404, f ? {'Content-Length': Buffer.byteLength(f)} : {}); res.end(f); });
await new Promise(r => updates.listen(0, '127.0.0.1', r));

const launch = () => electron.launch({executablePath: require('electron'), args: [APP_DIR, `--user-data-dir=${data}`],
  env: {...process.env, AGENT_ORBIT_URL: 'http://127.0.0.1:9', EPEIRA_TEST: '1', TMPDIR: tmp,  // 수집기 없음 → 실제 설치를 건드리지 않음, 창은 숨김, 받은 업데이트도 임시 폴더에
    EPEIRA_UPDATE_BASE: `http://127.0.0.1:${updates.address().port}`, EPEIRA_UPDATE_KEY: testKey.publicKey.export({type: 'spki', format: 'der'}).toString('base64')}});
const until = async (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: 8000});
const labels = page => page.$$eval('.tab-main span:not(.k)', els => els.map(e => e.textContent));
const send = (app, e) => app.evaluate(({BrowserWindow}, ev) => BrowserWindow.getAllWindows()[0].webContents.send('orbit:event', ev), e);
const answer = (app, response) => app.evaluate(({dialog}, r) => { dialog.showMessageBox = async () => ({response: r}); dialog.showMessageBoxSync = () => r; }, response);

let app, page;
const stub = () => app.evaluate(({ipcMain}, dir) => {  // 가짜 수집기 응답: 지난 세션 · 기록 검색 · 상태
  const now = Date.now() / 1000;
  ipcMain.removeHandler('orbit:get');
  ipcMain.handle('orbit:get', (_, p) => (p.startsWith('/api/summary') ? {sessions: [
    {id: 'sess-x', agent: 'claude', cwd: dir, label: 'alpha', title: '첫 질문 X', text: 'Bash ls', last: now - 3600},
    {id: 'sess-z', agent: 'claude', cwd: dir, label: 'alpha', title: '로그인 버그 고쳐줘', text: 'Bash npm test', last: now - 7200}]}
    : p.startsWith('/api/search') ? {results: [{id: 'sess-z', agent: 'claude', cwd: dir, label: 'alpha', kind: 'run', text: 'Bash npm test', ts: now - 60}]}
    : p.startsWith('/api/status') ? {version: 'test', port: 9, agents: {}, claudeLimits: false} : null));
}, alpha);
after(async () => {  // 끝낼 때 "종료할까요?" 확인 창이 떠도 기다리지 않게
  if (app) { await answer(app, 0).catch(() => {}); await app.close().catch(() => {}); }
  updates.close();
  rmSync(tmp, {recursive: true, force: true});
});

test('터미널은 프로젝트마다 따로: 바꿔도 새로 열리지 않고 그 프로젝트 탭만 보인다', async () => {
  app = await launch();
  page = await app.firstWindow();
  await app.evaluate(({Notification}) => { Notification.isSupported = () => false; });  // 테스트 중 macOS 알림을 띄우지 않게
  await until(page, () => typeof S !== 'undefined' && S.projects.length === 2);
  await page.evaluate(() => selectProject(S.projects[0].path));
  assert.equal(await page.evaluate(() => S.tabs.length), 0, '프로젝트를 골라도 터미널을 멋대로 열지 않는다');
  assert.equal(await page.evaluate(() => document.getElementById('welcome').hidden), false);
  await page.evaluate(async () => { await openTab(S.projects[0].path, 'shell'); await openTab(S.projects[0].path, 'shell'); });
  assert.deepEqual(await labels(page), ['터미널', '터미널 2']);
  await page.evaluate(() => selectProject(S.projects[1].path));
  assert.deepEqual(await labels(page), [], 'beta 엔 아직 터미널이 없다');
  await page.evaluate(() => openTab(S.projects[1].path, 'shell'));
  assert.deepEqual(await labels(page), ['터미널']);
  await page.evaluate(() => selectProject(S.projects[0].path));
  assert.deepEqual(await labels(page), ['터미널', '터미널 2'], 'alpha 로 돌아오면 alpha 의 터미널 2개');
  assert.equal(await page.evaluate(() => S.tabs.length), 3, '오가도 터미널이 늘지 않는다');
});

test('사이드바를 접어도 터미널과 궤도 패널이 제자리', async () => {
  await page.evaluate(() => toggle('no-side'));
  const r = await page.evaluate(() => ({terms: document.getElementById('terms').getBoundingClientRect().left, orbit: document.querySelector('.orbit').offsetWidth, side: document.querySelector('.side').offsetWidth}));
  assert.equal(r.side, 0);
  assert.equal(r.terms, 0, '터미널이 왼쪽 끝부터');
  assert.ok(r.orbit >= 320, `궤도 패널 폭 ${r.orbit}`);
  await page.evaluate(() => toggle('no-side'));
});

test('실행 중인 탭은 닫기 전에 묻는다', async () => {
  // 셸이 준비된 뒤(프롬프트가 보인 뒤) 명령을 넣어야 실행 중으로 잡힌다
  await until(page, () => { const b = tab(S.active).term.buffer.active; for (let i = 0; i < b.length; i++) if (b.getLine(i).translateToString().trim()) return true; return false; });
  await page.evaluate(() => window.orbit.write(S.active, 'sleep 30\r'));
  await page.waitForTimeout(1000);
  await answer(app, 1);  // 취소
  await page.evaluate(() => closeTab());
  assert.equal(await page.evaluate(() => projTabs().length), 2, '취소하면 그대로');
  await answer(app, 0);  // 닫기
  await page.evaluate(() => closeTab());
  await until(page, () => projTabs().length === 1);
});

test('수집기 이벤트로 탭 상태 표시: 일하는 중 → 승인 대기 → 끝', async () => {
  const id = await page.evaluate(() => S.active);
  await send(app, {kind: 'tab', tab: id, id: 'sess-x'});
  await send(app, {kind: 'start', id: 'sess-x', agent: 'claude', tool: 't1', text: 'Bash ls', ts: Date.now() / 1000});
  await until(page, () => !!document.querySelector('.tab.on .st.busy') && !!document.querySelector('.proj.on .st.busy'));  // 사이드바 프로젝트에도
  await send(app, {kind: 'notify', id: 'sess-x', agent: 'claude', text: 'Claude needs your permission to use Bash', ts: Date.now() / 1000});
  await until(page, () => !!document.querySelector('.tab.on .st.wait'));
  await send(app, {kind: 'done', id: 'sess-x', agent: 'claude', text: 'turn complete', ts: Date.now() / 1000});
  await until(page, () => !document.querySelector('.tab.on .st.wait') && !document.querySelector('.tab.on .st.busy'));
  assert.equal(await page.evaluate(() => tab(S.active).sid), 'sess-x', '탭 ↔ 세션을 기억 (다시 켤 때 이어 열기)');
});

test('터미널 찾기 (⌘F)', async () => {
  await page.evaluate(() => { tab(S.active).term.write('\r\nhello epeira search\r\n'); openFind(); });
  await page.fill('#find-q', 'epeira search');
  await until(page, () => /\d+\/\d+/.test(document.getElementById('find-n').textContent));
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('find').hidden), true);
});

test('탭 이름 바꾸기', async () => {
  await page.dblclick('.tab.on .tab-main');
  await page.fill('.tab-rename', '백엔드');
  await page.keyboard.press('Enter');
  assert.deepEqual(await labels(page), ['백엔드']);
});

test('테마: 라이트 · 다크로 바꾸면 화면과 터미널이 함께', async () => {
  const look = () => page.evaluate(() => [getComputedStyle(document.body).backgroundColor, tab(S.active).term.options.theme.background]);
  await page.evaluate(() => chooseTheme('dark'));
  assert.deepEqual(await look(), ['rgb(10, 10, 10)', '#0a0a0a']);
  await page.evaluate(() => chooseTheme('light'));
  assert.deepEqual(await look(), ['rgb(251, 251, 251)', '#fbfbfb']);
  await page.evaluate(() => chooseTheme('system'));
});

test('다시 켜면 프로젝트별 탭과 마지막 프로젝트가 돌아온다', async () => {
  await page.evaluate(() => selectProject(S.projects[1].path));
  const before = await labels(page);
  await answer(app, 0);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await app.evaluate(({Notification}) => { Notification.isSupported = () => false; });
  await until(page, () => typeof S !== 'undefined' && S.tabs.length === 2);
  assert.equal(await page.evaluate(() => S.current === S.projects[1].path), true, '마지막에 보던 프로젝트');
  assert.deepEqual(await labels(page), before);
  const alphaTab = await page.evaluate(() => { const t = projTabs(S.projects[0].path)[0]; return {title: t.title, sid: t.sid}; });
  assert.deepEqual(alphaTab, {title: '백엔드', sid: 'sess-x'});
});

test('궤도 패널의 "이 탭으로 가기"로 그 탭을 연다', async () => {
  await page.evaluate(() => document.getElementById('orbit-view').dispatchEvent(Object.assign(new Event('console-message'), {message: 'epeira:focus {"id":"sess-x"}'})));
  assert.equal(await page.evaluate(() => S.current === S.projects[0].path && tab(S.active).sid), 'sess-x');
});

test('궤도 HUB 이름을 바꾸면 탭 이름도 바뀐다', async () => {
  await send(app, {kind: 'name', id: 'sess-x', name: 'API 서버'});
  await until(page, () => [...document.querySelectorAll('.tab-main span:not(.k)')].some(e => e.textContent === 'API 서버'));
});

test('지난 세션 목록: 열려 있는 세션을 누르면 그 탭으로', async () => {
  await stub();
  await page.evaluate(() => selectProject(S.projects[1].path));
  await page.evaluate(() => loadSessions());
  await page.evaluate(() => selectProject(S.projects[0].path));
  await until(page, () => !!document.querySelector('.proj.on .sess'));
  assert.deepEqual(await page.$$eval('.proj.on .sess-name', els => els.map(e => e.textContent)), ['API 서버', '로그인 버그 고쳐줘'], '직접 붙인 이름 > 첫 질문');
  await page.click('.proj.on .sess');
  assert.equal(await page.evaluate(() => tab(S.active).sid), 'sess-x');
});

test('다시 켤 때 대화는 그 탭을 처음 볼 때 이어서 연다', async () => {
  const r = await page.evaluate(async () => { const t = await openTab(S.projects[0].path, 'claude', {sid: 'abc-123', resume: true, quiet: true}); return {id: t.id, run: t.pendingRun, active: S.active === t.id}; });
  assert.deepEqual([r.run, r.active], ['claude --resume abc-123', false], '보기 전엔 실행하지 않는다');
  await page.evaluate(id => closeTab(id), r.id);  // 실제 claude 를 띄우지 않고 닫는다
  assert.equal(await page.evaluate(id => !!tab(id), r.id), false);
});

test('화면 나누기: 지금 칸을 계속 나눠 n×n · 칸 이동 · 크게 보기 · 닫기 · 풀기', async () => {
  const panes = () => page.evaluate(() => projTabs().filter(t => !t.el.hidden).map(t => { const r = t.el.getBoundingClientRect(); return {id: t.id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width)}; }));
  const first = await page.evaluate(() => S.active);
  await page.evaluate(() => splitPane('cols'));  // [A | B]
  await page.evaluate(() => splitPane('rows'));  // [A | B 위 / C 아래]
  let p = await panes();
  assert.equal(p.length, 3, '세 칸');
  const [b, c] = p.filter(x => x.id !== first).sort((m, n) => m.y - n.y);
  assert.ok(b.x === c.x && c.y > b.y, `오른쪽 칸이 위아래로: ${JSON.stringify(p)}`);
  await page.evaluate(() => moveFocus('left'));
  assert.equal(await page.evaluate(() => S.active), first, '⌘⌥← 로 왼쪽 칸');
  await page.evaluate(() => splitPane('cols'));  // 왼쪽 칸은 좁아서 더 못 나눈다
  assert.equal((await panes()).length, 3, '공간이 부족하면 나누지 않는다');
  await page.evaluate(() => toggleZoom());
  assert.equal((await panes()).length, 1, '크게 보기');
  await page.evaluate(() => toggleZoom());
  assert.equal((await panes()).length, 3);
  await answer(app, 0);
  await page.evaluate(id => closeTab(id), c.id);
  assert.equal((await panes()).length, 2, '칸을 닫으면 옆 칸이 채운다');
  await page.evaluate(() => unsplit());
  assert.equal((await panes()).length, 1, '나누기 모두 풀기');
});

test('사이드바에 git 브랜치', async () => {
  await page.evaluate(() => loadGit());
  await until(page, () => [...document.querySelectorAll('.proj-text small')].some(e => e.textContent.startsWith('⎇')));
});

test('터미널 글자 크기 설정', async () => {
  await page.evaluate(() => setPref('fontSize', 15));
  assert.equal(await page.evaluate(() => tab(S.active).term.options.fontSize), 15);
  await page.evaluate(() => setPref('fontSize', 13));
});

test('다시 켜면 칸 배치도 돌아온다', async () => {
  await page.evaluate(() => splitPane('cols'));
  await until(page, () => projTabs().filter(t => !t.el.hidden).length === 2);
  await answer(app, 0);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await app.evaluate(({Notification}) => { Notification.isSupported = () => false; });
  await until(page, () => typeof S !== 'undefined' && S.tabs.length > 0 && projTabs().filter(t => !t.el.hidden).length === 2);
});

test('나눈 칸마다 이름표', async () => {
  await until(page, () => projTabs().filter(t => !t.el.hidden).length === 2);
  const names = await page.$$eval('.term.paned .pane-name', els => els.filter(e => e.offsetParent).map(e => e.textContent));
  assert.equal(names.length, 2);
  await page.evaluate(() => unsplit());
});

test('명령 팔레트 (⌘P): 프로젝트로 이동 · 기록 검색', async () => {
  await stub();
  await page.evaluate(() => openPalette());
  await page.fill('.pal-q', 'beta');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => S.current === S.projects[1].path), true);
  await page.evaluate(() => { openPalette(); });
  await page.fill('.pal-q', 'npm');
  await until(page, () => [...document.querySelectorAll('.pal-g')].some(e => e.textContent === '기록'));
  await page.keyboard.press('Escape');
});

test('설정 창 목차 · 단축키 안내', async () => {
  await page.evaluate(() => openSettings(undefined, 'terminal'));
  await until(page, () => document.querySelector('.set-nav [aria-current]') && document.querySelector('.set-nav [aria-current]').textContent === '터미널');
  await page.evaluate(() => openShortcuts());
  assert.equal(await page.textContent('#modal-title'), '단축키');
  await page.keyboard.press('Escape');
});

test('탭을 끌어 순서 바꾸기 · 넘치면 탭 목록 버튼', async () => {
  await page.evaluate(async () => { for (let i = 0; i < 8; i++) await openTab(S.current, 'shell', {quiet: true}); renderTabs(); });
  await until(page, () => !document.getElementById('tab-more').hidden);
  const last = await page.evaluate(() => { const l = projTabs(); moveTab(l[l.length - 1].id, l[0].id); return l[l.length - 1].id; });
  assert.equal(await page.evaluate(() => projTabs()[0].id), last, '마지막 탭을 맨 앞으로');
});

test('놓친 알림은 종 아이콘에 모인다', async () => {
  const id = await page.evaluate(() => projTabs().find(t => t.id !== S.active).id);  // 보고 있지 않은 탭
  await send(app, {kind: 'tab', tab: id, id: 'sess-y'});
  await send(app, {kind: 'start', id: 'sess-y', agent: 'claude', tool: 't9', text: 'Bash ls', ts: Date.now() / 1000});
  await send(app, {kind: 'done', id: 'sess-y', agent: 'claude', text: 'turn complete', ts: Date.now() / 1000});
  await until(page, () => S.inbox.length > 0 && !!document.querySelector('.sb-count'));
});

test('업데이트: 우리 서명이 맞고 안의 버전도 맞는 DMG 만 받아 둔다', async () => {
  const contents = path.join(tmp, 'pkg/Epeira.app/Contents'), dmgFile = path.join(tmp, 'u.dmg');
  mkdirSync(contents, {recursive: true});
  writeFileSync(path.join(contents, 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>9.9.9</string></dict></plist>');
  execFileSync('hdiutil', ['create', '-quiet', '-srcfolder', path.join(tmp, 'pkg'), '-volname', 'Epeira', '-format', 'UDZO', dmgFile]);
  const dmg = readFileSync(dmgFile), arch = process.arch === 'arm64' ? '-arm64' : '';
  const put = (v, sig) => { releases.set(`/v${v}/Epeira-${v}${arch}.dmg`, dmg); releases.set(`/v${v}/Epeira-${v}${arch}.dmg.sig`, sig.toString('base64')); };
  put('9.9.9', sign(null, dmg, testKey.privateKey));
  put('9.9.8', sign(null, Buffer.from('다른 파일'), testKey.privateKey));  // 다른 파일의 서명
  put('9.9.7', sign(null, dmg, testKey.privateKey));  // 서명은 맞지만 안의 앱은 9.9.9 → 예전 DMG 를 새 버전이라 내미는 경우
  await answer(app, 1);  // 다시 시작은 "나중에"
  await page.evaluate(() => { window.prog = []; window.orbit.onUpdateProgress(stage => window.prog.push(stage)); });
  assert.deepEqual(await page.evaluate(() => window.orbit.installUpdate('9.9.9')), {ok: true, later: true});
  const prog = await page.evaluate(() => window.prog);
  assert.ok(prog[0] === 'download' && prog.includes('verify') && prog.at(-1) === null, `진행 막대: 받기 → 확인 → 끝 ${JSON.stringify(prog)}`);
  assert.match((await page.evaluate(() => window.orbit.installUpdate('9.9.8'))).error, /서명/);
  assert.match((await page.evaluate(() => window.orbit.installUpdate('9.9.7'))).error, /9\.9\.9/);
  assert.match((await page.evaluate(() => window.orbit.installUpdate('9.9.6'))).error, /404/, '없는 릴리스');
  assert.deepEqual(await page.evaluate(() => window.orbit.installUpdate('0.0.1')), {ok: false}, '예전 버전으로는 바꾸지 않는다');
});

test('⌘⌫ 로 터미널의 지금 줄을 지운다', async () => {
  await page.evaluate(async dir => { selectProject(dir); await openTab(dir, 'shell'); }, alpha);
  const text = () => page.evaluate(() => { const b = tab(S.active).term.buffer.active, out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i).translateToString().trimEnd()); return out.join('\n'); });
  await until(page, () => { const b = tab(S.active).term.buffer.active; for (let i = 0; i < b.length; i++) if (b.getLine(i).translateToString().trim()) return true; return false; });
  await page.evaluate(() => tab(S.active).term.focus());
  await page.keyboard.type('echo zzz');
  await page.keyboard.press('Meta+Backspace');
  await page.keyboard.type('echo yyy');
  await page.keyboard.press('Enter');
  await until(page, () => { const b = tab(S.active).term.buffer.active; for (let i = 0; i < b.length; i++) if (b.getLine(i).translateToString().trim() === 'yyy') return true; return false; });
  assert.ok(!(await text()).includes('zzz'), '지운 줄은 실행되지 않고 화면에서도 사라진다');
});

test('사이드바 프로젝트 메뉴(⋯ · 우클릭): 새 터미널 · 터미널이 열린 프로젝트는 묻고 닫은 뒤 뺀다', async () => {
  const row = `.proj[title="${beta}"]`;
  const pick = async (label, right) => {
    if (right) await page.click(row, {button: 'right'});
    else { await page.hover(row); await page.click(`${row} .proj-more`); }
    await page.click(`#menu button:has-text("${label}")`);
  };
  const before = await page.evaluate(dir => projTabs(dir).length, beta);
  await pick('새 터미널');
  await until(page, ([dir, n]) => projTabs(dir).length === n + 1, [beta, before]);
  await answer(app, 1);  // 취소
  await pick('목록에서 빼기');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(dir => S.projects.some(p => p.path === dir), beta), true, '취소하면 그대로');
  await answer(app, 0);  // 닫고 빼기
  await pick('목록에서 빼기', true);
  await until(page, dir => !S.projects.some(p => p.path === dir) && !S.tabs.some(t => t.dir === dir), beta);
  await page.evaluate(async dir => { S.projects = (await window.orbit.addProjectPath(dir)).list; renderProjects(); }, beta);  // 다시 넣어 두기
});

test('설정의 업데이트 확인: 바로 묻고, 새 버전이 있으면 업데이트 버튼', async () => {
  releases.set('/app-version.json', JSON.stringify({version: '9.9.9', url: 'https://example.com/r'}));
  await page.evaluate(() => openSettings(undefined, 'help'));
  await page.click('.set-body button:text-is("업데이트 확인")');
  await until(page, () => S.update && S.update.version === '9.9.9');
  await until(page, () => [...document.querySelectorAll('.set-body button')].some(b => b.textContent === '업데이트'));
  assert.ok(await page.evaluate(() => document.querySelector('.set-body').textContent.includes(`Epeira v${S.appVersion}`)));
  await page.keyboard.press('Escape');
});

test('설정에서 터미널 글꼴 고르기: 터미널에만 쓰고, 기본으로 되돌리면 원래대로', async () => {
  assert.ok((await page.evaluate(() => window.orbit.fonts())).includes('Menlo'), '이 Mac 에 설치된 글꼴 목록');
  if (!(await page.evaluate(() => S.tabs.length))) await page.evaluate(() => openTab(S.projects[0].path, 'shell'));
  const mono = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mono'));
  const before = await mono();
  await page.evaluate(() => openSettings(undefined, 'terminal'));
  await page.selectOption('.set-body select[aria-label="글꼴"]', 'Menlo');
  await until(page, () => S.tabs.every(t => t.term.options.fontFamily.startsWith('"Epeira Keys", "Menlo"')));
  assert.equal(await mono(), before, '앱의 다른 글자는 그대로');
  await page.selectOption('.set-body select[aria-label="글꼴"]', '');
  await until(page, () => S.tabs.every(t => t.term.options.fontFamily.startsWith('"Epeira Keys", "SF Mono"')));
  await page.keyboard.press('Escape');
});

test('프로젝트 세션 목록 펼치기 · 접기: 지금 프로젝트가 아니어도', async () => {
  const row = dir => `.proj[title="${dir}"]`, shown = dir => page.$(`${row(dir)} .proj-detail`).then(Boolean);
  await page.evaluate(dir => selectProject(dir), alpha);
  await until(page, sel => document.querySelector(sel + ' .proj-detail'), row(alpha));
  await page.click(`${row(alpha)} .proj-fold`);
  assert.equal(await shown(alpha), false, '접으면 숨긴다');
  await page.click(`${row(alpha)} .proj-fold`);
  assert.equal(await shown(alpha), true);
  assert.equal(await shown(beta), false);
  await page.click(`${row(beta)} .proj-fold`);
  assert.equal(await shown(beta), true, '다른 프로젝트도 펼칠 수 있다');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('app.folds'))[S.projects[1].path]), true, '다시 켜도 기억');
  await page.click(`${row(beta)} .proj-fold`);
});
