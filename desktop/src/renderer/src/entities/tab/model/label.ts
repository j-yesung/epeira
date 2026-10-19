// 탭 이름: 세션 이름(궤도 HUB 와 같음) > 직접 붙인 이름 > 종류 이름 (같은 프로젝트에 같은 종류가 여럿이면 2, 3 …)
import { i18n } from "@/shared/i18n";

import type { Tab } from "./store";

export const tabLabel = (tab: Tab, tabs: Tab[], names: Record<string, string> = {}) => {
  if (tab.sid && names[tab.sid]) return names[tab.sid];
  if (tab.title) return tab.title;
  const kind = i18n.t(`tab.kind.${tab.kind}`);
  const i = tabs.filter((x) => x.dir === tab.dir && x.kind === tab.kind).indexOf(tab);
  return i > 0 ? `${kind} ${i + 1}` : kind;
};
