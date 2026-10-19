// 가운데 터미널 칸: 지금 탭의 터미널 (칸 나누기는 3b 에서). 지금 프로젝트에 탭이 없으면 시작 화면
import { Trans, useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { projectTabs, useTabs } from "@/entities/tab/model/store";
import { TerminalView } from "@/entities/terminal/ui/terminal-view";
import { FindBar } from "@/features/find-in-terminal/ui/find-bar";
import { openTab } from "@/features/manage-tabs/model/actions";
import { Button } from "@/shared/ui/button";
import { OrbitMark } from "@/shared/ui/icons/orbit-mark";

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
  const hasTabs = projectTabs(tabs, current).length > 0;
  return (
    <div data-pane-area className="relative min-h-0 flex-1">
      {tabs.map((tab) => {
        const shown = tab.id === active && tab.dir === current;
        return <TerminalView key={tab.id} id={tab.id} visible={shown} focused={shown} />;
      })}
      {!hasTabs && <Welcome />}
      <FindBar />
    </div>
  );
}
