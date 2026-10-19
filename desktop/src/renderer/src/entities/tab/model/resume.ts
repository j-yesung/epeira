// 지난 대화를 이어 열 명령: 세션 id 를 알면 그 대화로 (모르면 null → 엉뚱한 대화를 잇지 않게)
import type { TabKind } from "@ipc/contract";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const resumeCmd = (kind: TabKind, sid: string | null) => {
  if (!sid || !/^[\w-]+$/.test(sid)) return null; // 셸에 그대로 입력되는 값이라 글자를 제한한다
  if (kind === "claude") return `claude --resume ${sid}`;
  // Codex 는 로그 이름 끝의 세션 id
  const uuid = kind === "codex" && UUID.exec(sid);
  return uuid ? `codex resume ${uuid[0]}` : null;
};

/** 셸 탭에서 직접 켠 대화의 에이전트. 세션 id 는 수집기가 쓰는 로그 이름이라 Claude 는 uuid 그대로, Codex 는 rollout-…-uuid */
export const agentOf = (sid: string | null): TabKind => {
  const uuid = sid ? UUID.exec(sid)?.[0] : undefined;
  return !uuid ? "shell" : uuid === sid ? "claude" : "codex";
};
