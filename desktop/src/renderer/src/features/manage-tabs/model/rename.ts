// 탭 이름 바꾸기 (탭을 두 번 누르기, 비우면 원래 이름)
// 세션이 있는 탭은 수집기에 저장 → 궤도 HUB 이름도 같이 바뀐다 (못 하면 이 탭에만)
import { create } from "zustand";

import { useSessions } from "@/entities/session/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { epeira } from "@/shared/api/epeira";

/** 지금 이름을 바꾸는 탭 (탭을 두 번 누르기 · ⌘R) */
export const useRenaming = create<{ id: string | null }>(() => ({ id: null }));

export const renameTab = async (id: string, value: string) => {
  const tab = useTabs.getState().tabs.find((t) => t.id === id);
  if (!tab) return;
  const name = value.trim();
  const sid = tab.sid;
  if (sid) {
    const r = (await epeira.post("/api/rename", { id: sid, name })) as { ok?: boolean; name?: string | null } | null;
    if (r?.ok) {
      useSessions.setState((s) => {
        const names = { ...s.names };
        if (r.name) names[sid] = r.name;
        else delete names[sid];
        return { names };
      });
      useTabs.getState().patch(id, { title: null });
      return;
    }
  }
  useTabs.getState().patch(id, { title: name || null });
};
