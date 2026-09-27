/** Which screens the setup shows and when each may be left. Plain data, so the whole flow is a unit
 * test rather than a fresh install. */

export type StepId = "welcome" | "appearance" | "local" | "preferences" | "ready";

/** How the user chose to run the AI. Only "local" exists until providers ship (spec M5). */
export type SetupPath = "local";

export function stepsFor(path: SetupPath): StepId[] {
  switch (path) {
    case "local":
      return ["welcome", "appearance", "local", "preferences", "ready"];
  }
}

export function nextStep(steps: StepId[], current: StepId): StepId {
  const index = steps.indexOf(current);
  return steps[Math.min(index + 1, steps.length - 1)] ?? steps[0];
}

export function previousStep(steps: StepId[], current: StepId): StepId {
  const index = steps.indexOf(current);
  return steps[Math.max(index - 1, 0)] ?? steps[0];
}

export interface FlowState {
  /** Null while the connectivity check has not answered. */
  online: boolean | null;
  /** The model picked on the Local model step. An installed one needs no download and no network. */
  choice: { reference: string; fitsOnDisk: boolean; installed?: string } | null;
  modelOnDisk: boolean;
  engineReady: boolean;
}

export function canContinue(step: StepId, state: FlowState): boolean {
  switch (step) {
    case "welcome":
    case "appearance":
    case "preferences":
      return true;
    case "local":
      if (!state.choice) return false;
      return Boolean(state.choice.installed) || (state.choice.fitsOnDisk && state.online === true);
    case "ready":
      return state.modelOnDisk && state.engineReady;
  }
}
