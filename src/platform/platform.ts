export type Platform =
  | "windows"
  | "linux"
  | "darwin"
  | "termux"
  | "wsl";

export interface HostInfo {
  platform: Platform;
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  isTermux: boolean;
  isWsl: boolean;
  hasBash: boolean;
  shell: string;
}

export function detectPlatform(): HostInfo {
  const pf = process.platform;
  const isTermux = pf === "linux" && !!process.env.PREFIX && process.env.PREFIX.includes("com.termux");
  const isWsl = pf === "linux" && !!process.env.WSL_DISTRO_NAME;
  let platform: Platform = pf === "win32" ? "windows" : pf === "darwin" ? "darwin" : "linux";
  if (isTermux) platform = "termux";
  if (isWsl) platform = "wsl";

  const shell = isTermux
    ? "bash"
    : isWsl || pf !== "win32"
      ? "/bin/bash"
      : process.env.ComSpec ?? "cmd";

  return {
    platform,
    isWindows: pf === "win32",
    isMac: pf === "darwin",
    isLinux: pf === "linux",
    isTermux,
    isWsl,
    hasBash: pf !== "win32" || !!process.env.GIT_BASH,
    shell,
  };
}