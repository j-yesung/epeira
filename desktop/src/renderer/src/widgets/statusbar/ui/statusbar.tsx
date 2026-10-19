// 창 맨 아래 한 줄: 연결 · 에이전트별 오늘 사용량과 한도 · 알림 · 설정 (내용은 4단계에서)
import { useTranslation } from "react-i18next";

export function Statusbar() {
  const { t } = useTranslation();
  return (
    <footer
      role="status"
      aria-label={t("statusbar.label")}
      className="flex h-(--statusbar-height) shrink-0 items-center gap-3.5 overflow-hidden border-t bg-chrome pr-2 pl-3 font-mono text-muted-foreground text-xs"
    >
      <span className="flex items-center gap-1.5">
        <i className="size-[7px] rounded-full bg-faint-foreground" />
        {t("statusbar.connecting")}
      </span>
    </footer>
  );
}
