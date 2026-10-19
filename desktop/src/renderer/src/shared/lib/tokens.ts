// JS 에서 디자인 토큰 읽기 (색 값은 tokens.css 한곳에만). xterm 처럼 CSS 를 못 쓰는 곳에서 쓴다
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** 지금 테마의 터미널 색 (xterm 의 theme 모양) */
export const terminalTheme = () => ({
  background: css("background"),
  foreground: css("term-foreground"),
  cursor: css("term-cursor"),
  cursorAccent: css("background"),
  selectionBackground: css("term-selection"),
  ...Object.fromEntries(ANSI.map((name) => [name, css(`term-${kebab(name)}`)])),
});

/** 터미널 찾기(⌘F) 강조 색 */
export const findColors = () => ({
  matchBackground: css("term-find-match"),
  activeMatchBackground: css("term-find-match-active"),
  matchOverviewRuler: css("term-find-match-active"),
  activeMatchColorOverviewRuler: css("term-find-ruler-active"),
});
