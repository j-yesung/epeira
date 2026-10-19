import type { EpeiraApi } from "../../../../ipc/contract";

declare global {
  interface Window {
    epeira: EpeiraApi;
  }
}

/** 메인 프로세스와 주고받는 API (preload 가 연다) */
export const epeira = window.epeira;
