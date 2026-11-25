import { describe, expect, it } from "vitest";
import { canContinue, nextStep, previousStep, smallModelsOnly, stepsFor, type FlowState } from "../onboarding/flow";
import { ggufLadder } from "../modelRecommendations";

const blank: FlowState = { online: null, choice: null, modelOnDisk: false, engineReady: false };

describe("the setup's screens", () => {
  it("runs welcome, appearance, the source, the local model, preferences and ready on the local path", () => {
    expect(stepsFor("local")).toEqual(["welcome", "appearance", "source", "local", "preferences", "ready"]);
  });

  it("swaps the local model for the provider on the provider path, and asks both on both", () => {
    expect(stepsFor("provider")).toEqual(["welcome", "appearance", "source", "provider", "preferences", "ready"]);
    expect(stepsFor("both")).toEqual(["welcome", "appearance", "source", "local", "provider", "preferences", "ready"]);
  });

  it("calls a machine weak only when the ladder lands under ~2B parameters", () => {
    const weak = ggufLadder.filter((rung) => smallModelsOnly(rung.model)).map((rung) => rung.params);
    expect(weak).toEqual(["0.8B", "2B"]);
    expect(smallModelsOnly("someone/unknown-GGUF:Q4_K_M")).toBe(false);
  });

  it("moves forward and back without running off either end", () => {
    const steps = stepsFor("local");
    expect(nextStep(steps, "welcome")).toBe("appearance");
    expect(nextStep(steps, "local")).toBe("preferences");
    expect(nextStep(steps, "preferences")).toBe("ready");
    expect(nextStep(steps, "ready")).toBe("ready");
    expect(previousStep(steps, "appearance")).toBe("welcome");
    expect(previousStep(steps, "welcome")).toBe("welcome");
  });
});

describe("when a screen may be left", () => {
  it("always lets welcome, appearance and preferences go", () => {
    expect(canContinue("welcome", blank)).toBe(true);
    expect(canContinue("appearance", blank)).toBe(true);
    expect(canContinue("source", blank)).toBe(true);
    expect(canContinue("preferences", blank)).toBe(true);
  });

  it("needs a model that fits, and the network to fetch it", () => {
    const choice = { reference: "a/b:Q4", fitsOnDisk: true };
    expect(canContinue("local", blank)).toBe(false);
    expect(canContinue("local", { ...blank, choice })).toBe(false);
    expect(canContinue("local", { ...blank, choice, online: false })).toBe(false);
    expect(canContinue("local", { ...blank, choice, online: true })).toBe(true);
    expect(canContinue("local", { ...blank, choice: { ...choice, fitsOnDisk: false }, online: true })).toBe(false);
  });

  it("lets an installed model through offline, since nothing downloads", () => {
    const choice = { reference: "m.gguf", fitsOnDisk: true, installed: "m.gguf" };
    expect(canContinue("local", { ...blank, choice, online: false })).toBe(true);
  });

  it("opens the app once the model and engine are on disk or on their way, never after a failure", () => {
    expect(canContinue("ready", { ...blank, modelOnDisk: true })).toBe(false);
    expect(canContinue("ready", { ...blank, engineReady: true })).toBe(false);
    expect(canContinue("ready", { ...blank, modelOnDisk: true, engineReady: true })).toBe(true);
    expect(canContinue("ready", { ...blank, modelUnderWay: true, engineReady: true })).toBe(true);
    expect(canContinue("ready", { ...blank, modelUnderWay: true, engineUnderWay: true })).toBe(true);
    expect(canContinue("ready", { ...blank, modelUnderWay: false, engineReady: true })).toBe(false);
  });

  it("leaves the provider step only with a model from a provider that answered", () => {
    expect(canContinue("provider", blank)).toBe(false);
    expect(canContinue("provider", { ...blank, providerModel: null })).toBe(false);
    expect(canContinue("provider", { ...blank, providerModel: "@ollama/qwen3" })).toBe(true);
  });

  it("opens the app on a provider's model alone, with no local model or engine", () => {
    expect(canContinue("ready", { ...blank, path: "provider" })).toBe(false);
    expect(canContinue("ready", { ...blank, path: "provider", providerModel: "@ollama/qwen3" })).toBe(true);
    // Both keeps Draggy's own model as the default, so it waits for that one.
    expect(canContinue("ready", { ...blank, path: "both", providerModel: "@ollama/qwen3" })).toBe(false);
  });
});
