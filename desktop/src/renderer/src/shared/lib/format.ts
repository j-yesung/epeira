// 숫자 줄여 쓰기: 1.2k · 3.4M
export const fmtK = (x: number) =>
  x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : String(Math.round(x || 0));
