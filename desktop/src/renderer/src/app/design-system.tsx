// 개발 모드에서만 여는 디자인 시스템 창의 시작점 (배포본에는 들어가지 않음)
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DesignSystemPage } from "@/pages/design-system/design-system-page";

import "./styles/index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DesignSystemPage />
    </StrictMode>,
  );
}
