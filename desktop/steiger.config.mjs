// FSD 구조 검사 (pnpm fsd): 같은 레이어의 slice 끼리 가져오기 · 레이어 · slice 구조
import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    // 공개 API(index.ts)는 밖에서 여러 파일을 실제로 가져다 쓰는 slice 에만 두고, 나머지는 파일 경로로 직접 가져온다
    rules: { "fsd/public-api": "off", "fsd/no-public-api-sidestep": "off" },
  },
]);
