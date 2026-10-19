// 지난 시간: 방금 · n분 전 · n시간 전 · n일 전
import { i18n } from "@/shared/i18n";

/** ts: 초 단위 */
export const ago = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
  if (m < 1) return i18n.t("time.now");
  if (m < 60) return i18n.t("time.minutes", { n: m });
  if (m < 1440) return i18n.t("time.hours", { n: Math.floor(m / 60) });
  return i18n.t("time.days", { n: Math.floor(m / 1440) });
};
