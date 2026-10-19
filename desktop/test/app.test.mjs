// 앱 자동 테스트: pnpm test (먼저 빌드한다)
// React 로 옮기는 동안은 메인 프로세스 · preload 가 그대로 동작하는지를 본다. 화면 시나리오는 옮기면서 test/legacy 에서 하나씩 가져온다
// 임시 앱 데이터 폴더 + 없는 수집기 주소로 띄워서 실제 프로젝트 목록 · 수집기 설치는 건드리지 않는다
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

const require = createRequire(import.meta.url);
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const VERSION = JSON.parse(readFileSync(path.join(APP_DIR, "package.json"), "utf8")).version;
const tmp = mkdtempSync(path.join(tmpdir(), "epeira-test-"));
const data = path.join(tmp, "data");
const alpha = path.join(tmp, "alpha");
for (const d of [data, alpha]) mkdirSync(d);

// 릴리스 서버 흉내: 시험용 키로 서명한 DMG 를 준다 (앱에 든 공개 키는 EPEIRA_TEST 일 때만 바꿀 수 있다)
const testKey = generateKeyPairSync("ed25519");
const releases = new Map();
const updates = createServer((req, res) => {
  const f = releases.get(req.url);
  res.writeHead(f ? 200 : 404, f ? { "Content-Length": Buffer.byteLength(f) } : {});
  res.end(f);
});
await new Promise((r) => updates.listen(0, "127.0.0.1", r));

let app;
let page;
const answer = (response) =>
  app.evaluate(({ dialog }, r) => {
    dialog.showMessageBox = async () => ({ response: r });
    dialog.showMessageBoxSync = () => r;
  }, response);

const menu = (action) =>
  app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send("menu", a), action);
const until = async (fn, what) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await page.waitForTimeout(100);
  }
  assert.fail(what);
};

before(async () => {
  app = await electron.launch({
    executablePath: require("electron"),
    args: [APP_DIR, `--user-data-dir=${data}`],
    env: {
      ...process.env,
      AGENT_ORBIT_URL: "http://127.0.0.1:9", // 수집기 없음 → 실제 설치를 건드리지 않음
      EPEIRA_TEST: "1", // 창은 숨김
      TMPDIR: tmp, // 받은 업데이트도 임시 폴더에
      EPEIRA_UPDATE_BASE: `http://127.0.0.1:${updates.address().port}`,
      EPEIRA_UPDATE_KEY: testKey.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    },
  });
  page = await app.firstWindow();
  await app.evaluate(({ Notification }) => {
    Notification.isSupported = () => false; // 테스트 중 macOS 알림을 띄우지 않게
  });
});

after(async () => {
  if (app) {
    await answer(0).catch(() => {});
    await app.close().catch(() => {});
  }
  updates.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("React 화면이 뜨고 preload API 만 열린다", async () => {
  await page.waitForSelector('[role="tablist"]', { state: "attached" });
  assert.equal(await page.evaluate(() => window.epeira.appVersion()), VERSION);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined", "화면에 Node 를 열지 않는다");
  assert.equal(await page.evaluate(() => window.epeira.orbitUrl), "http://127.0.0.1:9");
  assert.match(await page.evaluate(() => document.documentElement.dataset.theme), /^(dark|light)$/, "테마를 건다");
});

test("앱 뼈대: 사이드바 · 탭 줄 · 궤도 패널 · 상태바, ⌘B · ⌘J 로 접고 그 상태를 기억", async () => {
  const has = (label) => page.evaluate((l) => !!document.querySelector(`[aria-label="${l}"]`), label);
  for (const label of ["프로젝트", "터미널 탭", "에이전트 궤도", "연결 상태와 오늘 사용량"])
    assert.ok(await has(label), label);
  await menu("toggle-side");
  await page.waitForFunction(() => !document.querySelector('aside[aria-label="프로젝트"]'));
  await menu("toggle-orbit");
  await page.waitForFunction(() => !document.querySelector('[aria-label="에이전트 궤도"]'));
  assert.deepEqual(
    await page.evaluate(() => [localStorage.getItem("app.no-side"), localStorage.getItem("app.no-orbit")]),
    ["1", "1"],
    "예전 화면과 같은 키에 저장",
  );
  await menu("toggle-side");
  await menu("toggle-orbit");
  await page.waitForFunction(() => !!document.querySelector('[aria-label="에이전트 궤도"]'));
  assert.ok(await has("프로젝트"));
});

test("탭: 폴더를 열고 새 터미널 → 입력하면 셸이 실행 · ⌘⌫ 로 줄 지우기 · 닫으면 시작 화면", async () => {
  // 폴더 열기 창 대신 alpha 를 고른 것으로
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, alpha);
  // 메인이 화면으로 보내는 터미널 출력을 모은다 (xterm 은 캔버스에 그려서 화면 글자를 직접 읽을 수 없다)
  await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    const send = wc.send.bind(wc);
    globalThis.ptyOut = "";
    wc.send = (channel, ...args) => {
      if (channel === "pty:data") globalThis.ptyOut += args[1];
      return send(channel, ...args);
    };
  });
  const out = () => app.evaluate(() => globalThis.ptyOut);
  const tabs = () =>
    page.$$eval('[role="tab"]', (els) =>
      els.map((e) => [e.querySelector(".truncate").textContent, e.getAttribute("aria-selected")]),
    );

  await page.click('button[aria-label="폴더 열기"]');
  await until(() => page.$("text=터미널만 열기"), "프로젝트를 고르면 시작 화면에 새 세션 버튼");
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await tabs()).length === 1, "새 탭");
  assert.deepEqual(await tabs(), [["터미널", "true"]]);
  await until(async () => (await out()).length > 0, "셸 프롬프트");
  await page.waitForTimeout(500);

  await page.keyboard.type("echo zzz-$((1+1))");
  await page.keyboard.press("Meta+Backspace");
  await page.keyboard.type("echo yyy-$((1+1))");
  await page.keyboard.press("Enter");
  await until(async () => (await out()).includes("yyy-2"), "입력한 명령이 실행된다");
  assert.ok(!(await out()).includes("zzz-2"), "⌘⌫ 로 지운 줄은 실행되지 않는다");

  // 두 번째 탭 → ⌘1 · ⌘2 로 오가기
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await tabs()).length === 2, "두 번째 탭");
  assert.deepEqual(
    (await tabs()).map(([label, on]) => [label.replace(/⌘\d$/, ""), on]),
    [
      ["터미널", "false"],
      ["터미널 2", "true"],
    ],
  );
  await page.keyboard.press("Meta+1");
  await until(async () => (await tabs())[0][1] === "true", "⌘1");

  // 셸을 끝내면 탭이 흐려지고, 닫으면 시작 화면
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await until(() => page.$('div:has(> button[role="tab"][aria-selected="true"]).opacity-55'), "끝난 탭은 흐리게");
  // 앞 탭을 먼저 닫으면 뒤 탭 이름이 "터미널"로 당겨지므로 뒤에서부터
  for (const label of ["터미널 2 탭 닫기", "터미널 탭 닫기"]) await page.click(`button[aria-label="${label}"]`);
  await until(async () => (await tabs()).length === 0, "모두 닫기");
  assert.ok(await page.$("text=터미널만 열기"), "시작 화면");
});

test("칸: ⌘D · ⇧⌘D 로 나누고, 옆 칸으로 · 크게 보기 · 탭을 칸에 끌어 놓기 · 칸 닫기 · 나누기 풀기", async () => {
  // 앞 테스트에서 alpha 를 열어 둔 시작 화면에서 시작
  const panes = () =>
    page.$$eval("[data-pane]", (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return {
          label: e.querySelector(".truncate")?.textContent ?? null,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          focused: e.contains(document.activeElement),
        };
      }),
    );
  const focusedPane = async () => (await panes()).findIndex((p) => p.focused);

  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await panes()).length === 1, "새 탭");
  await menu("split");
  await until(async () => (await panes()).length === 2, "⌘D 좌우로 나누기");
  let [a, b] = await panes();
  assert.ok(a.y === b.y && a.x < b.x && Math.abs(a.w - b.w) <= 1, "왼쪽 · 오른쪽 같은 크기");
  await menu("split-rows");
  await until(async () => (await panes()).length === 3, "⇧⌘D 위아래로 나누기");
  const [, top, bottom] = await panes();
  assert.ok(top.x === bottom.x && top.y < bottom.y, "오른쪽 칸이 위 · 아래로");
  assert.deepEqual(
    (await panes()).map((p) => p.label),
    ["터미널", "터미널 2", "터미널 3"],
  );
  await until(async () => (await focusedPane()) === 2, "새 칸에 입력 위치");

  await menu("split"); // 오른쪽 아래 칸은 반으로 나누면 너무 좁다
  await until(() => page.$("text=나눌 공간이 부족해요"), "공간이 부족하면 알림");
  assert.equal((await panes()).length, 3);

  await menu("pane-left");
  await until(async () => (await focusedPane()) === 0, "⌥⌘← 왼쪽 칸");
  assert.equal(await page.$eval('[role="tab"][aria-selected="true"] .truncate', (e) => e.textContent), "터미널");
  await menu("pane-zoom");
  await until(async () => (await panes()).length === 1, "⇧⌘↩ 크게 보기");
  await menu("pane-zoom");
  await until(async () => (await panes()).length === 3, "다시 누르면 원래대로");

  // 구분선을 끌면 크기가 바뀌고, 두 번 누르면 같은 크기로. 끌고 나도 입력 위치는 터미널에
  const sep = await page.$("[data-pane-area] [role=separator]").then((e) => e.boundingBox());
  await page.mouse.move(sep.x + sep.width / 2, sep.y + 200);
  await page.mouse.down();
  await page.mouse.move(sep.x - 150, sep.y + 200, { steps: 6 });
  await page.mouse.up();
  await until(async () => (await panes())[0].w < (await panes())[1].w - 100, "구분선 끌기");
  await until(async () => (await focusedPane()) === 0, "끌고 나도 입력 위치는 터미널");
  await page.mouse.dblclick(sep.x - 150 + sep.width / 2, sep.y + 200);
  await until(async () => Math.abs((await panes())[0].w - (await panes())[1].w) <= 1, "두 번 누르면 같은 크기");

  // 탭 줄의 "터미널 3" 을 첫 칸에 끌어 놓으면 두 칸이 자리를 바꾼다
  const from = await page.$$('[role="tab"]').then((t) => t[2].boundingBox());
  const to = await page.$("[data-pane]").then((e) => e.boundingBox());
  await page.mouse.move(from.x + 30, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 60, { steps: 4 });
  await page.mouse.move(to.x + 100, to.y + 200, { steps: 8 });
  await page.mouse.up();
  await until(async () => (await panes())[0].label === "터미널 3", "끌어 놓은 칸에 그 탭");
  assert.deepEqual(
    (await panes()).map((p) => p.label),
    ["터미널 3", "터미널 2", "터미널"],
  );

  await page.waitForTimeout(100); // dnd-kit 은 놓은 직후 50ms 동안 클릭을 막는다 (끌기 끝의 클릭이 탭을 누르지 않게)
  await page.click('button[aria-label="터미널 3 칸 닫기"]');
  await until(async () => (await panes()).length === 2, "칸 닫기 → 옆 칸이 자리를 채움");
  await menu("unsplit");
  await until(async () => (await panes()).length === 1, "⌥⌘W 나누기 풀기");
  assert.equal(await page.$$eval('[role="tab"]', (t) => t.length), 2, "터미널은 탭으로 남는다");

  // 탭 줄에서 끌어 순서 바꾸기: 지금 탭을 옆 탭 자리로
  const selected = () =>
    page.$$eval('[role="tab"]', (t) => t.findIndex((e) => e.getAttribute("aria-selected") === "true"));
  const was = await selected();
  const tabBoxes = await page.$$('[role="tab"]').then((t) => Promise.all(t.map((e) => e.boundingBox())));
  const [src, dst] = [tabBoxes[was], tabBoxes[1 - was]];
  await page.mouse.move(src.x + 30, src.y + 10);
  await page.mouse.down();
  await page.mouse.move(src.x + 40, src.y + 10, { steps: 3 });
  await page.mouse.move(dst.x + dst.width / 2, dst.y + 10, { steps: 8 });
  await page.mouse.up();
  await until(async () => (await selected()) === 1 - was, "끌어 놓은 자리로 순서가 바뀐다");
  await menu("close-tab");
  await menu("close-tab");
  await until(() => page.$("text=터미널만 열기"), "시작 화면");
});

test("프로젝트 목록: 폴더만 넣고, 뺄 수 있다", async () => {
  const added = await page.evaluate((dir) => window.epeira.addProjectPath(dir), alpha);
  assert.equal(added.added, alpha);
  assert.ok(added.list.some((p) => p.name === "alpha" && p.exists));
  const file = path.join(tmp, "not-a-folder.txt");
  writeFileSync(file, "x");
  assert.equal((await page.evaluate((f) => window.epeira.addProjectPath(f), file)).added, null, "파일은 넣지 않는다");
  assert.ok(!(await page.evaluate((dir) => window.epeira.removeProject(dir), alpha)).some((p) => p.path === alpha));
});

test("터미널: 셸을 열고 입력하면 출력이 오고, 끌 수 있다", async () => {
  const out = await page.evaluate(async (cwd) => {
    let text = "";
    const id = await window.epeira.createTerm({ cwd, cols: 80, rows: 24 });
    const off = window.epeira.onData((tid, d) => {
      if (tid === id) text += d;
    });
    window.epeira.write(id, "echo epeira-$((40+2))\r");
    for (let i = 0; i < 100 && !text.includes("epeira-42"); i++) await new Promise((r) => setTimeout(r, 100));
    off();
    window.epeira.kill(id);
    return text;
  }, alpha);
  assert.match(out, /epeira-42/);
});

test("수집기 요청은 정해진 것만 대신 보낸다", async () => {
  assert.equal(await page.evaluate(() => window.epeira.get("/api/../../etc/passwd")), null);
  assert.equal(await page.evaluate(() => window.epeira.post("/api/uninstall", {})), null);
});

test("설정의 글꼴 고르기: 이 Mac 에 설치된 글꼴 목록", async () => {
  assert.ok((await page.evaluate(() => window.epeira.fonts())).includes("Menlo"));
});

test("업데이트: 우리 서명이 맞고 안의 버전도 맞는 DMG 만 받아 둔다", async () => {
  const contents = path.join(tmp, "pkg/Epeira.app/Contents");
  const dmgFile = path.join(tmp, "u.dmg");
  mkdirSync(contents, { recursive: true });
  writeFileSync(
    path.join(contents, "Info.plist"),
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>9.9.9</string></dict></plist>',
  );
  execFileSync("hdiutil", [
    "create",
    "-quiet",
    "-srcfolder",
    path.join(tmp, "pkg"),
    "-volname",
    "Epeira",
    "-format",
    "UDZO",
    dmgFile,
  ]);
  const dmg = readFileSync(dmgFile);
  const arch = process.arch === "arm64" ? "-arm64" : "";
  const put = (v, sig) => {
    releases.set(`/v${v}/Epeira-${v}${arch}.dmg`, dmg);
    releases.set(`/v${v}/Epeira-${v}${arch}.dmg.sig`, sig.toString("base64"));
  };
  put("9.9.9", sign(null, dmg, testKey.privateKey));
  put("9.9.8", sign(null, Buffer.from("다른 파일"), testKey.privateKey)); // 다른 파일의 서명
  put("9.9.7", sign(null, dmg, testKey.privateKey)); // 서명은 맞지만 안의 앱은 9.9.9 → 예전 DMG 를 새 버전이라 내미는 경우
  await answer(1); // 다시 시작은 "나중에"
  await page.evaluate(() => {
    window.prog = [];
    window.epeira.onUpdateProgress((stage) => window.prog.push(stage));
  });
  assert.deepEqual(await page.evaluate(() => window.epeira.installUpdate("9.9.9")), { ok: true, later: true });
  const prog = await page.evaluate(() => window.prog);
  assert.ok(
    prog[0] === "download" && prog.includes("verify") && prog.at(-1) === null,
    `진행 막대: 받기 → 확인 → 끝 ${JSON.stringify(prog)}`,
  );
  assert.match((await page.evaluate(() => window.epeira.installUpdate("9.9.8"))).error, /서명/);
  assert.match((await page.evaluate(() => window.epeira.installUpdate("9.9.7"))).error, /9\.9\.9/);
  assert.match((await page.evaluate(() => window.epeira.installUpdate("9.9.6"))).error, /404/, "없는 릴리스");
  assert.deepEqual(
    await page.evaluate(() => window.epeira.installUpdate("0.0.1")),
    { ok: false },
    "예전 버전으로는 바꾸지 않는다",
  );
});
