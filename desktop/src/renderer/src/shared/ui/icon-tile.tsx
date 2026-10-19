// 작은 아이콘 칸 (탭 · 버튼 · 메뉴의 에이전트 로고 자리)
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export function IconTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-[18px] shrink-0 place-items-center rounded-sm border border-input bg-tile text-tile-foreground [&_svg]:size-3",
        className,
      )}
    >
      {children}
    </span>
  );
}
