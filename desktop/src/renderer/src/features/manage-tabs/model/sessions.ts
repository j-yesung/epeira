// 지난 세션 · 다른 터미널에서 하던 세션을 탭으로 이어 열기
import { toast } from "sonner";

import { useProjects } from "@/entities/project/model/store";
import { projectOf, type Session } from "@/entities/session/model/store";
import { resumeCmd } from "@/entities/tab/model/resume";
import { useTabs } from "@/entities/tab/model/store";
import { i18n } from "@/shared/i18n";

import { activateTab, openTab } from "./actions";

/** 방금까지 움직이던 세션: 다른 터미널에서 아직 실행 중일 수 있다 */
const RECENT = 120;

/** 이어 열기. "recent" 면 같은 대화를 두 곳에서 열지 않게 먼저 물어보고 force 로 다시 부른다 */
export const openSession = async (x: Session, force = false): Promise<"recent" | undefined> => {
  const open = useTabs.getState().tabs.find((t) => t.sid === x.id);
  if (open) {
    activateTab(open.id);
    return;
  }
  const projects = useProjects.getState();
  let dir = projectOf(x, projects.projects)?.path ?? null;
  if (!dir && x.cwd) dir = await projects.addPath(x.cwd); // 목록에 없는 폴더면 프로젝트로 추가
  if (!dir) {
    toast(i18n.t("session.noFolder"));
    return;
  }
  const kind = x.agent === "codex" ? "codex" : "claude";
  if (!resumeCmd(kind, x.id) || (x.agent !== "claude" && x.agent !== "codex")) {
    toast(i18n.t("session.cannotResume"));
    return;
  }
  if (!force && Date.now() / 1000 - (x.last || 0) <= RECENT) return "recent";
  await openTab(kind, dir, { sid: x.id, resume: true });
};
