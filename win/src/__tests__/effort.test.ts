// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  allowedEfforts,
  clampEffort,
  effectiveEffort,
  effortFromLegacy,
  localBudget,
  nextEffort,
  normalizeEffort,
} from "../ai/effort";
import { loadSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";

const ALL = ["off", "low", "medium", "high", "max"] as const;

const base = {
  mode: "code" as const,
  allowMaxInChat: false,
  canThink: true,
  supported: null,
  slowBlocksThinking: false,
};

describe("effective effort", () => {
  it("sends what was asked when nothing limits it", () => {
    expect(effectiveEffort({ ...base, asked: "high" })).toEqual({ asked: "high", sent: "high" });
  });

  it("sends off to a model that cannot think, and says so when thinking was asked", () => {
    expect(effectiveEffort({ ...base, asked: "high", canThink: false })).toEqual({
      asked: "high",
      sent: "off",
      reason: "noThinking",
    });
    expect(effectiveEffort({ ...base, asked: "off", canThink: false })).toEqual({ asked: "off", sent: "off" });
  });

  it("caps Max to High in Chat unless Max is allowed there", () => {
    expect(effectiveEffort({ ...base, mode: "chat", asked: "max" })).toEqual({
      asked: "max",
      sent: "high",
      reason: "chatCap",
    });
    expect(effectiveEffort({ ...base, mode: "chat", asked: "max", allowMaxInChat: true }).sent).toBe("max");
  });

  it("lets Code use Max", () => {
    expect(effectiveEffort({ ...base, mode: "code", asked: "max" }).sent).toBe("max");
  });

  it("turns thinking off for a slow model until the user allows it", () => {
    expect(effectiveEffort({ ...base, asked: "medium", slowBlocksThinking: true })).toEqual({
      asked: "medium",
      sent: "off",
      reason: "slow",
    });
    expect(effectiveEffort({ ...base, asked: "off", slowBlocksThinking: true })).toEqual({ asked: "off", sent: "off" });
  });

  it("clamps to the levels a model supports and gives the reason", () => {
    expect(effectiveEffort({ ...base, asked: "max", supported: ["off", "low", "medium", "high"] })).toEqual({
      asked: "max",
      sent: "high",
      reason: "unsupported",
    });
  });

  it("keeps the asked level while the model's capabilities are unknown", () => {
    expect(effectiveEffort({ ...base, asked: "high", canThink: null })).toEqual({ asked: "high", sent: "high" });
  });

  it("keeps the first reason that changed the level", () => {
    const result = effectiveEffort({
      ...base,
      mode: "chat",
      asked: "max",
      supported: ["off", "low", "medium", "high"],
    });
    expect(result).toEqual({ asked: "max", sent: "high", reason: "chatCap" });
  });
});

describe("cycling and clamping", () => {
  it("cycles through every level and wraps back to off", () => {
    let level: (typeof ALL)[number] = "off";
    const seen: string[] = [];
    for (let i = 0; i < ALL.length; i++) {
      level = nextEffort(level, { mode: "code", allowMaxInChat: false });
      seen.push(level);
    }
    expect(seen).toEqual(["low", "medium", "high", "max", "off"]);
  });

  it("skips Max in Chat when it is not allowed", () => {
    expect(allowedEfforts("chat", false)).not.toContain("max");
    expect(nextEffort("high", { mode: "chat", allowMaxInChat: false })).toBe("off");
  });

  it("clamps down to the nearest supported level", () => {
    expect(clampEffort("max", ["off", "medium"])).toBe("medium");
    expect(clampEffort("low", ["medium", "high"])).toBe("medium");
  });
});

describe("local budget", () => {
  it("is null for off", () => {
    expect(localBudget("off", 8192)).toBeNull();
  });

  it("never exceeds a quarter of the context", () => {
    expect(localBudget("max", 8192)).toBe(2048);
    expect(localBudget("max", 131072)).toBe(32768);
  });
});

describe("legacy values", () => {
  it("maps the old fast mode to off and keeps the other names", () => {
    expect(effortFromLegacy("low")).toBe("off");
    expect(effortFromLegacy("medium")).toBe("medium");
    expect(effortFromLegacy("high")).toBe("high");
    expect(effortFromLegacy("nonsense")).toBeUndefined();
  });

  it("reads an unknown value as the default level", () => {
    expect(normalizeEffort("bogus")).toBe("medium");
  });
});

describe("settings migration", () => {
  beforeEach(() => localStorage.clear());

  it("moves the old thinking modes onto the new keys", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ thinkingMode: "low", codeThinkingMode: "high" }));
    const settings = loadSettings();
    expect(settings.effort).toBe("off");
    expect(settings.codeEffort).toBe("high");
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")).not.toHaveProperty("thinkingMode");
  });

  it("keeps the new key when a saved blob has both", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ thinkingMode: "high", effort: "max" }));
    expect(loadSettings().effort).toBe("max");
  });

  it("resets an unknown saved value to medium", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ effort: "turbo" }));
    expect(loadSettings().effort).toBe("medium");
  });
});
