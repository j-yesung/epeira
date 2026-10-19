// 창 맨 아래 한 줄: 수집기 연결 · 에이전트별 오늘 사용량과 한도 요약 · 새로고침 | 새 버전 · 에이전트 연결하기 · 놓친 알림 · 설정
import { useState } from "react";

import { RefreshCw, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUsage } from "@/entities/usage/model/store";
import { refreshAll } from "@/features/collector/model/connect";
import { installUpdate, useUpdate } from "@/features/update/model/update";
import { UpdateProgress } from "@/features/update/ui/update-progress";
import { openSettings } from "@/shared/lib/dialogs";
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
  const needsAgents = !!usage?.ok && Object.values(usage.by ?? {}).some((a) => a.installed && !a.connected);
  const update = useUpdate((s) => s.update);
  const installing = useUpdate((s) => s.installing);
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
      {update &&
        (installing ? (
          <UpdateProgress />
        ) : (
          <button
            type="button"
            onClick={installUpdate}
            className="cursor-pointer font-sans text-primary-strong text-sm"
          >
            {t("update.available", { version: update.version })}
          </button>
        ))}
      {needsAgents && (
        <button
          type="button"
          onClick={() => openSettings("agents")}
          className="cursor-pointer font-sans text-primary-strong text-sm"
        >
          {t("statusbar.connectAgents")}
        </button>
      )}
      <InboxButton />
      <button
        type="button"
        title={t("statusbar.settings")}
        aria-label={t("statusbar.settings")}
        onClick={() => openSettings()}
        className="grid h-5 w-[22px] cursor-pointer place-items-center rounded-sm hover:bg-secondary hover:text-foreground"
      >
        <Settings className="size-3.5" />
      </button>
    </footer>
  );
}
