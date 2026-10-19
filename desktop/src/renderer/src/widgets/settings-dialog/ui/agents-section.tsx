// 설정 › 에이전트: 연결 상태 · 연결 / 해제 / 승인, 수집기 설정 (Claude 사용 한도 · 로그인할 때 실행)
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { loadUsage } from "@/features/collector/model/usage";
import { Button } from "@/shared/ui/button";
import { ClaudeLogo, OpenAILogo } from "@/shared/ui/icons/agent-logos";

import {
  type AgentAction,
  type AgentStatus,
  type CollectorStatus,
  setAutostart,
  setCollectorSetting,
} from "../model/collector";
import { Chip, Heading, Row, ToggleRow } from "./rows";

function AgentRow({ agent, a, onAction }: { agent: string; a: AgentStatus; onAction: (action: AgentAction) => void }) {
  const { t } = useTranslation();
  const untrusted = agent === "codex" && a.connected && !!a.trust && a.trust !== "trusted";
  const [state, tone]: [string, "ok" | "warn" | undefined] = !a.installed
    ? [t("agent.notInstalled"), undefined]
    : a.connected
      ? untrusted
        ? [t("agent.needsTrust"), "warn"]
        : [t("agent.connected"), "ok"]
      : a.legacy
        ? [t("settings.agents.needUpdate"), "warn"]
        : [t("agent.notConnected"), undefined];
  const desc = !a.installed
    ? t("settings.agents.needInstall", { name: a.name })
    : a.notify === false
      ? t("settings.agents.needNotify")
      : a.connected
        ? t("settings.agents.live")
        : undefined;
  const icon =
    agent === "claude" ? (
      <ClaudeLogo className="size-4 shrink-0 text-agent-claude" />
    ) : (
      <OpenAILogo className="size-4 shrink-0 text-foreground" />
    );
  return (
    <Row icon={icon} title={a.name} desc={desc}>
      <Chip tone={tone}>{state}</Chip>
      {a.installed &&
        (a.connected ? (
          <>
            {untrusted && (
              <Button size="sm" onClick={() => onAction("trust")}>
                {t("settings.agents.trust")}
              </Button>
            )}
            {a.notify === false && (
              <Button size="sm" onClick={() => onAction("connect")}>
                {t("settings.agents.notifyOn")}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => onAction("disconnect")}>
              {t("settings.agents.disconnect")}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => onAction("connect")}>
            {t(a.legacy ? "settings.agents.reconnect" : "settings.agents.connect")}
          </Button>
        ))}
    </Row>
  );
}

export function AgentsSection({
  status,
  intro,
  onAction,
  reload,
}: {
  status: CollectorStatus;
  intro?: string;
  onAction: (agent: string, action: AgentAction, name: string) => void;
  reload: () => unknown;
}) {
  const { t } = useTranslation();
  // 바꾸고 나면 다시 읽는다. 수집기가 거절하면 이유를 알린다
  const flip = async (r: Promise<{ ok?: boolean; message?: string } | null>) => {
    const res = await r;
    if (res?.message && res.ok === false) toast(res.message);
    await reload();
  };
  return (
    <>
      {intro && <p className="rounded-lg border border-input bg-secondary px-3 py-2.5 text-foreground">{intro}</p>}
      <Heading>{t("settings.agents.heading")}</Heading>
      {Object.entries(status.agents ?? {}).map(([agent, a]) => (
        <AgentRow key={agent} agent={agent} a={a} onAction={(action) => onAction(agent, action, a.name)} />
      ))}
      <Heading>{t("settings.collector.heading")}</Heading>
      {status.claudeLimits != null && (
        <ToggleRow
          title={t("settings.collector.limits")}
          desc={t("settings.collector.limitsDesc")}
          checked={status.claudeLimits}
          onChange={(v) =>
            flip(
              setCollectorSetting({ claudeLimits: v }).then(async (r) => {
                await loadUsage();
                return r;
              }),
            )
          }
        />
      )}
      {status.autostart != null && (
        <ToggleRow
          title={t("settings.collector.autostart")}
          desc={t("settings.collector.autostartDesc")}
          checked={status.autostart}
          onChange={(v) => flip(setAutostart(v))}
        />
      )}
    </>
  );
}
