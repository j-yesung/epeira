// 디자인 시스템 모아 보기: 토큰 · 글자 · 둥글기 · 그림자 · 부품을 다크 · 라이트로 나란히 (개발용이라 문구를 번역 파일에 두지 않음)
import { Button } from "@/shared/ui/button";

// Tailwind 는 코드에 그대로 적힌 클래스만 만든다 → 토큰마다 클래스를 적어 둔다
const COLORS = [
  ["background", "bg-background"],
  ["foreground", "bg-foreground"],
  ["card", "bg-card"],
  ["popover", "bg-popover"],
  ["secondary · muted · accent", "bg-secondary"],
  ["chrome", "bg-chrome"],
  ["tile", "bg-tile"],
  ["code", "bg-code"],
  ["glow", "bg-glow"],
  ["primary", "bg-primary"],
  ["primary-strong", "bg-primary-strong"],
  ["muted-foreground", "bg-muted-foreground"],
  ["faint-foreground", "bg-faint-foreground"],
  ["destructive", "bg-destructive"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["border", "bg-border"],
  ["input", "bg-input"],
  ["ring", "bg-ring"],
  ["agent-claude", "bg-agent-claude"],
  ["agent-codex", "bg-agent-codex"],
] as const;

const TEXT = [
  ["3xl · 22", "text-3xl"],
  ["2xl · 18", "text-2xl"],
  ["xl · 16", "text-xl"],
  ["lg · 15", "text-lg"],
  ["md · 14", "text-md"],
  ["base · 13 (기본)", "text-base"],
  ["sm · 12", "text-sm"],
  ["xs · 11", "text-xs"],
  ["2xs · 10", "text-2xs"],
] as const;

const RADIUS = [
  ["xs · 3", "rounded-xs"],
  ["sm · 5", "rounded-sm"],
  ["md · 7", "rounded-md"],
  ["lg · 8", "rounded-lg"],
  ["xl · 10", "rounded-xl"],
  ["2xl · 12", "rounded-2xl"],
  ["full", "rounded-full"],
] as const;

const SHADOWS = [
  ["sm", "shadow-sm"],
  ["md (메뉴)", "shadow-md"],
  ["lg (창)", "shadow-lg"],
] as const;

const BUTTON_VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-faint-foreground text-xs uppercase tracking-wider">{title}</h2>
      {children}
    </section>
  );
}

function ThemeColumn({ theme }: { theme: "dark" | "light" }) {
  return (
    <div
      data-theme={theme}
      className="flex min-w-0 flex-1 flex-col gap-8 overflow-y-auto bg-background p-6 text-foreground"
    >
      <h1 className="font-bold text-2xl">{theme === "dark" ? "다크" : "라이트"}</h1>

      <Section title="색 (의미 토큰)">
        <div className="grid grid-cols-3 gap-2">
          {COLORS.map(([name, cls]) => (
            <div key={name} className="flex items-center gap-2 rounded-lg border bg-card p-2">
              <span className={`size-7 shrink-0 rounded-md border ${cls}`} />
              <span className="truncate font-mono text-xs">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="글자 크기">
        <div className="flex flex-col gap-1">
          {TEXT.map(([name, cls]) => (
            <div key={name} className="flex items-baseline gap-4">
              <span className="w-28 shrink-0 font-mono text-faint-foreground text-xs">{name}</span>
              <span className={cls}>프로젝트 터미널 Epeira 123</span>
            </div>
          ))}
          <p className="text-muted-foreground">흐린 글자 (muted-foreground)</p>
          <p className="text-faint-foreground">더 흐린 글자 (faint-foreground)</p>
          <p className="font-mono">고정폭 글자 ~/epeira · 31.0k tok</p>
        </div>
      </Section>

      <Section title="둥글기">
        <div className="flex flex-wrap gap-3">
          {RADIUS.map(([name, cls]) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <span className={`size-12 border bg-secondary ${cls}`} />
              <span className="font-mono text-2xs text-faint-foreground">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="그림자">
        <div className="flex flex-wrap gap-6 p-2">
          {SHADOWS.map(([name, cls]) => (
            <div
              key={name}
              className={`flex h-16 w-28 items-center justify-center rounded-xl border bg-popover ${cls}`}
            >
              <span className="font-mono text-xs">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="버튼">
        <div className="flex flex-wrap items-center gap-2">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">작게</Button>
          <Button>보통</Button>
          <Button size="lg">크게</Button>
          <Button disabled>못 누름</Button>
        </div>
      </Section>
    </div>
  );
}

export function DesignSystemPage() {
  return (
    <main className="flex h-full">
      <ThemeColumn theme="dark" />
      <ThemeColumn theme="light" />
    </main>
  );
}
