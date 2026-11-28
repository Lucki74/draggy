// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";

afterEach(() => localStorage.clear());

describe("hooks settings migration", () => {
  it("gives a 1.x settings file empty hooks and trust", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: "dark" }));
    const loaded = loadSettings();
    expect(loaded.hooks).toEqual([]);
    expect(loaded.hookTrust).toEqual({});
    expect(loaded.theme).toBe("dark");
  });

  it("drops a hand-edited hooks value of the wrong shape", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ hooks: { PreToolUse: [] } }));
    expect(loadSettings().hooks).toEqual([]);
  });

  it("keeps a valid saved hook list", () => {
    const hooks = [{ event: "Stop", matcher: "", command: "npm test", timeout: 60, enabled: true }];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ hooks }));
    expect(loadSettings().hooks).toEqual(hooks);
  });
});
