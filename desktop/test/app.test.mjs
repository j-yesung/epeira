// 앱 자동 테스트: pnpm test (먼저 빌드한다)
// 화면은 사람이 보는 요소(역할 · 이름 · 글자)로 다룬다. 화면 안의 함수 · 상태를 직접 부르지 않는다
// 임시 앱 데이터 폴더 + 수집기 흉내로 띄워서 실제 프로젝트 목록 · 수집기 설치는 건드리지 않는다
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

// 수집기 흉내: 상태 · 지난 세션 · 이벤트(SSE) · 궤도 대시보드. 주소를 넘기면(AGENT_ORBIT_URL) 앱은 실제 수집기 설치를 건드리지 않는다
const NOW = Date.now() / 1000;
const sessions = [
  {
    id: "abc-1",
    agent: "claude",
    cwd: alpha,
    label: "alpha",
    title: "로그인 버그 고쳐줘",
    last: NOW - 3600,
    tools: 12,
    tin: 5000,
    tokens: 1200,
  },
  { id: "recent-1", agent: "claude", cwd: alpha, label: "alpha", title: "방금 하던 대화", last: NOW + 600 },
  { id: "sub-1", parent: "abc-1", agent: "claude", cwd: alpha, label: "alpha", title: "서브에이전트", last: NOW },
];
const status = {
  version: "0.0.0",
  agents: { claude: { name: "Claude Code", installed: true, connected: true } },
  limits: { claude: { plan: "max", at: NOW, primary: { used: 83, window: 300, resets: NOW + 5400 } } },
  claudeLimits: true,
};
const streams = new Set();
const dashboardCalls = [];
const posts = [];
/** 수집기 이벤트를 앱으로 */
const emit = (event) => {
  for (const s of streams) s.write(`data: ${JSON.stringify(event)}\n\n`);
};
const collector = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (v) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(v));
  };
  if (url.pathname === "/api/status") return json(status);
  if (url.pathname === "/api/summary") return json({ sessions });
  if (url.pathname === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": hi\n\n");
    streams.add(res);
    return req.on("close", () => streams.delete(res));
  }
  if (url.pathname === "/api/search") {
    return json({
      results: [
        {
          id: "abc-1",
          agent: "claude",
          cwd: alpha,
          kind: "you",
          text: `찾은 질문 ${url.searchParams.get("q")}`,
          ts: NOW - 60,
        },
      ],
    });
  }
  if (url.pathname === "/api/preview") return json({ diff: "--- a\n+++ b\n+ epeira 훅", trust: false });
  if (req.method === "POST") {
    // 설정 창 · 탭 이름 바꾸기가 보낸 것을 모아 둔다
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    return req.on("end", () => {
      const data = JSON.parse(body || "{}");
      posts.push([url.pathname, data]);
      json(
        url.pathname === "/api/rename"
          ? { ok: true, id: data.id, name: data.name || null }
          : { ok: true, message: "완료했어요" },
      );
    });
  }
  if (url.pathname === "/record") {
    dashboardCalls.push(url.searchParams.get("c"));
    return res.end();
  }
  if (url.pathname === "/") {
    // 대시보드: 앱이 부르는 함수를 /record 로 알린다
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(`<!doctype html><script>
      const rec = (c) => fetch("/record?c=" + encodeURIComponent(c));
      window.aoFocusProject = (name, tab) => rec("focus:" + name + ":" + tab);
      window.aoSetActive = () => {};
    </script>`);
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => collector.listen(0, "127.0.0.1", r));
const ORBIT_URL = `http://127.0.0.1:${collector.address().port}`;

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

/** 화면이 셸에 보내는 입력을 모은다. 이어 열기 명령은 실제 claude 를 띄우지 않게 셸에 보내지 않는다 → 끝나면 release */
const holdResume = () =>
  app.evaluate(({ ipcMain }) => {
    globalThis.ptyWrite = ipcMain.listeners("pty:write");
    globalThis.ptyIn = [];
    ipcMain.removeAllListeners("pty:write");
    ipcMain.on("pty:write", (e, id, data) => {
      globalThis.ptyIn.push(data);
      if (!data.includes("--resume")) for (const f of globalThis.ptyWrite) f(e, id, data);
    });
  });
const releaseResume = () =>
  app.evaluate(({ ipcMain }) => {
    ipcMain.removeAllListeners("pty:write");
    for (const f of globalThis.ptyWrite) ipcMain.on("pty:write", f);
  });
const ptyIn = () => app.evaluate(() => globalThis.ptyIn.join(""));

/** ⌘W 로 지금 프로젝트의 탭을 하나씩 모두 닫고 시작 화면으로 (닫기가 끝나야 다음 탭이 지금 탭이 된다) */
const closeAll = async () => {
  const count = () => page.$$eval('[role="tab"]', (t) => t.length);
  for (let n = await count(); n > 0; n--) {
    await menu("close-tab");
    await until(async () => (await count()) === n - 1, "탭 닫기");
  }
  await until(() => page.$("text=왼쪽에서 프로젝트를 고르거나"), "시작 화면");
};

before(async () => {
  app = await electron.launch({
    executablePath: require("electron"),
    args: [APP_DIR, `--user-data-dir=${data}`],
    env: {
      ...process.env,
      AGENT_ORBIT_URL: ORBIT_URL, // 수집기 흉내 → 실제 설치를 건드리지 않음
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
  for (const s of streams) s.destroy();
  collector.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("React 화면이 뜨고 preload API 만 열린다", async () => {
  await page.waitForSelector('[role="tablist"]', { state: "attached" });
  assert.equal(await page.evaluate(() => window.epeira.appVersion()), VERSION);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined", "화면에 Node 를 열지 않는다");
  assert.equal(await page.evaluate(() => window.epeira.orbitUrl), ORBIT_URL);
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
  await until(() => page.$(`aside li[title="${alpha}"]`), "폴더를 열면 사이드바에 프로젝트");
  // 시작 화면은 안내 문장과 단축키만 (새 세션 · 터미널은 위 탭 줄에서)
  assert.ok(await page.$("[data-pane-area] >> text=왼쪽에서 프로젝트를 고르거나"));
  assert.equal(await page.$("[data-pane-area] button"), null, "시작 화면에 버튼 없음");
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
  assert.ok(await page.$("text=왼쪽에서 프로젝트를 고르거나"), "시작 화면");
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
  await closeAll();
});

test("다시 켜면: 예전 형식(app.tabs)의 탭 · 칸 배치를 되살리고, 대화는 그 탭을 처음 볼 때 이어 연다", async () => {
  await holdResume();
  const saved = {
    current: alpha,
    list: [
      { dir: alpha, kind: "shell", title: null, sid: null, last: false },
      { dir: alpha, kind: "claude", title: "API 서버", sid: "abc-123", last: false },
      { dir: path.join(tmp, "gone"), kind: "shell", title: null, sid: null, last: false }, // 없어진 폴더
      { dir: alpha, kind: "codex", title: null, sid: "bad id; rm", last: true }, // 이어 열 수 없는 세션 → 셸
    ],
    layouts: { [alpha]: { dir: "cols", ratio: 0.3, a: { t: 0 }, b: { t: 3 } } },
  };
  await page.evaluate((v) => localStorage.setItem("app.tabs", v), JSON.stringify(saved));
  await page.reload();
  await page.waitForSelector('[role="tablist"]', { state: "attached" });
  const tabs = () =>
    page.$$eval('[role="tab"]', (els) =>
      els.map(
        (e) => e.querySelector(".truncate").textContent + (e.getAttribute("aria-selected") === "true" ? "*" : ""),
      ),
    );
  await until(async () => (await tabs()).length === 3, "탭 되살리기");
  assert.deepEqual(await tabs(), ["터미널", "API 서버", "터미널 2*"], "순서 · 이름 · 마지막에 보던 탭");
  const panes = await page.$$eval("[data-pane]", (els) => els.map((e) => e.getBoundingClientRect().width));
  assert.equal(panes.length, 2, "칸 배치");
  assert.ok(Math.abs(panes[0] / (panes[0] + panes[1]) - 0.3) < 0.02, `저장된 비율: ${panes}`);
  assert.ok(!(await ptyIn()).includes("claude --resume"), "보기 전엔 대화를 열지 않는다");

  await page.click('[role="tab"]:has-text("API 서버")');
  await until(async () => (await ptyIn()).includes("claude --resume abc-123\r"), "처음 볼 때 이어 연다");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("app.tabs")));
  assert.deepEqual(
    stored.list.map((t) => [t.kind, t.title, t.sid, t.last]),
    [
      ["shell", null, null, false],
      ["claude", "API 서버", "abc-123", true],
      ["shell", null, "bad id; rm", false],
    ],
    "같은 형식으로 다시 저장 (없어진 폴더의 탭은 빠짐)",
  );
  assert.deepEqual(stored.layouts[alpha], { dir: "cols", ratio: 0.3, a: { t: 0 }, b: { t: 1 } }, "고른 탭이 그 칸에");

  await releaseResume();
  await answer(0);
  await closeAll();
});

test("사이드바: 프로젝트 고르기 · 펼치기, 탭에 열린 세션만, ⋯ 메뉴는 닫혀도 제자리 · 우클릭 메뉴, 목록에서 빼기", async () => {
  const beta = path.join(tmp, "beta");
  mkdirSync(beta, { recursive: true });
  await page.evaluate((d) => window.epeira.addProjectPath(d), beta);
  await page.reload(); // 프로젝트 목록 · 지난 세션을 다시 읽는다
  const row = (dir) => `aside li[title="${dir}"]`;
  await page.waitForSelector(row(beta));
  const names = () =>
    page.$$eval('[aria-label="열린 세션"] button', (els) => els.map((e) => e.innerText.split("\n")[0]));
  const main = (dir) => `${row(dir)} > button[aria-expanded]:not([aria-label])`;
  await page.click(main(beta)); // 다른 프로젝트를 누르면 고르고 펼친다 (지금 프로젝트를 다시 누르면 접기 · 펼치기)
  await until(async () => (await page.getAttribute(main(beta), "aria-expanded")) === "true", "beta 고르기");
  await page.click(main(alpha));
  await page.waitForSelector(`${row(alpha)} p:has-text("오늘")`);
  assert.deepEqual(await names(), [], "닫은 지난 세션은 사이드바에 없다");

  // 지난 세션은 명령 팔레트에서 이어 연다 → 탭에 열리면 사이드바의 열린 세션에
  await holdResume();
  const tabCount = () => page.$$eval('[role="tab"]', (t) => t.length);
  const palette = async (q) => {
    await menu("palette");
    await page.waitForFunction(() => document.activeElement?.matches("[cmdk-input]"));
    await page.keyboard.type(q);
  };
  await palette("로그인 버그");
  await page.click('[cmdk-group]:has-text("지난 세션") [cmdk-item]:has-text("로그인 버그 고쳐줘")');
  await until(async () => (await ptyIn()).includes("claude --resume abc-1\r"), "이어 열기");
  await until(async () => (await names()).join() === "로그인 버그 고쳐줘", "열린 세션");
  assert.equal(await page.$eval(`${row(alpha)} [title="열린 터미널 1개"]`, (e) => e.textContent), "1");

  // 열린 세션을 누르면 그 탭으로
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await tabCount()) === 2, "다른 탭");
  await page.click('[aria-label="열린 세션"] button:has-text("로그인 버그 고쳐줘")');
  await until(
    async () => (await page.$eval('[role="tab"][aria-selected="true"] .truncate', (e) => e.textContent)) === "Claude",
    "그 세션의 탭으로",
  );

  // 방금까지 움직이던 세션은 먼저 묻는다 (다른 터미널에서 아직 실행 중일 수 있어서)
  await palette("방금 하던");
  await page.click('[cmdk-item]:has-text("방금 하던 대화")');
  await page.waitForSelector('[role="dialog"]:has-text("세션 이어 열기")');
  await page.click('[role="dialog"] button:has-text("취소")');
  await until(async () => !(await page.$('[role="dialog"]')), "취소");
  assert.equal(await tabCount(), 2);
  await releaseResume();

  // ⋯ 메뉴: 닫히는 동안에도 제자리 (버튼이 숨으며 기준 위치를 잃어 왼쪽 위로 튀지 않게)
  await page.hover(row(alpha));
  await page.click('button[aria-label="alpha 메뉴"]');
  await page.waitForSelector("[role=menu]");
  await page.evaluate(() => {
    window.menuX = [];
    const tick = () => {
      const m = document.querySelector("[role=menu]");
      if (!m) return;
      window.menuX.push(m.getBoundingClientRect().x);
      requestAnimationFrame(tick);
    };
    tick();
  });
  await page.mouse.move(700, 500);
  await page.keyboard.press("Escape");
  await until(async () => !(await page.$("[role=menu]")), "메뉴 닫기");
  const xs = await page.evaluate(() => window.menuX);
  assert.ok(Math.min(...xs) > 100, `닫히는 동안 메뉴 위치: ${[...new Set(xs.map(Math.round))]}`);

  // ⋯ 메뉴로 새 터미널, 우클릭 메뉴로 목록에서 빼기
  await page.hover(row(alpha));
  await page.click('button[aria-label="alpha 메뉴"]');
  await page.click('[role="menuitem"]:has-text("새 터미널")');
  await until(async () => (await tabCount()) === 3, "⋯ → 새 터미널");
  await page.click(row(beta), { button: "right", position: { x: 120, y: 20 } });
  await page.click('[role="menuitem"]:has-text("목록에서 빼기")');
  await until(async () => !(await page.$(row(beta))), "목록에서 빼기");

  // 펼침 상태는 예전과 같은 키에 기억
  await page.click('button[aria-label="alpha 세션 접기"]');
  await until(async () => !(await page.$(`${row(alpha)} p:has-text("오늘")`)), "접기");
  assert.equal(await page.evaluate((d) => JSON.parse(localStorage.getItem("app.folds"))[d], alpha), false);

  await answer(0);
  await closeAll();
});

test("수집기: 이벤트로 탭 상태 · 놓친 알림 · Dock 배지, 상태바 사용량 · 한도, 궤도 패널에 지금 탭 알리기", async () => {
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await page.waitForSelector("[data-pane]");
  const tabId = await page.$eval("[data-pane]", (e) => e.dataset.pane);
  const footer = () => page.$eval("footer[role=status]", (e) => e.innerText.replace(/\s+/g, " "));
  await until(() => page.$('footer [role=img][aria-label="수집기에 연결됨"]'), "수집기 연결");
  assert.match(await footer(), /Claude Code 5h 83% · 7d 0%/, "사용 한도 요약만, 기록이 없는 창도 0%");
  assert.doesNotMatch(await footer(), /LIVE|도구|tok/);
  assert.ok(
    await page.$('footer [role=progressbar][aria-label="Claude Code 5시간 한도"][aria-valuenow="83"]'),
    "5시간 한도 작은 막대",
  );

  // 에이전트를 누르면 한도 상세 (올리기만 해서는 열리지 않는다)
  const agent = 'footer button:has-text("Claude Code")';
  const detail = "[data-slot=popover-content]";
  await page.hover(agent);
  await page.waitForTimeout(300);
  assert.equal(await page.$(detail), null, "올리기만 해서는 열리지 않는다");
  await page.click(agent);
  await page.waitForSelector(`${detail}:has-text("5시간")`);
  assert.equal(await page.$(`${detail}:has-text("오늘 도구")`), null, "오늘 사용량 줄은 없다");
  await page.keyboard.press("Escape");
  await until(async () => !(await page.$(detail)), "상세 닫기");

  // 궤도 패널: 지금 프로젝트 · 탭을 대시보드에 알린다
  await until(() => dashboardCalls.includes(`focus:alpha:${tabId}`), "대시보드에 지금 탭");

  // 앱이 뒤에 있을 때 생긴 일은 탭에 표시하고 놓친 알림 · Dock 배지에 남긴다
  await page.evaluate(() => {
    document.hasFocus = () => false;
  });
  const dot = () => page.$eval('[role="tab"] [role=img]', (e) => e.getAttribute("aria-label")).catch(() => null);
  emit({ kind: "tab", tab: tabId, id: "abc-1" });
  emit({ kind: "start", id: "abc-1" });
  await until(async () => (await dot()) === "일하는 중", "일하는 중");
  emit({ kind: "notify", id: "abc-1", text: "Bash 승인" });
  await until(async () => (await dot()) === "입력 · 승인을 기다려요", "승인 대기");
  emit({ kind: "done", id: "abc-1" });
  await until(async () => (await dot()) === "새 응답이 있어요", "응답 끝");
  assert.equal(await app.evaluate(({ app }) => app.getBadgeCount()), 1, "Dock 배지");
  emit({ kind: "name", id: "abc-1", name: "API 서버" });
  await until(
    async () => (await page.$eval('[role="tab"] .truncate', (e) => e.textContent)) === "API 서버",
    "궤도 HUB 에서 붙인 이름",
  );
  await page.evaluate(() => {
    delete document.hasFocus;
  });
  await page.click('footer button[aria-label="놓친 알림 2개"]');
  assert.deepEqual(
    await page.$$eval("[role=menuitem]", (els) => els.map((e) => e.innerText.split("\n")[1]?.replace(/ · [^·]+$/, ""))),
    ["응답을 마쳤어요", "입력 · 승인을 기다려요 → Bash 승인", undefined],
    "놓친 알림 (최근 것부터) · 모두 지우기",
  );
  await page.keyboard.press("Escape");
  await until(async () => !(await page.$("[role=menu]")), "놓친 알림 닫기");
  await until(async () => !!(await page.$('footer button[aria-label="알림 기록"]')), "열어 보면 읽은 것으로");

  // 궤도 대시보드의 "이 탭으로 가기": 그 세션의 탭으로
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await page.$$('[role="tab"]')).length === 2, "두 번째 탭");
  await page.evaluate(() =>
    document.querySelector("webview").executeJavaScript(`console.log('epeira:focus {"id":"abc-1"}')`),
  );
  await until(
    async () => (await page.$eval('[role="tab"][aria-selected="true"] .truncate', (e) => e.textContent)) === "API 서버",
    "대시보드에서 고른 탭으로",
  );
  await closeAll();
});

test("보기 › 확대 · 축소 · 실제 크기는 앱 화면만, 궤도 패널은 늘 기본 크기", async () => {
  const zoom = () =>
    app.evaluate(({ webContents }) =>
      Object.fromEntries(webContents.getAllWebContents().map((w) => [w.getType(), w.getZoomLevel()])),
    );
  const click = (label) =>
    app.evaluate(({ Menu }, l) => {
      const find = (items) => {
        for (const it of items) {
          if (it.label === l) return it;
          const sub = it.submenu && find(it.submenu.items);
          if (sub) return sub;
        }
      };
      find(Menu.getApplicationMenu().items).click();
    }, label);
  await until(async () => (await zoom()).webview === 0, "궤도 패널");
  await click("확대");
  await click("확대");
  assert.deepEqual(await zoom(), { window: 1, webview: 0 });
  // 궤도 패널을 다시 열어도 (webview 는 창의 배율을 따라가려 한다)
  await menu("toggle-orbit");
  await until(async () => !("webview" in (await zoom())), "궤도 패널 닫기");
  await menu("toggle-orbit");
  await until(async () => "webview" in (await zoom()), "궤도 패널 열기");
  await page.waitForTimeout(1000);
  assert.deepEqual(await zoom(), { window: 1, webview: 0 });
  await click("실제 크기");
  assert.deepEqual(await zoom(), { window: 0, webview: 0 });
});

test("설정 · 명령 팔레트 · 단축키 안내 · 탭 이름 바꾸기", async () => {
  // 설정: 에이전트 연결은 바뀌는 내용을 먼저 보여 주고 동의를 받는다
  status.agents.codex = { name: "Codex", installed: true, connected: false };
  await menu("settings");
  await page.waitForSelector('[role=dialog]:has-text("에이전트")');
  await page.click('[role=dialog] button:text-is("연결")');
  await page.waitForSelector('[role=dialog]:has-text("Codex 연결") pre:has-text("epeira 훅")');
  await page.click('[role=dialog] button:text-is("연결")');
  await until(() => posts.some(([p, d]) => p === "/api/connect" && d.agent === "codex"), "연결 요청");
  await page.waitForSelector('nav[aria-label="설정 목차"]');
  delete status.agents.codex;

  // 터미널 글자 크기 · 테마는 예전과 같은 곳에 저장
  const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem("app.prefs") || "{}"));
  await page.click('nav[aria-label="설정 목차"] button:has-text("터미널")');
  await page.click('button[aria-label="크게"]');
  assert.equal((await prefs()).fontSize, 14);
  await page.click('button[aria-label="작게"]');
  assert.equal((await prefs()).fontSize, 13);
  await page.click('nav[aria-label="설정 목차"] button:has-text("화면")');
  await page.click('[role=dialog] button:text-is("라이트")');
  await until(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "light", "라이트");
  await page.click('[role=dialog] button:text-is("시스템")');
  await page.keyboard.press("Escape");
  await until(async () => !(await page.$("[role=dialog]")), "설정 닫기");

  // 단축키 안내
  await menu("shortcuts");
  await page.waitForSelector('[role=dialog]:has-text("명령 팔레트")');
  await page.keyboard.press("Escape");
  await until(async () => !(await page.$("[role=dialog]")), "단축키 닫기");

  // 명령 팔레트: 명령 실행 · 지난 7일 기록 찾기
  const tabCount = () => page.$$eval('[role="tab"]', (t) => t.length);
  const palette = async () => {
    await menu("palette");
    await page.waitForFunction(() => document.activeElement?.matches("[cmdk-input]"));
  };
  await palette();
  await page.keyboard.type("새 터미널");
  await page.keyboard.press("Enter");
  await until(async () => (await tabCount()) === 1, "팔레트로 새 터미널");
  await until(
    async () => page.evaluate(() => !!document.activeElement?.closest("[data-pane]")),
    "닫으면 터미널에 입력 위치",
  );
  await palette();
  await page.keyboard.type("버그");
  await page.waitForSelector('[cmdk-group]:has-text("기록") [cmdk-item]:has-text("찾은 질문 버그")');
  await page.keyboard.press("Escape");
  // 닫히는 애니메이션이 끝나야 화면을 누를 수 있다 (그동안 Radix 가 화면의 포인터를 막는다)
  await until(async () => !(await page.$("[role=dialog]")), "팔레트 닫기");

  // 탭 이름 바꾸기: 세션이 있는 탭은 수집기에 저장 (궤도 HUB 이름과 같이)
  const tabId = await page.$eval("[data-pane]", (e) => e.dataset.pane);
  emit({ kind: "tab", tab: tabId, id: "abc-1" });
  await until(
    async () => (await page.evaluate(() => JSON.parse(localStorage.getItem("app.tabs")).list[0].sid)) === "abc-1",
    "탭 ↔ 세션",
  );
  await page.dblclick('[role="tab"]');
  await page.fill('input[aria-label="탭 이름"]', "배포 준비");
  await page.keyboard.press("Enter");
  await until(
    async () => (await page.$eval('[role="tab"] .truncate', (e) => e.textContent)) === "배포 준비",
    "이름 바꾸기",
  );
  assert.ok(posts.some(([p, d]) => p === "/api/rename" && d.id === "abc-1" && d.name === "배포 준비"));
  await closeAll();
});

/** 탭 줄의 이름들 (지금 탭은 *) */
const tabLabels = () =>
  page.$$eval('[role="tab"]', (els) =>
    els.map((e) => e.querySelector(".truncate").textContent + (e.getAttribute("aria-selected") === "true" ? "*" : "")),
  );
const projectRow = (dir) => `aside li[title="${dir}"]`;
const projectMain = (dir) => `${projectRow(dir)} > button[aria-expanded]:not([aria-label])`;
const savedTabs = () => page.evaluate(() => JSON.parse(localStorage.getItem("app.tabs")));

test("프로젝트마다 따로: 바꿔도 터미널이 새로 열리지 않고 그 프로젝트 탭만, 다시 켜면 프로젝트별로 돌아온다", async () => {
  const beta = path.join(tmp, "beta");
  await page.evaluate((d) => window.epeira.addProjectPath(d), beta);
  await page.reload();
  await page.waitForSelector(projectRow(beta));
  assert.equal((await savedTabs()).current, alpha);
  assert.deepEqual(await tabLabels(), [], "프로젝트를 골라도 터미널을 멋대로 열지 않는다");
  assert.ok(await page.$("text=왼쪽에서 프로젝트를 고르거나"));

  for (let i = 0; i < 2; i++) await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await tabLabels()).length === 2, "alpha 에 탭 둘");
  assert.deepEqual(await tabLabels(), ["터미널", "터미널 2*"]);

  // 명령 팔레트로 beta 로 → 아직 터미널이 없다
  await menu("palette");
  await page.waitForFunction(() => document.activeElement?.matches("[cmdk-input]"));
  await page.keyboard.type("beta");
  await page.waitForSelector('[cmdk-group]:has-text("프로젝트") [cmdk-item]:has-text("beta")');
  await page.keyboard.press("Enter");
  await until(async () => (await savedTabs()).current === beta, "팔레트로 프로젝트 이동");
  assert.deepEqual(await tabLabels(), []);
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await tabLabels()).length === 1, "beta 에 탭");

  // 사이드바로 alpha 로 → alpha 의 탭 둘, 마지막에 보던 탭
  await page.click(projectMain(alpha));
  await until(async () => (await tabLabels()).join() === "터미널,터미널 2*", "alpha 로 돌아오면 alpha 의 탭");
  assert.equal((await savedTabs()).list.length, 3, "오가도 터미널이 늘지 않는다");

  // 사이드바를 접어도 터미널은 왼쪽 끝부터, 궤도 패널은 제자리
  const box = () =>
    page.evaluate(() => ({
      pane: Math.round(document.querySelector("[data-pane]").getBoundingClientRect().left),
      orbit: Math.round(document.querySelector('[aria-label="에이전트 궤도"]').getBoundingClientRect().width),
    }));
  const before = await box();
  await menu("toggle-side");
  await until(async () => (await box()).pane === 0, "사이드바 접기");
  assert.equal((await box()).orbit, before.orbit);
  await menu("toggle-side");
  await until(async () => (await box()).pane === before.pane, "다시 펴기");

  // 다시 켜면 프로젝트별 탭과 마지막 프로젝트
  await page.reload();
  await page.waitForSelector('[role="tab"]');
  await until(async () => (await tabLabels()).join() === "터미널,터미널 2*", "다시 켜도 alpha");
  await page.click(projectMain(beta));
  await until(async () => (await tabLabels()).join() === "터미널*", "beta 의 탭도");
  await answer(0);
  await closeAll();
  await page.click(projectMain(alpha));
  await until(async () => (await tabLabels()).length === 2, "alpha");
  await closeAll();
});

test("터미널: 실행 중이면 닫기 전에 묻기 · 찾기(⌘F) · 테마를 따라 색 · 글꼴은 터미널에만 · 넘치면 탭 목록", async () => {
  const out = () => app.evaluate(() => globalThis.ptyOut);
  const start = (await out()).length;
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await out()).length > start, "셸 프롬프트");
  await page.waitForTimeout(500);
  await page.keyboard.type("echo find-me-$((2+3))");
  await page.keyboard.press("Enter");
  await until(async () => (await out()).includes("find-me-5"), "명령 실행");

  // 찾기: 몇 번째 / 전체, esc 로 닫기
  await menu("find");
  await page.waitForFunction(() => document.activeElement?.matches('input[aria-label="터미널에서 찾기"]'));
  await page.keyboard.type("find-me");
  await until(
    async () => /^\d+\/\d+$/.test(await page.$eval('[role="search"] span', (e) => e.textContent)),
    "찾은 개수",
  );
  await page.keyboard.press("Escape");
  await until(async () => !(await page.$('[role="search"]')), "찾기 닫기");

  // 실행 중이면 닫기 전에 묻는다: 취소하면 그대로, 닫기면 닫힌다
  await page.keyboard.type("sleep 30");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  await answer(1);
  await menu("close-tab");
  await page.waitForTimeout(500);
  assert.equal((await tabLabels()).length, 1, "취소하면 그대로");
  await answer(0);
  await menu("close-tab");
  await until(async () => (await tabLabels()).length === 0, "닫기");

  // 테마: 라이트 · 다크로 바꾸면 터미널 색도 함께
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  // xterm 6 은 테마 바탕색을 스크롤 영역에 칠한다
  await page.waitForSelector("[data-pane] .xterm-scrollable-element");
  const termBg = () => page.$eval("[data-pane] .xterm-scrollable-element", (e) => getComputedStyle(e).backgroundColor);
  await menu("settings");
  await page.click('nav[aria-label="설정 목차"] button:has-text("화면")');
  await page.click('[role=dialog] button:text-is("라이트")');
  await until(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "light", "라이트");
  const light = await termBg();
  await page.click('[role=dialog] button:text-is("다크")');
  await until(async () => (await termBg()) !== light, "다크면 터미널도 어둡게");
  await page.click('[role=dialog] button:text-is("시스템")');

  // 글꼴: 터미널에만 쓰고, 기본으로 되돌리면 원래대로
  const termFont = () => page.evaluate(() => JSON.parse(localStorage.getItem("app.prefs") || "{}").fontTerm ?? "");
  const bodyFont = () => page.evaluate(() => getComputedStyle(document.body).fontFamily);
  const ui = await bodyFont();
  await page.click('nav[aria-label="설정 목차"] button:has-text("터미널")');
  await page.click('[role=dialog] [role=combobox][aria-label="글꼴"]');
  await until(() => page.evaluate(() => document.querySelectorAll("[role=option]").length > 1), "글꼴 목록");
  await page.getByRole("option", { name: "Menlo", exact: true }).click();
  await until(async () => (await termFont()) === "Menlo", "Menlo");
  assert.equal(await bodyFont(), ui, "앱의 다른 글자는 그대로");
  await page.click('[role=dialog] [role=combobox][aria-label="글꼴"]');
  await page.getByRole("option", { name: "기본 (SF Mono)", exact: true }).click();
  await until(async () => (await termFont()) === "", "기본 글꼴");
  await until(async () => !(await page.$("[role=listbox]")), "글꼴 목록 닫힘");
  await page.keyboard.press("Escape");
  await until(async () => !(await page.$("[role=dialog]")), "설정 닫기");

  // 탭이 넘치면 탭 목록 버튼 → 고르면 그 탭으로
  for (let i = 0; i < 9; i++) await menu("new-shell");
  await until(async () => (await tabLabels()).length === 10, "탭 열 개");
  await page.waitForSelector('button[aria-label="탭 목록"]');
  await page.click('button[aria-label="탭 목록"]');
  await page.click("[role=menuitem] >> nth=0");
  await until(async () => (await tabLabels())[0] === "터미널*", "목록에서 고른 탭");
  await closeAll();
});

test("사이드바: git 브랜치 · 지금 프로젝트가 아니어도 펼치기 · 터미널이 열린 프로젝트는 묻고 닫은 뒤 뺀다", async () => {
  const gamma = path.join(tmp, "gamma");
  mkdirSync(gamma, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", gamma]);
  await page.evaluate((d) => window.epeira.addProjectPath(d), gamma);
  await page.reload();
  await page.waitForSelector(`${projectRow(gamma)} small:has-text("⎇ main")`);

  // 지금 프로젝트(alpha)를 그대로 두고 gamma 만 펼치기
  await page.click('button[aria-label="gamma 세션 펼치기"]');
  await page.waitForSelector(`${projectRow(gamma)} p:has-text("오늘")`);
  assert.equal((await savedTabs()).current, alpha, "펼쳐도 지금 프로젝트는 그대로");
  await page.click('button[aria-label="gamma 세션 접기"]');

  // 터미널이 열린 프로젝트를 빼면 먼저 묻고, 터미널을 닫은 뒤 뺀다
  await page.click(projectMain(gamma));
  await page.click('button[aria-label="새 터미널 탭 (⌘T)"]');
  await until(async () => (await tabLabels()).length === 1, "gamma 에 탭");
  await answer(0);
  await page.click(projectRow(gamma), { button: "right", position: { x: 120, y: 20 } });
  await page.click('[role="menuitem"]:has-text("목록에서 빼기")');
  await until(async () => !(await page.$(projectRow(gamma))), "목록에서 빼기");
  await until(async () => !(await savedTabs()).list.some((t) => t.dir === gamma), "그 터미널도 닫힘");
  assert.notEqual((await savedTabs()).current, gamma, "남은 프로젝트로");
});

test("설정의 업데이트 확인: 바로 묻고, 새 버전이 있으면 업데이트 버튼 · 상태바 링크", async () => {
  releases.set("/app-version.json", JSON.stringify({ version: "9.9.9", url: "https://example.com/r" }));
  await menu("settings");
  await page.click('nav[aria-label="설정 목차"] button:has-text("문제 해결")');
  assert.ok(await page.$(`[role=dialog]:has-text("Epeira v${VERSION}")`));
  await page.click('[role=dialog] button:text-is("업데이트 확인")');
  await page.waitForSelector('[role=dialog] button:text-is("업데이트")');
  await page.waitForSelector('footer button:has-text("새 버전 9.9.9")');
  await page.keyboard.press("Escape");
  await until(async () => !(await page.$("[role=dialog]")), "설정 닫기");
  releases.delete("/app-version.json");
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
