// 앱 메뉴 · 단축키: 앱 전체 단축키는 여기서 맡고, 누르면 화면에 동작 이름만 보낸다
import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";

import type { MenuAction } from "../ipc/contract";
import { ORBIT, sendToWin } from "./context";

const send = (action: MenuAction) => () => sendToWin("menu", action);

export const buildMenu = () => {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { label: "설정…", accelerator: "CmdOrCtrl+,", click: send("settings") },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "파일",
      submenu: [
        { label: "폴더 열기…", accelerator: "CmdOrCtrl+O", click: send("add-project") },
        { type: "separator" },
        { label: "새 터미널 탭", accelerator: "CmdOrCtrl+T", click: send("new-shell") },
        { label: "Claude 새 세션", accelerator: "CmdOrCtrl+Shift+C", click: send("new-claude") },
        { label: "Codex 새 세션", accelerator: "CmdOrCtrl+Shift+X", click: send("new-codex") },
        { type: "separator" },
        { label: "탭 닫기", accelerator: "CmdOrCtrl+W", click: send("close-tab") },
        ...(isMac
          ? []
          : ([
              { type: "separator" },
              { label: "설정…", accelerator: "CmdOrCtrl+,", click: send("settings") },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "편집",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "찾기…", accelerator: "CmdOrCtrl+F", click: send("find") },
      ],
    },
    {
      label: "보기",
      submenu: [
        { label: "명령 팔레트…", accelerator: "CmdOrCtrl+P", click: send("palette") },
        { label: "단축키 안내", accelerator: "CmdOrCtrl+/", click: send("shortcuts") },
        { type: "separator" },
        { label: "사이드바", accelerator: "CmdOrCtrl+B", click: send("toggle-side") },
        { label: "궤도 패널", accelerator: "CmdOrCtrl+J", click: send("toggle-orbit") },
        {
          label: "화면 나누기",
          submenu: [
            { label: "좌우로 나누기", accelerator: "CmdOrCtrl+D", click: send("split") },
            { label: "위아래로 나누기", accelerator: "CmdOrCtrl+Shift+D", click: send("split-rows") },
            { type: "separator" },
            { label: "왼쪽 칸", accelerator: "CmdOrCtrl+Alt+Left", click: send("pane-left") },
            { label: "오른쪽 칸", accelerator: "CmdOrCtrl+Alt+Right", click: send("pane-right") },
            { label: "위 칸", accelerator: "CmdOrCtrl+Alt+Up", click: send("pane-up") },
            { label: "아래 칸", accelerator: "CmdOrCtrl+Alt+Down", click: send("pane-down") },
            { type: "separator" },
            { label: "지금 칸 크게 보기", accelerator: "CmdOrCtrl+Shift+Enter", click: send("pane-zoom") },
            { label: "나누기 모두 풀기", accelerator: "CmdOrCtrl+Alt+W", click: send("unsplit") },
          ],
        },
        { label: "대시보드 크게 보기", click: () => shell.openExternal(`${ORBIT}/`) },
        { type: "separator" },
        { label: "다음 탭", accelerator: "Ctrl+Tab", click: send("next-tab") },
        { label: "이전 탭", accelerator: "Ctrl+Shift+Tab", click: send("prev-tab") },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
