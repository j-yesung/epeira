// 수집기 이벤트 → 탭 상태(일하는 중 · 입력 · 승인 대기 · 안 본 응답) · 놓친 알림 · macOS 알림 · Dock 배지

import { useInbox } from "@/entities/notification/model/inbox";
import { projectName } from "@/entities/project/model/store";
import { useSessions } from "@/entities/session/model/store";
import { tabLabel } from "@/entities/tab/model/label";
import { type Tab, useTabs } from "@/entities/tab/model/store";
import { epeira } from "@/shared/api/epeira";
import { i18n } from "@/shared/i18n";
import { usePrefs } from "@/shared/lib/prefs";

import { linkTab } from "./usage";

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** 지금 보고 있는 탭 (앱이 앞에 있고 그 탭이 지금 탭) */
const seen = (id: string) => document.hasFocus() && useTabs.getState().active === id;

/** 보고 있지 않으면 놓친 알림에 남기고, 설정에서 켠 경우 macOS 알림. type: done(응답 끝) · wait(승인 · 입력 대기) */
const alertTab = (tab: Tab, msg: string, detail: string | null, type: "done" | "wait") => {
  if (seen(tab.id)) return;
  const title = `${projectName(tab.dir)} · ${tabLabel(tab, useTabs.getState().tabs, useSessions.getState().names)}`;
  const body = detail ? `${msg} → ${detail}` : msg;
  useInbox.getState().push({ at: Date.now(), tab: tab.id, title, body });
  const prefs = usePrefs.getState();
  if (!prefs.notify || !prefs[type === "wait" ? "notifyWait" : "notifyDone"]) return;
  epeira.notify({ title, body, tab: tab.id, silent: !prefs.sound });
};

export const handleAgentEvent = (e: Record<string, unknown>) => {
  const kind = str(e.kind);
  const id = str(e.id);
  if (kind === "tab") {
    const tab = str(e.tab);
    if (tab && id) linkTab(tab, id);
    return;
  }
  if (kind === "name" && id) {
    // 궤도 HUB 에서 이름을 바꾸면 탭 이름도 (직접 붙인 탭 이름보다 앞선다)
    const name = str(e.name);
    useSessions.setState((s) => {
      const names = { ...s.names };
      if (name) names[id] = name;
      else delete names[id];
      return { names };
    });
    for (const t of useTabs.getState().tabs)
      if (t.sid === id && t.title) useTabs.getState().patch(t.id, { title: null });
    return;
  }
  const sid = str(e.parent) || id;
  const tab = sid ? useTabs.getState().tabs.find((t) => t.sid === sid) : undefined;
  if (!tab || kind === "stat" || kind === "hello") return;
  const patch = (p: Partial<Tab>) => useTabs.getState().patch(tab.id, p);
  if (e.replay) {
    if (kind === "start") patch({ busy: true }); // 앱을 켜기 전부터 돌던 도구
    return;
  }
  if (kind === "notify") {
    if (!tab.busy) return; // 응답을 마친 뒤의 "입력 기다림" 알림은 이미 알렸다
    patch({ waiting: true });
    alertTab(tab, i18n.t("tab.state.wait"), str(e.text), "wait");
  } else if (kind === "done") {
    if (e.parent) return; // 서브에이전트가 끝난 건 대화가 끝난 게 아니다
    const unread = !seen(tab.id);
    patch({ busy: false, waiting: false, unread: unread || tab.unread });
    if (unread) alertTab(tab, i18n.t("tab.doneAlert"), null, "done");
  } else if (kind === "error" && e.text === "interrupted") {
    patch({ busy: false, waiting: false });
  } else {
    patch({ busy: true, waiting: false });
  }
};

/** Dock 배지: 기다리거나 안 본 응답이 있는 탭 수 (바뀔 때만 알린다) */
export const watchBadge = () => {
  let last = -1;
  const update = () => {
    const n = useTabs.getState().tabs.filter((t) => t.waiting || t.unread).length;
    if (n !== last) epeira.badge((last = n));
  };
  update();
  return useTabs.subscribe(update);
};

/** 앱으로 돌아오면 지금 탭의 새 응답은 본 것으로 */
export const markActiveSeen = () => {
  const { active, tabs, patch } = useTabs.getState();
  if (active && tabs.find((t) => t.id === active)?.unread) patch(active, { unread: false });
};
