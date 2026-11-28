import type { Routine } from "./store";
import { nextRun } from "./schedule";

/** The routines to start at `now`. A routine is due when a slot of its cron fell after its last run.
 * Several slots missed while the computer slept count as one run, so a long sleep never starts a pile
 * of runs. `running` holds the ids already going, which are never started twice. */
export function dueRoutines(routines: Routine[], now: number, running: ReadonlySet<string> = new Set()): Routine[] {
  return routines.filter((routine) => {
    if (!routine.enabled || !routine.cron || running.has(routine.id)) return false;
    if (!routine.prompt.trim() || !routine.workspaceId) return false;
    const slot = nextRun(routine.cron, routine.lastRunAt ?? routine.createdAt);
    return slot !== null && slot <= now;
  });
}

/** Milliseconds to the start of the next minute, so one timer ticks on the minute. */
export function msToNextMinute(now: number): number {
  return 60_000 - (now % 60_000) + 50;
}

/** Title of the chat a run creates. */
export function runTitle(name: string, now: Date): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${name} · ${day}`;
}
