// 테마: 고른 값(시스템 · 라이트 · 다크)을 <html data-theme> 로 건다. 시스템이면 macOS 설정이 바뀔 때 따라간다

import type { ThemeChoice } from "@ipc/contract";
import { create } from "zustand";

import { epeira } from "../api/epeira";

const dark = matchMedia("(prefers-color-scheme: dark)");

const apply = (choice: ThemeChoice) => {
  const isDark = choice === "dark" || (choice === "system" && dark.matches);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
};

interface ThemeState {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => Promise<void>;
}

export const useTheme = create<ThemeState>((set) => ({
  choice: "system",
  setChoice: async (choice) => {
    const saved = await epeira.setTheme(choice);
    set({ choice: saved });
    apply(saved);
  },
}));

/** 앱을 켤 때 한 번: 저장된 테마를 걸고, 시스템 설정 변화를 따라간다 */
export const initTheme = async () => {
  const choice = await epeira.getTheme();
  useTheme.setState({ choice });
  apply(choice);
  dark.addEventListener("change", () => apply(useTheme.getState().choice));
};
