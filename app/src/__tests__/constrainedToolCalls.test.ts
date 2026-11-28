// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";
import { grammarRefused, noteEngineStart, noteGrammarRefused } from "../llama";

afterEach(() => localStorage.clear());

describe("constrained tool calls setting", () => {
  it("is on for a fresh install and for settings files saved before it existed", () => {
    expect(loadSettings().constrainedToolCalls).toBe(true);

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ modelName: "@claude/opus" }));
    expect(loadSettings().constrainedToolCalls).toBe(true);
  });

  it("stays off when the user turned it off", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ constrainedToolCalls: false }));
    expect(loadSettings().constrainedToolCalls).toBe(false);
  });
});

describe("grammar refusals", () => {
  it("are kept while the engine is reused and forgotten when it starts again", () => {
    noteGrammarRefused("local-model");
    noteEngineStart("local-model", { success: true, alreadyRunning: true });
    expect(grammarRefused("local-model")).toBe(true);

    noteEngineStart("local-model", { success: true });
    expect(grammarRefused("local-model")).toBe(false);
  });
});
