// 오른쪽 궤도 패널: 로컬 수집기의 대시보드(webview)를 그대로 띄운다. 밤하늘이라 늘 어둡게 (data-theme="dark")
// 수집기를 준비하는 동안 · 못 할 때는 안내. 지금 프로젝트 · 탭을 대시보드에 알린다 (프로젝트마다 독립된 궤도, HUB 는 그 탭의 세션)
import { useEffect, useRef, useState } from "react";

import { ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProjects } from "@/entities/project/model/store";
import { useTabs } from "@/entities/tab/model/store";
import { retryCollector, useCollector } from "@/features/collector/model/connect";
import { epeira } from "@/shared/api/epeira";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { handleOrbitMessage } from "../model/messages";

/** Electron webview 에서 쓰는 것만 */
interface Webview extends HTMLElement {
  executeJavaScript: (code: string) => Promise<unknown>;
  reload: () => void;
}

const DASHBOARD = `${epeira.orbitUrl}/?view=mini&embed=1`;

function Off() {
  const { t } = useTranslation();
  const phase = useCollector((s) => s.phase);
  if (phase === "wait" || phase === "ok") {
    return (
      <div
        role="status"
        aria-label={t("orbit.waiting")}
        className="size-[26px] animate-spin self-center rounded-full border-[2.5px] border-input border-t-primary"
      />
    );
  }
  const python = phase === "python";
  return (
    <>
      <h2 className="font-semibold text-foreground text-lg">{t(python ? "orbit.pythonTitle" : "orbit.failedTitle")}</h2>
      <p>{t(python ? "orbit.pythonBody" : "orbit.failedBody")}</p>
      <Button className="self-start" onClick={() => (python ? epeira.installDevTools() : retryCollector())}>
        {t(python ? "orbit.installDevTools" : "orbit.retry")}
      </Button>
    </>
  );
}

export function OrbitPanel() {
  const { t } = useTranslation();
  const ok = useCollector((s) => s.phase === "ok");
  const reloads = useCollector((s) => s.reloads);
  const project = useProjects((s) => s.projects.find((p) => p.path === s.current));
  const active = useTabs((s) => s.active);
  const ref = useRef<HTMLWebViewElement & Webview>(null);
  // 수집기가 준비되면 대시보드를 연다 (한 번 열면 그대로, 수집기가 잠깐 꺼져도 화면은 남긴다)
  const [src, setSrc] = useState("about:blank");
  const [loads, setLoads] = useState(0);
  if (ok && src === "about:blank") setSrc(DASHBOARD);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onReady = () => setLoads((n) => n + 1);
    const onMessage = (e: Event) => handleOrbitMessage((e as Event & { message?: string }).message);
    el.addEventListener("dom-ready", onReady);
    el.addEventListener("console-message", onMessage);
    return () => {
      el.removeEventListener("dom-ready", onReady);
      el.removeEventListener("console-message", onMessage);
    };
  }, []);

  // 새로고침 · 수집기 업데이트 → 다시 불러오기
  const firstReloads = useRef(reloads);
  useEffect(() => {
    if (reloads !== firstReloads.current) ref.current?.reload();
  }, [reloads]);

  // 지금 프로젝트 · 탭 알리기 (예전 수집기는 aoFocusTab 만 있다)
  const name = project?.name ?? "";
  const dir = project?.path ?? "";
  useEffect(() => {
    if (!loads) return;
    const args = [name, active ?? "", dir].map((x) => JSON.stringify(x)).join(", ");
    ref.current
      ?.executeJavaScript(
        `window.aoFocusProject ? aoFocusProject(${args}) : window.aoFocusTab && aoFocusTab(${JSON.stringify(active ?? "")})`,
      )
      .catch(() => {});
  }, [loads, name, dir, active]);

  // 앱이 뒤로 가면 궤도 애니메이션을 초당 8번으로 (배터리)
  useEffect(() => {
    if (!loads) return;
    const tell = () =>
      ref.current?.executeJavaScript(`window.aoSetActive && aoSetActive(${document.hasFocus()})`).catch(() => {});
    const onBlur = () => setTimeout(tell, 50);
    tell();
    addEventListener("focus", tell);
    addEventListener("blur", onBlur);
    return () => {
      removeEventListener("focus", tell);
      removeEventListener("blur", onBlur);
    };
  }, [loads]);

  return (
    <section
      aria-label={t("orbit.label")}
      data-theme="dark"
      className="flex h-full min-w-0 flex-col bg-background text-foreground"
    >
      <div className="flex h-(--bar-height) shrink-0 items-center gap-1.5 border-b bg-chrome pr-2.5 pl-3.5 [-webkit-app-region:drag]">
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          title={t("orbit.openDashboard")}
          aria-label={t("orbit.openDashboard")}
          onClick={() => epeira.openExternal(`${epeira.orbitUrl}/`)}
          className="[-webkit-app-region:no-drag]"
        >
          <ArrowUpRight />
        </Button>
      </div>
      {!ok && (
        <div className="flex flex-1 flex-col justify-center gap-3 p-6 text-muted-foreground">
          <Off />
        </div>
      )}
      <webview ref={ref} src={src} partition="persist:orbit" className={cn("min-h-0 flex-1", !ok && "hidden")} />
    </section>
  );
}
