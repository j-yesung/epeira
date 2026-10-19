// 왼쪽 사이드바: 신호등 옆 이름 · 프로젝트 머리(+ 폴더 열기) · 프로젝트 목록. 폴더를 끌어다 놓으면 프로젝트로 추가
import { useEffect, useState } from "react";

import { FolderIcon, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { useSessions } from "@/entities/session/model/store";
import { addFolders } from "@/features/manage-tabs/model/projects";
import { epeira } from "@/shared/api/epeira";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { ProjectRow } from "./project-row";

export function Sidebar() {
  const { t } = useTranslation();
  const projects = useProjects((s) => s.projects);
  const [dropping, setDropping] = useState(false);
  const dirs = projects.map((p) => p.path).join("\n");

  // git 브랜치 · 변경 수: 프로젝트가 늘거나 줄 때와 15초마다
  useEffect(() => {
    if (!dirs) return;
    const load = () => useProjects.getState().loadGit();
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [dirs]);

  // 지난 세션: 1분마다 (7일치를 읽으니 덜 자주)
  useEffect(() => {
    const load = () => useSessions.getState().load();
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <aside
      aria-label={t("sidebar.label")}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        addFolders([...e.dataTransfer.files].map((f) => epeira.pathForFile(f)).filter(Boolean));
      }}
      className={cn(
        "flex h-full min-w-0 flex-col bg-chrome",
        dropping && "outline-dashed outline-2 outline-primary -outline-offset-6",
      )}
    >
      <div className="flex h-(--bar-height) shrink-0 items-center pr-3.5 pl-(--traffic-lights) [-webkit-app-region:drag]">
        <span className="font-bold text-muted-foreground text-sm leading-none">Epeira</span>
      </div>
      <div className="flex items-center justify-between pt-2.5 pr-2.5 pb-1.5 pl-3.5 font-bold text-faint-foreground text-xs tracking-widest">
        <span>{t("sidebar.title")}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => useProjects.getState().add()}
          title={t("sidebar.addProjectHint")}
          aria-label={t("sidebar.addProject")}
        >
          <Plus />
        </Button>
      </div>
      {projects.length ? (
        <ul className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
          {projects.map((p) => (
            <ProjectRow key={p.path} project={p} />
          ))}
        </ul>
      ) : (
        <div className="px-2.5 py-1">
          <div
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-xl border border-input border-dashed px-3 py-5 text-center text-faint-foreground",
              dropping && "border-primary text-primary",
            )}
          >
            <FolderIcon className={cn("size-5 text-muted-foreground", dropping && "text-primary")} />
            <b className={cn("font-semibold text-muted-foreground text-sm", dropping && "text-primary")}>
              {t("sidebar.emptyTitle")}
            </b>
            <small className="text-xs">{t("sidebar.emptyHint")}</small>
          </div>
        </div>
      )}
    </aside>
  );
}
