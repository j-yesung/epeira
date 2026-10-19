// 새 버전: 6시간마다(설정에서 바로도) 사이트의 app-version.json 을 확인하고, 누르면 GitHub Releases 의 DMG 를 받아 바꾼다
// 관리자가 릴리스할 때 비밀 키(저장소 밖)로 DMG 에 서명하고 앱엔 공개 키만 → 사이트나 내려받는 길이 털려도 우리가 서명하지 않은 파일은 설치하지 않는다
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { app, ipcMain } from "electron";

import type { UpdateInfo, UpdateInstallResult, UpdateStage } from "../ipc/contract";
import { liveWin, messageBox, newer, state, TEST } from "./context";
import { conf, saveConf } from "./store";
import { confirmQuit } from "./terminals";

const SITE = process.env.EPEIRA_UPDATE_BASE || "https://epeira.vercel.app";
const RELEASES = process.env.EPEIRA_UPDATE_BASE || "https://github.com/j-yesung/epeira/releases/download";
const UPDATE_KEY = crypto.createPublicKey({
  key: Buffer.from(
    (TEST && process.env.EPEIRA_UPDATE_KEY) || "MCowBQYDK2VwAyEAWnNiV7VZ9Ba/TOrzn4zJ3AR1WUQXLw2nvZujRttGay8=",
    "base64",
  ),
  format: "der",
  type: "spki",
});

const latestApp = () =>
  new Promise<Partial<UpdateInfo> | null>((resolve) => {
    const req = (SITE.startsWith("https:") ? https : http).get(`${SITE}/app-version.json`, { timeout: 8000 }, (res) => {
      let body = "";
      res.on("data", (d) => {
        body += d;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout: 120000 }, (err, out) => (err ? reject(err) : resolve(out.trim()))),
  );

const download = async (url: string, file: string, progress?: (fraction: number) => void) => {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`내려받지 못했어요 (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const body = Readable.fromWeb(res.body as WebReadableStream);
  let got = 0;
  if (progress && total) {
    body.on("data", (d: Buffer) => {
      got += d.length;
      progress(got / total);
    });
  }
  await pipeline(body, fs.createWriteStream(file));
};

/** 화면(상태바 · 설정)과 Dock 아이콘에 진행 막대. fraction: 0~1, 확인 중이면 null, 끝나면 stage = null */
let shown = -1;
const updateProgress = (stage: UpdateStage, fraction: number | null = null) => {
  const win = liveWin();
  if (!win || (stage === "download" && fraction !== null && fraction - shown < 0.01 && fraction < 1)) return;
  shown = stage === "download" && fraction !== null ? fraction : -1;
  win.setProgressBar(stage === "download" ? (fraction ?? 0) : stage ? 1 : -1);
  win.webContents.send("update:progress", stage, fraction);
};

interface Staged {
  version: string;
  app: string;
  dmg: string;
}

/** 받기 → 서명 확인 → DMG 에서 앱 꺼내기 → 안의 버전 확인 (지금 앱은 아직 그대로) */
const stageUpdate = async (version: string): Promise<Staged> => {
  const name = `Epeira-${version}${process.arch === "arm64" ? "-arm64" : ""}.dmg`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epeira-update-"));
  const dmg = path.join(dir, name);
  const mnt = path.join(dir, "mnt");
  const next = path.join(dir, "Epeira.app");
  try {
    updateProgress("download", 0);
    await download(`${RELEASES}/v${version}/${name}`, dmg, (f) => updateProgress("download", f));
    updateProgress("verify");
    await download(`${RELEASES}/v${version}/${name}.sig`, `${dmg}.sig`);
    const sig = Buffer.from(fs.readFileSync(`${dmg}.sig`, "utf8").trim(), "base64");
    if (!crypto.verify(null, fs.readFileSync(dmg), UPDATE_KEY, sig)) throw new Error("서명이 맞지 않아요");
    await run("hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt]);
    try {
      await run("ditto", [path.join(mnt, "Epeira.app"), next]);
    } finally {
      await run("hdiutil", ["detach", mnt, "-force"]).catch(() => {});
    }
    const inner = await run("plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      "-o",
      "-",
      path.join(next, "Contents/Info.plist"),
    ]);
    if (inner !== version) throw new Error(`받은 앱이 ${inner} 버전이에요`); // 예전 버전 DMG 를 새 버전이라고 내미는 것 막기
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  } finally {
    updateProgress(null);
  }
  return { version, app: next, dmg };
};

/** 앱이 끝난 뒤 바꾸고 다시 켠다. 못 바꾸면 원래 앱을 다시 켜고 DMG 를 열어 직접 옮기게 한다 */
const SWAP =
  'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; old="$(dirname "$2")/old.app"; ' +
  'if mv "$3" "$old"; then if mv "$2" "$3"; then rm -rf "$old"; else mv "$old" "$3"; open "$4"; fi; else open "$4"; fi; open "$3"';

let staged: Staged | null = null;
let installing: Promise<UpdateInstallResult> | null = null;

const canWrite = (dir: string) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const installUpdate = async (version: unknown): Promise<UpdateInstallResult> => {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version) || !newer(version, app.getVersion())) {
    return { ok: false };
  }
  const target = path.resolve(app.getPath("exe"), "../../.."); // …/Epeira.app
  const canSwap =
    app.isPackaged &&
    target.endsWith(".app") &&
    !/^\/Volumes\/|\/AppTranslocation\//.test(target) &&
    canWrite(path.dirname(target));
  if (!canSwap && !TEST) return { ok: false, manual: true }; // DMG 안에서 켰거나 응용 프로그램 폴더에 쓸 수 없으면 직접 받기
  try {
    if (!staged || staged.version !== version) staged = await stageUpdate(version);
  } catch (e) {
    return { ok: false, manual: true, error: (e as Error).message };
  }
  const { response } = await messageBox({
    type: "info",
    buttons: ["다시 시작", "나중에"],
    defaultId: 0,
    cancelId: 1,
    message: `Epeira ${version} 을(를) 설치할 준비가 됐어요`,
    detail: "다시 시작하면 새 버전으로 바뀌어요. 탭과 Claude · Codex 대화는 다시 열어요.",
  });
  if (response !== 0 || !canSwap || !confirmQuit()) return { ok: true, later: true }; // 테스트(개발 앱)는 바꾸지 않는다
  spawn("/bin/sh", ["-c", SWAP, "sh", String(process.pid), staged.app, target, staged.dmg], {
    detached: true,
    stdio: "ignore",
  }).unref();
  state.quitting = true;
  app.quit();
  return { ok: true };
};

export const registerUpdateIpc = () => {
  ipcMain.handle("app:version", () => app.getVersion());
  // 6시간에 한 번만 실제로 묻는다. force: 설정의 "업데이트 확인"
  ipcMain.handle("update:check", async (_e, force: unknown) => {
    if (TEST && !force) return null;
    const c = conf();
    if (!force && c.latest && Date.now() - (c.checkedAt || 0) < 6 * 36e5) {
      return newer(c.latest.version, app.getVersion()) ? c.latest : null;
    }
    const v = await latestApp();
    if (!(v && typeof v.version === "string" && typeof v.url === "string" && /^https:\/\//.test(v.url))) {
      return force ? { failed: true } : null;
    }
    saveConf({ latest: { version: v.version, url: v.url }, checkedAt: Date.now() });
    return newer(v.version, app.getVersion()) ? { version: v.version, url: v.url } : null;
  });
  ipcMain.handle("update:install", (_e, version: unknown) => {
    installing ??= installUpdate(version).finally(() => {
      installing = null;
    });
    return installing;
  });
};
