import type { SearchStep } from "../types";

/** One place decides which "working" mark shows, so two never run at once. */

/** An empty thinking step is only a placeholder and shows nothing of its own. */
function showsItself(step: SearchStep): boolean {
  return !step.isComplete && !(step.type === "thinking" && !step.content);
}

/** The mark under a reply that has begun but has nothing visible yet. */
export function showsTailMark(steps: SearchStep[], text: string, isGenerating: boolean, isLast: boolean): boolean {
  return text === "" && isGenerating && isLast && !steps.some(showsItself);
}

/** A collapsed work group stands in for its running steps; an open one lets them show their own. */
export function showsGroupMark(steps: SearchStep[], open: boolean): boolean {
  return !open && steps.some((step) => !step.isComplete);
}
