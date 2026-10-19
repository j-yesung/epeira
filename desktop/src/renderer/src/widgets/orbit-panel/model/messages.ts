// 궤도 대시보드가 콘솔로 보내는 요청: "탭으로 열기"(epeira:open) · "이 탭으로 가기"(epeira:focus)
// 대시보드가 보낸 폴더 · 종류는 믿지 않는다: 수집기 기록에 있는 세션만, 값도 수집기 것으로
import { toast } from "sonner";

import { useSessions } from "@/entities/session/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { activateTab } from "@/features/manage-tabs/model/actions";
import { openSession } from "@/features/manage-tabs/model/sessions";
import { i18n } from "@/shared/i18n";

export const handleOrbitMessage = async (message: string | undefined) => {
  const m = /^epeira:(open|focus) (\{.*\})$/.exec(message || "");
  if (!m) return;
  let x: { id?: unknown };
  try {
    x = JSON.parse(m[2]);
  } catch {
    return;
  }
  const id = x?.id;
  if (typeof id !== "string") return;
  const open = useTabs.getState().tabs.find((t) => t.sid === id);
  if (open) return activateTab(open.id);
  if (m[1] !== "open") return;
  if (!useSessions.getState().sessions.some((s) => s.id === id)) await useSessions.getState().load();
  const known = useSessions.getState().sessions.find((s) => s.id === id);
  if (known) openSession(known);
  else toast(i18n.t("orbit.sessionMissing"));
};
