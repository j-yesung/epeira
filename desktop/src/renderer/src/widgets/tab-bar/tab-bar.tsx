// 가운데 위 탭 줄: 탭들 · 새 터미널 · Claude · Codex 새 세션 · 궤도 패널 열고 닫기 (탭은 3단계에서)
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { IconTile } from "@/shared/ui/icon-tile";
import { ClaudeLogo, OpenAILogo } from "@/shared/ui/icons/agent-logos";
import { OrbitMark } from "@/shared/ui/icons/orbit-mark";

interface TabBarProps {
  /** 사이드바를 닫으면 신호등 버튼 자리를 비운다 */
  sideOpen: boolean;
  orbitOpen: boolean;
  onToggleOrbit: () => void;
}

export function TabBar({ sideOpen, orbitOpen, onToggleOrbit }: TabBarProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex h-(--bar-height) shrink-0 items-center gap-1.5 border-b bg-chrome px-2.5 [-webkit-app-region:drag]",
        !sideOpen && "pl-(--traffic-lights)",
      )}
    >
      <div
        role="tablist"
        aria-label={t("tabBar.label")}
        className="flex min-w-0 shrink items-center gap-1 overflow-x-auto"
      />
      <Button
        variant="ghost"
        size="icon"
        disabled
        title={t("tabBar.newShell")}
        aria-label={t("tabBar.newShell")}
        className="[-webkit-app-region:no-drag]"
      >
        <Plus />
      </Button>
      <div className="ml-auto flex shrink-0 gap-1.5 [-webkit-app-region:no-drag]">
        <Button variant="secondary" disabled title={t("tabBar.newClaude")}>
          <IconTile>
            <ClaudeLogo className="text-agent-claude" />
          </IconTile>
          Claude
        </Button>
        <Button variant="secondary" disabled title={t("tabBar.newCodex")}>
          <IconTile>
            <OpenAILogo className="text-foreground" />
          </IconTile>
          Codex
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title={t("tabBar.toggleOrbit")}
          aria-label={t("tabBar.toggleOrbit")}
          aria-pressed={orbitOpen}
          onClick={onToggleOrbit}
          className={cn(orbitOpen && "text-primary hover:text-primary")}
        >
          <OrbitMark className="size-4" />
        </Button>
      </div>
    </div>
  );
}
