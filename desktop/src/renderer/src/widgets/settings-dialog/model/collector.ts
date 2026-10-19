// 설정 창이 수집기에 묻고 시키는 것: 상태 · 에이전트 연결 미리보기 · 연결 / 해제 / 승인 (메인이 정해진 주소만 대신 보낸다)
import { epeira } from "@/shared/api/epeira";

export interface AgentStatus {
  name: string;
  installed: boolean;
  connected: boolean;
  /** Codex 훅 승인 상태 */
  trust?: string;
  /** Claude Code 알림 훅 (false 면 승인 · 입력 대기를 알 수 없다) */
  notify?: boolean;
  /** 예전 방식으로 연결돼 있어 다시 연결이 필요 */
  legacy?: boolean;
}

export interface CollectorStatus {
  version: string;
  port: number;
  agents?: Record<string, AgentStatus>;
  claudeLimits?: boolean | null;
  autostart?: boolean | null;
}

export type AgentAction = "connect" | "disconnect" | "trust";

export interface AgentPreview {
  /** 바뀌는 설정 파일 (diff) */
  diff?: string;
  /** Codex 훅 승인도 함께 */
  trust?: boolean;
  command?: string;
  error?: string;
}

export const loadStatus = () => epeira.get("/api/status") as Promise<CollectorStatus | null>;

export const previewAgent = (agent: string, action: AgentAction) =>
  epeira.get(`/api/preview?agent=${encodeURIComponent(agent)}&action=${action}`) as Promise<AgentPreview | null>;

export const applyAgent = (agent: string, action: AgentAction) =>
  epeira.post(`/api/${action}`, { agent }) as Promise<{ message?: string } | null>;

export const setCollectorSetting = (body: { claudeLimits: boolean }) =>
  epeira.post("/api/settings", body) as Promise<{ ok?: boolean; message?: string } | null>;

export const setAutostart = (enabled: boolean) =>
  epeira.post("/api/autostart", { enabled }) as Promise<{ ok?: boolean; message?: string } | null>;
