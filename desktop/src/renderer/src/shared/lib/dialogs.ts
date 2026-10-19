// 앱 안의 창 (명령 팔레트 · 설정 · 단축키 안내): 메뉴 · 상태바 · 팔레트 · 처음 켰을 때 안내가 연다
import { create } from "zustand";

export type SettingsSection = "agents" | "alerts" | "terminal" | "look" | "help";

interface DialogState {
  palette: boolean;
  shortcuts: boolean;
  /** 열린 설정 (null 이면 닫힘). intro: 맨 위에 보여 줄 안내 */
  settings: { section: SettingsSection; intro?: string } | null;
}

export const useDialogs = create<DialogState>(() => ({ palette: false, shortcuts: false, settings: null }));

/** 마지막에 본 목차 (다시 열면 그 자리) */
let lastSection: SettingsSection = "agents";

export const openSettings = (section?: SettingsSection, intro?: string) => {
  lastSection = section ?? lastSection;
  useDialogs.setState({ settings: { section: lastSection, intro }, palette: false, shortcuts: false });
};

export const setSettingsSection = (section: SettingsSection) => {
  lastSection = section;
  useDialogs.setState((s) => ({ settings: s.settings && { ...s.settings, section } }));
};

export const closeDialogs = () => useDialogs.setState({ palette: false, shortcuts: false, settings: null });

/** 열린 창이 있으면 (닫히는 중인 창은 빼고) → 그 창의 입력을 빼앗지 않는다 */
export const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"]');
