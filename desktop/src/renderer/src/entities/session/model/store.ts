// 지난 세션 (수집기가 모은 최근 7일 Claude · Codex 대화). 사이드바에서 누르면 탭으로 이어 연다
import type { Project, TabKind } from "@ipc/contract";
import { create } from "zustand";

import { epeira } from "@/shared/api/epeira";
import { inPath } from "@/shared/lib/path";

export interface Session {
  id: string;
  agent: string;
  /** 서브에이전트면 부모 세션 */
  parent?: string | null;
  cwd?: string;
  /** 폴더 이름 (경로를 모를 때) */
  label?: string;
  /** 첫 질문 */
  title?: string;
  /** 마지막 동작 */
  text?: string;
  /** 마지막으로 움직인 때 (초) */
  last: number;
}

interface SessionState {
  sessions: Session[];
  /** 궤도 HUB 에서 직접 붙인 세션 이름 (수집기가 기억) */
  names: Record<string, string>;
  load: () => Promise<void>;
}

const WEEK = 7 * 86400;

export const useSessions = create<SessionState>((set) => ({
  sessions: [],
  names: {},
  load: async () => {
    const r = (await epeira.get(`/api/summary?since=${Math.floor(Date.now() / 1000 - WEEK)}`)) as {
      sessions?: unknown;
    } | null;
    if (!Array.isArray(r?.sessions)) return; // 수집기가 없으면 지난 목록을 그대로
    const sessions = (r.sessions as Session[]).filter((x) => x && typeof x.id === "string" && !x.parent);
    set({ sessions: sessions.sort((a, b) => b.last - a.last) });
  },
}));

/** 직접 붙인 이름(궤도 HUB) > 첫 질문 > 마지막 동작 > 폴더 이름 */
export const sessionName = (x: Session, names: Record<string, string>) =>
  names[x.id] || x.title || x.text || x.label || x.id;

/** 세션이 어느 프로젝트 것인지 (경로를 모르면 폴더 이름으로) */
export const projectOf = (x: Session, projects: Project[]) =>
  projects.find((p) => (x.cwd ? inPath(x.cwd, p.path) : x.label === p.name));

/** 탭 종류 표시용 (모르는 에이전트는 셸 모양) */
export const sessionKind = (x: Session): TabKind => (x.agent === "claude" || x.agent === "codex" ? x.agent : "shell");
