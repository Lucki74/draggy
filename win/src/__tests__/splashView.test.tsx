// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { translations } from "../translations";
import { INITIAL_STATE, splashView, type SplashState } from "../splash/splashView";
import { ReadySignal } from "../app/ReadySignal";

const t = (key: string) => translations.en[key] ?? key;

describe("splashView", () => {
  it("shows the fuse and no skip while checking", () => {
    const view = splashView(INITIAL_STATE, t, "en");
    expect(view.status).toBe(translations.en.splashChecking);
    expect(view.download).toBeNull();
    expect(view.canSkip).toBe(false);
  });

  it("measures a download and offers to skip it", () => {
    const state: SplashState = { phase: "downloading", version: "2.4.0", downloaded: 19_100_000, total: 38_200_000 };
    const view = splashView(state, t, "en");
    expect(view.canSkip).toBe(true);
    expect(view.download).toEqual({ progress: 0.5, version: "Draggy 2.4.0", transferred: "19 / 38 MB" });
  });

  it("leaves a download of unknown size unmeasured", () => {
    const state: SplashState = { phase: "downloading", version: null, downloaded: 5, total: null };
    expect(splashView(state, t, "en").download).toEqual({ progress: undefined, version: "", transferred: "" });
  });

  it("names the version it updated to", () => {
    const view = splashView({ ...INITIAL_STATE, phase: "updated", version: "2.4.0" }, t, "en");
    expect(view.status).toBe("Updated to 2.4.0");
  });

  it("reads an unknown phase as checking", () => {
    const state = { ...INITIAL_STATE, phase: "exploded" } as unknown as SplashState;
    expect(splashView(state, t, "en").status).toBe(translations.en.splashChecking);
  });

  it("has every phase in every language", () => {
    const keys = ["splashChecking", "splashDownloading", "splashSkip", "splashInstalling", "splashFailed", "splashLaunching", "splashUpdated"];
    for (const language of ["en", "fr", "es", "ru"]) {
      for (const key of keys) expect(translations[language][key], `${language}.${key}`).toBeTruthy();
      expect(translations[language].splashUpdated).toContain("{version}");
    }
  });
});

describe("ReadySignal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("tells the splash once, after a frame", () => {
    const ready = vi.fn(() => Promise.resolve());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    const previous = window.draggy;
    window.draggy = { startup: { ready } } as unknown as typeof window.draggy;
    try {
      render(<ReadySignal />);
      render(<ReadySignal />);
      expect(ready).toHaveBeenCalledTimes(1);
    } finally {
      window.draggy = previous;
    }
  });
});
