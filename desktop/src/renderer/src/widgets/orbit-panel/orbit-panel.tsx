// 오른쪽 궤도 패널: 늘 어두운 밤하늘 (data-theme="dark"). 수집기 대시보드는 WebContentsView 로 옮기면서 붙인다
import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { epeira } from "@/shared/api/epeira";
import { Button } from "@/shared/ui/button";

export function OrbitPanel() {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("orbit.label")}
      data-theme="dark"
      className="flex h-full min-w-0 flex-col bg-background text-foreground"
    >
      <div className="flex h-(--bar-height) shrink-0 items-center gap-1.5 border-b bg-chrome pr-2.5 pl-3.5 [-webkit-app-region:drag]">
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          title={t("orbit.openDashboard")}
          aria-label={t("orbit.openDashboard")}
          onClick={() => epeira.openExternal(`${epeira.orbitUrl}/`)}
          className="[-webkit-app-region:no-drag]"
        >
          <ArrowUpRight />
        </Button>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground text-sm">
        {t("orbit.placeholder")}
      </div>
    </section>
  );
}
