// 업데이트 진행 막대: 받기는 퍼센트, 서명 확인 · 앱 꺼내기는 움직이는 막대
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import { Progress } from "@/shared/ui/progress";

import { useUpdate } from "../model/update";

export function UpdateProgress({ className }: { className?: string }) {
  const { t } = useTranslation();
  const progress = useUpdate((s) => s.progress) ?? { stage: "download", fraction: 0 };
  const down = progress.stage === "download";
  const pct = Math.round((progress.fraction ?? 0) * 100);
  return (
    <span
      role="status"
      className={cn("inline-flex items-center gap-2 whitespace-nowrap text-muted-foreground", className)}
    >
      <Progress
        value={down ? pct : null}
        aria-label={t("update.progress")}
        className={cn(
          "h-1.5 w-[110px] bg-input",
          !down &&
            "animate-[update-move_1.2s_linear_infinite] bg-[linear-gradient(90deg,var(--input)_30%,var(--primary)_50%,var(--input)_70%)] bg-size-[300%_100%] [&>*]:hidden",
        )}
      />
      <span>{down ? `${pct}%` : t("update.verifying")}</span>
    </span>
  );
}
