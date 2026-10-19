// Epeira 표시 (궤도 모양). 색은 currentColor → 쓰는 곳에서 text-primary 등으로
import type { SVGProps } from "react";

export function OrbitMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" {...props}>
      <ellipse cx="16" cy="16" rx="13" ry="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="11" y="11" width="10" height="10" rx="3" fill="currentColor" />
    </svg>
  );
}
