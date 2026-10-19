// 사용량 읽기 (15초마다 · 새로고침): 상태바 숫자와 함께 탭 ↔ 세션 짝 · 세션 이름도 받는다
import { useSessions } from "@/entities/session/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { useUsage } from "@/entities/usage/model/store";

/** 수집기가 알려 준 탭 ↔ 세션 짝을 탭에 저장 → 다시 켰을 때 그 대화를 이어 연다 */
export const linkTab = (tabId: string, sid: string) => {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (tab && sid && tab.sid !== sid) useTabs.getState().patch(tab.id, { sid });
};

export const loadUsage = async (refresh = false) => {
  const usage = await useUsage.getState().load(refresh);
  if (!usage.ok) return;
  for (const [tabId, sid] of Object.entries(usage.tabs ?? {})) linkTab(tabId, sid);
  if (usage.names) useSessions.setState({ names: usage.names });
};
