// 수집기 준비: 앱이 알아서 설치 · 업데이트 · 실행한다. 안 되면 사용자에게 명령을 시키지 않고 스스로 계속 다시 시도
// 사람이 해야 하는 건 Python(Apple 개발자 도구) 설치 하나뿐
import { create } from "zustand";

import { epeira } from "@/shared/api/epeira";

import { loadUsage } from "./usage";

/** wait: 준비 중 · ok: 궤도 패널을 띄움 · python: 개발자 도구가 필요 · failed: 여러 번 실패 (계속 다시 시도) */
export type CollectorPhase = "wait" | "ok" | "python" | "failed";

interface CollectorState {
  phase: CollectorPhase;
  /** 궤도 화면을 다시 불러올 때마다 1씩 (수집기가 새 버전으로 바뀌었거나 새로고침) */
  reloads: number;
}

export const useCollector = create<CollectorState>(() => ({ phase: "wait", reloads: 0 }));

let retry: ReturnType<typeof setTimeout> | undefined;
let fails = 0;

export const connectCollector = async () => {
  clearTimeout(retry);
  if (useCollector.getState().phase !== "ok") useCollector.setState({ phase: "wait" });
  const r = await epeira.collector();
  await loadUsage();
  if (r.ok) {
    fails = 0;
    useCollector.setState((s) => ({ phase: "ok", reloads: r.updated && s.phase === "ok" ? s.reloads + 1 : s.reloads }));
    return;
  }
  fails++;
  if (r.needPython) {
    useCollector.setState({ phase: "python" });
    retry = setTimeout(connectCollector, 10_000); // 설치가 끝나면 알아서 이어감
    return;
  }
  // 업데이트 · 재시작 중일 수 있다 → 처음 몇 번은 조용히 다시
  useCollector.setState({ phase: fails < 3 ? "wait" : "failed" });
  retry = setTimeout(connectCollector, fails < 3 ? 4_000 : 15_000);
};

/** "다시 시도" 버튼: 바로 */
export const retryCollector = () => {
  fails = 0;
  return connectCollector();
};

/** 상태바 새로고침: 수집기 상태 · 사용 한도까지 다시 읽고 궤도 화면도 새로 */
export const refreshAll = async () => {
  await connectCollector();
  await loadUsage(true);
  useCollector.setState((s) => ({ reloads: s.phase === "ok" ? s.reloads + 1 : s.reloads }));
};
