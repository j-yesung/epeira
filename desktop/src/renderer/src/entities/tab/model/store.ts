// 터미널 탭: 프로젝트마다 따로. last 는 프로젝트별로 마지막에 보던 탭

import type { TabKind } from "@ipc/contract";
import { create } from "zustand";

export interface Tab {
  /** 메인 프로세스가 준 PTY id (수집기가 탭 ↔ 세션을 짝짓는 값이기도 함) */
  id: string;
  /** 프로젝트 폴더 */
  dir: string;
  kind: TabKind;
  /** 직접 붙인 이름 (없으면 종류 이름) */
  title: string | null;
  /** 이 탭의 Claude · Codex 세션 */
  sid: string | null;
  exited: boolean;
  busy: boolean;
  waiting: boolean;
  unread: boolean;
}

interface TabState {
  tabs: Tab[];
  active: string | null;
  last: Record<string, string>;
  add: (tab: Tab) => void;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
  patch: (id: string, patch: Partial<Tab>) => void;
}

export const useTabs = create<TabState>((set) => ({
  tabs: [],
  active: null,
  last: {},
  add: (tab) => set((s) => ({ tabs: [...s.tabs, tab] })),
  remove: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      const last = { ...s.last };
      if (tab && last[tab.dir] === id) delete last[tab.dir];
      return { tabs: s.tabs.filter((t) => t.id !== id), active: s.active === id ? null : s.active, last };
    }),
  setActive: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      return { active: id, last: tab ? { ...s.last, [tab.dir]: tab.id } : s.last };
    }),
  patch: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
}));

/** 그 프로젝트의 탭들 (열린 순서) */
export const projectTabs = (tabs: Tab[], dir: string | null) => tabs.filter((t) => t.dir === dir);
