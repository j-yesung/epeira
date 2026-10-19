// 메인 창: 사이드바 | 터미널(탭 줄 · 칸) | 궤도 패널, 아래 상태바. 사이드바 · 궤도 패널은 끌어서 너비를 바꾸고 ⌘B · ⌘J 로 접는다
import { useState } from "react";

import { useTranslation } from "react-i18next";
import { Group, Panel, Separator } from "react-resizable-panels";

import { OrbitPanel } from "@/widgets/orbit-panel/ui/orbit-panel";
import { PaneLayout } from "@/widgets/pane-layout/ui/pane-layout";
import { Sidebar } from "@/widgets/sidebar/ui/sidebar";
import { Statusbar } from "@/widgets/statusbar/ui/statusbar";
import { TabBar } from "@/widgets/tab-bar/ui/tab-bar";

import {
  CENTER_MIN,
  initialWidths,
  ORBIT_WIDTH,
  SIDE_WIDTH,
  saveOrbitWidth,
  saveSideWidth,
  useLayout,
} from "../model/layout";
import { useWorkspaceEvents } from "../model/use-workspace-events";

export function WorkspacePage() {
  const { t } = useTranslation();
  const { sideOpen, orbitOpen, toggleOrbit } = useLayout();
  const [widths] = useState(initialWidths);

  useWorkspaceEvents();

  return (
    <div className="flex h-full flex-col">
      <Group orientation="horizontal" className="min-h-0 flex-1">
        {sideOpen && (
          <>
            <Panel
              id="side"
              defaultSize={`${widths.side}px`}
              minSize={`${SIDE_WIDTH.min}px`}
              maxSize={`${SIDE_WIDTH.max}px`}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => saveSideWidth(size.inPixels)}
            >
              <Sidebar />
            </Panel>
            <Separator
              aria-label={t("sidebar.resize")}
              className="w-px bg-border data-[separator=active]:bg-primary data-[separator=hover]:bg-primary"
            />
          </>
        )}
        <Panel id="center" minSize={`${CENTER_MIN}px`}>
          <section className="flex h-full min-w-0 flex-col">
            <TabBar sideOpen={sideOpen} orbitOpen={orbitOpen} onToggleOrbit={toggleOrbit} />
            <PaneLayout />
          </section>
        </Panel>
        {orbitOpen && (
          <>
            <Separator
              aria-label={t("orbit.resize")}
              className="w-[5px] bg-border data-[separator=active]:bg-primary data-[separator=hover]:bg-primary"
            />
            <Panel
              id="orbit"
              defaultSize={`${widths.orbit}px`}
              minSize={`${ORBIT_WIDTH.min}px`}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => saveOrbitWidth(size.inPixels)}
            >
              <OrbitPanel />
            </Panel>
          </>
        )}
      </Group>
      <Statusbar />
    </div>
  );
}
