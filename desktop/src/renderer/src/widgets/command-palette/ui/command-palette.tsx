// 명령 팔레트 (⌘P): 명령 · 프로젝트 · 탭 · 지난 세션, 두 글자부터는 지난 7일 기록(질문 · 명령 · 파일)도 찾는다
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { MenuAction, TabKind } from "@ipc/contract";
import { useTranslation } from "react-i18next";

import { projectName, useProjects } from "@/entities/project/model/store";
import { projectOf, type Session, sessionKind, sessionName, useSessions } from "@/entities/session/model/store";
import { tabLabel } from "@/entities/tab/model/label";
import { useTabs } from "@/entities/tab/model/store";
import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { activateTab, focusActive, selectProject } from "@/features/manage-tabs/model/actions";
import { openSession } from "@/features/manage-tabs/model/sessions";
import { epeira } from "@/shared/api/epeira";
import { closeDialogs, useDialogs } from "@/shared/lib/dialogs";
import { shortPath } from "@/shared/lib/path";
import { useTheme } from "@/shared/lib/theme";
import { ago } from "@/shared/lib/time";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";

interface Found {
  id: string;
  parent?: string | null;
  agent: string;
  cwd?: string;
  label?: string;
  text: string;
  ts: number;
}

const COMMANDS = [
  ["newShell", "new-shell", "⌘T"],
  ["newClaude", "new-claude", "⇧⌘C"],
  ["newCodex", "new-codex", "⇧⌘X"],
  ["split", "split", "⌘D"],
  ["splitRows", "split-rows", "⇧⌘D"],
  ["unsplit", "unsplit", "⌥⌘W"],
  ["find", "find", "⌘F"],
  ["toggleSide", "toggle-side", "⌘B"],
  ["toggleOrbit", "toggle-orbit", "⌘J"],
  ["addProject", "add-project", "⌘O"],
  ["settings", "settings", "⌘,"],
  ["shortcuts", "shortcuts", "⌘/"],
] as const satisfies readonly (readonly [string, MenuAction, string])[];
const THEMES = [
  ["dark", "dark"],
  ["light", "light"],
  ["system", "system"],
] as const;

/** 앞에서부터 그대로 찾는다 (이름 · 경로 · 묶음 이름) */
const filter = (_value: string, search: string, keywords?: string[]) =>
  (keywords ?? []).join(" ").toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0;

function Item({
  value,
  keywords,
  icon,
  label,
  sub,
  hint,
  onSelect,
  forceMount,
}: {
  value: string;
  keywords: string[];
  icon?: TabKind | null;
  label: string;
  sub?: string;
  hint?: string;
  onSelect: () => void;
  forceMount?: boolean;
}) {
  return (
    <CommandItem
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      forceMount={forceMount}
      className="min-h-[38px] gap-2.5 px-2.5"
    >
      {icon ? <KindIcon kind={icon} /> : <KindIcon kind="shell" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate font-medium text-foreground">{label}</b>
        {sub && <small className="truncate text-faint-foreground text-xs">{sub}</small>}
      </span>
      {hint && <kbd>{hint}</kbd>}
    </CommandItem>
  );
}

export function CommandPalette({ onAction }: { onAction: (action: MenuAction) => void }) {
  const { t } = useTranslation();
  const open = useDialogs((s) => s.palette);
  const projects = useProjects((s) => s.projects);
  const tabs = useTabs((s) => s.tabs);
  const sessions = useSessions((s) => s.sessions);
  const names = useSessions((s) => s.names);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);

  const input = useRef<HTMLInputElement>(null);
  // 열 때마다 입력칸으로. 닫히는 중에 다시 열면 창이 새로 만들어지지 않아 저절로 옮겨 가지 않는다
  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
    else setQuery("");
  }, [open]);

  // 지난 7일 기록 찾기 (두 글자부터, 입력이 멈추면)
  useEffect(() => {
    setFound([]);
    const q = query.trim();
    if (q.length < 2) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const r = (await epeira.get(`/api/search?q=${encodeURIComponent(q)}`)) as { results?: Found[] } | null;
      if (!stale && Array.isArray(r?.results)) setFound(r.results.slice(0, 15));
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  /** 고르면 팔레트를 닫고 실행 (닫힌 뒤 지금 탭으로 입력 위치가 돌아간다) */
  const run = (fn: () => unknown) => () => {
    closeDialogs();
    fn();
  };
  const group = (key: "commands" | "projects" | "tabs" | "sessions" | "history", children: ReactNode) => (
    // 기록은 수집기가 이미 찾은 것 → 거르지 않는다
    <CommandGroup heading={t(`palette.groups.${key}`)} forceMount={key === "history" || undefined}>
      {children}
    </CommandGroup>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialogs()}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActive();
        }}
        className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[620px]"
      >
        <DialogTitle className="sr-only">{t("palette.label")}</DialogTitle>
        <DialogDescription className="sr-only">{t("palette.placeholder")}</DialogDescription>
        <Command filter={filter} className="bg-card">
          <CommandInput
            ref={input}
            value={query}
            onValueChange={setQuery}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.label")}
            className="h-12 text-lg"
          />
          <CommandList className="max-h-[52vh] p-1.5">
            <CommandEmpty>{t("palette.empty")}</CommandEmpty>
            {group(
              "commands",
              <>
                {COMMANDS.map(([key, action, hint]) => (
                  <Item
                    key={key}
                    value={`cmd:${key}`}
                    keywords={[t(`palette.cmd.${key}`), t("palette.groups.commands")]}
                    label={t(`palette.cmd.${key}`)}
                    hint={hint}
                    onSelect={run(() => onAction(action))}
                  />
                ))}
                {THEMES.map(([key, choice]) => (
                  <Item
                    key={key}
                    value={`theme:${key}`}
                    keywords={[t(`palette.cmd.${key}`), t("palette.groups.commands")]}
                    label={t(`palette.cmd.${key}`)}
                    onSelect={run(() => useTheme.getState().setChoice(choice))}
                  />
                ))}
              </>,
            )}
            {group(
              "projects",
              projects
                .filter((p) => p.exists)
                .map((p) => (
                  <Item
                    key={p.path}
                    value={`project:${p.path}`}
                    keywords={[p.name, p.path, t("palette.groups.projects")]}
                    label={p.name}
                    sub={shortPath(p.path)}
                    onSelect={run(() => selectProject(p.path))}
                  />
                )),
            )}
            {group(
              "tabs",
              tabs.map((tab) => {
                const label = tabLabel(tab, tabs, names);
                return (
                  <Item
                    key={tab.id}
                    value={`tab:${tab.id}`}
                    keywords={[label, projectName(tab.dir), t("palette.groups.tabs")]}
                    icon={tab.kind}
                    label={label}
                    sub={projectName(tab.dir)}
                    onSelect={run(() => activateTab(tab.id))}
                  />
                );
              }),
            )}
            {group(
              "sessions",
              sessions.slice(0, 40).map((x) => {
                const label = sessionName(x, names);
                const sub = `${projectOf(x, projects)?.name ?? x.label ?? ""} · ${ago(x.last)}`;
                return (
                  <Item
                    key={x.id}
                    value={`session:${x.id}`}
                    keywords={[label, sub, t("palette.groups.sessions")]}
                    icon={sessionKind(x)}
                    label={label}
                    sub={sub}
                    onSelect={run(() => openSession(x))}
                  />
                );
              }),
            )}
            {found.length > 0 &&
              group(
                "history",
                found.map((e, i) => {
                  // 서브에이전트의 기록이면 부모 세션으로 연다
                  const root: Session = (e.parent && sessions.find((x) => x.id === e.parent)) || {
                    id: e.parent || e.id,
                    agent: e.agent,
                    cwd: e.cwd,
                    label: e.label,
                    last: e.ts,
                  };
                  return (
                    <Item
                      // biome-ignore lint/suspicious/noArrayIndexKey: 같은 세션의 기록이 여럿일 수 있다
                      key={`${e.id}-${i}`}
                      value={`found:${i}`}
                      keywords={[]}
                      forceMount
                      icon={sessionKind(root)}
                      label={e.text}
                      sub={`${sessionName(root, names)} · ${ago(e.ts)}`}
                      onSelect={run(() => openSession({ ...root, cwd: root.cwd || e.cwd, last: e.ts }))}
                    />
                  );
                }),
              )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
