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

const require = createRequire(import.meta.url);
const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'tycho-test-'));
const data = path.join(tmp, 'data'), alpha = path.join(tmp, 'alpha'), beta = path.join(tmp, 'beta');
for (const d of [data, alpha, beta]) mkdirSync(d);
writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{path: alpha, name: 'alpha'}, {path: beta, name: 'beta'}]));

const launch = () => electron.launch({executablePath: require('electron'), args: [APP_DIR, `--user-data-dir=${data}`],
  env: {...process.env, AGENT_ORBIT_URL: 'http://127.0.0.1:9', TYCHO_TEST: '1'}});  // 수집기 없음 → 실제 설치를 건드리지 않음, 창은 숨김
const until = async (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: 8000});
const labels = page => page.$$eval('.tab-main span:not(.k)', els => els.map(e => e.textContent));
const send = (app, e) => app.evaluate(({BrowserWindow}, ev) => BrowserWindow.getAllWindows()[0].webContents.send('orbit:event', ev), e);
const answer = (app, response) => app.evaluate(({dialog}, r) => { dialog.showMessageBox = async () => ({response: r}); dialog.showMessageBoxSync = () => r; }, response);

let app, page;
after(async () => { if (app) await app.close().catch(() => {}); rmSync(tmp, {recursive: true, force: true}); });

test('프로젝트 목록과 번호 붙은 탭 이름', async () => {
  app = await launch();
  page = await app.firstWindow();
  await app.evaluate(({Notification}) => { Notification.isSupported = () => false; });  // 테스트 중 macOS 알림을 띄우지 않게
  await until(page, () => typeof S !== 'undefined' && S.projects.length === 2);
  await page.evaluate(() => selectProject(S.projects[0].path));
  await until(page, () => S.tabs.length === 1);
  await page.evaluate(() => openTab(S.projects[0].path, 'shell'));
  await until(page, () => S.tabs.length === 2);
  assert.deepEqual(await labels(page), ['alpha', 'alpha 2']);
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
  assert.equal(await page.evaluate(() => S.tabs.length), 2, '취소하면 그대로');
  await answer(app, 0);  // 닫기
  await page.evaluate(() => closeTab());
  await until(page, () => S.tabs.length === 1);
});

test('수집기 이벤트로 탭 상태 표시: 일하는 중 → 승인 대기 → 끝', async () => {
  const id = await page.evaluate(() => S.active);
  await send(app, {kind: 'tab', tab: id, id: 'sess-x'});
  await send(app, {kind: 'start', id: 'sess-x', agent: 'claude', tool: 't1', text: 'Bash ls', ts: Date.now() / 1000});
  await until(page, () => !!document.querySelector('.tab.on .st.busy'));
  await send(app, {kind: 'notify', id: 'sess-x', agent: 'claude', text: 'Claude needs your permission to use Bash', ts: Date.now() / 1000});
  await until(page, () => !!document.querySelector('.tab.on .st.wait'));
  await send(app, {kind: 'done', id: 'sess-x', agent: 'claude', text: 'turn complete', ts: Date.now() / 1000});
  await until(page, () => !document.querySelector('.tab.on .st.wait') && !document.querySelector('.tab.on .st.busy'));
  assert.equal(await page.evaluate(() => S.tabs[0].sid), 'sess-x', '탭 ↔ 세션을 기억 (다시 켤 때 이어 열기)');
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

test('다시 켜면 탭이 돌아온다', async () => {
  await page.evaluate(() => openTab(S.projects[1].path, 'shell'));
  await until(page, () => S.tabs.length === 2);
  const before = await labels(page);
  await answer(app, 0);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await app.evaluate(({Notification}) => { Notification.isSupported = () => false; });
  await until(page, n => typeof S !== 'undefined' && S.tabs.length === n, before.length);
  assert.deepEqual(await labels(page), before);
  assert.equal(await page.evaluate(() => S.tabs[0].sid), 'sess-x');
});
