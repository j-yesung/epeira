// FSD 구조 검사 (pnpm fsd): 위 레이어 가져오기 · 같은 레이어의 slice 끼리 가져오기 · 레이어 · segment 구조
import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    rules: {
      // 공개 API(index.ts)는 밖에서 여러 파일을 실제로 가져다 쓰는 slice 에만 두고, 나머지는 파일 경로로 직접 가져온다
      "fsd/public-api": "off",
      "fsd/no-public-api-sidestep": "off",
      // 메인 창(페이지)이 하나라 모든 위젯 · 기능이 결국 그 페이지 하나에서 쓰인다 → "한 곳에서만 쓰니 합치라"는 규칙은 맞지 않음
      "fsd/insignificant-slice": "off",
    },
  },
]);
