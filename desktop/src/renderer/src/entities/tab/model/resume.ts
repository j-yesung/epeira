// 지난 대화를 이어 열 명령: 세션 id 를 알면 그 대화로 (모르면 null → 셸만 열어 엉뚱한 대화를 잇지 않게)
import type { TabKind } from "@ipc/contract";

export const resumeCmd = (kind: TabKind, sid: string | null) => {
  if (!sid || !/^[\w-]+$/.test(sid)) return null; // 셸에 그대로 입력되는 값이라 글자를 제한한다
  if (kind === "claude") return `claude --resume ${sid}`;
  // Codex 는 로그 이름 끝의 세션 id
  const uuid = kind === "codex" && /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(sid);
  return uuid ? `codex resume ${uuid[0]}` : null;
};
