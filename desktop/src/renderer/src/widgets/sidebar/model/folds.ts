// 프로젝트 아래 세션 목록 펼치기 · 접기. 정한 적이 없으면 지금 프로젝트만 펼친다 (다시 켜도 기억 → 예전과 같은 app.folds)
import { create } from "zustand";

import { storage } from "@/shared/lib/storage";

const read = (): Record<string, boolean> => {
  try {
    const v = JSON.parse(storage.get("folds") || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};

interface FoldState {
  folds: Record<string, boolean>;
  setFold: (dir: string, open: boolean) => void;
}

export const useFolds = create<FoldState>((set) => ({
  folds: read(),
  setFold: (dir, open) =>
    set((s) => {
      const folds = { ...s.folds, [dir]: open };
      storage.set("folds", JSON.stringify(folds));
      return { folds };
    }),
}));

export const isUnfolded = (folds: Record<string, boolean>, dir: string, current: string | null) =>
  Object.hasOwn(folds, dir) ? folds[dir] : dir === current;
