// 사용 한도 (5시간 · 주간 창): 수집기가 기록한 값. 초기화 시각이 지났으면 이미 초기화된 것으로 본다 (마지막 기록이 그 전 값이라서)
import { i18n } from "@/shared/i18n";

interface LimitWindow {
  used?: number | null;
  /** 창 길이 (분) */
  window?: number;
  /** 초기화 시각 (초) */
  resets?: number | null;
}

export interface AgentLimits {
  primary?: LimitWindow;
  secondary?: LimitWindow;
  plan?: string;
  /** 기록한 때 (초) */
  at?: number;
  error?: string;
}

export interface LimitView {
  name: string;
  short: string;
  used: number;
  resets: number | null;
}

export const limitWindows = (L: AgentLimits | undefined): LimitView[] =>
  !L
    ? []
    : [L.primary, L.secondary]
        .filter((w): w is LimitWindow => !!w && w.used != null)
        .map((w) => {
          const mins = w.window || 300;
          const weekly = mins >= 1440;
          const reset = !!w.resets && w.resets * 1000 < Date.now();
          const hours = Math.round(mins / 60);
          return {
            name: weekly ? i18n.t("limits.weekly") : i18n.t("limits.hours", { n: hours }),
            short: weekly ? i18n.t("limits.weeklyShort") : i18n.t("limits.hoursShort", { n: hours }),
            used: reset ? 0 : Math.round(w.used ?? 0),
            resets: reset ? null : (w.resets ?? null),
          };
        });

/** 80% 넘으면 주의, 95% 넘으면 위험 */
export const limitLevel = (used: number) => (used >= 95 ? "err" : used >= 80 ? "warn" : null);

/** 남은 시간 · 지난 시간: n일 n시간 · n시간 n분 · n분 */
export const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m >= 1440) return i18n.t("limits.spanDays", { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60) });
  if (m >= 60) return i18n.t("limits.spanHours", { h: Math.floor(m / 60), m: m % 60 });
  return i18n.t("limits.spanMinutes", { m });
};
