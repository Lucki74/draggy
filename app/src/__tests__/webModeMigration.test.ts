// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings, loadSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";

afterEach(() => localStorage.clear());

describe("web access is on or off", () => {
  it("starts on", () => {
    expect(defaultSettings.webMode).toBe("on");
    expect(defaultSettings.codeWebMode).toBe("on");
  });

  it("reads a saved auto as on and keeps off", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ webMode: "on", codeWebMode: "off" }));
    const loaded = loadSettings();
    expect(loaded.webMode).toBe("on");
    expect(loaded.codeWebMode).toBe("off");
  });
});
