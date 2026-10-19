// 로컬 수집기: 상태 · 사용량 읽기, 정해진 쓰기만 대신 보내기, 이벤트 전달, 앱에 든 수집기로 설치 · 업데이트
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ipcMain } from "electron";

import type { CollectorEnsureResult, UsageResult } from "../ipc/contract";
import { BUNDLE, HOME_APP, liveWin, newer, ORBIT, sleep } from "./context";
import { loginShell } from "./terminals";

const getJSON = <T = unknown>(pathname: string, timeout = 4000) =>
  new Promise<T | null>((resolve) => {
    const req = http.get(`${ORBIT}${pathname}`, { timeout }, (res) => {
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

/** 수집기의 쓰기 API 는 허용된 Origin + JSON 만 받는다 → 수집기 자기 주소를 Origin 으로 */
const postJSON = (pathname: string, body: unknown) =>
  new Promise<unknown>((resolve) => {
    const data = JSON.stringify(body || {});
    const req = http.request(
      `${ORBIT}${pathname}`,
      {
        method: "POST",
        timeout: 60000,
        headers: { "Content-Type": "application/json", Origin: ORBIT, "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let out = "";
        res.on("data", (d) => {
          out += d;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(out));
          } catch {
            resolve({ ok: false, message: "응답을 읽지 못했어요" });
          }
        });
      },
    );
    req.on("error", () => resolve({ ok: false, message: "수집기에 연결할 수 없어요" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, message: "시간이 너무 오래 걸려요" });
    });
    req.end(data);
  });

interface CollectorStatus {
  version: string;
  port: number;
  agents?: Record<string, { name: string; installed: boolean; connected: boolean; trust?: unknown }>;
  limits?: Record<string, unknown>;
  claudeLimits?: unknown;
  tabs?: Record<string, string>;
  names?: Record<string, string>;
  [key: string]: unknown;
}

interface SummarySession {
  id: string;
  parent?: string;
  agent: string;
  cwd?: string;
  label?: string;
  tools?: number;
  tin?: number;
  tokens?: number;
  tcache?: number;
}

const collectorStatus = () => getJSON<CollectorStatus>("/api/status");

/** 화면은 읽기 몇 가지와 정해진 쓰기(연결 · 해제 · 승인 · 설정)만 부탁할 수 있다 */
const READS = /^\/api\/(status|preview|summary|search)(\?|$)/;
const WRITES = new Set([
  "/api/connect",
  "/api/disconnect",
  "/api/trust",
  "/api/settings",
  "/api/autostart",
  "/api/rename",
]);

/** Finder 에서 켠 앱은 PATH 가 짧다 → 로그인 셸의 PATH 를 받아 수집기에 넘긴다 (python3 · codex 를 찾게) */
const userPath = () =>
  new Promise<string>((resolve) => {
    const child = execFile(
      loginShell(),
      ["-ilc", 'printf "__EPEIRA__%s__EPEIRA__" "$PATH"'],
      { timeout: 8000 },
      (_err, out) => {
        const m = /__EPEIRA__(.*)__EPEIRA__/.exec(out || "");
        resolve(m ? m[1] : process.env.PATH || "");
      },
    );
    child.stdin?.end(); // 셸 설정이 무언가를 물어도 기다리지 않게
  });

/** 앱에 든 수집기 버전 */
const bundledVersion = () => {
  try {
    return /^VERSION = '([^']+)'/m.exec(fs.readFileSync(path.join(BUNDLE, "agent_orbit.py"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
};

/** install.sh 와 같은 절차를 앱에 든 파일로 (내려받지 않음) */
const installCollector = async () => {
  const env = {
    ...process.env,
    PATH: await userPath(),
    AGENT_ORBIT_BASE: pathToFileURL(BUNDLE).href.replace(/\/$/, ""),
  };
  return new Promise<{ ok: boolean; out: string }>((resolve) =>
    execFile("/bin/sh", [path.join(BUNDLE, "install.sh")], { env, timeout: 120000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr}`.slice(-2000) }),
    ),
  );
};

/** 앱이 켜지면 수집기도 바로: 없으면 설치, 앱에 든 것보다 오래됐으면 업데이트, 꺼져 있으면 깨운다
 * 사용자가 터미널에 설치 명령을 칠 필요가 없다. 훅 연결(설정 파일 변경)은 여전히 확인 창에서 동의를 받고 한다 */
const ensureCollector = async (): Promise<CollectorEnsureResult> => {
  let st = await collectorStatus();
  const want = bundledVersion();
  if (st && !(want && newer(want, st.version))) return { ok: true, status: st };
  const installed = () => fs.existsSync(path.join(HOME_APP, "agent_orbit.py"));
  if (!st && installed() && process.platform === "darwin") {
    // 설치돼 있는데 꺼져 있으면 먼저 깨워 본다
    spawn("launchctl", ["kickstart", `gui/${process.getuid?.()}/dev.agentorbit.collector`], { stdio: "ignore" });
    for (let i = 0; i < 8 && !st; i++) {
      await sleep(400);
      st = await collectorStatus();
    }
    if (st && !(want && newer(want, st.version))) return { ok: true, status: st };
  }
  // 개발 · 테스트로 다른 수집기 주소를 쓰면 실제 설치(~/.agent-orbit)는 건드리지 않는다
  if (!want || process.env.AGENT_ORBIT_URL)
    return st ? { ok: true, status: st } : { ok: false, installed: installed() };
  const r = await installCollector();
  st = await collectorStatus();
  if (st) return { ok: true, status: st, updated: true };
  return { ok: false, installed: installed(), needPython: /Python 3\.9/.test(r.out), log: r.out };
};

/** 하단 상태바: 오늘 에이전트별 도구 횟수 · 토큰 · 연결 상태 · 사용 한도 · 탭 ↔ 세션 */
const usage = async (refresh: boolean): Promise<UsageResult> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [status, sum] = await Promise.all([
    getJSON<CollectorStatus>(refresh ? "/api/status?refresh=1" : "/api/status"), // 새로고침 버튼이면 한도도 다시
    getJSON<{ sessions?: SummarySession[] }>(`/api/summary?since=${today.getTime() / 1000}`),
  ]);
  if (!status) return { ok: false };
  const by: NonNullable<UsageResult["by"]> = {};
  for (const [k, a] of Object.entries(status.agents || {})) {
    by[k] = {
      name: a.name,
      installed: a.installed,
      connected: a.connected,
      trust: a.trust,
      calls: 0,
      tin: 0,
      tout: 0,
      tcache: 0,
    };
  }
  const sessions = sum?.sessions || [];
  for (const x of sessions) {
    const b = by[x.agent];
    if (b) {
      b.calls += x.tools || 0;
      b.tin += x.tin || 0;
      b.tout += x.tokens || 0;
      b.tcache += x.tcache || 0;
    }
  }
  // 프로젝트별 오늘 사용량
  const todays = sessions.map((x) => ({
    id: x.id,
    parent: x.parent,
    agent: x.agent,
    cwd: x.cwd,
    label: x.label,
    tools: x.tools || 0,
    tok: (x.tin || 0) + (x.tokens || 0),
  }));
  return {
    ok: true,
    version: status.version,
    port: status.port,
    by,
    limits: status.limits || {},
    claudeLimits: status.claudeLimits,
    tabs: status.tabs || {},
    names: status.names || {},
    today: todays,
  };
};

/** 수집기 이벤트를 화면에 전달 (탭 상태 · 알림용, 궤도 화면과 별개). 끊기면 3초 뒤 다시 */
let following = false;
export const followEvents = () => {
  if (following) return;
  following = true;
  let buf = "";
  const again = () => {
    if (!following) return;
    following = false;
    setTimeout(followEvents, 3000);
  };
  const req = http.get(`${ORBIT}/api/events`, (res) => {
    res.setEncoding("utf8");
    res.on("data", (d: string) => {
      buf += d;
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const line = buf
          .slice(0, i)
          .split("\n")
          .find((l) => l.startsWith("data: "));
        buf = buf.slice(i + 2);
        const win = liveWin();
        if (!line || !win) continue;
        try {
          win.webContents.send("orbit:event", JSON.parse(line.slice(6)));
        } catch {
          // 깨진 줄은 건너뜀
        }
      }
    });
    res.on("end", again);
    res.on("error", again);
  });
  req.on("error", again);
};

let ensuring: Promise<CollectorEnsureResult> | null = null; // 동시에 두 번 설치하지 않게

export const registerCollectorIpc = () => {
  ipcMain.handle("orbit:get", (_e, p: unknown) => (typeof p === "string" && READS.test(p) ? getJSON(p, 25000) : null));
  ipcMain.handle("orbit:post", (_e, p: unknown, body: unknown) =>
    typeof p === "string" && WRITES.has(p) ? postJSON(p, body) : null,
  );
  ipcMain.handle("collector:usage", (_e, refresh: unknown) => usage(!!refresh));
  ipcMain.handle("collector:ensure", () => {
    ensuring ??= ensureCollector().finally(() => {
      ensuring = null;
    });
    return ensuring;
  });
  // 문제 해결: 진단 정보(epeira doctor) · 수집기 다시 설치
  ipcMain.handle("collector:doctor", async () => {
    const bin = path.join(HOME_APP, "bin", "epeira");
    if (!fs.existsSync(bin)) return "수집기가 설치되어 있지 않아요.";
    const env = { ...process.env, PATH: await userPath() };
    return new Promise<string>((resolve) =>
      execFile(bin, ["doctor"], { env, timeout: 30000 }, (err, out, errOut) =>
        resolve(`${out}${errOut}`.trim() || String(err)),
      ),
    );
  });
  ipcMain.handle("collector:reinstall", async () => {
    if (process.env.AGENT_ORBIT_URL || !bundledVersion()) {
      return { ok: false, log: "개발 · 테스트 모드에서는 다시 설치하지 않아요." };
    }
    const r = await installCollector();
    return { ok: !!(await collectorStatus()), log: r.out };
  });
};
