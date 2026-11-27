import type { SearchStep } from "../types";

/** The steps of a reply with each child run's own steps placed right after it, for lookups such as pending approvals. */
export function allSteps(steps: SearchStep[] | undefined): SearchStep[] {
  if (!steps) return [];
  return steps.flatMap((step) => (step.type === "subagent" && step.subagent ? [step, ...allSteps(step.subagent.steps)] : [step]));
}
