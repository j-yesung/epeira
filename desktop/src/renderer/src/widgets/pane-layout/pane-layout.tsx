// 가운데 터미널 칸들 (칸 나누기 · 터미널은 3단계에서). 지금은 탭이 없을 때의 시작 화면만
import { Trans, useTranslation } from "react-i18next";

import { OrbitMark } from "@/shared/ui/icons/orbit-mark";

function Welcome() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_60%_45%_at_50%_40%,var(--glow)_0%,var(--background)_70%)] p-6 text-center">
      <OrbitMark className="size-16 text-primary" />
      <h1 className="font-bold text-3xl">{t("welcome.title")}</h1>
      <p className="max-w-[460px] text-muted-foreground">{t("welcome.body")}</p>
      <p className="text-faint-foreground text-sm">
        <Trans i18nKey="welcome.keys" components={{ kbd: <kbd /> }} />
      </p>
    </div>
  );
}

export function PaneLayout() {
  return (
    <div className="relative min-h-0 flex-1">
      <Welcome />
    </div>
  );
}
