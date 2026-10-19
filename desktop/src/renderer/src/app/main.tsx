import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/shared/i18n";

import { initTheme } from "@/shared/lib/theme";

import { App } from "./app";

import "./styles/index.css";

await initTheme(); // 첫 화면부터 저장된 테마로 (깜빡이지 않게)

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
