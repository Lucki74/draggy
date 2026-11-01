// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";
import { safeJsonParse } from "../utils";

afterEach(() => localStorage.clear());

describe("language migration for removed languages", () => {
  it("migrates a saved removed language to en and writes it back", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "ar" }));
    const loaded = loadSettings();
    expect(loaded.language).toBe("en");

    const saved = safeJsonParse<{ language?: string }>(localStorage.getItem(SETTINGS_KEY) ?? "");
    expect(saved?.language).toBe("en");
  });

  it("keeps a supported non-English language like fr intact", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "fr" }));
    const loaded = loadSettings();
    expect(loaded.language).toBe("fr");
  });

  it("migrates other dropped languages to en", () => {
    for (const dropped of ["de", "it", "pt", "nl", "ja", "ko"]) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: dropped }));
      expect(loadSettings().language).toBe("en");
    }
  });
});
