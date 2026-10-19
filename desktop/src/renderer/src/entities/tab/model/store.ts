// 터미널 탭: 프로젝트마다 따로. last 는 프로젝트별로 마지막에 보던 탭, layout 은 프로젝트별 칸 나누기, zoom 은 한 칸 크게 보기

import type { TabKind } from "@ipc/contract";
import { create } from "zustand";

import type { PaneNode } from "./panes";

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
  layout: Record<string, PaneNode | null>;
  zoom: Record<string, boolean>;
  add: (tab: Tab) => void;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
  patch: (id: string, patch: Partial<Tab>) => void;
  /** 끌어 놓은 탭을 그 탭 자리로 */
  move: (id: string, to: string) => void;
  /** 나누기를 풀면(null) 크게 보기도 끈다 */
  setLayout: (dir: string, node: PaneNode | null) => void;
  setZoom: (dir: string, on: boolean) => void;
}

export const useTabs = create<TabState>((set) => ({
  tabs: [],
  active: null,
  last: {},
  layout: {},
  zoom: {},
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
  move: (id, to) =>
    set((s) => {
      const from = s.tabs.findIndex((t) => t.id === id);
      const at = s.tabs.findIndex((t) => t.id === to);
      if (from < 0 || at < 0 || from === at) return s;
      const tabs = [...s.tabs];
      tabs.splice(at, 0, ...tabs.splice(from, 1));
      return { tabs };
    }),
  setLayout: (dir, node) =>
    set((s) => ({ layout: { ...s.layout, [dir]: node }, zoom: node ? s.zoom : { ...s.zoom, [dir]: false } })),
  setZoom: (dir, on) => set((s) => ({ zoom: { ...s.zoom, [dir]: on } })),
}));

/** 그 프로젝트의 탭들 (열린 순서) */
export const projectTabs = (tabs: Tab[], dir: string | null) => tabs.filter((t) => t.dir === dir);
