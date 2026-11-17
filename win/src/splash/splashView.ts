import { formatTransferred } from "../formatBytes";

/** What the startup window is doing, as `splash-state` reports it. */
export type SplashPhase = "checking" | "downloading" | "installing" | "failed" | "updated" | "launching";

export interface SplashState {
  phase: SplashPhase;
  version: string | null;
  downloaded: number;
  total: number | null;
}

/** The saved look, set by the shell before any page script runs. */
export interface SplashBoot {
  theme: string | null;
  accent: string | null;
  language: string | null;
}

declare global {
  interface Window {
    __DRAGGY_SPLASH__?: SplashBoot;
  }
}

export const INITIAL_STATE: SplashState = { phase: "checking", version: null, downloaded: 0, total: null };

const STATUS_KEYS: Record<SplashPhase, string> = {
  checking: "splashChecking",
  downloading: "splashDownloading",
  installing: "splashInstalling",
  failed: "splashFailed",
  updated: "splashUpdated",
  launching: "splashLaunching",
};

export interface SplashView {
  status: string;
  /** A download shows a measured line with its version and size; everything else shows the fuse. */
  download: { progress: number | undefined; version: string; transferred: string } | null;
  canSkip: boolean;
}

/** The shell's state is trusted only as far as its shape: an unknown phase reads as checking. */
export function splashView(state: SplashState, t: (key: string) => string, language: string): SplashView {
  const phase = state.phase in STATUS_KEYS ? state.phase : "checking";
  const status = t(STATUS_KEYS[phase]).replace("{version}", state.version ?? "");
  if (phase !== "downloading") return { status, download: null, canSkip: false };
  const total = state.total ?? 0;
  const known = total > 0;
  return {
    status,
    download: {
      progress: known ? Math.min(1, Math.max(0, state.downloaded / total)) : undefined,
      version: state.version ? `Draggy ${state.version}` : "",
      transferred: known ? formatTransferred(state.downloaded, total, language) : "",
    },
    canSkip: true,
  };
}
