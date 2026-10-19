// 프로젝트 다루기 (탭과 함께): 목록에서 빼기 · 끌어다 놓은 폴더 더하기
import { toast } from "sonner";

import { projectName, useProjects } from "@/entities/project/model/store";
import { projectTabs, useTabs } from "@/entities/tab/model/store";
import { epeira } from "@/shared/api/epeira";
import { i18n } from "@/shared/i18n";

import { closeTab, selectProject } from "./actions";

/** 목록에서 빼기: 열린 터미널이 있으면 한 번 묻고 닫는다. 지금 프로젝트였으면 남은 프로젝트로 */
export const removeProject = async (dir: string) => {
  const open = projectTabs(useTabs.getState().tabs, dir);
  if (
    open.length &&
    !(await epeira.confirmRemove(
      projectName(dir),
      open.map((t) => t.id),
    ))
  )
    return;
  for (const t of open) await closeTab(t.id, true);
  const projects = await useProjects.getState().remove(dir);
  if (useProjects.getState().current !== dir) return;
  const next = projects.find((p) => p.exists);
  if (next) return selectProject(next.path);
  useProjects.getState().setCurrent(null);
  useTabs.getState().setActive(null);
};

/** 사이드바에 끌어다 놓은 폴더들을 더하고 (마지막으로 더한) 그 프로젝트로 */
export const addFolders = async (paths: string[]) => {
  let added: string | null = null;
  for (const p of paths) added = (await useProjects.getState().addPath(p)) ?? added;
  if (added) selectProject(added);
  else toast(i18n.t("sidebar.dropOnlyFolders"));
};
