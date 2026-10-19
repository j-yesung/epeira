// 설정 창 (⌘,): 왼쪽 목차 + 오른쪽 내용. 에이전트 연결 · 해제 · 승인은 바뀌는 내용을 먼저 보여 주고 동의를 받는다
import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

import { focusActive } from "@/features/manage-tabs/model/actions";
import { useUpdate } from "@/features/update/model/update";
import { closeDialogs, type SettingsSection, setSettingsSection, useDialogs } from "@/shared/lib/dialogs";
import { cn } from "@/shared/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

import { type AgentAction, type CollectorStatus, loadStatus } from "../model/collector";
import { AgentConfirm } from "./agent-confirm";
import { AgentsSection } from "./agents-section";
import { HelpSection } from "./help-section";
import { AlertsSection, LookSection, TerminalSection } from "./prefs-sections";

const SECTIONS: SettingsSection[] = ["agents", "alerts", "terminal", "look", "help"];

function Spinner() {
  return (
    <div className="mx-auto my-6 size-[26px] animate-spin rounded-full border-[2.5px] border-input border-t-primary" />
  );
}

export function SettingsDialog() {
  const { t } = useTranslation();
  const settings = useDialogs((s) => s.settings);
  const hasUpdate = useUpdate((s) => !!s.update);
  const open = !!settings;
  /** undefined: 읽는 중 · null: 수집기에 연결할 수 없음 */
  const [status, setStatus] = useState<CollectorStatus | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<{ agent: string; action: AgentAction; name: string } | null>(null);

  const reload = useCallback(async () => setStatus(await loadStatus()), []);
  const back = useCallback(() => {
    setConfirm(null);
    reload();
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    setStatus(undefined);
    setConfirm(null);
    reload();
  }, [open, reload]);

  // 할 일이 있는 목차엔 점: 연결 안 된 에이전트 · 새 버전
  const todo: Partial<Record<SettingsSection, boolean>> = {
    agents: Object.values(status?.agents ?? {}).some((a) => a.installed && (!a.connected || a.notify === false)),
    help: hasUpdate,
  };
  const section = settings?.section ?? "agents";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialogs()}>
      <DialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActive();
        }}
        className="max-h-[86vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-[780px]"
      >
        <DialogHeader>
          <DialogTitle>
            {confirm ? t(`settings.action.${confirm.action}Title`, { name: confirm.name }) : t("settings.title")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("settings.title")}</DialogDescription>
        </DialogHeader>
        {confirm ? (
          <AgentConfirm {...confirm} onDone={back} />
        ) : status === undefined ? (
          <Spinner />
        ) : status === null ? (
          <p className="text-muted-foreground">{t("settings.noCollector")}</p>
        ) : (
          <div className="grid min-h-[420px] grid-cols-[150px_minmax(0,1fr)] gap-4.5 overflow-hidden">
            <nav aria-label={t("settings.nav")} className="flex flex-col gap-0.5 pt-1">
              {SECTIONS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-current={k === section ? "page" : undefined}
                  onClick={() => setSettingsSection(k)}
                  className={cn(
                    "flex h-8 cursor-pointer items-center justify-between rounded-md px-2.5 text-left text-muted-foreground hover:bg-secondary hover:text-foreground",
                    k === section && "bg-secondary font-semibold text-foreground",
                  )}
                >
                  {t(`settings.sections.${k}`)}
                  {todo[k] && (
                    <span role="img" aria-label={t("settings.todo")} className="size-[7px] rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </nav>
            <div className="grid min-w-0 content-start gap-2.5 overflow-y-auto pr-1 text-muted-foreground">
              {section === "agents" && (
                <AgentsSection
                  status={status}
                  intro={settings?.intro}
                  reload={reload}
                  onAction={(agent, action, name) => setConfirm({ agent, action, name })}
                />
              )}
              {section === "alerts" && <AlertsSection />}
              {section === "terminal" && <TerminalSection />}
              {section === "look" && <LookSection />}
              {section === "help" && <HelpSection status={status} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
