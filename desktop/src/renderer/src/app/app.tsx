import { useEffect, useState } from "react";

import { epeira } from "@/shared/api/epeira";
import { Button } from "@/shared/ui/button";

/** React 로 옮기는 중인 앱 화면 (1단계: 도구 확인용 빈 화면) */
export function App() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    epeira.appVersion().then(setVersion);
  }, []);

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4" data-testid="react-shell">
      <h1 className="font-bold text-2xl">Epeira</h1>
      <p className="text-muted-foreground text-sm">React 화면으로 옮기는 중 · v{version}</p>
      <Button onClick={() => epeira.openExternal("https://github.com/j-yesung/epeira")}>저장소 열기</Button>
    </main>
  );
}
