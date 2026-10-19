// 이 화면의 작은 저장 값 (localStorage 의 app.* 키, 예전 화면과 같은 키). 사생활 모드 등으로 막혀도 앱은 그대로 동작
const KEY = (k: string) => `app.${k}`;

export const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(KEY(k));
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(KEY(k), v);
    } catch {
      // 없어도 동작엔 지장 없음
    }
  },
};
