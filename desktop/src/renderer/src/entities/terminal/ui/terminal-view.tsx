// 탭의 터미널을 이 자리에 붙인다 (터미널 자체는 registry 가 들고 있다). 이 자리가 사라지면 숨김 자리로 돌려놓는다
import { useEffect, useLayoutEffect, useRef } from "react";

import { cn } from "@/shared/lib/utils";

import { fitTerminal, getTerminal, parkTerminal } from "../model/registry";

interface TerminalViewProps {
  id: string;
  /** 지금 탭이면 보이는 순간 입력 위치를 이 터미널로 */
  focused: boolean;
  className?: string;
}

export function TerminalView({ id, focused, className }: TerminalViewProps) {
  const box = useRef<HTMLDivElement>(null);

  // 칸 배치가 바뀌어 이 자리가 새로 생겨도 같은 터미널을 옮겨 붙인다 (다시 만들지 않는다)
  useLayoutEffect(() => {
    const el = box.current;
    const host = getTerminal(id)?.host;
    if (!el || !host) return;
    el.append(host);
    fitTerminal(id);
    const ro = new ResizeObserver(() => fitTerminal(id));
    ro.observe(el);
    return () => {
      ro.disconnect();
      parkTerminal(id);
    };
  }, [id]);

  // 붙인 뒤에 옮긴다. 그 사이 팔레트 · 설정 같은 창이 열렸으면 거기 입력을 빼앗지 않는다
  useEffect(() => {
    if (focused && !document.querySelector('[role="dialog"]')) getTerminal(id)?.term.focus();
  }, [id, focused]);

  return <div ref={box} className={cn("absolute inset-0 bg-background pt-2.5 pr-1.5 pb-1.5 pl-3.5", className)} />;
}
