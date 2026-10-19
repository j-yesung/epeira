// 터미널 찾기 막대: 칸 오른쪽 위에 뜬다. ↩ 다음 · ⇧↩ 이전 · esc 닫기

import { useEffect, useRef } from "react";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useTabs } from "@/entities/tab/model/store";
import { getTerminal } from "@/entities/terminal/model/registry";
import { Button } from "@/shared/ui/button";

import { useFind } from "../model/store";

export function FindBar() {
  const { t } = useTranslation();
  const { open, query, count, hide, setQuery, find } = useFind();
  const active = useTabs((s) => s.active);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.select();
  }, [open]);

  // 찾은 개수: 지금 탭의 검색 결과를 듣는다
  useEffect(() => {
    if (!open || !active) return;
    const sub = getTerminal(active)?.search.onDidChangeResults((r) =>
      useFind.setState({ count: r.resultCount ? `${r.resultIndex + 1}/${r.resultCount}` : t("find.none") }),
    );
    find(1);
    return () => sub?.dispose();
  }, [open, active, find, t]);

  if (!open) return null;
  return (
    <div
      role="search"
      className="absolute top-2 right-4.5 z-10 flex items-center gap-0.5 rounded-lg border border-input bg-popover py-[3px] pr-[3px] pl-2.5 shadow-sm"
    >
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            find(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") hide();
        }}
        placeholder={t("find.placeholder")}
        aria-label={t("find.placeholder")}
        spellCheck={false}
        className="w-50 bg-transparent text-foreground text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="min-w-10 text-right font-mono text-2xs text-faint-foreground">{count}</span>
      <Button variant="ghost" size="icon" title={t("find.prev")} aria-label={t("find.prev")} onClick={() => find(-1)}>
        <ChevronUp />
      </Button>
      <Button variant="ghost" size="icon" title={t("find.next")} aria-label={t("find.next")} onClick={() => find(1)}>
        <ChevronDown />
      </Button>
      <Button variant="ghost" size="icon" title={t("find.close")} aria-label={t("find.close")} onClick={hide}>
        <X />
      </Button>
    </div>
  );
}
