// 칸 하나: 탭의 터미널 + (나눈 화면이면) 위에 이름표. 누르면 그 탭이 지금 탭
// 탭을 끌어 놓으면 이 칸에 보여 주고(TabDnd), 파일을 놓으면 그 경로를 터미널에 넣는다
import type { DragEvent } from "react";

import { useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSessions } from "@/entities/session/model/store";
import { tabLabel } from "@/entities/tab/model/label";
import { useTabs } from "@/entities/tab/model/store";
import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { getTerminal } from "@/entities/terminal/model/registry";
import { TerminalView } from "@/entities/terminal/ui/terminal-view";
import { activateTab, closeTab } from "@/features/manage-tabs/model/actions";
import { epeira } from "@/shared/api/epeira";
import { cn } from "@/shared/lib/utils";

/** 셸에 그대로 넣어도 안전하게 */
const shq = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

export function Pane({ id, paned }: { id: string; paned: boolean }) {
  const { t } = useTranslation();
  const tabs = useTabs((s) => s.tabs);
  const names = useSessions((s) => s.names);
  const focused = useTabs((s) => s.active === id);
  const { setNodeRef, isOver } = useDroppable({ id: `pane:${id}`, data: { pane: id } });
  const tab = tabs.find((x) => x.id === id);
  if (!tab) return null;
  const label = tabLabel(tab, tabs, names);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map((f) => epeira.pathForFile(f)).filter(Boolean);
    const term = getTerminal(id)?.term;
    if (!term || !paths.length) return;
    activateTab(id);
    term.paste(`${paths.map(shq).join(" ")} `);
    term.focus();
  };

  return (
    <div
      ref={setNodeRef}
      data-pane={id}
      onMouseDown={() => !focused && activateTab(id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="relative flex h-full flex-col"
    >
      {paned && (
        <div
          className={cn(
            "flex h-[26px] shrink-0 items-center gap-[7px] border-b bg-chrome pr-1 pl-2.5 text-faint-foreground text-sm",
            focused && "text-foreground shadow-[inset_0_2px_0_var(--primary)]",
          )}
        >
          <KindIcon kind={tab.kind} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <button
            type="button"
            title={t("pane.close")}
            aria-label={t("pane.closeNamed", { label })}
            onClick={() => closeTab(id)}
            className="grid size-5 cursor-pointer place-items-center rounded-sm hover:bg-secondary hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <TerminalView id={id} focused={focused} className={paned ? "pt-1.5" : undefined} />
      </div>
      {isOver && <div className="pointer-events-none absolute inset-0 ring-2 ring-primary ring-inset" />}
    </div>
  );
}
