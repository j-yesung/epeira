import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

/** 화면의 CSP: 배포본은 앱에 든 파일만. 개발 서버(저장하면 바로 반영)일 때만 React 가 넣는 인라인 스크립트와 웹소켓을 더 허용 */
const csp = (dev: boolean): Plugin => ({
  name: "epeira-csp",
  transformIndexHtml: (html) =>
    html.replace(
      "%CSP%",
      [
        "default-src 'self'",
        dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        ...(dev ? ["connect-src 'self' ws://localhost:*"] : []),
        "frame-src http://127.0.0.1:*",
        "child-src http://127.0.0.1:*",
      ].join("; "),
    ),
});

// 명령은 늘 desktop/ 에서 실행한다 (pnpm 스크립트 · CI)
export default defineConfig(({ command }) => ({
  main: {},
  preload: {},
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src") } },
    plugins: [react(), tailwindcss(), csp(command === "serve")],
  },
}));
