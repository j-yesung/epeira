// 화면 문구 (i18next). 한국어로 시작하고, 영어는 en/ 을 더하면 된다
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ko from "./ko/translation.json";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof ko };
  }
}

i18n.use(initReactI18next).init({
  lng: "ko",
  fallbackLng: "ko",
  resources: { ko: { translation: ko } },
  interpolation: { escapeValue: false }, // React 가 이미 막는다
});

export { i18n };
