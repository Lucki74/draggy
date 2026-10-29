import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { planPins, isNoise } = require("./autoPin.cjs");
const { capabilitiesFor, find } = require("./catalog.cjs");

describe("isNoise", () => {
  it.each(["text-embedding-3-large", "tts-1", "whisper-1", "gpt-image-1", "dall-e-3", "omni-moderation-latest", "gpt-5-realtime-preview", "gemini-2.5-flash-image", "gpt-4o-audio-preview"])("skips %s", (id) => {
    expect(isNoise(null, id)).toBe(true);
  });
  it.each(["gpt-5.5", "claude-opus-5-6", "gemini-3-pro", "llama-4-scout", "qwen3:32b"])("keeps %s", (id) => {
    expect(isNoise(null, id)).toBe(false);
  });
  it("skips a dated snapshot only when its base is pinned", () => {
    expect(isNoise(null, "gpt-5-2026-01-02", new Set(["gpt-5"]))).toBe(true);
    expect(isNoise(null, "gpt-5-2026-01-02", new Set())).toBe(false);
  });
  it("takes extra patterns from the entry", () => {
    expect(isNoise({ noisePatterns: ["-vec$"] }, "x-vec")).toBe(true);
  });
});

describe("planPins", () => {
  it("seeds on the first look and pins nothing", () => {
    expect(planPins({ listed: ["a", "b"], pinned: ["a"] })).toEqual({ seenModels: ["a", "b"], pinnedModels: ["a"], added: [] });
  });
  it("pins a new id and leaves an unticked one off", () => {
    const plan = planPins({ listed: ["a", "b", "c"], pinned: ["a"], seen: ["a", "b"] });
    expect(plan).toEqual({ seenModels: ["a", "b", "c"], pinnedModels: ["a", "c"], added: ["c"] });
  });
  it("caps pins at three and still marks the rest seen", () => {
    const plan = planPins({ listed: ["1", "2", "3", "4", "5"], pinned: [], seen: [] });
    expect(plan.added).toEqual(["1", "2", "3"]);
    expect(plan.seenModels).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("family fallback", () => {
  it("gives a new gpt or claude name its family's capabilities", () => {
    expect(capabilitiesFor(find("openai"), "gpt-7").capabilities).toEqual(["tools"]);
    expect(capabilitiesFor(find("gemini"), "gemini-9-ultra").capabilities).toEqual(["tools", "vision", "thinking"]);
    expect(capabilitiesFor(find("anthropic"), "claude-opus-9").capabilities).toContain("vision");
    expect(capabilitiesFor(find("openai"), "mystery").capabilities).toEqual([]);
  });
});
