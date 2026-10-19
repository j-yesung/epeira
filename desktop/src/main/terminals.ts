// 터미널: 탭마다 로그인 셸 하나. AGENT_ORBIT_TAB 으로 수집기가 탭 ↔ 세션을 짝짓는다

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clipboard, ipcMain, Menu } from "electron";
import * as pty from "node-pty";

import type { TermAction } from "../ipc/contract";
import { liveWin, messageBox, messageBoxSync, sendToWin } from "./context";

const terms = new Map<string, pty.IPty>(); // 탭 id → pty
let seq = 0;

/** 앱을 띄운 환경(npm · Electron · 다른 에이전트 세션 · 다른 터미널 앱)의 흔적은 넘기지 않는다
 * → 안의 claude 가 "중첩 세션"으로 오해하거나, 다른 앱의 훅이 이 탭을 제 것으로 착각하지 않게 */
const LEAKY_ENV =
  /^(ELECTRON_|npm_|CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|CODEX_|ORCA_|ITERM_|VSCODE_|TMUX|KITTY_|WEZTERM_|GHOSTTY_|TERM_PROGRAM_VERSION$)/;

const shellEnv = (id: string) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !LEAKY_ENV.test(k)) env[k] = v;
  return {
    ...env,
    AGENT_ORBIT_TAB: id,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "AgentOrbit",
    LANG: env.LANG || "ko_KR.UTF-8",
  };
};

export const loginShell = () => process.env.SHELL || os.userInfo().shell || "/bin/zsh";

/** 탭에서 셸 말고 다른 프로그램(claude · codex · npm …)이 돌고 있으면 그 이름 */
const SHELLS = /^-?(zsh|bash|fish|sh|tcsh|ksh|nu|login)$/;
export const busy = (id: string) => {
  const p = terms.get(id);
  try {
    const name = p && path.basename(p.process || "");
    return name && !SHELLS.test(name) ? name : null;
  } catch {
    return null;
  }
};

/** 실행 중인 작업이 있으면 한 번 묻는다 (앱 종료 · 창 닫기 · 업데이트) */
export const confirmQuit = () => {
  const names = [...new Set([...terms.keys()].map(busy).filter(Boolean))];
  if (!names.length) return true;
  return (
    messageBoxSync({
      type: "warning",
      buttons: ["종료", "취소"],
      defaultId: 1,
      cancelId: 1,
      message: "실행 중인 작업이 있어요",
      detail: `${names.join(", ")} → 종료하면 함께 끝나요. 다음에 켜면 탭과 Claude · Codex 대화를 다시 열어요.`,
    }) === 0
  );
};

export const killAll = () => {
  for (const p of terms.values()) p.kill();
  terms.clear();
};

export const registerTerminalIpc = () => {
  ipcMain.handle("pty:create", (_e, opts: { cwd?: unknown; run?: unknown; cols?: unknown; rows?: unknown }) => {
    const id = `ao-${process.pid}-${++seq}`;
    const cwd = typeof opts?.cwd === "string" && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir();
    const p = pty.spawn(loginShell(), ["-l"], {
      name: "xterm-256color",
      cols: Number(opts?.cols) || 100,
      rows: Number(opts?.rows) || 30,
      cwd,
      env: shellEnv(id),
    });
    terms.set(id, p);
    p.onData((d) => sendToWin("pty:data", id, d));
    p.onExit(({ exitCode }) => {
      if (terms.get(id) !== p) return; // 앱이 끈 것(탭 닫기 · 앱 종료)은 알리지 않는다 → 종료하는 동안 탭이 "끝남"으로 저장되지 않게
      terms.delete(id);
      sendToWin("pty:exit", id, exitCode);
    });
    if (typeof opts?.run === "string" && opts.run) p.write(`${opts.run}\r`); // 셸이 준비되면 입력으로 읽힌다
    return id;
  });
  ipcMain.on("pty:write", (_e, id: string, data: string) => terms.get(id)?.write(data));
  ipcMain.on("pty:resize", (_e, id: string, cols: number, rows: number) => {
    const p = terms.get(id);
    if (p && cols > 0 && rows > 0) p.resize(cols, rows);
  });
  ipcMain.on("pty:kill", (_e, id: string) => {
    const p = terms.get(id);
    if (p) {
      p.kill();
      terms.delete(id);
    }
  });

  // 실행 중이면 묻고 닫는다 (작업 손실 방지)
  ipcMain.handle("pty:confirmClose", async (_e, id: string) => {
    const name = busy(id);
    if (!name) return true;
    const r = await messageBox({
      type: "warning",
      buttons: ["닫기", "취소"],
      defaultId: 1,
      cancelId: 1,
      message: `${name} 이(가) 실행 중이에요`,
      detail: "탭을 닫으면 함께 끝나요. Claude · Codex 대화는 나중에 이어서 열 수 있어요.",
    });
    return r.response === 0;
  });

  // 터미널이 열린 프로젝트를 빼기 전에 한 번 묻는다
  ipcMain.handle("projects:confirmRemove", async (_e, name: string, tabIds: unknown) => {
    const ids = Array.isArray(tabIds) ? tabIds.filter((x): x is string => typeof x === "string") : [];
    const running = [...new Set(ids.map(busy).filter(Boolean))];
    const r = await messageBox({
      type: "warning",
      buttons: ["닫고 빼기", "취소"],
      defaultId: 1,
      cancelId: 1,
      message: `${name} 의 터미널 ${ids.length}개를 닫고 목록에서 뺄까요?`,
      detail: `${running.length ? `${running.join(", ")} 이(가) 실행 중이에요 → 함께 끝나요. ` : ""}폴더는 지우지 않아요. Claude · Codex 대화는 나중에 이어서 열 수 있어요.`,
    });
    return r.response === 0;
  });

  // 터미널 우클릭 메뉴: 복사는 여기서, 붙여넣기 · 찾기 등은 화면이 (붙여넣기 모드를 지키려고 xterm 의 paste 로)
  ipcMain.on("term:menu", (_e, selection: string) => {
    const win = liveWin();
    if (!win) return;
    const act = (action: TermAction, text?: string) => win.webContents.send("term:action", action, text);
    Menu.buildFromTemplate([
      { label: "복사", enabled: !!selection, click: () => clipboard.writeText(selection) },
      { label: "붙여넣기", click: async () => act("paste", await clipboard.readText()) }, // Electron 44 부터 비동기
      { label: "모두 선택", click: () => act("selectAll") },
      { type: "separator" },
      { label: "찾기…", click: () => act("find") },
      { label: "화면 지우기", click: () => act("clear") },
    ]).popup({ window: win });
  });
};
