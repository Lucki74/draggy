import { diffLines } from "./diff";
import type { SearchStep } from "../types";

/** Steps that fold into a work block. Prose, reasoning, questions for the user and written files
 * stay in the transcript on their own; an answered approval folds in with the call it allowed. */
export function isWorkStep(step: SearchStep) {
  if (step.type === "approval") return Boolean(step.answer);
  return !["text", "thinking", "create_file", "app", "image"].includes(step.type) &&
    !(step.type === "loading" && !step.isComplete);
}

/** Lines added and removed by one file step, or null when it has no diff. */
export function stepTotals(step: SearchStep) {
  if (step.type !== "edit_file" || step.before === undefined || step.after === undefined) return null;
  let added = 0;
  let removed = 0;
  for (const hunk of diffLines(step.before, step.after).hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "added") added += 1;
      else if (line.kind === "removed") removed += 1;
    }
  }
  return { added, removed };
}

/** Files the turn wrote or changed, once each, in the order first touched. */
export function touchedFiles(steps: SearchStep[]): { name: string; path: string; created: boolean }[] {
  const seen = new Map<string, { name: string; path: string; created: boolean }>();
  for (const step of steps) {
    if ((step.type !== "create_file" && step.type !== "edit_file") || !step.filepath || step.change === "deleted") continue;
    if (!seen.has(step.filepath)) {
      seen.set(step.filepath, {
        name: step.filename || step.filepath,
        path: step.filepath,
        created: step.type === "create_file" || step.change === "created",
      });
    }
  }
  return [...seen.values()];
}
