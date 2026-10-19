// 에이전트 연결 · 해제 · 승인: 바뀌는 설정 파일을 먼저 보여 주고 동의를 받는다
import { useEffect, useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { loadUsage } from "@/features/collector/model/usage";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { type AgentAction, type AgentPreview, applyAgent, previewAgent } from "../model/collector";

const lineClass = (l: string) =>
  /^\+(?!\+\+)/.test(l) ? "text-success" : /^-(?!--)/.test(l) ? "text-destructive" : undefined;

export function AgentConfirm({
  agent,
  action,
  name,
  onDone,
}: {
  agent: string;
  action: AgentAction;
  name: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<AgentPreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    previewAgent(agent, action).then((p) => {
      if (p && !p.error) return setPreview(p);
      toast(p?.error || t("settings.action.unreachable"));
      onDone();
    });
  }, [agent, action, onDone, t]);

  if (!preview) {
    return (
      <div className="mx-auto my-6 size-[26px] animate-spin rounded-full border-[2.5px] border-input border-t-primary" />
    );
  }

  const apply = async () => {
    setBusy(true);
    const r = await applyAgent(agent, action);
    toast(r?.message || t("settings.action.done"));
    await loadUsage();
    onDone();
  };

  return (
    <div className="grid gap-2.5 text-muted-foreground">
      <p>{t(`settings.action.${action}Intro`, { name })}</p>
      {preview.diff ? (
        <pre className="max-h-[260px] overflow-auto rounded-lg border border-input bg-code px-3 py-2.5 font-mono text-[11.5px] leading-normal">
          {preview.diff.split("\n").map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff 줄은 순서가 곧 정체
            <span key={i} className={cn("block", lineClass(l))}>
              {l || " "}
            </span>
          ))}
        </pre>
      ) : (
        action !== "trust" && <p>{t("settings.action.noChange")}</p>
      )}
      {preview.trust && (
        <>
          <p>{t(action === "connect" ? "settings.action.trustToo" : "settings.action.trustCommand")}</p>
          <pre className="max-h-[260px] overflow-auto rounded-lg border border-input bg-code px-3 py-2.5 font-mono text-[11.5px]">
            {preview.command}
          </pre>
        </>
      )}
      <div className="-mx-5 mt-1 -mb-5 flex justify-end gap-2 border-t px-5 py-3">
        <Button variant="secondary" onClick={onDone}>
          {t("settings.action.cancel")}
        </Button>
        <Button variant={action === "disconnect" ? "destructive" : "default"} disabled={busy} onClick={apply}>
          {t(`settings.action.${action}Ok`)}
        </Button>
      </div>
    </div>
  );
}
