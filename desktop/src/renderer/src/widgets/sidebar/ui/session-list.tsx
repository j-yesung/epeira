// 펼친 프로젝트 아래: 오늘 쓴 토큰 + 지난 세션 (누르면 이어서 열기, 이미 탭에 있으면 그 탭으로)
import type { Project } from "@ipc/contract";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { projectOf, sessionKind, sessionName, useSessions } from "@/entities/session/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { useUsage } from "@/entities/usage/model/store";
import { openSession } from "@/features/manage-tabs/model/sessions";
import { fmtK } from "@/shared/lib/format";
import { ago } from "@/shared/lib/time";

const SHOWN = 6;

export function SessionList({ project }: { project: Project }) {
  const { t } = useTranslation();
  const sessions = useSessions((s) => s.sessions);
  const names = useSessions((s) => s.names);
  const projects = useProjects((s) => s.projects);
  const tabs = useTabs((s) => s.tabs);
  const today = useUsage((s) => s.usage?.today);
  const list = sessions.filter((x) => projectOf(x, projects)?.path === project.path).slice(0, SHOWN);

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
      {list.length > 0 && (
        <ul aria-label={t("session.list")} className="grid grid-cols-[minmax(0,1fr)] gap-px">
          {list.map((x) => {
            const inTab = tabs.some((tab) => tab.sid === x.id);
            const name = sessionName(x, names);
            return (
              <li key={x.id}>
                <button
                  type="button"
                  title={inTab ? t("session.goToTab") : t("session.resume")}
                  onClick={() => openSession(x)}
                  className="flex h-[26px] w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left text-muted-foreground text-sm hover:bg-card hover:text-foreground"
                >
                  <KindIcon kind={sessionKind(x)} />
                  <span title={name} className="min-w-0 flex-1 truncate">
                    {name}
                  </span>
                  {inTab && (
                    <span
                      role="img"
                      aria-label={t("session.inTab")}
                      className="size-[7px] shrink-0 rounded-full bg-primary"
                    />
                  )}
                  <small className="shrink-0 font-mono text-2xs text-faint-foreground">{ago(x.last)}</small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
