// 화면 나누기 (iTerm2 처럼): ⌘D 지금 칸을 좌우로 · ⇧⌘D 위아래로, 계속 나눠 프로젝트당 9칸까지
// ⌥⌘ + 방향키 옆 칸으로 · ⇧⌘↩ 지금 칸 크게 · ⌥⌘W 나누기 모두 풀기 (터미널은 탭으로 남는다)
import { toast } from "sonner";

import { useProjects } from "@/entities/project/model/store";
import { leaves, MAX_PANES, type PaneDir, replaceLeaf, swapLeaves } from "@/entities/tab/model/panes";
import { useTabs } from "@/entities/tab/model/store";
import { i18n } from "@/shared/i18n";

import { activateTab, openTab } from "./actions";

/** 칸이 너무 작으면 Claude Code 화면이 깨진다 */
const MIN_W = 320;
const MIN_H = 150;

const paneRect = (id: string) => document.querySelector(`[data-pane="${id}"]`)?.getBoundingClientRect();

export const splitPane = async (dir: PaneDir) => {
  const project = useProjects.getState().current;
  const { active, layout, zoom } = useTabs.getState();
  if (!project || !active) return;
  const root = layout[project] ?? { tab: active };
  if (leaves(root).length >= MAX_PANES) return toast(i18n.t("pane.max", { max: MAX_PANES }));
  if (zoom[project]) {
    // 크게 보던 칸은 원래 크기로 돌려놓고 잰다
    useTabs.getState().setZoom(project, false);
    await new Promise(requestAnimationFrame);
  }
  const box = paneRect(active);
  if (!box) return;
  const half =
    dir === "cols" ? { width: box.width / 2, height: box.height } : { width: box.width, height: box.height / 2 };
  if (dir === "cols" ? half.width < MIN_W : half.height < MIN_H) return toast(i18n.t("pane.noRoom"));
  const id = await openTab("shell", project, { quiet: true, size: half });
  if (!id) return;
  // 여는 사이 지금 탭 · 배치가 바뀌었을 수 있어 다시 읽는다
  const now = useTabs.getState();
  const base = now.layout[project] ?? { tab: active };
  const at = leaves(base).includes(active) ? active : leaves(base)[0];
  now.setLayout(project, replaceLeaf(base, at, { dir, ratio: 0.5, a: { tab: at }, b: { tab: id } }));
  activateTab(id);
};

/** 그 방향에서 가장 가까운 칸으로 */
export const moveFocus = (way: "left" | "right" | "up" | "down") => {
  const { active } = useTabs.getState();
  const c = active && paneRect(active);
  if (!c) return;
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  let best: string | null = null;
  let bd = Number.POSITIVE_INFINITY;
  for (const el of document.querySelectorAll<HTMLElement>("[data-pane]")) {
    const id = el.dataset.pane;
    if (!id || id === active) continue;
    const r = el.getBoundingClientRect();
    const ok = {
      left: r.right <= c.left + 2,
      right: r.left >= c.right - 2,
      up: r.bottom <= c.top + 2,
      down: r.top >= c.bottom - 2,
    }[way];
    const d = Math.abs(r.left + r.width / 2 - cx) + Math.abs(r.top + r.height / 2 - cy);
    if (ok && d < bd) {
      bd = d;
      best = id;
    }
  }
  if (best) activateTab(best);
};

/** 지금 칸만 크게, 다시 누르면 원래대로 */
export const toggleZoom = () => {
  const project = useProjects.getState().current;
  const { layout, zoom, setZoom } = useTabs.getState();
  if (project && layout[project]) setZoom(project, !zoom[project]);
};

export const unsplit = () => {
  const project = useProjects.getState().current;
  if (project) useTabs.getState().setLayout(project, null);
};

/** 탭을 칸에 끌어 놓기: 그 칸에 보여 준다 (이미 다른 칸에 있으면 자리를 바꾼다) */
export const dropTabOnPane = (id: string, target: string) => {
  const { tabs, layout, setLayout } = useTabs.getState();
  const tab = tabs.find((t) => t.id === id);
  const project = useProjects.getState().current;
  if (!tab || tab.dir !== project) return;
  const root = layout[project];
  if (root && target !== id) {
    setLayout(
      project,
      leaves(root).includes(id) ? swapLeaves(root, id, target) : replaceLeaf(root, target, { tab: id }),
    );
  }
  activateTab(id);
};
