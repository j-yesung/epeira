// 탭 종류 표시: 셸은 ›, Claude · Codex 는 로고
import type { TabKind } from "@ipc/contract";

import { IconTile } from "@/shared/ui/icon-tile";
import { ClaudeLogo, OpenAILogo } from "@/shared/ui/icons/agent-logos";

export function KindIcon({ kind }: { kind: TabKind }) {
  return (
    <IconTile>
      {kind === "claude" ? (
        <ClaudeLogo className="text-agent-claude" />
      ) : kind === "codex" ? (
        <OpenAILogo className="text-foreground" />
      ) : (
        <span className="font-bold font-mono text-muted-foreground text-xs leading-none">›</span>
      )}
    </IconTile>
  );
}
