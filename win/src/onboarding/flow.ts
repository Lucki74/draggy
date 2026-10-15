/** Which screens the setup shows and when each may be left. Plain data, so the whole flow is a unit
 * test rather than a fresh install. */

import { ggufLadder } from "../modelRecommendations";

export type StepId = "welcome" | "appearance" | "source" | "local" | "provider" | "preferences" | "ready";

/** How the user chose to run the AI, on the where-the-AI-runs step. */
export type SetupPath = "local" | "provider" | "both";

export function stepsFor(path: SetupPath): StepId[] {
  switch (path) {
    case "local":
      return ["welcome", "appearance", "source", "local", "preferences", "ready"];
    case "provider":
      return ["welcome", "appearance", "source", "provider", "preferences", "ready"];
    case "both":
      return ["welcome", "appearance", "source", "local", "provider", "preferences", "ready"];
  }
}

/** A rung under ~2B parameters (budget under 3 GB): local still works, but a provider deserves a mention. */
export function smallModelsOnly(reference: string): boolean {
  const rung = ggufLadder.find((entry) => entry.model === reference);
  return rung !== undefined && rung.vram < 3;
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
  path?: SetupPath;
  /** Null while the connectivity check has not answered. */
  online: boolean | null;
  /** The model picked on the Local model step. An installed one needs no download and no network. */
  choice: { reference: string; fitsOnDisk: boolean; installed?: string } | null;
  modelOnDisk: boolean;
  /** Downloading, with its file known, so the app can open on it and wait. */
  modelUnderWay?: boolean;
  engineReady: boolean;
  engineUnderWay?: boolean;
  /** The provider's `@instance/model`, set only once that provider answered with its models. */
  providerModel?: string | null;
}

export function canContinue(step: StepId, state: FlowState): boolean {
  switch (step) {
    case "welcome":
    case "appearance":
    case "source":
    case "preferences":
      return true;
    case "local":
      if (!state.choice) return false;
      return Boolean(state.choice.installed) || (state.choice.fitsOnDisk && state.online === true);
    case "provider":
      return Boolean(state.providerModel);
    case "ready":
      // A provider's model answers at once; the engine it still sets up only serves the Library.
      if (state.path === "provider") return Boolean(state.providerModel);
      // The app can be entered while both are still arriving; it waits for them itself.
      return (state.modelOnDisk || state.modelUnderWay === true) && (state.engineReady || state.engineUnderWay === true);
  }
}
