// 창 맨 아래 한 줄: 수집기 연결 · 에이전트별 오늘 사용량과 한도 요약 · 새로고침 · 놓친 알림 (설정 · 업데이트는 4c)
import { useState } from "react";

import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUsage } from "@/entities/usage/model/store";
import { refreshAll } from "@/features/collector/model/connect";
import { cn } from "@/shared/lib/utils";

import { AgentUsageItem } from "./agent-usage";
import { InboxButton } from "./inbox-button";

function RefreshButton() {
  const { t } = useTranslation();
  const [spin, setSpin] = useState(false);
  return (
    <button
      type="button"
      title={t("statusbar.refresh")}
      aria-label={t("statusbar.refresh")}
      onClick={() => {
        setSpin(true);
        setTimeout(() => setSpin(false), 600);
        refreshAll();
      }}
      className="grid h-5 w-[22px] cursor-pointer place-items-center rounded-sm hover:bg-secondary hover:text-foreground"
    >
      <RefreshCw className={cn("size-3", spin && "animate-spin")} />
    </button>
  );
}

export function Statusbar() {
  const { t } = useTranslation();
  const usage = useUsage((s) => s.usage);
  const agents = Object.keys(usage?.by ?? {}).filter((k) => k === "claude" || k === "codex");
  return (
    <footer
      role="status"
      aria-label={t("statusbar.label")}
      className="flex h-(--statusbar-height) shrink-0 items-center gap-3.5 overflow-hidden whitespace-nowrap border-t bg-chrome pr-2 pl-3 font-mono text-muted-foreground text-xs"
    >
      <span className="flex items-center gap-1.5">
        <i
          className={cn(
            "size-[7px] rounded-full bg-faint-foreground",
            usage?.ok && "bg-success shadow-[0_0_6px_var(--success)]",
          )}
        />
        {!usage ? t("statusbar.connecting") : usage.ok ? t("statusbar.live") : t("statusbar.off")}
      </span>
      {usage?.ok && agents.sort().map((a) => <AgentUsageItem key={a} agent={a} />)}
      {usage && <RefreshButton />}
      <span className="flex-1" />
      <InboxButton />
    </footer>
  );
}
