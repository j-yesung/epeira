// 프로젝트 목록과 지금 프로젝트. 목록 화면은 사이드바(4단계), 여기는 상태만

import type { Project } from "@ipc/contract";
import { create } from "zustand";

import { epeira } from "@/shared/api/epeira";

interface ProjectState {
  projects: Project[];
  /** 지금 보고 있는 프로젝트 (그 프로젝트의 탭만 보인다) */
  current: string | null;
  load: () => Promise<void>;
  setCurrent: (dir: string | null) => void;
  /** 폴더 열기 창으로 프로젝트를 더하고 그 프로젝트로 */
  add: () => Promise<string | null>;
}

export const useProjects = create<ProjectState>((set, get) => ({
  projects: [],
  current: null,
  load: async () => {
    const projects = await epeira.projects();
    set({ projects, current: get().current ?? projects[0]?.path ?? null });
  },
  setCurrent: (dir) => {
    set({ current: dir });
    if (dir) epeira.touchProject(dir).then((projects) => set({ projects }));
  },
  add: async () => {
    const r = await epeira.addProject();
    set({ projects: r.list });
    if (r.added) get().setCurrent(r.added);
    return r.added;
  },
}));

export const projectName = (dir: string) =>
  useProjects.getState().projects.find((p) => p.path === dir)?.name ?? dir.split("/").pop() ?? dir;
