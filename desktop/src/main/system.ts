// macOS 와 맞닿는 작은 일들: 알림 · Dock 배지 · git 상태 · 글꼴 목록 · 테마 · 바깥 링크
import { execFile } from "node:child_process";

import { app, ipcMain, Notification, nativeTheme, shell } from "electron";

import type { GitInfo, NotifyMessage, ThemeChoice } from "../ipc/contract";
import { liveWin } from "./context";
import { conf, saveConf } from "./store";

/** git: 프로젝트의 브랜치와 바뀐 파일 수 (사이드바). git 저장소가 아니면 null */
const gitInfo = (dir: string) =>
  new Promise<GitInfo | null>((resolve) =>
    execFile(
      "git",
      ["-C", dir, "status", "--porcelain=v1", "--branch", "--untracked-files=normal"],
      { timeout: 3000, maxBuffer: 4 << 20 },
      (err, out) => {
        if (err) return resolve(null);
        const [head, ...rest] = out.split("\n");
        const m = /^## (?:No commits yet on )?([^.\s]+)/.exec(head);
        resolve({ branch: m ? m[1] : "HEAD", changes: rest.filter(Boolean).length });
      },
    ),
  );

/** 설정의 글꼴 고르기: 이 Mac 에 설치된 글꼴 이름 (macOS 글꼴 관리자에 묻는다, 한 번만) */
let fontList: Promise<string[]> | null = null;
const fonts = () => {
  fontList ??= new Promise<string[]>((resolve) => {
    if (process.platform !== "darwin") return resolve([]);
    execFile(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        'ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))',
      ],
      { timeout: 10000 },
      (_err, out) => {
        try {
          resolve((JSON.parse(out) as string[]).filter((f) => !f.startsWith(".")).sort((a, b) => a.localeCompare(b)));
        } catch {
          fontList = null;
          resolve([]);
        }
      },
    );
  });
  return fontList;
};

const THEMES: ThemeChoice[] = ["system", "light", "dark"];

export const registerSystemIpc = () => {
  // 알림 · Dock 배지: 응답을 마쳤거나 권한 승인 · 입력을 기다리는 탭
  ipcMain.on("notify", (_e, { title, body, tab, silent }: NotifyMessage) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: !!silent });
    n.on("click", () => {
      const win = liveWin();
      if (!win) return;
      win.show();
      win.focus();
      win.webContents.send("tab:activate", tab);
    });
    n.show();
  });
  ipcMain.on("badge", (_e, count: number) => {
    app.setBadgeCount(Math.max(0, count | 0));
  });

  ipcMain.handle("git:info", async (_e, dirs: unknown) => {
    const list = (Array.isArray(dirs) ? dirs : []).filter((d): d is string => typeof d === "string").slice(0, 50);
    return Object.fromEntries(await Promise.all(list.map(async (d) => [d, await gitInfo(d)])));
  });
  ipcMain.handle("fonts:list", () => fonts());

  ipcMain.on("install-devtools", () => {
    if (process.platform === "darwin") execFile("xcode-select", ["--install"], () => {});
  });
  ipcMain.on("open-external", (_e, url: unknown) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
  });

  // 테마: 시스템 · 라이트 · 다크 (궤도 패널은 밤하늘이라 늘 어둡게)
  ipcMain.handle("theme:get", () => conf().theme || "system");
  ipcMain.handle("theme:set", (_e, theme: unknown) => {
    if (!THEMES.includes(theme as ThemeChoice)) return conf().theme || "system";
    nativeTheme.themeSource = theme as ThemeChoice;
    saveConf({ theme: theme as ThemeChoice });
    return theme;
  });
};
