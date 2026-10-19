// 잠깐 떴다 사라지는 알림 (sonner). 색은 디자인 토큰을 따른다
import type { CSSProperties } from "react";

import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      offset={40}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--input)",
        } as CSSProperties
      }
      {...props}
    />
  );
}
