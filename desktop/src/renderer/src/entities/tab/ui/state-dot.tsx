// 탭 상태 표시: 기다림(입력 · 승인) > 일하는 중 > 새 응답. 탭 줄 · 사이드바 프로젝트 줄
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

import type { Tab } from "../model/store";

export type TabState = "wait" | "busy" | "new";

export const tabState = (t: Tab): TabState | null => (t.waiting ? "wait" : t.busy ? "busy" : t.unread ? "new" : null);

/** 여러 탭 중 가장 급한 것 (기다림 > 새 응답 > 일하는 중) */
export const worstState = (tabs: Tab[]): TabState | null =>
  tabs.some((t) => t.waiting) ? "wait" : tabs.some((t) => t.unread) ? "new" : tabs.some((t) => t.busy) ? "busy" : null;

export function StateDot({ state, className }: { state: TabState; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t(`tab.state.${state}`)}
      title={t(`tab.state.${state}`)}
      className={cn(
        "shrink-0 rounded-full",
        state === "wait" && "size-[7px] bg-warning shadow-[0_0_6px_var(--warning)]",
        state === "new" && "size-[7px] bg-primary",
        state === "busy" && "size-2.5 animate-spin border-[1.5px] border-input border-t-primary",
        className,
      )}
    />
  );
}
