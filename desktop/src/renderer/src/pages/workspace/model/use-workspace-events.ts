// 메인 창이 듣는 신호: 메뉴 · 단축키(메인 프로세스가 동작 이름만 보낸다) · ⌘1–9 · 터미널 우클릭 메뉴 · 셸이 끝남
import { useEffect } from "react";

import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { getTerminal, initTerminals } from "@/entities/terminal/model/registry";
import { useFind } from "@/features/find-in-terminal/model/store";
import { activateNth, closeTab, cycleTab, openTab } from "@/features/manage-tabs/model/actions";
import { epeira } from "@/shared/api/epeira";

import { useLayout } from "./layout";

export const useWorkspaceEvents = () => {
  const { t } = useTranslation();

  useEffect(() => {
    initTerminals();
    useProjects.getState().load();
  }, []);

  useEffect(
    () =>
      epeira.onMenu((action) => {
        const layout = useLayout.getState();
        const run: Partial<Record<typeof action, () => unknown>> = {
          "add-project": () => useProjects.getState().add(),
          "new-shell": () => openTab("shell"),
          "new-claude": () => openTab("claude"),
          "new-codex": () => openTab("codex"),
          "close-tab": () => closeTab(),
          "next-tab": () => cycleTab(1),
          "prev-tab": () => cycleTab(-1),
          find: () => useFind.getState().show(),
          "toggle-side": layout.toggleSide,
          "toggle-orbit": layout.toggleOrbit,
        };
        run[action]?.();
      }),
    [],
  );

  // ⌘1–9: 지금 프로젝트의 탭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && activateNth(Number(e.key))) {
        e.preventDefault();
      }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  // 터미널 우클릭 메뉴의 동작 (복사는 메뉴가 바로 처리)
  useEffect(
    () =>
      epeira.onTermAction((action, text) => {
        const id = useTabs.getState().active;
        const h = id ? getTerminal(id) : undefined;
        if (!h) return;
        if (action === "find") return useFind.getState().show();
        if (action === "paste" && text)
          h.term.paste(text); // 붙여넣기 모드를 지켜 여러 줄도 한 번에
        else if (action === "selectAll") h.term.selectAll();
        else if (action === "clear") h.term.clear();
        h.term.focus();
      }),
    [],
  );

  // 셸이 끝나면 탭을 흐리게 하고 안내
  useEffect(
    () =>
      epeira.onExit((id) => {
        useTabs.getState().patch(id, { exited: true, busy: false, waiting: false });
        getTerminal(id)?.term.write(`\r\n\x1b[90m${t("tab.exited")}\x1b[0m\r\n`);
      }),
    [t],
  );
};
