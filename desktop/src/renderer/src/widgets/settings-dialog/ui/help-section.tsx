// 설정 › 문제 해결: 앱 버전 · 업데이트, 수집기 버전 · 진단 정보 복사 · 다시 설치, 대시보드 크게 보기
import { useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { refreshAll } from "@/features/collector/model/connect";
import { checkUpdate, installUpdate, useUpdate } from "@/features/update/model/update";
import { UpdateProgress } from "@/features/update/ui/update-progress";
import { epeira } from "@/shared/api/epeira";
import { Button } from "@/shared/ui/button";

import type { CollectorStatus } from "../model/collector";
import { Heading, Row } from "./rows";

export function HelpSection({ status }: { status: CollectorStatus }) {
  const { t } = useTranslation();
  const { version, update, installing } = useUpdate();
  const [busy, setBusy] = useState<"check" | "doctor" | "reinstall" | null>(null);

  const check = async () => {
    setBusy("check");
    const u = await checkUpdate(true).catch(() => ({ failed: true as const }));
    setBusy(null);
    toast(
      u && "failed" in u
        ? t("settings.help.checkFailed")
        : u
          ? t("settings.help.found", { version: u.version })
          : t("settings.help.latest"),
    );
  };
  const doctor = async () => {
    setBusy("doctor");
    const out = await epeira.doctor();
    await navigator.clipboard.writeText(out).catch(() => {});
    setBusy(null);
    toast(t("settings.help.doctorCopied"));
  };
  const reinstall = async () => {
    setBusy("reinstall");
    toast(t("settings.help.reinstalling"));
    const r = await epeira.reinstall();
    setBusy(null);
    toast(r.ok ? t("settings.help.reinstalled") : t("settings.help.reinstallFailed", { log: r.log ?? "" }).trim());
    refreshAll();
  };

  return (
    <>
      <Heading>{t("settings.sections.help")}</Heading>
      <Row
        title={t("settings.help.version", { version })}
        desc={update ? t("settings.help.updateAvailable", { version: update.version }) : t("settings.help.updateAuto")}
      >
        {update ? (
          installing ? (
            <UpdateProgress className="text-sm" />
          ) : (
            <Button size="sm" onClick={installUpdate}>
              {t("settings.help.update")}
            </Button>
          )
        ) : (
          <Button size="sm" variant="secondary" disabled={busy === "check"} onClick={check}>
            {t("settings.help.check")}
          </Button>
        )}
      </Row>
      <Row
        title={t("settings.help.collector", { version: status.version, port: status.port })}
        desc={t("settings.help.collectorOk")}
      >
        <Button size="sm" variant="secondary" disabled={busy === "doctor"} onClick={doctor}>
          {t("settings.help.doctor")}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy === "reinstall"} onClick={reinstall}>
          {t("settings.help.reinstall")}
        </Button>
      </Row>
      <button
        type="button"
        onClick={() => epeira.openExternal(`${epeira.orbitUrl}/`)}
        className="cursor-pointer justify-self-start text-primary-strong text-sm"
      >
        {t("settings.help.dashboard")}
      </button>
    </>
  );
}
