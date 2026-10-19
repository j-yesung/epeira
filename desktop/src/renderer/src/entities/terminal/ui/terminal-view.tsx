// 탭의 터미널을 이 자리에 붙인다 (터미널 자체는 registry 가 들고 있다). 보일 때만 칸 크기에 맞춘다
import { useEffect, useLayoutEffect, useRef } from "react";

import { cn } from "@/shared/lib/utils";

import { fitTerminal, getTerminal } from "../model/registry";

interface TerminalViewProps {
  id: string;
  visible: boolean;
  /** 지금 탭이면 보이는 순간 입력 위치를 이 터미널로 (숨은 터미널에 입력이 가지 않게) */
  focused: boolean;
  className?: string;
}

export function TerminalView({ id, visible, focused, className }: TerminalViewProps) {
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = getTerminal(id)?.host;
    if (host && box.current && host.parentElement !== box.current) box.current.append(host);
  }, [id]);

  useEffect(() => {
    const el = box.current;
    if (!visible || !el) return;
    fitTerminal(id);
    const ro = new ResizeObserver(() => fitTerminal(id));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, visible]);

  // 보이게 된 뒤에 옮긴다. 그 사이 팔레트 · 설정 같은 창이 열렸으면 거기 입력을 빼앗지 않는다
  useEffect(() => {
    if (visible && focused && !document.querySelector('[role="dialog"]')) getTerminal(id)?.term.focus();
  }, [id, visible, focused]);

  return (
    <div
      ref={box}
      className={cn("absolute inset-0 bg-background pt-2.5 pr-1.5 pb-1.5 pl-3.5", !visible && "hidden", className)}
    />
  );
}
