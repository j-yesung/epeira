// 탭 저장 · 되살리기: 다시 켜면 탭과 칸 배치를, Claude · Codex 대화는 그 탭을 처음 볼 때 이어서 연다
// 저장 형식은 예전 화면과 같다 (app.tabs) → 업데이트해도 열어 둔 탭이 그대로
// { current, list: [{dir, kind, title, sid, last}], layouts: {폴더: 칸 트리 (탭 id 대신 list 의 순번 {t})} }
import type { TabKind } from "@ipc/contract";

import { useProjects } from "@/entities/project/model/store";
import { isLeaf, type PaneNode } from "@/entities/tab/model/panes";
import { useTabs } from "@/entities/tab/model/store";
import { storage } from "@/shared/lib/storage";

import { activateTab, openTab, selectProject } from "./actions";

interface SavedTab {
  dir: string;
  kind: TabKind;
  title: string | null;
  sid: string | null;
  /** 그 프로젝트에서 마지막에 보던 탭 */
  last: boolean;
}
type SavedNode = { t: number } | { dir: string; ratio: number; a: SavedNode | null; b: SavedNode | null };
interface Saved {
  current: string | null;
  list: SavedTab[];
  layouts: Record<string, SavedNode | null>;
}

const serialize = (): Saved => {
  const { tabs, last, layout } = useTabs.getState();
  const live = tabs.filter((t) => !t.exited);
  const index = new Map(live.map((t, i) => [t.id, i]));
  const ser = (n: PaneNode): SavedNode | null => {
    if (!isLeaf(n)) return { dir: n.dir, ratio: n.ratio, a: ser(n.a), b: ser(n.b) };
    const i = index.get(n.tab);
    return i === undefined ? null : { t: i };
  };
  return {
    current: useProjects.getState().current,
    list: live.map((t) => ({ dir: t.dir, kind: t.kind, title: t.title, sid: t.sid, last: last[t.dir] === t.id })),
    layouts: Object.fromEntries(Object.entries(layout).flatMap(([d, n]) => (n ? [[d, ser(n)]] : []))),
  };
};

const save = () => storage.set("tabs", JSON.stringify(serialize()));

const read = (): Partial<Saved> | null => {
  try {
    const saved = JSON.parse(storage.get("tabs") || "null");
    return saved && typeof saved === "object" ? saved : null;
  } catch {
    return null; // 깨진 값이면 새로 시작
  }
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** 순번 → 탭 id. 없어진 탭(폴더가 사라진 프로젝트 등)의 칸은 빼고 옆 칸이 채운다. 같은 탭이 두 칸에 있으면 하나만 */
const deserialize = (n: unknown, ids: (string | null)[], used = new Set<string>()): PaneNode | null => {
  if (!n || typeof n !== "object") return null;
  const node = n as Record<string, unknown>;
  if ("t" in node) {
    const id = typeof node.t === "number" ? ids[node.t] : null;
    if (!id || used.has(id)) return null;
    used.add(id);
    return { tab: id };
  }
  const a = deserialize(node.a, ids, used);
  const b = deserialize(node.b, ids, used);
  if (!a || !b) return a ?? b;
  const ratio = typeof node.ratio === "number" && node.ratio > 0.05 && node.ratio < 0.95 ? node.ratio : 0.5;
  return { dir: node.dir === "rows" ? "rows" : "cols", ratio, a, b };
};

let started = false;

/** 앱을 켤 때 한 번 (프로젝트 목록을 읽은 뒤): 저장된 탭을 되살리고, 그 뒤로 바뀔 때마다 저장 */
export const restoreTabs = async () => {
  if (started) return;
  started = true;
  const saved = read();
  const list = Array.isArray(saved?.list) ? saved.list : [];
  const { projects } = useProjects.getState();
  const ids: (string | null)[] = [];
  for (const s of list) {
    const dir = str(s?.dir);
    if (!dir || !projects.some((p) => p.path === dir && p.exists)) {
      ids.push(null);
      continue;
    }
    const id = await openTab(s.kind, dir, { quiet: true, resume: true, title: str(s.title), sid: str(s.sid) });
    ids.push(id);
    if (id && s.last) useTabs.setState((st) => ({ last: { ...st.last, [dir]: id } }));
  }
  for (const [dir, n] of Object.entries(saved?.layouts ?? {})) {
    const node = deserialize(n, ids);
    if (node && !isLeaf(node)) useTabs.getState().setLayout(dir, node);
  }
  const current = str(saved?.current);
  const { tabs } = useTabs.getState();
  if (current && projects.some((p) => p.path === current)) selectProject(current);
  else if (tabs.length) activateTab(tabs[tabs.length - 1].id);
  // 되살리는 동안은 저장하지 않는다 (덜 연 상태로 저장된 값을 덮지 않게)
  save();
  useTabs.subscribe(save);
  useProjects.subscribe(save);
};
