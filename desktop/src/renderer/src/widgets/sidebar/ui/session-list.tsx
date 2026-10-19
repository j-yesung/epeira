// 펼친 프로젝트 아래: 오늘 쓴 토큰 + 지금 탭에 열린 세션(Claude · Codex 대화, 누르면 그 탭으로)
// 닫은 지난 세션은 명령 팔레트(⌘P)에서 이어 연다
import type { Project } from "@ipc/contract";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { projectOf, sessionName, useSessions } from "@/entities/session/model/store";
import { tabLabel } from "@/entities/tab/model/label";
import { useTabs } from "@/entities/tab/model/store";
import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { StateDot, tabState } from "@/entities/tab/ui/state-dot";
import { useUsage } from "@/entities/usage/model/store";
import { activateTab } from "@/features/manage-tabs/model/actions";
import { fmtK } from "@/shared/lib/format";
import { ago } from "@/shared/lib/time";

export function SessionList({ project }: { project: Project }) {
  const { t } = useTranslation();
  const sessions = useSessions((s) => s.sessions);
  const names = useSessions((s) => s.names);
  const projects = useProjects((s) => s.projects);
  const tabs = useTabs((s) => s.tabs);
  const today = useUsage((s) => s.usage?.today);
  // 세션이 짝지어진 탭 (수집기가 탭 ↔ 세션을 알려 준 것)
  const open = tabs.filter((tab) => tab.dir === project.path && tab.sid);

  // 오늘 쓴 토큰: 서브에이전트는 부모 세션의 프로젝트로 센다
  const byId = new Map((today ?? []).map((x) => [x.id, x]));
  let tok = 0;
  for (const x of today ?? []) {
    const root = (x.parent && byId.get(x.parent)) || x;
    if (projectOf({ ...root, last: 0 }, projects)?.path === project.path) tok += x.tok;
  }

  return (
    <div className="pr-1.5 pb-2 pl-[58px]">
      <p title={t("sidebar.usageHint")} className="mb-1 font-mono text-faint-foreground text-xs">
        {tok ? t("sidebar.usageToday", { tok: fmtK(tok) }) : t("sidebar.usageNone")}
      </p>
      {open.length > 0 && (
        <ul aria-label={t("session.list")} className="grid grid-cols-[minmax(0,1fr)] gap-px">
          {open.map((tab) => {
            const x = sessions.find((s) => s.id === tab.sid);
            const name = x ? sessionName(x, names) : tabLabel(tab, tabs, names);
            const state = tabState(tab);
            return (
              <li key={tab.id}>
                <button
                  type="button"
                  title={t("session.goToTab")}
                  onClick={() => activateTab(tab.id)}
                  className="flex h-[26px] w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left text-muted-foreground text-sm hover:bg-card hover:text-foreground"
                >
                  <KindIcon kind={tab.kind} />
                  <span title={name} className="min-w-0 flex-1 truncate">
                    {name}
                  </span>
                  {state && <StateDot state={state} />}
                  {x && <small className="shrink-0 font-mono text-2xs text-faint-foreground">{ago(x.last)}</small>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
