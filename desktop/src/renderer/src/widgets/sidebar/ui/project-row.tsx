// 사이드바 프로젝트 한 줄: 펼치기(›) · 이름 · git 또는 경로 · 열린 터미널 수 · 메뉴(⋯ · 우클릭), 펼치면 지난 세션
import type { Project } from "@ipc/contract";
import { Folder, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { selectProject } from "@/features/manage-tabs/model/actions";
import { shortPath } from "@/shared/lib/path";
import { cn } from "@/shared/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { isUnfolded, useFolds } from "../model/folds";
import { ProjectMenuItems } from "./project-menu";
import { SessionList } from "./session-list";

export function ProjectRow({ project: p }: { project: Project }) {
  const { t } = useTranslation();
  const current = useProjects((s) => s.current);
  const git = useProjects((s) => s.git[p.path]);
  const count = useTabs((s) => s.tabs.filter((x) => x.dir === p.path && !x.exited).length);
  const folds = useFolds((s) => s.folds);
  const setFold = useFolds((s) => s.setFold);
  const on = p.path === current;
  const unfolded = p.exists && isUnfolded(folds, p.path, current);
  const sub = !p.exists
    ? t("sidebar.gone")
    : git
      ? git.changes
        ? t("sidebar.gitChanges", { branch: git.branch, changes: git.changes })
        : t("sidebar.git", { branch: git.branch })
      : shortPath(p.path);

  // 다른 프로젝트를 누르면 고르고 펼친다, 지금 프로젝트를 다시 누르면 펼치기 · 접기
  const click = () => {
    if (!p.exists) return;
    if (on) return setFold(p.path, !unfolded);
    setFold(p.path, true);
    selectProject(p.path);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          title={p.path}
          className={cn(
            "group relative cursor-pointer rounded-lg hover:bg-secondary",
            on &&
              "bg-secondary before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary",
            !p.exists && "opacity-50",
          )}
        >
          {p.exists && (
            <button
              type="button"
              aria-expanded={unfolded}
              aria-label={t(unfolded ? "sidebar.foldNamed" : "sidebar.unfoldNamed", { name: p.name })}
              title={t(unfolded ? "sidebar.fold" : "sidebar.unfold")}
              onClick={() => setFold(p.path, !unfolded)}
              className={cn(
                "absolute top-3 left-[3px] z-1 grid size-[18px] cursor-pointer place-items-center rounded-sm text-faint-foreground text-md leading-none transition-transform hover:bg-input hover:text-foreground",
                unfolded && "rotate-90",
              )}
            >
              ›
            </button>
          )}
          <button
            type="button"
            aria-expanded={p.exists ? unfolded : undefined}
            onClick={click}
            className="flex w-full cursor-pointer items-center gap-2.5 py-2 pr-2 pl-[22px] text-left"
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-[26px] shrink-0 place-items-center text-muted-foreground [&_svg]:size-[19px]",
                on && "text-primary",
              )}
            >
              {unfolded ? <FolderOpen /> : <Folder />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate font-semibold">{p.name}</b>
              <small className="truncate font-mono text-faint-foreground text-xs">{sub}</small>
            </span>
            {count > 0 && (
              <span
                title={t("sidebar.openCount", { count })}
                className="min-w-[18px] rounded-full bg-primary/18 px-[5px] text-center font-mono font-semibold text-primary-strong text-xs leading-[18px] group-focus-within:invisible group-hover:invisible"
              >
                {count}
              </span>
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t("sidebar.menu")}
                aria-label={t("sidebar.menuNamed", { name: p.name })}
                className="absolute top-[9px] right-1.5 hidden size-6 cursor-pointer place-items-center rounded-md bg-secondary text-lg text-muted-foreground leading-none hover:bg-input hover:text-foreground group-focus-within:grid group-hover:grid data-[state=open]:grid"
              >
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <ProjectMenuItems project={p} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
            </DropdownMenuContent>
          </DropdownMenu>
          {unfolded && <SessionList project={p} />}
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ProjectMenuItems project={p} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
