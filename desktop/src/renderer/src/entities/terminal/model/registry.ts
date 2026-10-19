// 터미널(xterm)은 React 상태 밖에 둔다: 화면을 다시 그리거나 칸을 옮겨도 터미널을 새로 만들지 않게
// 탭 id → { 터미널 · 애드온 · 담는 DOM }. TerminalView 가 이 DOM 을 제자리에 붙인다
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal } from "@xterm/xterm";

import { epeira } from "@/shared/api/epeira";
import { i18n } from "@/shared/i18n";
import { usePrefs } from "@/shared/lib/prefs";
import { terminalTheme } from "@/shared/lib/tokens";

export interface TermHandle {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  /** 터미널을 담는 DOM. 탭을 처음 열 때 만들어 두고 화면에서 옮겨 붙인다 */
  host: HTMLDivElement;
  /** 처음 보일 때 입력할 명령 (다시 켠 뒤 지난 대화 이어 열기 → 한꺼번에 여러 대화를 띄우지 않게) */
  pending: string | null;
}

const handles = new Map<string, TermHandle>();
export const getTerminal = (id: string) => handles.get(id);

/** 단축키 기호 글꼴(Epeira Keys)을 먼저 불러 둔다 → GPU 렌더러는 글꼴이 준비된 뒤 그려야 그 글꼴을 쓴다 */
const keysFont = document.fonts.load('13px "Epeira Keys"', "⌘⌥⇧⏎↑").catch(() => {});

const fontName = (f: string) => f.replace(/["\;{}<>]/g, "").trim();
/** 설정에서 고른 글꼴 → SF Mono · Menlo → 한글은 D2Coding 이 있으면 그것, 없으면 macOS 기본 한글 글꼴 */
const termFont = (custom: string) =>
  `"Epeira Keys", ${fontName(custom) ? `"${fontName(custom)}", ` : ""}"SF Mono", Menlo, D2Coding, "Apple SD Gothic Neo", monospace`;
/** 글꼴이 준비된 뒤 칸 크기를 잰다 */
const loadFont = (custom: string) =>
  fontName(custom) ? document.fonts.load(`13px "${fontName(custom)}"`, "가A").catch(() => {}) : Promise.resolve();

/** 처음 크기를 재는 곳: 화면 밖의 보이지 않는 자리 (터미널 칸과 같은 크기) */
let stage: HTMLDivElement | null = null;
const staging = (size?: { width: number; height: number }) => {
  if (!stage) {
    stage = document.createElement("div");
    stage.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden";
    document.body.append(stage);
  }
  stage.style.width = `${Math.max(320, size?.width ?? 800)}px`;
  stage.style.height = `${Math.max(150, size?.height ?? 500)}px`;
  return stage;
};

/** 화면에 없는 터미널을 두는 곳 (숨김). 칸에 보일 때 TerminalView 가 꺼내 간다 */
let lot: HTMLDivElement | null = null;
export const parkTerminal = (id: string) => {
  const host = handles.get(id)?.host;
  if (!host) return;
  if (!lot) {
    lot = document.createElement("div");
    lot.hidden = true;
    document.body.append(lot);
  }
  lot.append(host);
};

/** 새 터미널: 칸 크기를 재고 PTY 를 연다 → 탭 id. run: 셸이 준비되면 입력할 명령 (claude · codex), pending: 처음 보일 때 입력할 명령 */
export const openTerminal = async (opts: {
  cwd: string;
  run: string | null;
  pending?: string | null;
  size?: { width: number; height: number };
}) => {
  const prefs = usePrefs.getState();
  await keysFont;
  await loadFont(prefs.fontTerm);
  const host = document.createElement("div");
  host.className = "h-full w-full";
  staging(opts.size).append(host);
  const term = new Terminal({
    fontFamily: termFont(prefs.fontTerm),
    fontSize: prefs.fontSize,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    macOptionIsMeta: prefs.optionMeta,
    allowProposedApi: true,
    theme: terminalTheme() as ITheme,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon((_e, url) => epeira.openExternal(url)));
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11"; // 이모지 · 기호 칸 폭을 요즘 터미널 프로그램과 맞춘다
  term.open(host);
  try {
    // GPU 로 그린다 (Claude Code 처럼 화면을 자주 다시 그려도 가볍게). 안 되면 기본 렌더러
    const gl = new WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    term.loadAddon(gl);
  } catch {
    // WebGL 을 못 쓰는 환경
  }
  fit.fit();
  const id = await epeira.createTerm({ cwd: opts.cwd, run: opts.run, cols: term.cols, rows: term.rows });
  term.onData((d) => epeira.write(id, d));
  term.onResize(({ cols, rows }) => epeira.resize(id, cols, rows));
  // ⌘⌫: 지금 줄 지우기 (macOS 터미널처럼 Ctrl+U)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown" && e.metaKey && e.key === "Backspace") {
      epeira.write(id, "\x15");
      return false;
    }
    return true;
  });
  term.onSelectionChange(() => {
    if (usePrefs.getState().copyOnSelect && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()).catch(() => {});
    }
  });
  // 우클릭 메뉴는 메인이 띄운다 (복사는 메인이, 붙여넣기 · 찾기 등은 화면이 → onTermAction)
  host.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    epeira.termMenu(term.getSelection());
  });
  host.dataset.terminal = id;
  handles.set(id, { term, fit, search, host, pending: opts.pending ?? null });
  if (opts.pending) term.write(`\x1b[90m${i18n.t("tab.resumeHint")}\x1b[0m\r\n`);
  parkTerminal(id);
  return id;
};

/** 처음 보일 때 한 번: 미뤄 둔 명령을 입력한다 */
export const runPending = (id: string) => {
  const h = handles.get(id);
  if (!h?.pending) return;
  epeira.write(id, `${h.pending}\r`);
  h.pending = null;
};

export const disposeTerminal = (id: string) => {
  const h = handles.get(id);
  if (!h) return;
  h.term.dispose();
  h.host.remove();
  handles.delete(id);
};

/** 보이는 터미널만 칸 크기에 맞춘다 (숨은 칸은 크기가 0 이라 건너뜀) */
export const fitTerminal = (id: string) => {
  const h = handles.get(id);
  if (h?.host.isConnected && h.host.clientWidth && h.host.clientHeight) h.fit.fit();
};

let started = false;
/** 앱을 켤 때 한 번: PTY 출력을 터미널로, 테마 · 설정이 바뀌면 모든 터미널에 */
export const initTerminals = () => {
  if (started) return;
  started = true;
  epeira.onData((id, data) => handles.get(id)?.term.write(data));
  new MutationObserver(() => {
    const theme = terminalTheme() as ITheme;
    for (const h of handles.values()) h.term.options.theme = theme;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  usePrefs.subscribe(async (prefs, prev) => {
    if (prefs.fontTerm !== prev.fontTerm) await loadFont(prefs.fontTerm);
    for (const [id, h] of handles) {
      h.term.options.fontSize = prefs.fontSize;
      h.term.options.macOptionIsMeta = prefs.optionMeta;
      h.term.options.fontFamily = termFont(prefs.fontTerm);
      fitTerminal(id);
    }
  });
};
