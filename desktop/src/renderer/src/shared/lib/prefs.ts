// 앱 설정 (이 Mac 의 이 앱에만): 알림 · 터미널. 예전 화면과 같은 키(app.prefs, JSON)
import { create } from "zustand";

import { storage } from "./storage";

export interface Prefs {
  notify: boolean;
  notifyDone: boolean;
  notifyWait: boolean;
  sound: boolean;
  fontSize: number;
  copyOnSelect: boolean;
  /** Option 키를 Meta 로 (Option+←/→ 로 단어 이동) */
  optionMeta: boolean;
  /** 터미널 글꼴 (비우면 기본) */
  fontTerm: string;
}

const DEFAULTS: Prefs = {
  notify: true,
  notifyDone: true,
  notifyWait: true,
  sound: true,
  fontSize: 13,
  copyOnSelect: false,
  optionMeta: true,
  fontTerm: "",
};

const load = (): Prefs => {
  try {
    return { ...DEFAULTS, ...JSON.parse(storage.get("prefs") || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
};

interface PrefsState extends Prefs {
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...load(),
  setPref: (key, value) => {
    set({ [key]: value } as Partial<PrefsState>);
    const { setPref: _, ...prefs } = get();
    storage.set("prefs", JSON.stringify(prefs));
  },
}));
