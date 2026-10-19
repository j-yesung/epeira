// 화면(renderer)에 여는 최소 API → Node 는 화면에 직접 열지 않는다
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from "electron";

import type { EpeiraApi } from "../ipc/contract";

/** 메인이 보내는 신호 구독. React 부품이 사라질 때 끊을 수 있게 해제 함수를 돌려준다 */
const on = <A extends unknown[]>(channel: string, fn: (...args: A) => void) => {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => fn(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const api: EpeiraApi = {
  platform: process.platform,
  orbitUrl: (process.argv.find((a) => a.startsWith("--agent-orbit-url=")) ?? "=http://127.0.0.1:47777").split("=")[1],

  projects: () => ipcRenderer.invoke("projects:list"),
  addProject: () => ipcRenderer.invoke("projects:add"),
  addProjectPath: (dir) => ipcRenderer.invoke("projects:addPath", dir),
  removeProject: (dir) => ipcRenderer.invoke("projects:remove", dir),
  confirmRemove: (name, tabIds) => ipcRenderer.invoke("projects:confirmRemove", name, tabIds),
  touchProject: (dir) => ipcRenderer.invoke("projects:touch", dir),
  revealProject: (dir) => ipcRenderer.send("project:reveal", dir),
  pathForFile: (file) => webUtils.getPathForFile(file),

  collector: () => ipcRenderer.invoke("collector:ensure"),
  installDevTools: () => ipcRenderer.send("install-devtools"),
  usage: (refresh) => ipcRenderer.invoke("collector:usage", !!refresh),
  get: (pathname) => ipcRenderer.invoke("orbit:get", pathname),
  post: (pathname, body) => ipcRenderer.invoke("orbit:post", pathname, body),
  onEvent: (fn) => on("orbit:event", fn),
  doctor: () => ipcRenderer.invoke("collector:doctor"),
  reinstall: () => ipcRenderer.invoke("collector:reinstall"),

  createTerm: (opts) => ipcRenderer.invoke("pty:create", opts),
  confirmClose: (id) => ipcRenderer.invoke("pty:confirmClose", id),
  write: (id, data) => ipcRenderer.send("pty:write", id, data),
  resize: (id, cols, rows) => ipcRenderer.send("pty:resize", id, cols, rows),
  kill: (id) => ipcRenderer.send("pty:kill", id),
  onData: (fn) => on("pty:data", fn),
  onExit: (fn) => on("pty:exit", fn),
  termMenu: (selection) => ipcRenderer.send("term:menu", selection),
  onTermAction: (fn) => on("term:action", fn),

  notify: (msg) => ipcRenderer.send("notify", msg),
  badge: (count) => ipcRenderer.send("badge", count),
  onActivateTab: (fn) => on("tab:activate", fn),
  gitInfo: (dirs) => ipcRenderer.invoke("git:info", dirs),
  fonts: () => ipcRenderer.invoke("fonts:list"),

  appVersion: () => ipcRenderer.invoke("app:version"),
  checkUpdate: (force) => ipcRenderer.invoke("update:check", !!force),
  installUpdate: (version) => ipcRenderer.invoke("update:install", version),
  onUpdateProgress: (fn) => on("update:progress", fn),

  getTheme: () => ipcRenderer.invoke("theme:get"),
  setTheme: (theme) => ipcRenderer.invoke("theme:set", theme),
  onMenu: (fn) => on("menu", fn),
  openExternal: (url) => ipcRenderer.send("open-external", url),
};

contextBridge.exposeInMainWorld("epeira", api);
