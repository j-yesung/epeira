// 메인 프로세스 여러 파일이 같이 쓰는 값: 창 · 종료 중인지 · 수집기 주소 · 테스트 여부
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app, type BrowserWindow, dialog } from "electron";

/** 자동 테스트: 창을 띄우지 않는다 (사용자 화면을 가리지 않게) */
export const TEST = process.env.EPEIRA_TEST === "1";

export const HOME_APP = path.join(os.homedir(), ".agent-orbit");

/** 수집기가 다른 포트로 설치됐으면 그 포트 */
const savedPort = () => {
  try {
    return Number(fs.readFileSync(path.join(HOME_APP, "port"), "utf8")) || 47777;
  } catch {
    return 47777;
  }
};

/** 로컬 수집기 주소. 개발 · 테스트용으로만 바꾼다 */
export const ORBIT = process.env.AGENT_ORBIT_URL || `http://127.0.0.1:${savedPort()}`;

/** 앱에 들어 있는 수집기 파일. 개발 중엔 저장소 맨 위 (out/main → desktop → 저장소) */
export const BUNDLE = app.isPackaged ? path.join(process.resourcesPath, "collector") : path.join(__dirname, "../../..");

export const state: { win: BrowserWindow | null; quitting: boolean } = { win: null, quitting: false };

/** 살아 있는 창 (닫혔으면 null) */
export const liveWin = () => (state.win && !state.win.isDestroyed() ? state.win : null);

/** 화면으로 신호 보내기 (창이 없으면 아무것도 안 함) */
export const sendToWin = (channel: string, ...args: unknown[]) => {
  liveWin()?.webContents.send(channel, ...args);
};

/** 확인 창: 창이 있으면 그 창에 붙여서. 부를 때마다 dialog 를 찾아서 테스트가 바꿔 끼울 수 있다 */
export const messageBox = (opts: Electron.MessageBoxOptions) => {
  const win = liveWin();
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
};
export const messageBoxSync = (opts: Electron.MessageBoxSyncOptions) => {
  const win = liveWin();
  return win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts);
};

/** 버전 비교: a 가 b 보다 높으면 true (1.3.100 > 1.3.0) */
export const newer = (a: string, b: string) => {
  const x = a.split(".").map(Number);
  const y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
