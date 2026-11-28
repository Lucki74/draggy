import type { PermissionMode } from "../types";
import { parseSchedule } from "./schedule";

export type RoutineStatus = "running" | "done" | "failed";

export interface Routine {
  id: string;
  name: string;
  prompt: string;
  /** What the user typed: plain words or cron. */
  schedule: string;
  /** The cron the schedule parsed to. Empty when the text does not parse, and then the routine never runs. */
  cron: string;
  workspaceId: string;
  /** The most the run may do. Never raised by the scheduler. */
  permissionMode: PermissionMode;
  enabled: boolean;
  createdAt: number;
  /** When the last run started. The next run is the first slot after it. */
  lastRunAt: number | null;
  lastStatus: RoutineStatus | null;
  lastChatId: string | null;
}

/** A routine without a chosen mode runs with Accept edits at most. */
export const DEFAULT_ROUTINE_MODE: PermissionMode = "acceptEdits";

const MODES: readonly PermissionMode[] = ["plan", "ask", "acceptEdits", "turbo", "auto"];
const STATUSES: readonly RoutineStatus[] = ["running", "done", "failed"];

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const time = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Saved routines as they should be after loading: missing fields filled, a mode that is not one of the
 * five reset to the default, and a schedule that no longer parses switched off instead of lost. A run
 * that was still going when the app closed reads as failed. */
export function sanitizeRoutines(value: unknown): Routine[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Routine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = text(entry.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const schedule = text(entry.schedule, text(entry.cron));
    const parsed = parseSchedule(schedule);
    const mode = MODES.find((candidate) => candidate === entry.permissionMode) ?? DEFAULT_ROUTINE_MODE;
    const status = STATUSES.find((candidate) => candidate === entry.lastStatus) ?? null;
    out.push({
      id,
      name: text(entry.name, "Routine").trim() || "Routine",
      prompt: text(entry.prompt),
      schedule,
      cron: parsed.ok ? parsed.cron : "",
      workspaceId: text(entry.workspaceId),
      permissionMode: mode,
      enabled: parsed.ok && entry.enabled !== false,
      createdAt: time(entry.createdAt) ?? 0,
      lastRunAt: time(entry.lastRunAt),
      lastStatus: status === "running" ? "failed" : status,
      lastChatId: typeof entry.lastChatId === "string" ? entry.lastChatId : null,
    });
  }
  return out;
}
