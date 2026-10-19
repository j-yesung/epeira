// 새 버전: 켤 때와 켜 둔 동안 6시간마다 확인. 받으면 우리 서명을 확인하고 다시 시작 (못 하면 내려받기 페이지)
import type { UpdateInfo, UpdateStage } from "@ipc/contract";
import { toast } from "sonner";
import { create } from "zustand";

import { epeira } from "@/shared/api/epeira";
import { i18n } from "@/shared/i18n";

interface UpdateState {
  /** 지금 앱 버전 */
  version: string;
  /** 새 버전 (없으면 null) */
  update: UpdateInfo | null;
  installing: boolean;
  /** 받기(0~1) → 확인 중(fraction null) */
  progress: { stage: NonNullable<UpdateStage>; fraction: number | null } | null;
}

export const useUpdate = create<UpdateState>(() => ({ version: "", update: null, installing: false, progress: null }));

/** force: 설정의 "업데이트 확인" (캐시 없이) → 실패면 { failed } */
export const checkUpdate = async (force = false) => {
  const u = await epeira.checkUpdate(force);
  if (u && "failed" in u) return u;
  useUpdate.setState({ update: u });
  return u;
};

export const installUpdate = async () => {
  const { update, installing } = useUpdate.getState();
  if (!update || installing) return;
  useUpdate.setState({ installing: true });
  toast(i18n.t("update.downloading", { version: update.version }));
  const r = await epeira
    .installUpdate(update.version)
    .catch((e: Error) => ({ ok: false, manual: true, error: e.message }));
  useUpdate.setState({ installing: false, progress: null });
  if (r.manual) {
    toast(r.error ? i18n.t("update.manualError", { error: r.error }) : i18n.t("update.manual"));
    epeira.openExternal(update.url);
  }
};

const SIX_HOURS = 6 * 3600_000;

/** 앱을 켤 때 한 번 */
export const initUpdates = () => {
  epeira.appVersion().then((version) => useUpdate.setState({ version }));
  checkUpdate().catch(() => {});
  const timer = setInterval(() => checkUpdate().catch(() => {}), SIX_HOURS);
  const off = epeira.onUpdateProgress((stage, fraction) =>
    useUpdate.setState({ progress: stage ? { stage, fraction } : null }),
  );
  return () => {
    clearInterval(timer);
    off();
  };
};
