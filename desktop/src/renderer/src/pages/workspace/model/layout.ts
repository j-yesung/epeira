// 메인 창 배치: 사이드바 · 궤도 패널을 보일지와 너비. 예전 화면과 같은 저장 키(app.no-side · no-orbit · sideW · orbitW)
import { create } from "zustand";

import { storage } from "@/shared/lib/storage";

export const SIDE_WIDTH = { default: 248, min: 200, max: 360 };
export const ORBIT_WIDTH = { default: 440, min: 320 };
export const CENTER_MIN = 360; // 터미널이 최소한 이만큼은 남게

const savedWidth = (key: string, fallback: number) => Number(storage.get(key)) || fallback;

interface LayoutState {
  sideOpen: boolean;
  orbitOpen: boolean;
  toggleSide: () => void;
  toggleOrbit: () => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sideOpen: storage.get("no-side") !== "1",
  orbitOpen: storage.get("no-orbit") !== "1",
  toggleSide: () => {
    const open = !get().sideOpen;
    storage.set("no-side", open ? "0" : "1");
    set({ sideOpen: open });
  },
  toggleOrbit: () => {
    const open = !get().orbitOpen;
    storage.set("no-orbit", open ? "0" : "1");
    set({ orbitOpen: open });
  },
}));

/** 처음 그릴 때의 너비 (끌어서 바꾼 너비는 바로 저장하고, 화면을 다시 그리지는 않는다) */
export const initialWidths = () => ({
  side: savedWidth("sideW", SIDE_WIDTH.default),
  orbit: savedWidth("orbitW", ORBIT_WIDTH.default),
});
export const saveSideWidth = (px: number) => storage.set("sideW", String(Math.round(px)));
export const saveOrbitWidth = (px: number) => storage.set("orbitW", String(Math.round(px)));
