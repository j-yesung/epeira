// 왼쪽 사이드바: 신호등 옆 이름 · 프로젝트 머리(+ 폴더 열기) · 프로젝트 목록 (목록은 4단계에서)
import { FolderIcon, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { Button } from "@/shared/ui/button";

export function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside aria-label={t("sidebar.label")} className="flex h-full min-w-0 flex-col bg-chrome">
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
      <div className="px-2.5 py-1">
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-input border-dashed px-3 py-5 text-center text-faint-foreground">
          <FolderIcon className="size-5 text-muted-foreground" />
          <b className="font-semibold text-muted-foreground text-sm">{t("sidebar.emptyTitle")}</b>
          <small className="text-xs">{t("sidebar.emptyHint")}</small>
        </div>
      </div>
    </aside>
  );
}
