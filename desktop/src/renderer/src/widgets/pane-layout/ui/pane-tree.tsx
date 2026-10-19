// 칸 나누기 트리를 중첩 Group 으로: 나눔 하나 = 칸 두 개 + 구분선. 구분선을 끌면 비율 저장, 두 번 누르면 같은 크기로
import { useId } from "react";

import { useTranslation } from "react-i18next";
import { Group, Panel, Separator } from "react-resizable-panels";

import { evenRatio, isLeaf, type PaneNode, setRatioAt } from "@/entities/tab/model/panes";
import { useTabs } from "@/entities/tab/model/store";
import { refocusAfterResize } from "@/features/manage-tabs/model/actions";
import { cn } from "@/shared/lib/utils";

import { Pane } from "./pane";

const saveRatio = (dir: string, path: string, ratio: number) => {
  const { layout, setLayout } = useTabs.getState();
  const root = layout[dir];
  let n = root;
  for (const side of path) if (n && !isLeaf(n)) n = side === "a" ? n.a : n.b;
  if (!root || !n || isLeaf(n) || !Number.isFinite(ratio) || Math.abs(n.ratio - ratio) < 0.001) return;
  setLayout(dir, setRatioAt(root, path, ratio));
};

/** path: 맨 위에서 이 나눔까지 ("" 맨 위, "ab" 는 a 쪽의 b 쪽) */
export function PaneTree({ node, path, dir }: { node: PaneNode; path: string; dir: string }) {
  const { t } = useTranslation();
  const uid = useId().replace(/[^\w-]/g, "");
  if (isLeaf(node)) return <Pane id={node.tab} paned />;
  const cols = node.dir === "cols";
  const a = `pane-${uid}-a`;
  const b = `pane-${uid}-b`;
  const even = evenRatio(node) * 100;
  const min = cols ? "160px" : "90px"; // 끌어서 한쪽이 너무 작아지지 않게
  return (
    <Group
      orientation={cols ? "horizontal" : "vertical"}
      defaultLayout={{ [a]: node.ratio * 100, [b]: 100 - node.ratio * 100 }}
      onLayoutChanged={(layout, meta) => {
        saveRatio(dir, path, (meta.requestedLayout ?? layout)[a] / 100);
        if (meta.isUserInteraction) refocusAfterResize();
      }}
    >
      <Panel id={a} defaultSize={`${even}%`} minSize={min}>
        <PaneTree node={node.a} path={`${path}a`} dir={dir} />
      </Panel>
      <Separator
        aria-label={t("pane.resize")}
        className={cn(
          "bg-input data-[separator=active]:bg-primary data-[separator=hover]:bg-primary",
          cols ? "w-px" : "h-px",
        )}
      />
      <Panel id={b} defaultSize={`${100 - even}%`} minSize={min}>
        <PaneTree node={node.b} path={`${path}b`} dir={dir} />
      </Panel>
    </Group>
  );
}
