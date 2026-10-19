// 가운데 위 탭 줄: 지금 프로젝트의 탭들 · 새 터미널 · Claude · Codex 새 세션 · 궤도 패널 열고 닫기
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { tabLabel } from "@/entities/tab/model/label";
import { projectTabs, type Tab, useTabs } from "@/entities/tab/model/store";
import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { getTerminal } from "@/entities/terminal/model/registry";
import { activateTab, closeTab, openTab } from "@/features/manage-tabs/model/actions";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { IconTile } from "@/shared/ui/icon-tile";
import { ClaudeLogo, OpenAILogo } from "@/shared/ui/icons/agent-logos";
import { OrbitMark } from "@/shared/ui/icons/orbit-mark";

interface TabBarProps {
  /** 사이드바를 닫으면 신호등 버튼 자리를 비운다 */
  sideOpen: boolean;
  orbitOpen: boolean;
  onToggleOrbit: () => void;
}

function TabItem({ tab, index, label, active }: { tab: Tab; index: number; label: string; active: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      title={tab.dir}
      className={cn(
        "flex h-[30px] min-w-24 max-w-[220px] flex-[0_1_200px] items-center rounded-lg border border-transparent text-muted-foreground [-webkit-app-region:no-drag] hover:bg-card",
        active && "border-input bg-secondary text-foreground hover:bg-secondary",
        tab.exited && "opacity-55",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => (active ? getTerminal(tab.id)?.term.focus() : activateTab(tab.id))}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-[7px] pr-1 pl-2"
      >
        <KindIcon kind={tab.kind} />
        <span className="truncate">{label}</span>
        {index < 9 && (
          <kbd className="ml-auto border-0 p-0 text-2xs text-faint-foreground tracking-normal">⌘{index + 1}</kbd>
        )}
      </button>
      <button
        type="button"
        title={t("tab.close")}
        aria-label={t("tab.closeNamed", { label })}
        onClick={() => closeTab(tab.id)}
        className="mr-1 grid size-[22px] shrink-0 cursor-pointer place-items-center rounded-sm text-faint-foreground hover:bg-secondary hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function TabBar({ sideOpen, orbitOpen, onToggleOrbit }: TabBarProps) {
  const { t } = useTranslation();
  const current = useProjects((s) => s.current);
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const list = projectTabs(tabs, current);
  return (
    <div
      className={cn(
        "flex h-(--bar-height) shrink-0 items-center gap-1.5 border-b bg-chrome px-2.5 [-webkit-app-region:drag]",
        !sideOpen && "pl-(--traffic-lights)",
      )}
    >
      <div
        role="tablist"
        aria-label={t("tabBar.label")}
        style={{ flexBasis: `${list.length * 204}px` }}
        className="flex min-w-0 shrink grow-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {list.map((tab, i) => (
          <TabItem key={tab.id} tab={tab} index={i} label={tabLabel(tab, tabs)} active={tab.id === active} />
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon"
        title={t("tabBar.newShell")}
        aria-label={t("tabBar.newShell")}
        onClick={() => openTab("shell")}
        className="[-webkit-app-region:no-drag]"
      >
        <Plus />
      </Button>
      <div className="ml-auto flex shrink-0 gap-1.5 [-webkit-app-region:no-drag]">
        <Button variant="secondary" title={t("tabBar.newClaude")} onClick={() => openTab("claude")}>
          <IconTile>
            <ClaudeLogo className="text-agent-claude" />
          </IconTile>
          Claude
        </Button>
        <Button variant="secondary" title={t("tabBar.newCodex")} onClick={() => openTab("codex")}>
          <IconTile>
            <OpenAILogo className="text-foreground" />
          </IconTile>
          Codex
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={t("tabBar.toggleOrbit")}
          aria-label={t("tabBar.toggleOrbit")}
          aria-pressed={orbitOpen}
          onClick={onToggleOrbit}
          className={cn(orbitOpen && "text-primary hover:text-primary")}
        >
          <OrbitMark className="size-4" />
        </Button>
      </div>
    </div>
  );
}
