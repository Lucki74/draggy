import type { ContextRow } from "../agent/contextBreakdown";

/** How the context wheel draws itself, kept apart so the component file only exports the component. */

/** One colour per part, the same in the bar and in the list under it. */
export const CONTEXT_COLORS: Record<ContextRow["id"], string> = {
  messages: "#3b82f6",
  system: "#d4a017",
  tools: "#f97316",
  memory: "#94a3b8",
  skills: "#10b981",
  summary: "#8b5cf6",
  draft: "#06b6d4",
  free: "transparent",
};

/** "13.6%", or "0.4%" for a sliver, so a small part is not rounded to nothing. */
export function formatPercent(percent: number): string {
  const value = Math.max(0, Math.min(100, percent));
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

/** How loud the wheel is: quiet until the window is nearly full. */
export function toneFor(percent: number): string {
  if (percent >= 95) return "#ef4444";
  if (percent >= 80) return "#f59e0b";
  return "var(--text-main)";
}
