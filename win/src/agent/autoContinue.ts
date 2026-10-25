import type { OutOfContextInfo } from "./agentLoop";

/** The window an automatic continuation loads, or null when the cut reply should stay as it is. */
export function autoContinueWindow(cut: OutOfContextInfo | undefined, nextWindow: number | null): number | null {
  if (!cut?.canGrow || nextWindow === null || nextWindow <= cut.loaded) return null;
  return nextWindow;
}
