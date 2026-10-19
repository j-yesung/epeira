// 메인 창이 듣는 신호: 메뉴 · 단축키(메인 프로세스가 동작 이름만 보낸다) · ⌘1–9 · 터미널 우클릭 메뉴 · 셸이 끝남 · 수집기 이벤트
import { useEffect } from "react";

import type { MenuAction } from "@ipc/contract";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useProjects } from "@/entities/project/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { getTerminal, initTerminals } from "@/entities/terminal/model/registry";
import { connectCollector } from "@/features/collector/model/connect";
import { handleAgentEvent, markActiveSeen, watchBadge } from "@/features/collector/model/events";
import { loadUsage } from "@/features/collector/model/usage";
import { useFind } from "@/features/find-in-terminal/model/store";
import {
  activateNth,
  activateTab,
  closeTab,
  cycleTab,
  focusActive,
  openTab,
} from "@/features/manage-tabs/model/actions";
import { moveFocus, splitPane, toggleZoom, unsplit } from "@/features/manage-tabs/model/panes";
import { restoreTabs } from "@/features/manage-tabs/model/persist";
import { useRenaming } from "@/features/manage-tabs/model/rename";
import { initUpdates } from "@/features/update/model/update";
import { epeira } from "@/shared/api/epeira";
import { i18n } from "@/shared/i18n";
import { openSettings, useDialogs } from "@/shared/lib/dialogs";

import { useLayout } from "./layout";

/** ⌘G · ⇧⌘G: 찾기가 열려 있으면 다음 · 이전, 아니면 찾기를 연다 (열면 첫 결과로 간다) */
const findAgain = (dir: 1 | -1) => {
  const find = useFind.getState();
  if (find.open) find.find(dir);
  else find.show();
};

/** ⌘K: 지금 터미널 화면 지우기 (Terminal · iTerm 처럼, 셸에는 보내지 않는다). 찾던 글이 사라지므로 찾기도 닫는다 */
const clearTerminal = () => {
  if (useFind.getState().open) useFind.getState().hide();
  const id = useTabs.getState().active;
  const h = id ? getTerminal(id) : undefined;
  h?.term.clear();
  h?.term.focus();
};

/** 메뉴 · 단축키 · 명령 팔레트의 동작 */
export const runMenuAction = (action: MenuAction) => {
  const layout = useLayout.getState();
  const run: Partial<Record<MenuAction, () => unknown>> = {
    "add-project": () => useProjects.getState().add(),
    "new-shell": () => openTab("shell"),
    "new-claude": () => openTab("claude"),
    "new-codex": () => openTab("codex"),
    "close-tab": () => closeTab(),
    "rename-tab": () => useRenaming.setState({ id: useTabs.getState().active }),
    "next-tab": () => cycleTab(1),
    "prev-tab": () => cycleTab(-1),
    split: () => splitPane("cols"),
    "split-rows": () => splitPane("rows"),
    "pane-left": () => moveFocus("left"),
    "pane-right": () => moveFocus("right"),
    "pane-up": () => moveFocus("up"),
    "pane-down": () => moveFocus("down"),
    "pane-zoom": toggleZoom,
    unsplit,
    find: () => useFind.getState().show(),
    "find-next": () => findAgain(1),
    "find-prev": () => findAgain(-1),
    "clear-terminal": clearTerminal,
    "toggle-side": layout.toggleSide,
    "toggle-orbit": layout.toggleOrbit,
    settings: () => openSettings(),
    "quit-blocked": () => toast(i18n.t("tab.quitBlocked")),
    palette: () => useDialogs.setState({ palette: true, shortcuts: false, settings: null }),
    shortcuts: () => useDialogs.setState({ shortcuts: true, palette: false, settings: null }),
  };
  run[action]?.();
};

export const useWorkspaceEvents = () => {
  const { t } = useTranslation();

  // 켤 때 한 번: 프로젝트 목록을 읽고 지난번 탭 · 칸 배치를 되살린다
  useEffect(() => {
    initTerminals();
    useProjects.getState().load().then(restoreTabs);
  }, []);

  useEffect(initUpdates, []);

  // 수집기: 준비(설치 · 업데이트 · 실행) → 이벤트로 탭 상태 · 알림, 15초마다 사용량 · 탭 ↔ 세션 짝
  useEffect(() => {
    connectCollector();
    const timer = setInterval(loadUsage, 15_000);
    const offEvent = epeira.onEvent(handleAgentEvent);
    const offBadge = watchBadge();
    const offActivate = epeira.onActivateTab(activateTab); // macOS 알림을 누르면 그 탭으로
    addEventListener("focus", markActiveSeen);
    return () => {
      clearInterval(timer);
      offEvent();
      offBadge();
      offActivate();
      removeEventListener("focus", markActiveSeen);
    };
  }, []);

  useEffect(() => epeira.onMenu(runMenuAction), []);

  // ⌘1–9: 지금 프로젝트의 탭, ⇧⌘[ · ⇧⌘]: 이전 · 다음 탭 (macOS 앱들과 같게)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && activateNth(Number(e.key))) {
        e.preventDefault();
      } else if (e.metaKey && e.shiftKey && !e.altKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        e.preventDefault();
        e.stopPropagation(); // 터미널로 가지 않게
        cycleTab(e.code === "BracketLeft" ? -1 : 1);
      }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  // 구분선을 마우스로 누르면 라이브러리가 구분선에 포커스를 준다 → 놓으면 입력 위치를 터미널로 (키보드로 조절할 때는 그대로)
  useEffect(() => {
    const onUp = () =>
      requestAnimationFrame(() => {
        if (document.activeElement?.hasAttribute("data-separator")) focusActive();
      });
    addEventListener("pointerup", onUp, true);
    return () => removeEventListener("pointerup", onUp, true);
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
