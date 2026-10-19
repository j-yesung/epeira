// 오늘 사용량 · 연결 상태 · 사용 한도 (수집기 /api/status + 오늘 세션, 메인이 모아 준다). 상태바 · 사이드바
import type { UsageResult } from "@ipc/contract";
import { create } from "zustand";

import { epeira } from "@/shared/api/epeira";

interface UsageState {
  usage: UsageResult | null;
  /** refresh: 사용 한도도 다시 조회 (수집기가 1분에 한 번까지만) */
  load: (refresh?: boolean) => Promise<UsageResult>;
}

export const useUsage = create<UsageState>((set) => ({
  usage: null,
  load: async (refresh) => {
    const usage = await epeira.usage(refresh);
    set({ usage });
    return usage;
  },
}));
