// 가운데 터미널 자리: 나눈 화면이면 칸 트리, 아니면(또는 한 칸 크게 보기) 지금 탭 하나. 지금 프로젝트에 탭이 없으면 시작 화면
import { Trans, useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { projectTabs, useTabs } from "@/entities/tab/model/store";
import { FindBar } from "@/features/find-in-terminal/ui/find-bar";
import { openTab } from "@/features/manage-tabs/model/actions";
import { Button } from "@/shared/ui/button";
import { OrbitMark } from "@/shared/ui/icons/orbit-mark";

import { Pane } from "./pane";
import { PaneTree } from "./pane-tree";

function Welcome() {
  const { t } = useTranslation();
  const project = useProjects((s) => s.projects.find((p) => p.path === s.current));
  const add = useProjects((s) => s.add);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_60%_45%_at_50%_40%,var(--glow)_0%,var(--background)_70%)] p-6 text-center">
      <OrbitMark className="size-16 text-primary" />
      <h1 className="font-bold text-3xl">{t("welcome.title")}</h1>
      <p className="max-w-[460px] text-muted-foreground">{t("welcome.body")}</p>
      <div className="my-1.5 flex flex-wrap justify-center gap-2">
        {project ? (
          <>
            <Button onClick={() => openTab("claude")}>{t("welcome.newClaude", { name: project.name })}</Button>
            <Button variant="secondary" onClick={() => openTab("codex")}>
              {t("welcome.newCodex")}
            </Button>
            <Button variant="secondary" onClick={() => openTab("shell")}>
              {t("welcome.newShell")}
            </Button>
          </>
        ) : (
          <Button onClick={() => add()}>{t("welcome.openFolder")}</Button>
        )}
      </div>
      <p className="text-faint-foreground text-sm">
        <Trans i18nKey="welcome.keys" components={{ kbd: <kbd /> }} />
      </p>
    </div>
  );
}

export function PaneLayout() {
  const current = useProjects((s) => s.current);
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const root = useTabs((s) => (current ? s.layout[current] : null));
  const zoomed = useTabs((s) => !!current && !!s.zoom[current]);
  const single = tabs.some((t) => t.id === active && t.dir === current) ? active : null;
  return (
    <div data-pane-area className="relative min-h-0 flex-1">
      <div className="absolute inset-0">
        {root && current && !zoomed ? (
          <PaneTree node={root} path="" dir={current} />
        ) : (
          single && <Pane id={single} paned={false} />
        )}
      </div>
      {!projectTabs(tabs, current).length && <Welcome />}
      <FindBar />
    </div>
  );
}
