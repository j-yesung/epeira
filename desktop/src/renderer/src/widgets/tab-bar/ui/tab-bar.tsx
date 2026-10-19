// 가운데 위 탭 줄: 지금 프로젝트의 탭들(두 번 눌러 이름 바꾸기, 끌어서 순서 바꾸기 · 칸에 놓기는 TabDnd, 넘치면 탭 목록)
// · 새 터미널 · Claude · Codex 새 세션 · 궤도 패널 열고 닫기
import { useEffect, useRef, useState } from "react";

import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { ChevronDown, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { useSessions } from "@/entities/session/model/store";
import { tabLabel } from "@/entities/tab/model/label";
import { leaves } from "@/entities/tab/model/panes";
import { projectTabs, type Tab, useTabs } from "@/entities/tab/model/store";
import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { StateDot, tabState } from "@/entities/tab/ui/state-dot";
import { getTerminal } from "@/entities/terminal/model/registry";
import { activateTab, closeTab, focusActive, openTab } from "@/features/manage-tabs/model/actions";
import { renameTab } from "@/features/manage-tabs/model/rename";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { IconTile } from "@/shared/ui/icon-tile";
import { ClaudeLogo, OpenAILogo } from "@/shared/ui/icons/agent-logos";
import { OrbitMark } from "@/shared/ui/icons/orbit-mark";

interface TabBarProps {
  /** 사이드바를 닫으면 신호등 버튼 자리를 비운다 */
  sideOpen: boolean;
  orbitOpen: boolean;
  onToggleOrbit: () => void;
}

interface TabItemProps {
  tab: Tab;
  index: number;
  label: string;
  active: boolean;
  /** 나눈 화면의 다른 칸에 보이는 탭 */
  paned: boolean;
}

function TabItem({ tab, index, label, active, paned }: TabItemProps) {
  const { t } = useTranslation();
  // 키보드로 끌기는 쓰지 않는다 (↩ · space 는 탭 고르기). 그래서 attributes(role=button 등)는 붙이지 않는다
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: tab.id });
  const state = tabState(tab);
  const [renaming, setRenaming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!renaming) return;
    done.current = false;
    input.current?.focus();
    input.current?.select();
  }, [renaming]);

  /** 이름 바꾸기 끝: value 가 null 이면 취소. ↩ 와 입력칸을 떠날 때가 겹쳐도 한 번만 */
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    setRenaming(false);
    if (value !== null) renameTab(tab.id, value);
    focusActive();
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      title={t("tab.hint", { dir: tab.dir })}
      style={{ transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined, transition }}
      className={cn(
        "flex h-[30px] min-w-24 max-w-[220px] flex-[0_1_200px] items-center rounded-lg border border-transparent text-muted-foreground [-webkit-app-region:no-drag] hover:bg-card",
        paned && "border-input text-foreground",
        active && "border-input bg-secondary text-foreground hover:bg-secondary",
        tab.exited && "opacity-55",
        isDragging && "opacity-40",
      )}
    >
      {renaming ? (
        <input
          ref={input}
          defaultValue={label}
          maxLength={40}
          spellCheck={false}
          aria-label={t("tab.rename")}
          onPointerDown={(e) => e.stopPropagation()} // 글자를 드래그해 고를 때 탭이 끌리지 않게
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") finish(e.currentTarget.value);
            else if (e.key === "Escape") finish(null);
          }}
          onBlur={(e) => finish(e.currentTarget.value)}
          className="mr-1 ml-1.5 h-6 min-w-0 flex-1 rounded-md border border-primary bg-background px-1.5 text-foreground outline-none"
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => (active ? getTerminal(tab.id)?.term.focus() : activateTab(tab.id))}
          onDoubleClick={() => setRenaming(true)}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-[7px] pr-1 pl-2"
        >
          <KindIcon kind={tab.kind} />
          <span className="truncate">{label}</span>
          {state && <StateDot state={state} />}
          {index < 9 && (
            <kbd className="ml-auto border-0 p-0 text-2xs text-faint-foreground tracking-normal">⌘{index + 1}</kbd>
          )}
        </button>
      )}
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
  const names = useSessions((s) => s.names);
  const active = useTabs((s) => s.active);
  const root = useTabs((s) => (current ? s.layout[current] : null));
  const zoomed = useTabs((s) => !!current && !!s.zoom[current]);
  const panes = zoomed ? [] : leaves(root);
  const list = projectTabs(tabs, current);
  const tablist = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  // 탭이 넘치면 탭 목록 버튼을 보인다
  useEffect(() => {
    const el = tablist.current;
    if (!el) return;
    const check = () => setOverflow(list.length > 0 && el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list.length]);

  // 지금 탭은 보이게
  useEffect(() => {
    if (active)
      tablist.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      className={cn(
        "flex h-(--bar-height) shrink-0 items-center gap-1.5 border-b bg-chrome px-2.5 [-webkit-app-region:drag]",
        !sideOpen && "pl-(--traffic-lights)",
      )}
    >
      <div
        ref={tablist}
        role="tablist"
        aria-label={t("tabBar.label")}
        style={{ flexBasis: `${list.length * 204}px` }}
        className="flex min-w-0 shrink grow-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        <SortableContext items={list.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          {list.map((tab, i) => (
            <TabItem
              key={tab.id}
              tab={tab}
              index={i}
              label={tabLabel(tab, tabs, names)}
              active={tab.id === active}
              paned={panes.includes(tab.id)}
            />
          ))}
        </SortableContext>
      </div>
      {overflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title={t("tab.list")}
              aria-label={t("tab.list")}
              className="[-webkit-app-region:no-drag]"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {list.map((tab) => {
              const state = tabState(tab);
              return (
                <DropdownMenuItem
                  key={tab.id}
                  onSelect={() => activateTab(tab.id)}
                  className={cn(tab.id === active && "bg-secondary")}
                >
                  <KindIcon kind={tab.kind} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{tabLabel(tab, tabs, names)}</span>
                    {state && (
                      <small className="truncate text-faint-foreground text-xs">{t(`tab.state.${state}`)}</small>
                    )}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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
