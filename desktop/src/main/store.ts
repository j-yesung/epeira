// 앱 데이터 폴더의 JSON 두 개: 앱 설정(app.json → 창 위치 · 테마 · 업데이트 확인) · 프로젝트 목록(projects.json)
import fs from "node:fs";
import path from "node:path";

import { app, dialog, ipcMain, shell } from "electron";

import type { Project, ProjectsResult } from "../ipc/contract";
import { state } from "./context";

export interface AppConf {
  bounds?: Electron.Rectangle;
  maximized?: boolean;
  theme?: "system" | "light" | "dark";
  latest?: { version: string; url: string };
  checkedAt?: number;
}

const confFile = () => path.join(app.getPath("userData"), "app.json");

export const conf = (): AppConf => {
  try {
    return JSON.parse(fs.readFileSync(confFile(), "utf8"));
  } catch {
    return {};
  }
};

export const saveConf = (patch: Partial<AppConf>) => {
  const next = { ...conf(), ...patch };
  fs.mkdirSync(path.dirname(confFile()), { recursive: true });
  fs.writeFileSync(confFile(), JSON.stringify(next, null, 2));
  return next;
};

type StoredProject = Omit<Project, "exists">;
const storeFile = () => path.join(app.getPath("userData"), "projects.json");

export const loadProjects = (): StoredProject[] => {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), "utf8"));
  } catch {
    return [];
  }
};

const saveProjects = (list: StoredProject[]) => {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(list, null, 2));
};

const projectsView = (): Project[] => loadProjects().map((p) => ({ ...p, exists: fs.existsSync(p.path) }));

const addProject = (dir: string): ProjectsResult => {
  const list = loadProjects();
  if (!list.some((p) => p.path === dir)) {
    list.unshift({ path: dir, name: path.basename(dir), added: Date.now(), opened: Date.now() });
  }
  saveProjects(list);
  return { list: projectsView(), added: dir };
};

export const registerProjectIpc = () => {
  ipcMain.handle("projects:list", () => projectsView());
  ipcMain.handle("projects:add", async () => {
    const opts: Electron.OpenDialogOptions = {
      title: "프로젝트 폴더 열기",
      properties: ["openDirectory", "createDirectory"],
    };
    const r = state.win ? await dialog.showOpenDialog(state.win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { list: projectsView(), added: null };
    return addProject(r.filePaths[0]);
  });
  // 폴더를 사이드바에 끌어다 놓기
  ipcMain.handle("projects:addPath", (_e, dir: unknown) => {
    try {
      if (typeof dir === "string" && path.isAbsolute(dir) && fs.statSync(dir).isDirectory()) return addProject(dir);
    } catch {
      // 폴더가 아님
    }
    return { list: projectsView(), added: null };
  });
  ipcMain.handle("projects:remove", (_e, dir: unknown) => {
    saveProjects(loadProjects().filter((p) => p.path !== dir));
    return projectsView();
  });
  ipcMain.handle("projects:touch", (_e, dir: unknown) => {
    const list = loadProjects();
    const p = list.find((x) => x.path === dir);
    if (p) {
      p.opened = Date.now();
      saveProjects(list);
    }
    return projectsView();
  });
  // "Finder 에서 보기": 목록에 있는 프로젝트만, 폴더를 실행하지 않고 보여 주기만
  ipcMain.on("project:reveal", (_e, dir: unknown) => {
    if (typeof dir === "string" && loadProjects().some((p) => p.path === dir)) shell.showItemInFolder(dir);
  });
};
