// 궤도 대시보드(app.js) 자동 테스트: npm test
// 임시 HOME · 임시 포트로 수집기를 띄우고 시스템 Chrome 으로 연다 (Chrome 이 없으면 건너뜀). 실제 설치 · 설정은 건드리지 않는다
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const skip = !existsSync(CHROME) && 'Chrome 이 없어 건너뜀';
const tmp = mkdtempSync(path.join(tmpdir(), 'epeira-dash-'));
let port, collector, browser, page;
const errors = [];

const freePort = () => new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const hook = body => fetch(`http://127.0.0.1:${port}/hook?agent=claude&tab=`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const until = (fn, arg) => page.waitForFunction(fn, arg, {timeout: 8000});

before(async () => {
  if (skip) return;
  port = await freePort();
  collector = spawn('python3', [path.join(ROOT, 'agent_orbit.py'), 'serve'], {env: {...process.env, HOME: tmp, AGENT_ORBIT_HOME: path.join(tmp, 'ao'), AGENT_ORBIT_PORT: String(port)}, stdio: 'ignore'});
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) break; } catch { /* 아직 */ } await new Promise(r => setTimeout(r, 200)); }
  browser = await chromium.launch({executablePath: CHROME, headless: true});
  page = await browser.newPage({viewport: {width: 440, height: 760}});
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?view=mini&embed=1`);
  await page.waitForFunction(() => typeof S !== 'undefined' && S.connected);
  // 프로젝트 /w/p 에서 시작한 세션이 Bash 를 실행 중
  const base = {session_id: 'dash-1', transcript_path: '/tmp/x/dash-1.jsonl', cwd: '/w/p'};
  await hook({...base, hook_event_name: 'SessionStart', source: 'startup'});
  await hook({...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {command: 'npm test'}, tool_use_id: 'dash-t1'});
  await until(() => S.sess.has('dash-1'));
});
after(async () => {
  if (browser) await browser.close();
  if (collector) collector.kill();
  rmSync(tmp, {recursive: true, force: true});
});

test('프로젝트 경로로 궤도를 가른다 (하위 폴더 포함)', {skip}, async () => {
  await page.evaluate(() => aoFocusProject('p', '', '/w/p'));
  assert.equal(await page.evaluate(() => S.focus), 'dash-1');
  await page.evaluate(() => aoFocusProject('q', '', '/w/q'));
  assert.equal(await page.evaluate(() => S.focus), null, '다른 프로젝트엔 그 세션이 없다');
  await page.evaluate(() => aoFocusProject('w', '', '/w'));
  assert.equal(await page.evaluate(() => S.focus), 'dash-1', '/w/p 는 /w 의 하위 폴더');
});

test('HUB 를 누르면 세션 기록 + 탭으로 열기', {skip}, async () => {
  await page.evaluate(() => aoFocusProject('p', '', '/w/p'));
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const r = document.getElementById('orbit').getBoundingClientRect(), h = S.hubRect; return {x: r.left + h.x + h.w / 2, y: r.top + h.y + h.h / 2}; });
  await page.mouse.click(box.x, box.y);
  await until(() => document.querySelector('#drawer h2'));
  const buttons = await page.$$eval('#drawer .hd button', els => els.map(e => e.textContent));
  assert.ok(buttons.includes('탭으로 열기'), JSON.stringify(buttons));
  await page.keyboard.press('Escape');
});

test('실행 중인 도구는 노드가 되고, 누르면 그 도구 기록', {skip}, async () => {
  await until(() => S.drawn.some(([t, n]) => t === 'st' && n.key === 'Bash' && n.live));
  const box = await page.evaluate(() => { const n = S.drawn.find(([t, x]) => t === 'st' && x.key === 'Bash')[1], r = document.getElementById('orbit').getBoundingClientRect(); return {x: r.left + n.bx + n.bw / 2, y: r.top + n.by + n.bh / 2}; });
  await page.mouse.click(box.x, box.y);
  await until(() => document.querySelector('#drawer h2') && document.querySelector('#drawer h2').textContent.endsWith('· Bash'));
  await page.keyboard.press('Escape');
});

test('궤도를 글로도 읽을 수 있다 (화면 읽기 프로그램)', {skip}, async () => {
  await page.evaluate(() => aoFocusProject('p', '', '/w/p'));
  await until(() => document.getElementById('orbit-text').textContent.includes('실행 중: Bash npm test'));
});

test('앱에서 고른 프로젝트가 없으면 궤도가 비고, 탭을 닫은 세션은 빠진다', {skip}, async () => {
  await page.evaluate(() => aoFocusProject('', '', ''));
  assert.equal(await page.evaluate(() => S.focus), null, '프로젝트가 없으면 아무것도');
  await page.evaluate(() => aoFocusProject('p', '', '/w/p'));
  assert.equal(await page.evaluate(() => S.focus), 'dash-1');
  await page.evaluate(() => aoForget('dash-1'));
  assert.equal(await page.evaluate(() => [S.focus, S.sess.has('dash-1')].join()), ',false', '닫은 세션은 궤도에서 빠진다');
  await page.reload();
  await page.waitForFunction(() => typeof S !== 'undefined' && S.summaryReady);
  await page.evaluate(() => aoFocusProject('p', '', '/w/p'));
  assert.equal(await page.evaluate(() => S.sess.has('dash-1')), false, '새로고침해도 다시 나타나지 않는다');
  await hook({session_id: 'dash-1', transcript_path: '/tmp/x/dash-1.jsonl', cwd: '/w/p', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {file_path: '/w/p/a.ts'}, tool_use_id: 'dash-t2'});
  await until(() => S.focus === 'dash-1');  // 닫은 뒤 다시 움직이면 돌아온다
});

test('앱이 뒤에 있으면 애니메이션을 줄인다', {skip}, async () => {
  await page.evaluate(() => aoSetActive(false));
  assert.equal(await page.evaluate(() => slow), true);
  await page.evaluate(() => aoSetActive(true));
  assert.equal(await page.evaluate(() => slow), false);
});

test('스크립트 오류 없음', {skip}, () => {
  assert.deepEqual(errors, []);
});
