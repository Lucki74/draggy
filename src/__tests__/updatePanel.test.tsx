// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import SettingsPage from "../SettingsPage";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";
import type { FakeApi } from "./helpers/electronApi";
import type { AppSettings } from "../types";

/**
 * The panel that sat on "Not checked yet." for a whole release because App
 * subscribed to the same channel and the preload dropped the first listener.
 */

const settings = {
  theme: "light",
  fontSize: "base",
  language: "en",
  modelName: "qwen3:8b",
  customInstructions: [],
  thinkingMode: "medium",
  webMode: "auto",
  voiceName: "",
  voiceModel: "",
  voiceEngine: "system",
  voiceRate: 1,
  embedModel: "",
  libraryEnabled: false,
  codeExecution: false,
  searchProvider: "auto",
  searxngUrl: "",
  braveApiKey: "",
  showMetrics: false,
  autoUpdate: true,
} as unknown as AppSettings;

function renderUpdates() {
  return render(
    <SettingsPage
      settings={settings}
      activeModel="qwen3:8b"
      initialTab="updates"
      onUpdate={() => {}}
      onSelectModel={() => {}}
      onClearChats={() => {}}
      onLibraryChange={() => {}}
    />,
  );
}

describe("the updates panel", () => {
  let api: FakeApi;

  beforeEach(() => {
    api = installFakeElectronApi();
  });

  afterEach(() => {
    cleanup();
    clearFakeElectronApi();
  });

  it("follows the check it started", async () => {
    renderUpdates();
    expect(await screen.findByText("Not checked yet.")).toBeTruthy();

    await act(async () => api.updater.emit({ status: "checking" }));
    expect(screen.getByText("Checking for updates…")).toBeTruthy();

    await act(async () => api.updater.emit({ status: "current", percent: 0 }));
    expect(screen.getByText("Draggy is up to date.")).toBeTruthy();
  });

  it("offers the download once one is available", async () => {
    renderUpdates();
    await screen.findByText("Not checked yet.");

    await act(async () => api.updater.emit({ status: "available", version: "9.9.9" }));

    expect(screen.getByText("Update available: v9.9.9")).toBeTruthy();
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy();
  });

  it("offers the install once one is downloaded", async () => {
    renderUpdates();
    await screen.findByText("Not checked yet.");

    await act(async () =>
      api.updater.emit({ status: "ready", version: "9.9.9", percent: 100 }),
    );

    expect(screen.getByRole("button", { name: /restart/i })).toBeTruthy();
  });

  it("shows the reason a check failed", async () => {
    renderUpdates();
    await screen.findByText("Not checked yet.");

    await act(async () =>
      api.updater.emit({ status: "error", error: "no latest.yml on the release" }),
    );

    expect(screen.getByText("no latest.yml on the release")).toBeTruthy();
  });

  it("keeps listening when a second part of the app wants the same channel", async () => {
    renderUpdates();
    await screen.findByText("Not checked yet.");

    // What App does for the update dialog. Before the fix this silenced the
    // panel above, and Check now looked dead for the rest of the session.
    const seen: unknown[] = [];
    api.updater.subscribe((state) => seen.push(state));

    await act(async () => api.updater.emit({ status: "current", percent: 0 }));

    expect(seen).toHaveLength(1);
    expect(screen.getByText("Draggy is up to date.")).toBeTruthy();
  });

  it("lets go of its listener when it goes away", async () => {
    const view = renderUpdates();
    await screen.findByText("Not checked yet.");
    expect(api.updater.count).toBe(1);

    view.unmount();
    expect(api.updater.count).toBe(0);
  });
});
