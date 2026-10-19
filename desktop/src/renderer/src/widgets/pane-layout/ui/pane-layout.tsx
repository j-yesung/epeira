// 가운데 터미널 자리: 나눈 화면이면 칸 트리, 아니면(또는 한 칸 크게 보기) 지금 탭 하나. 지금 프로젝트에 탭이 없으면 시작 화면
import { Trans, useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { projectTabs, useTabs } from "@/entities/tab/model/store";
import { FindBar } from "@/features/find-in-terminal/ui/find-bar";
import { OrbitMark } from "@/shared/ui/icons/orbit-mark";

import { Pane } from "./pane";
import { PaneTree } from "./pane-tree";

/** 지금 프로젝트에 탭이 없을 때. 새 세션 · 터미널은 위 탭 줄의 버튼과 단축키로 연다 */
function Welcome() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_60%_45%_at_50%_40%,var(--glow)_0%,var(--background)_70%)] p-6 text-center">
      <OrbitMark className="size-16 text-primary" />
      <h1 className="font-bold text-3xl">{t("welcome.title")}</h1>
      <p className="mb-1.5 whitespace-pre-line text-muted-foreground">{t("welcome.body")}</p>
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
