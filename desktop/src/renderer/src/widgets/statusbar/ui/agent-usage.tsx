// 상태바의 에이전트 한 칸: 오늘 도구 횟수 · 토큰 · 사용 한도 요약. 누르면 상세: 연결 · 한도 막대 · 초기화까지 남은 시간
import type { AgentUsage } from "@ipc/contract";
import { useTranslation } from "react-i18next";

import { type AgentLimits, limitLevel, limitWindows, span } from "@/entities/usage/model/limits";
import { useUsage } from "@/entities/usage/model/store";
import { fmtK } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { ClaudeLogo, OpenAILogo } from "@/shared/ui/icons/agent-logos";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

const levelText = (used: number) =>
  ({ warn: "text-warning", err: "text-destructive", ok: "" })[limitLevel(used) ?? "ok"];
const levelBar = (used: number) =>
  ({ warn: "bg-warning", err: "bg-destructive", ok: "bg-primary" })[limitLevel(used) ?? "ok"];

function Logo({ agent, className }: { agent: string; className?: string }) {
  return agent === "claude" ? (
    <ClaudeLogo className={cn("text-agent-claude", className)} />
  ) : (
    <OpenAILogo className={cn("text-foreground", className)} />
  );
}

function Detail({ agent, a, L }: { agent: string; a: AgentUsage; L: AgentLimits | undefined }) {
  const { t } = useTranslation();
  const claudeLimits = useUsage((s) => s.usage?.claudeLimits);
  const wins = limitWindows(L);
  const state = !a.installed
    ? t("agent.notInstalled")
    : !a.connected
      ? t("agent.notConnected")
      : agent === "codex" && a.trust && a.trust !== "trusted"
        ? t("agent.needsTrust")
        : t("agent.connected");
  // 한도를 못 보여줄 때 이유
  const note =
    agent === "codex"
      ? t("limits.codexNone")
      : !claudeLimits
        ? t("limits.claudeOff")
        : L?.error === "no-login" || L?.error === "expired"
          ? t("limits.claudeNoLogin")
          : L?.error
            ? t("limits.error")
            : t("limits.loading");
  return (
    <div className="font-sans text-muted-foreground text-sm leading-normal">
      <h4 className="mb-2.5 flex items-center gap-2 font-semibold text-base text-foreground">
        <Logo agent={agent} className="size-3.5" />
        {a.name}
        {L?.plan && (
          <span className="rounded-xs border border-input px-[5px] font-mono font-semibold text-2xs text-muted-foreground leading-4">
            {L.plan.toUpperCase()}
          </span>
        )}
        <span className="flex-1" />
        <small className="font-normal text-faint-foreground text-xs">{state}</small>
      </h4>
      {wins.length ? (
        wins.map((w) => (
          <div key={w.name}>
            <div className="mt-2 grid grid-cols-[44px_1fr_38px] items-center gap-2.5 text-foreground">
              <span>{w.name}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-border">
                <i className={cn("block h-full rounded-full", levelBar(w.used))} style={{ width: `${w.used}%` }} />
              </span>
              <b className={cn("text-right font-mono font-semibold text-sm", levelText(w.used))}>{w.used}%</b>
            </div>
            <p className="mt-0.5 ml-[54px] text-faint-foreground text-xs">
              {w.resets
                ? t("limits.resetIn", {
                    span: span(w.resets * 1000 - Date.now()),
                    at: new Date(w.resets * 1000).toLocaleString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                      weekday: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }),
                  })
                : t("limits.resetDone")}
            </p>
          </div>
        ))
      ) : (
        <p className="text-faint-foreground text-xs">{note}</p>
      )}
      {L?.at && (
        <p className="mt-2.5 border-t pt-2 font-mono text-faint-foreground text-xs">
          {t("limits.recorded", { span: span(Date.now() - L.at * 1000) })}
        </p>
      )}
    </div>
  );
}

export function AgentUsageItem({ agent }: { agent: string }) {
  const { t } = useTranslation();
  const a = useUsage((s) => s.usage?.by?.[agent]);
  const L = useUsage((s) => s.usage?.limits?.[agent]) as AgentLimits | undefined;
  if (!a) return null;
  const wins = limitWindows(L);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "-mx-1 inline-flex h-5 cursor-pointer items-center gap-1.5 rounded-sm px-1 outline-none hover:bg-secondary focus-visible:bg-secondary data-[state=open]:bg-secondary",
            !a.connected && "opacity-55",
          )}
        >
          <Logo agent={agent} className="size-3" />
          <span className="sr-only">{a.connected ? a.name : t("statusbar.agentOff", { name: a.name })}</span>
          <span className="text-faint-foreground">{t("statusbar.tools")}</span>
          <b className="font-semibold text-foreground">{a.calls.toLocaleString()}</b>
          <span className="text-faint-foreground">{t("statusbar.tok", { n: fmtK(a.tin + a.tout) })}</span>
          {wins.length > 0 && (
            <span>
              {wins.map((w, i) => (
                <span key={w.name} className={levelText(w.used)}>
                  {i ? " · " : ""}
                  {w.short} {w.used}%
                </span>
              ))}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8}>
        <Detail agent={agent} a={a} L={L} />
      </PopoverContent>
    </Popover>
  );
}
