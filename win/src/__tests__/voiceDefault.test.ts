// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";

afterEach(() => localStorage.clear());

const save = (patch: Record<string, unknown>) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(patch));

describe("the default voice engine", () => {
  it("is the neural voice for a new install", () => {
    expect(loadSettings().voiceEngine).toBe("neural");
  });

  it("moves someone who never named a system voice, once", () => {
    save({ voiceEngine: "system", voiceName: "" });
    expect(loadSettings().voiceEngine).toBe("neural");

    // They go back to the basic voice on purpose: that sticks.
    save({ voiceEngine: "system", voiceName: "" });
    expect(loadSettings().voiceEngine).toBe("system");
  });

  it("keeps a named system voice", () => {
    save({ voiceEngine: "system", voiceName: "Microsoft Zira" });
    expect(loadSettings()).toMatchObject({ voiceEngine: "system", voiceName: "Microsoft Zira" });
  });
});
