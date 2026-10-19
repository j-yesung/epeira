// Epeira 앱 → 왼쪽 프로젝트, 가운데 터미널 탭(실제 셸), 오른쪽 궤도(로컬 수집기 대시보드)
import fs from "node:fs";
import path from "node:path";

import { app, BrowserWindow, nativeTheme, screen, session, shell } from "electron";

import icon from "../../resources/icon.png?asset";
import { followEvents, registerCollectorIpc } from "./collector";
import { ORBIT, state, TEST } from "./context";
import { buildMenu } from "./menu";
import { conf, registerProjectIpc, saveConf } from "./store";
import { registerSystemIpc } from "./system";
import { confirmQuit, killAll, registerTerminalIpc } from "./terminals";
import { registerUpdateIpc } from "./update";

app.setName("Epeira");

// 이름이 Tycho · Agent Orbit 이던 때의 앱 데이터(프로젝트 목록 · 탭 · 설정)를 처음 한 번 옮긴다
{
  const newData = path.join(app.getPath("appData"), "Epeira");
  const oldData = ["Tycho", "Agent Orbit"]
    .map((n) => path.join(app.getPath("appData"), n))
    .find((d) => fs.existsSync(d));
  if (!fs.existsSync(newData) && oldData) {
    try {
      fs.cpSync(oldData, newData, { recursive: true });
    } catch {
      // 새로 시작
    }
  }
}

const isOrbit = (url: string) => url.startsWith(`${ORBIT}/`);

const createWindow = () => {
  // 지난번 창 크기 · 위치 (모니터가 바뀌어 화면 밖이면 기본값)
  const c = conf();
  const b = c.bounds;
  const onScreen =
    b &&
    screen
      .getAllDisplays()
      .some(
        ({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y,
      );
  const win = new BrowserWindow({
    ...(onScreen ? b : { width: 1480, height: 920 }),
    minWidth: 980,
    minHeight: 600,
    title: "Epeira",
    show: !TEST,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#f6f6f6",
    // 신호등 버튼(높이 16) 가운데를 상단 바(52px)의 가운데 26px 에 맞춘다
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      backgroundThrottling: !TEST,
      additionalArguments: [`--agent-orbit-url=${ORBIT}`],
    },
  });
  state.win = win;
  if (c.maximized) win.maximize();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const keep = () => {
    if (!win.isDestroyed() && !win.isMinimized() && !win.isFullScreen()) {
      saveConf({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    }
  };
  for (const ev of ["resize", "move"] as const) {
    win.on(ev as "resize", () => {
      clearTimeout(timer);
      timer = setTimeout(keep, 400);
    });
  }
  // 창을 닫으면 터미널도 끝난다 → 실행 중이면 묻는다 (앱 종료 중이면 이미 물었다)
  win.on("close", (e) => {
    keep();
    if (!state.quitting && !confirmQuit()) return e.preventDefault();
    killAll();
  });

  // 개발: 저장하면 바로 반영되는 개발 서버, 배포본: 앱에 든 파일
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, "../renderer/index.html"));

  // 궤도 패널(webview)은 로컬 수집기 대시보드만 열 수 있다
  win.webContents.on("will-attach-webview", (e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    if (params.src !== "about:blank" && !isOrbit(params.src)) e.preventDefault();
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
};

app.on("web-contents-created", (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (wc.getType() === "webview") {
    // 끌어다 놓은 파일(file://)은 열지 않는다
    wc.on("will-navigate", (e, url) => {
      if (isOrbit(url)) return;
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    });
    // 새로 불러오거나 궤도 패널을 다시 열면 창의 배율을 다시 따라가므로 그때마다 기본 크기로
    wc.on("did-navigate", () => wc.setZoomLevel(0));
  }
});

registerProjectIpc();
registerTerminalIpc();
registerCollectorIpc();
registerUpdateIpc();
registerSystemIpc();

app.whenReady().then(() => {
  // 권한: Electron 은 요청하면 다 허락한다 → 앱 화면은 알림 · 클립보드 쓰기만, 궤도 패널(webview)은 아무것도
  const allow = new Set(["notifications", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, done) => done(allow.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allow.has(perm));
  const orbit = session.fromPartition("persist:orbit");
  orbit.setPermissionRequestHandler((_wc, _perm, done) => done(false));
  orbit.setPermissionCheckHandler(() => false);
  nativeTheme.themeSource = conf().theme || "system";
  // 배포본은 앱 꾸러미의 아이콘(icon.icns)을 macOS 가 알아서 쓴다. 개발 중(Electron 기본 아이콘)에만 Dock 아이콘을 바꾼다
  if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(icon);
  buildMenu();
  createWindow();
  followEvents();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

// 실행 중인 작업이 있으면 한 번 묻는다
app.on("before-quit", (e) => {
  if (state.quitting) return;
  if (!confirmQuit()) return e.preventDefault();
  state.quitting = true;
});
app.on("will-quit", killAll);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
