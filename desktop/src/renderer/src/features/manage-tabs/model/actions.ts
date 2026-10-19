// 탭 다루기: 열기 · 닫기 · 고르기 · 돌아가며 고르기. 터미널(entities/terminal) · 탭(entities/tab) · 프로젝트(entities/project)를 함께 움직인다
import type { TabKind } from "@ipc/contract";

import { useProjects } from "@/entities/project/model/store";
import { isLeaf, leaves, removeLeaf, replaceLeaf } from "@/entities/tab/model/panes";
import { projectTabs, useTabs } from "@/entities/tab/model/store";
import { disposeTerminal, getTerminal, openTerminal } from "@/entities/terminal/model/registry";
import { epeira } from "@/shared/api/epeira";

const KINDS: TabKind[] = ["shell", "claude", "codex"];

/** 지금 탭으로: 그 프로젝트로 바꾼다. 입력 위치는 그 터미널이 보이게 된 뒤 TerminalView 가 옮긴다 */
export const activateTab = (id: string) => {
  const { tabs, active, layout } = useTabs.getState();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  // 나눈 화면에서 칸에 없는 탭을 고르면 지금 칸(없으면 첫 칸)에 그 탭을 보여 준다
  const root = layout[tab.dir];
  const shown = leaves(root);
  if (root && !shown.includes(id)) {
    useTabs
      .getState()
      .setLayout(tab.dir, replaceLeaf(root, active && shown.includes(active) ? active : shown[0], { tab: id }));
  }
  useTabs.getState().setActive(id);
  useTabs.getState().patch(id, { unread: false });
  if (useProjects.getState().current !== tab.dir) useProjects.getState().setCurrent(tab.dir);
};

/** 입력 위치를 지금 탭의 터미널로 */
export const focusActive = () => {
  const id = useTabs.getState().active;
  if (id) getTerminal(id)?.term.focus();
};

/** 구분선을 끌고 나면 라이브러리가 구분선 포커스를 풀어 입력 위치가 사라진다 → 지금 터미널로 (키보드로 조절 중이면 그대로) */
export const refocusAfterResize = () =>
  requestAnimationFrame(() => {
    if (document.activeElement === document.body) focusActive();
  });

/** 새 탭: 지금 프로젝트(없으면 폴더 열기)에서 셸을 열고, claude · codex 면 셸이 준비되면 실행
 * quiet: 고르지 않고 열기만 (칸 나누기가 자리를 먼저 잡는다), size: 처음 터미널 크기 (없으면 칸 전체) */
export const openTab = async (
  kind: TabKind = "shell",
  dir = useProjects.getState().current,
  opts: { quiet?: boolean; size?: { width: number; height: number } } = {},
) => {
  if (!dir) {
    const added = await useProjects.getState().add();
    if (!added) return null;
    dir = added;
  }
  const safeKind = KINDS.includes(kind) ? kind : "shell"; // 셸에 그대로 입력되는 값이라 정해진 것만
  const size = opts.size ?? document.querySelector("[data-pane-area]")?.getBoundingClientRect();
  const id = await openTerminal({ cwd: dir, run: safeKind === "shell" ? null : safeKind, size });
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
  if (!opts.quiet) activateTab(id);
  return id;
};

/** 탭 닫기: claude · codex 등이 돌고 있으면 먼저 묻고, 같은 프로젝트의 옆 탭으로 */
export const closeTab = async (id = useTabs.getState().active, asked = false) => {
  const tab = useTabs.getState().tabs.find((t) => t.id === id);
  if (!tab) return;
  if (!asked && !(await epeira.confirmClose(tab.id))) return;
  const { tabs, active, layout } = useTabs.getState(); // 묻는 사이 바뀌었을 수 있다
  const list = projectTabs(tabs, tab.dir);
  const i = list.indexOf(tab);
  let next = list[i + 1] ?? list[i - 1];
  // 칸을 닫으면 옆 칸이 자리를 채우고, 그 칸이 지금 탭이 된다. 한 칸만 남으면 나누기를 푼다
  const root = layout[tab.dir];
  if (root && leaves(root).includes(tab.id)) {
    const { rest, sibling } = removeLeaf(root, tab.id);
    useTabs.getState().setLayout(tab.dir, rest && !isLeaf(rest) ? rest : null);
    next = tabs.find((t) => t.id === leaves(sibling)[0]) ?? next;
  }
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
