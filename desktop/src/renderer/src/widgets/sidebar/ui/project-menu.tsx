// 프로젝트 메뉴: ⋯ 버튼(DropdownMenu)과 우클릭(ContextMenu)이 같은 항목을 쓴다
import type { ComponentType, ReactNode } from "react";

import type { Project } from "@ipc/contract";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { openTab } from "@/features/manage-tabs/model/actions";
import { removeProject } from "@/features/manage-tabs/model/projects";
import { epeira } from "@/shared/api/epeira";

interface MenuParts {
  Item: ComponentType<{ onSelect?: () => void; disabled?: boolean; children?: ReactNode }>;
  Separator: ComponentType;
}

export function ProjectMenuItems({ project: p, Item, Separator }: { project: Project } & MenuParts) {
  const { t } = useTranslation();
  const copy = () =>
    navigator.clipboard.writeText(p.path).then(
      () => toast(t("projectMenu.copied")),
      () => {},
    );
  return (
    <>
      <Item disabled={!p.exists} onSelect={() => openTab("shell", p.path)}>
        <KindIcon kind="shell" />
        {t("projectMenu.newShell")}
      </Item>
      <Item disabled={!p.exists} onSelect={() => openTab("claude", p.path)}>
        <KindIcon kind="claude" />
        {t("projectMenu.newClaude")}
      </Item>
      <Item disabled={!p.exists} onSelect={() => openTab("codex", p.path)}>
        <KindIcon kind="codex" />
        {t("projectMenu.newCodex")}
      </Item>
      <Separator />
      <Item disabled={!p.exists} onSelect={() => epeira.revealProject(p.path)}>
        {t("projectMenu.reveal")}
      </Item>
      <Item onSelect={copy}>{t("projectMenu.copyPath")}</Item>
      <Separator />
      <Item onSelect={() => removeProject(p.path)}>
        <span className="flex min-w-0 flex-1 flex-col">
          {t("projectMenu.remove")}
          <small className="truncate text-faint-foreground text-xs">{t("projectMenu.removeSub")}</small>
        </span>
      </Item>
    </>
  );
}
