// 앱 기본 시나리오 자동 테스트: npm test
// 임시 앱 데이터 폴더 + 없는 수집기 주소로 띄워서 실제 프로젝트 목록 · 수집기 설치는 건드리지 않는다
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {_electron as electron} from 'playwright-core';
import {execFileSync} from 'node:child_process';

const require = createRequire(import.meta.url);
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'tycho-test-'));
const data = path.join(tmp, 'data'), alpha = path.join(tmp, 'alpha'), beta = path.join(tmp, 'beta');
for (const d of [data, alpha, beta]) mkdirSync(d);
execFileSync('git', ['init', '-q', beta]);  // beta 는 git 저장소 (사이드바 브랜치 표시)
writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{path: alpha, name: 'alpha'}, {path: beta, name: 'beta'}]));

const launch = () => electron.launch({executablePath: require('electron'), args: [APP_DIR, `--user-data-dir=${data}`],
  env: {...process.env, AGENT_ORBIT_URL: 'http://127.0.0.1:9', TYCHO_TEST: '1'}});  // 수집기 없음 → 실제 설치를 건드리지 않음, 창은 숨김
const until = async (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: 8000});
const labels = page => page.$$eval('.tab-main span:not(.k)', els => els.map(e => e.textContent));
const send = (app, e) => app.evaluate(({BrowserWindow}, ev) => BrowserWindow.getAllWindows()[0].webContents.send('orbit:event', ev), e);
const answer = (app, response) => app.evaluate(({dialog}, r) => { dialog.showMessageBox = async () => ({response: r}); dialog.showMessageBoxSync = () => r; }, response);

let app, page;
after(async () => { if (app) await app.close().catch(() => {}); rmSync(tmp, {recursive: true, force: true}); });

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
  await page.evaluate(() => { tab(S.active).term.write('\r\nhello tycho search\r\n'); openFind(); });
  await page.fill('#find-q', 'tycho search');
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

test('라이트 테마로 바꾸면 터미널도 밝게', async () => {
  await page.evaluate(() => window.orbit.setTheme('light'));
  await until(page, () => tab(S.active).term.options.theme.background === '#fbfbfb');
  await page.evaluate(() => window.orbit.setTheme('system'));
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
  await page.evaluate(() => document.getElementById('orbit-view').dispatchEvent(Object.assign(new Event('console-message'), {message: 'tycho:focus {"id":"sess-x"}'})));
  assert.equal(await page.evaluate(() => S.current === S.projects[0].path && tab(S.active).sid), 'sess-x');
});

test('궤도 HUB 이름을 바꾸면 탭 이름도 바뀐다', async () => {
  await send(app, {kind: 'name', id: 'sess-x', name: 'API 서버'});
  await until(page, () => [...document.querySelectorAll('.tab-main span:not(.k)')].some(e => e.textContent === 'API 서버'));
});

test('지난 세션 목록: 열려 있는 세션을 누르면 그 탭으로', async () => {
  await app.evaluate(({ipcMain}, dir) => {
    ipcMain.removeHandler('orbit:get');
    ipcMain.handle('orbit:get', (_, p) => (p.startsWith('/api/summary') ? {sessions: [{id: 'sess-x', agent: 'claude', cwd: dir, label: 'alpha', text: '버그 고치기', last: Date.now() / 1000 - 3600}]} : null));
  }, alpha);
  await page.evaluate(() => selectProject(S.projects[1].path));
  await page.evaluate(() => loadSessions());
  await page.evaluate(() => selectProject(S.projects[0].path));
  await until(page, () => !!document.querySelector('.proj.on .sess'));
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
