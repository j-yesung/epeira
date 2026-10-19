// 경로 보여 주기: 홈은 ~, 길면 가운데를 줄여 마지막 폴더가 보이게
export const tilde = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

export const shortPath = (p: string) => {
  const parts = tilde(p).split("/");
  return parts.length > 4 ? `${parts[0]}/…/${parts.slice(-2).join("/")}` : parts.join("/");
};

/** cwd 가 dir 안인지 (dir 자신 포함) */
export const inPath = (cwd: string | undefined, dir: string) =>
  !!cwd && (cwd === dir || cwd.startsWith(dir.endsWith("/") ? dir : `${dir}/`));
