// 탭 다루기: 열기 · 닫기 · 고르기 · 돌아가며 고르기. 터미널(entities/terminal) · 탭(entities/tab) · 프로젝트(entities/project)를 함께 움직인다
import type { TabKind } from "@ipc/contract";

import { useProjects } from "@/entities/project/model/store";
import { projectTabs, useTabs } from "@/entities/tab/model/store";
import { disposeTerminal, openTerminal } from "@/entities/terminal/model/registry";
import { epeira } from "@/shared/api/epeira";

const KINDS: TabKind[] = ["shell", "claude", "codex"];

/** 지금 탭으로: 그 프로젝트로 바꾼다. 입력 위치는 그 터미널이 보이게 된 뒤 TerminalView 가 옮긴다 */
export const activateTab = (id: string) => {
  const tab = useTabs.getState().tabs.find((t) => t.id === id);
  if (!tab) return;
  useTabs.getState().setActive(id);
  useTabs.getState().patch(id, { unread: false });
  if (useProjects.getState().current !== tab.dir) useProjects.getState().setCurrent(tab.dir);
};

/** 새 탭: 지금 프로젝트(없으면 폴더 열기)에서 셸을 열고, claude · codex 면 셸이 준비되면 실행 */
export const openTab = async (kind: TabKind = "shell", dir = useProjects.getState().current) => {
  if (!dir) {
    const added = await useProjects.getState().add();
    if (!added) return null;
    dir = added;
  }
  const safeKind = KINDS.includes(kind) ? kind : "shell"; // 셸에 그대로 입력되는 값이라 정해진 것만
  const area = document.querySelector("[data-pane-area]")?.getBoundingClientRect();
  const id = await openTerminal({ cwd: dir, run: safeKind === "shell" ? null : safeKind, size: area });
  useTabs.getState().add({
    id,
    dir,
    kind: safeKind,
    title: null,
    sid: null,
    exited: false,
    busy: false,
    waiting: false,
    unread: false,
  });
  activateTab(id);
  return id;
};

/** 탭 닫기: claude · codex 등이 돌고 있으면 먼저 묻고, 같은 프로젝트의 옆 탭으로 */
export const closeTab = async (id = useTabs.getState().active, asked = false) => {
  const { tabs, active } = useTabs.getState();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (!asked && !(await epeira.confirmClose(tab.id))) return;
  const list = projectTabs(tabs, tab.dir);
  const i = list.indexOf(tab);
  const next = list[i + 1] ?? list[i - 1];
  epeira.kill(tab.id);
  disposeTerminal(tab.id);
  useTabs.getState().remove(tab.id);
  if (active !== tab.id) return;
  if (next) activateTab(next.id);
  else useTabs.getState().setActive(null);
};

/** 지금 프로젝트 안에서 다음 · 이전 탭 (⌃⇥ · ⌃⇧⇥) */
export const cycleTab = (step: 1 | -1) => {
  const { tabs, active } = useTabs.getState();
  const list = projectTabs(tabs, useProjects.getState().current);
  if (!list.length) return;
  const i = list.findIndex((t) => t.id === active);
  activateTab(list[(i + step + list.length) % list.length].id);
};

/** ⌘1–9: 지금 프로젝트의 n 번째 탭 */
export const activateNth = (n: number) => {
  const tab = projectTabs(useTabs.getState().tabs, useProjects.getState().current)[n - 1];
  if (tab) activateTab(tab.id);
  return !!tab;
};

/** 프로젝트 고르기: 그 프로젝트에서 마지막에 보던 탭으로 (없으면 시작 화면, 터미널을 멋대로 열지 않는다) */
export const selectProject = (dir: string) => {
  useProjects.getState().setCurrent(dir);
  const { tabs, last } = useTabs.getState();
  const list = projectTabs(tabs, dir);
  const tab = list.find((t) => t.id === last[dir]) ?? list.at(-1);
  if (tab) activateTab(tab.id);
  else useTabs.getState().setActive(null);
};
