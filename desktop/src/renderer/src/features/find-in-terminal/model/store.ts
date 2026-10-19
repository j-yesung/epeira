// 터미널 찾기 (⌘F): 지금 탭의 터미널에서 찾는다
import { create } from "zustand";

import { useTabs } from "@/entities/tab/model/store";
import { getTerminal } from "@/entities/terminal/model/registry";
import { findColors } from "@/shared/lib/tokens";

interface FindState {
  open: boolean;
  query: string;
  /** "3/12" · "없음" · "" */
  count: string;
  show: () => void;
  hide: () => void;
  setQuery: (query: string) => void;
  find: (dir: 1 | -1, incremental?: boolean) => void;
}

const activeTerminal = () => {
  const id = useTabs.getState().active;
  return id ? getTerminal(id) : undefined;
};

export const useFind = create<FindState>((set, get) => ({
  open: false,
  query: "",
  count: "",
  show: () => {
    if (activeTerminal()) set({ open: true });
  },
  hide: () => {
    set({ open: false, count: "" });
    const term = activeTerminal();
    term?.search.clearDecorations();
    term?.term.focus();
  },
  setQuery: (query) => {
    set({ query });
    get().find(1, true);
  },
  find: (dir, incremental = false) => {
    const t = activeTerminal();
    const { query } = get();
    if (!t) return;
    if (!query) {
      t.search.clearDecorations();
      set({ count: "" });
      return;
    }
    const opts = { decorations: findColors(), incremental };
    if (dir < 0) t.search.findPrevious(query, opts);
    else t.search.findNext(query, opts);
  },
}));
