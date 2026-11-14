// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { defaultSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";

// The backend is picked when storage.ts loads, so each test loads it after the stub.
async function freshUseSettings() {
  vi.resetModules();
  return (await import("../app/settings")).useSettings;
}

function stubDb(stored: string | null) {
  const set = vi.fn(async () => ({ success: true }));
  const get = vi.fn(async () => ({ success: true, value: stored }));
  (window as unknown as { draggy: unknown }).draggy = {
    db: { get, set },
    setSearchConfig: vi.fn(async () => ({ success: true })),
    updater: { configure: vi.fn(async () => undefined) },
  };
  return { get, set };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { draggy?: unknown }).draggy;
});

describe("settings with an empty localStorage", () => {
  it("takes the copy in sqlite and never saves the defaults over it", async () => {
    const saved = { ...defaultSettings, modelName: "kept.gguf", accent: "orange", metricsChosen: true, showMetrics: true };
    const { set } = stubDb(JSON.stringify(saved));
    const useSettings = await freshUseSettings();
    const { result } = renderHook(() => useSettings(false));
    await waitFor(() => expect(result.current[0].modelName).toBe("kept.gguf"));
    expect(result.current[0].showMetrics).toBe(true);
    for (const [, value] of set.mock.calls as unknown as [string, string][]) {
      expect(JSON.parse(value).modelName).toBe("kept.gguf");
    }
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).modelName).toBe("kept.gguf");
  });

  it("saves the defaults on a real first run", async () => {
    const { set } = stubDb(null);
    const useSettings = await freshUseSettings();
    renderHook(() => useSettings(false));
    await waitFor(() => expect(set).toHaveBeenCalledWith(SETTINGS_KEY, expect.any(String)));
  });
});
