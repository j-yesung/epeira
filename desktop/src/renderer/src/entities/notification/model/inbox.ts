// 놓친 알림: 보고 있지 않을 때 생긴 응답 끝 · 승인 대기를 모아 둔다 (macOS 알림을 꺼도). 최근 30개
import { create } from "zustand";

export interface InboxItem {
  /** 생긴 때 (밀리초) */
  at: number;
  tab: string;
  title: string;
  body: string;
  read: boolean;
}

interface InboxState {
  items: InboxItem[];
  push: (item: Omit<InboxItem, "read">) => void;
  readAll: () => void;
  clear: () => void;
}

const MAX = 30;

export const useInbox = create<InboxState>((set) => ({
  items: [],
  push: (item) => set((s) => ({ items: [{ ...item, read: false }, ...s.items].slice(0, MAX) })),
  readAll: () => set((s) => ({ items: s.items.map((x) => (x.read ? x : { ...x, read: true })) })),
  clear: () => set({ items: [] }),
}));
