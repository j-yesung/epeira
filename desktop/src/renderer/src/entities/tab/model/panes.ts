// 칸 나누기 트리 (프로젝트마다 하나): 칸 {tab} 또는 나눔 {dir: 'cols'(좌우) | 'rows'(위아래), ratio, a, b}
// 예전 화면과 같은 모양이라 저장된 배치(app.tabs 의 layouts)를 그대로 읽는다

export type PaneDir = "cols" | "rows";
export type PaneLeaf = { tab: string };
export type PaneSplit = { dir: PaneDir; ratio: number; a: PaneNode; b: PaneNode };
export type PaneNode = PaneLeaf | PaneSplit;

/** 한 프로젝트에 나눌 수 있는 칸 수 */
export const MAX_PANES = 9;

export const isLeaf = (n: PaneNode): n is PaneLeaf => "tab" in n;

/** 칸에 보이는 탭들 (왼쪽 위부터) */
export const leaves = (n: PaneNode | null | undefined): string[] =>
  !n ? [] : isLeaf(n) ? [n.tab] : [...leaves(n.a), ...leaves(n.b)];

export const replaceLeaf = (n: PaneNode, id: string, to: PaneNode): PaneNode =>
  isLeaf(n) ? (n.tab === id ? to : n) : { ...n, a: replaceLeaf(n.a, id, to), b: replaceLeaf(n.b, id, to) };

export const swapLeaves = (n: PaneNode, a: string, b: string): PaneNode =>
  isLeaf(n)
    ? n.tab === a
      ? { tab: b }
      : n.tab === b
        ? { tab: a }
        : n
    : { ...n, a: swapLeaves(n.a, a, b), b: swapLeaves(n.b, a, b) };

/** 그 칸을 뺀 트리와, 빈자리를 채운 옆 칸 */
export const removeLeaf = (n: PaneNode, id: string): { rest: PaneNode | null; sibling: PaneNode | null } => {
  if (isLeaf(n)) return { rest: n.tab === id ? null : n, sibling: null };
  if (isLeaf(n.a) && n.a.tab === id) return { rest: n.b, sibling: n.b };
  if (isLeaf(n.b) && n.b.tab === id) return { rest: n.a, sibling: n.a };
  const a = removeLeaf(n.a, id);
  const b = removeLeaf(n.b, id);
  return { rest: { ...n, a: a.rest ?? n.a, b: b.rest ?? n.b }, sibling: a.sibling ?? b.sibling };
};

/** 경로("" 맨 위, "ab" 는 a 의 b)에 있는 나눔의 비율을 바꾼다 */
export const setRatioAt = (n: PaneNode, path: string, ratio: number): PaneNode => {
  if (isLeaf(n)) return n;
  if (!path) return { ...n, ratio };
  const side = path[0] === "a" ? "a" : "b";
  return { ...n, [side]: setRatioAt(n[side], path.slice(1), ratio) };
};

/** 같은 방향으로 늘어선 칸 수 */
const weight = (n: PaneNode, dir: PaneDir): number =>
  isLeaf(n) || n.dir !== dir ? 1 : weight(n.a, dir) + weight(n.b, dir);

/** 같은 방향으로 늘어선 칸들이 모두 같은 크기가 되는 비율 (구분선을 두 번 누르면 이 값으로) */
export const evenRatio = (n: PaneSplit) => weight(n.a, n.dir) / (weight(n.a, n.dir) + weight(n.b, n.dir));
