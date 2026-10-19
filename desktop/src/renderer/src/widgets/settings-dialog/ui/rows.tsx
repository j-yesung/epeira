// 설정 창의 줄 모양: 제목 · 설명 · 오른쪽 조작 (스위치 · 버튼 · 고르기)
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { Switch } from "@/shared/ui/switch";

export function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mt-1.5 font-bold text-faint-foreground text-xs tracking-widest first:mt-0">{children}</h3>;
}

export function Row({
  title,
  desc,
  icon,
  children,
}: {
  title: ReactNode;
  desc?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2.5 rounded-lg border bg-background px-2.5 py-1.5">
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="font-semibold text-foreground">{title}</b>
        {desc && <small className="text-faint-foreground text-sm">{desc}</small>}
      </span>
      {children}
    </div>
  );
}

export function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => unknown;
}) {
  return (
    <Row title={title} desc={desc}>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </Row>
  );
}

/** 몇 개 중 하나 고르기 (테마 · 글자 크기) */
export function Segmented({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <span role="group" aria-label={label} className="inline-flex shrink-0 rounded-lg border border-input p-0.5">
      {children}
    </span>
  );
}

export function SegButton({ pressed, className, ...props }: React.ComponentProps<"button"> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "h-6 cursor-pointer rounded-md px-2.5 text-muted-foreground text-sm disabled:cursor-default aria-pressed:bg-secondary aria-pressed:font-semibold aria-pressed:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Chip({ tone, children }: { tone?: "ok" | "warn"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full border border-input px-[7px] py-px text-faint-foreground text-xs",
        tone === "ok" && "border-success text-success",
        tone === "warn" && "border-warning text-warning",
      )}
    >
      {children}
    </span>
  );
}
