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
  const menu = (action) =>
    app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].webContents.send("menu", a), action);
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

test("프로젝트 목록: 폴더만 넣고, 뺄 수 있다", async () => {
  const added = await page.evaluate((dir) => window.epeira.addProjectPath(dir), alpha);
  assert.equal(added.added, alpha);
  assert.deepEqual(
    added.list.map((p) => [p.name, p.exists]),
    [["alpha", true]],
  );
  const file = path.join(tmp, "not-a-folder.txt");
  writeFileSync(file, "x");
  assert.equal((await page.evaluate((f) => window.epeira.addProjectPath(f), file)).added, null, "파일은 넣지 않는다");
  assert.deepEqual(await page.evaluate((dir) => window.epeira.removeProject(dir), alpha), []);
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
