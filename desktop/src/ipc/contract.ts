// 메인 ↔ 화면 약속: preload 가 화면에 여는 API (window.epeira) 의 모양
// 메인은 이 타입과 상관없이 받은 값을 늘 다시 검사한다 (화면을 믿지 않는다)

export type TabKind = "shell" | "claude" | "codex";
export type ThemeChoice = "system" | "light" | "dark";
export type Unsubscribe = () => void;

export interface Project {
  path: string;
  name: string;
  added?: number;
  opened?: number;
  exists: boolean;
}

export interface ProjectsResult {
  list: Project[];
  added: string | null;
}

export interface CollectorEnsureResult {
  ok: boolean;
  status?: { version: string; port: number; [key: string]: unknown };
  updated?: boolean;
  installed?: boolean;
  needPython?: boolean;
  log?: string;
}

export interface AgentUsage {
  name: string;
  installed: boolean;
  connected: boolean;
  trust?: unknown;
  calls: number;
  tin: number;
  tout: number;
  tcache: number;
}

export interface UsageResult {
  ok: boolean;
  version?: string;
  port?: number;
  by?: Record<string, AgentUsage>;
  limits?: Record<string, unknown>;
  claudeLimits?: unknown;
  tabs?: Record<string, string>;
  names?: Record<string, string>;
  today?: { id: string; parent?: string; agent: string; cwd?: string; label?: string; tools: number; tok: number }[];
}

export interface GitInfo {
  branch: string;
  changes: number;
}

export interface UpdateInfo {
  version: string;
  url: string;
}

export interface UpdateCheckFailed {
  failed: true;
}

export interface UpdateInstallResult {
  ok: boolean;
  later?: boolean;
  manual?: boolean;
  error?: string;
}

/** 업데이트 진행: 받기(0~1) → 확인 중(null) → 끝(stage 가 null) */
export type UpdateStage = "download" | "verify" | null;

export interface NotifyMessage {
  title: string;
  body: string;
  tab?: string;
  silent?: boolean;
}

export type TermAction = "paste" | "selectAll" | "find" | "clear";

/** 메뉴 · 단축키에서 화면으로 보내는 동작 */
export type MenuAction =
  | "settings"
  | "add-project"
  | "new-shell"
  | "new-claude"
  | "new-codex"
  | "close-tab"
  | "rename-tab"
  | "find"
  | "find-next"
  | "find-prev"
  | "clear-terminal"
  | "palette"
  | "shortcuts"
  | "toggle-side"
  | "toggle-orbit"
  | "split"
  | "split-rows"
  | "pane-left"
  | "pane-right"
  | "pane-up"
  | "pane-down"
  | "pane-zoom"
  | "unsplit"
  | "next-tab"
  | "prev-tab";

export interface EpeiraApi {
  platform: string;
  /** 궤도 패널이 여는 로컬 수집기 주소 */
  orbitUrl: string;

  projects: () => Promise<Project[]>;
  addProject: () => Promise<ProjectsResult>;
  addProjectPath: (dir: string) => Promise<ProjectsResult>;
  removeProject: (dir: string) => Promise<Project[]>;
  confirmRemove: (name: string, tabIds: string[]) => Promise<boolean>;
  touchProject: (dir: string) => Promise<Project[]>;
  revealProject: (dir: string) => void;
  /** 끌어다 놓은 파일 · 폴더의 경로 */
  pathForFile: (file: File) => string;

  collector: () => Promise<CollectorEnsureResult>;
  installDevTools: () => void;
  usage: (refresh?: boolean) => Promise<UsageResult>;
  get: (pathname: string) => Promise<unknown>;
  post: (pathname: string, body?: unknown) => Promise<unknown>;
  onEvent: (fn: (event: Record<string, unknown>) => void) => Unsubscribe;
  doctor: () => Promise<string>;
  reinstall: () => Promise<{ ok: boolean; log?: string }>;

  createTerm: (opts: { cwd: string; run?: string | null; cols: number; rows: number }) => Promise<string>;
  confirmClose: (id: string) => Promise<boolean>;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  kill: (id: string) => void;
  onData: (fn: (id: string, data: string) => void) => Unsubscribe;
  onExit: (fn: (id: string, code: number) => void) => Unsubscribe;
  termMenu: (selection: string) => void;
  onTermAction: (fn: (action: TermAction, text?: string) => void) => Unsubscribe;

  notify: (msg: NotifyMessage) => void;
  badge: (count: number) => void;
  onActivateTab: (fn: (id: string) => void) => Unsubscribe;
  gitInfo: (dirs: string[]) => Promise<Record<string, GitInfo | null>>;
  fonts: () => Promise<string[]>;

  appVersion: () => Promise<string>;
  checkUpdate: (force?: boolean) => Promise<UpdateInfo | UpdateCheckFailed | null>;
  installUpdate: (version: string) => Promise<UpdateInstallResult>;
  onUpdateProgress: (fn: (stage: UpdateStage, fraction: number | null) => void) => Unsubscribe;

  getTheme: () => Promise<ThemeChoice>;
  setTheme: (theme: ThemeChoice) => Promise<ThemeChoice>;
  onMenu: (fn: (action: MenuAction) => void) => Unsubscribe;
  openExternal: (url: string) => void;
}
