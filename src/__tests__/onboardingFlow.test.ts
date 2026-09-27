import { describe, expect, it } from "vitest";
import { canContinue, nextStep, previousStep, stepsFor, type FlowState } from "../onboarding/flow";

const blank: FlowState = { online: null, choice: null, modelOnDisk: false, engineReady: false };

describe("the setup's screens", () => {
  it("runs welcome, appearance, the local model, preferences and ready on the local path", () => {
    expect(stepsFor("local")).toEqual(["welcome", "appearance", "local", "preferences", "ready"]);
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

  it("opens the app only once the model is on disk and the engine is ready", () => {
    expect(canContinue("ready", { ...blank, modelOnDisk: true })).toBe(false);
    expect(canContinue("ready", { ...blank, engineReady: true })).toBe(false);
    expect(canContinue("ready", { ...blank, modelOnDisk: true, engineReady: true })).toBe(true);
  });
});
