// 펼친 프로젝트 아래: 지난 세션 (누르면 이어서 열기, 이미 탭에 있으면 그 탭으로)
import { useState } from "react";

import type { Project } from "@ipc/contract";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { projectOf, type Session, sessionKind, sessionName, useSessions } from "@/entities/session/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { openSession } from "@/features/manage-tabs/model/sessions";
import { ago } from "@/shared/lib/time";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

const SHOWN = 6;

export function SessionList({ project }: { project: Project }) {
  const { t } = useTranslation();
  const sessions = useSessions((s) => s.sessions);
  const projects = useProjects((s) => s.projects);
  const tabs = useTabs((s) => s.tabs);
  const [recent, setRecent] = useState<Session | null>(null);
  const list = sessions.filter((x) => projectOf(x, projects)?.path === project.path).slice(0, SHOWN);
  if (!list.length) return null;

  const open = async (x: Session) => {
    if ((await openSession(x)) === "recent") setRecent(x);
  };

  return (
    <div className="pr-1.5 pb-2 pl-[58px]">
      <ul aria-label={t("session.list")} className="grid grid-cols-[minmax(0,1fr)] gap-px">
        {list.map((x) => {
          const inTab = tabs.some((tab) => tab.sid === x.id);
          const name = sessionName(x);
          return (
            <li key={x.id}>
              <button
                type="button"
                title={inTab ? t("session.goToTab") : t("session.resume")}
                onClick={() => open(x)}
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
      <Dialog open={!!recent} onOpenChange={(o) => !o && setRecent(null)}>
        <DialogContent showCloseButton={false} className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("session.recentTitle")}</DialogTitle>
            <DialogDescription>{t("session.recentBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRecent(null)}>
              {t("session.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (recent) openSession(recent, true);
                setRecent(null);
              }}
            >
              {t("session.openAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
