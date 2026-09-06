// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import App from "../App";
import { SETTINGS_KEY } from "../storage";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";
import type { FakeApi } from "./helpers/electronApi";

/**
 * The shell around every screen: the settings overlay that has to stay mounted
 * and opaque, and the dialog offering an update that finished downloading.
 */

describe("the app shell", () => {
  let api: FakeApi;

  beforeEach(() => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ modelName: "qwen3:8b", language: "en", autoUpdate: true }),
    );
    api = installFakeElectronApi();
  });

  afterEach(() => {
    cleanup();
    clearFakeElectronApi();
    localStorage.clear();
  });

  /**
   * The overlay wrapping the settings page, found from inside it: icons carry
   * aria-hidden of their own, so the attribute alone is not enough.
   */
  async function settingsOverlay() {
    const inside = (await screen.findAllByText("Appearance"))[0];
    return inside.closest("[aria-hidden]");
  }

  it("keeps the settings panel mounted while the chat is showing", async () => {
    render(<App />);

    // A model pull lives in that component, and unmounting it aborted the pull
    // the moment anyone looked at anything else.
    const overlay = await settingsOverlay();
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
  });

  it("paints the overlay so the composer cannot show through it", async () => {
    render(<App />);
    await screen.findAllByText("Appearance");

    // The state the bug was visible in: settings open, over the chat.
    await act(async () => screen.getByRole("button", { name: "Settings" }).click());

    const overlay = await settingsOverlay();
    expect(overlay?.getAttribute("aria-hidden")).toBe("false");

    // 1.2.1 left this transparent and unlayered, and the chat's composer was
    // painted through the bottom of the settings page.
    expect(overlay?.className).toContain("bg-[var(--bg-base)]");
    expect(overlay?.className).toContain("z-20");
  });

  it("hides the overlay without unmounting it", async () => {
    render(<App />);
    const overlay = await settingsOverlay();

    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.className).toContain("invisible");
    expect(overlay?.className).toContain("bg-[var(--bg-base)]");
  });

  it("offers an update that was already downloaded when the window opened", async () => {
    api.updaterState = { status: "ready", version: "9.9.9" };
    render(<App />);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/9\.9\.9/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /install now/i })).toBeTruthy();
  });

  it("offers one that finishes while the window is open", async () => {
    render(<App />);
    await screen.findAllByText("Appearance");
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => api.updater.emit({ status: "ready", version: "9.9.9" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("stays quiet for a check that found nothing", async () => {
    render(<App />);
    await screen.findAllByText("Appearance");

    await act(async () => api.updater.emit({ status: "current" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks the main process to install when told to", async () => {
    api.updaterState = { status: "ready", version: "9.9.9" };
    render(<App />);

    const install = await screen.findByRole("button", { name: /install now/i });
    await act(async () => install.click());

    expect(api.install).toHaveBeenCalled();
  });

  it("puts the dialog away for the rest of the session", async () => {
    api.updaterState = { status: "ready", version: "9.9.9" };
    render(<App />);

    const later = await screen.findByRole("button", { name: /maybe later/i });
    await act(async () => later.click());

    expect(screen.queryByRole("dialog")).toBeNull();

    // A later state change must not bring it back and interrupt the user again.
    await act(async () => api.updater.emit({ status: "ready", version: "9.9.9" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
