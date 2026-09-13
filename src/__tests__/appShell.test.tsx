// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import App from "../App";
import { SETTINGS_KEY } from "../storage";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";
import type { FakeApi } from "./helpers/electronApi";

/** The shell around every screen: the settings overlay that has to stay mounted and opaque, and the
 * dialog offering an update that finished downloading. */

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

  /** The overlay wrapping the settings page, found from inside it: icons carry aria-hidden of their
   * own, so the attribute alone is not enough. */
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

describe("the chat and code switch", () => {
  beforeEach(() => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ modelName: "qwen3:8b", language: "en", autoUpdate: true }),
    );
    installFakeElectronApi();
  });

  afterEach(() => {
    cleanup();
    clearFakeElectronApi();
    localStorage.clear();
  });

  it("opens on Chat, with the chat side's screens", async () => {
    render(<App />);

    const chat = await screen.findByRole("radio", { name: "Chat" });
    expect(chat.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Code" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("button", { name: /talk/i })).toBeTruthy();
    // The settings menu names Projects too, so the sidebar is checked by its own button.
    expect(screen.queryByRole("button", { name: /new project/i })).toBeNull();
  });

  it("switches to Code, which asks for a folder when there is no project", async () => {
    render(<App />);

    const code = await screen.findByRole("radio", { name: "Code" });
    await act(async () => code.click());

    expect(code.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Open a project")).toBeTruthy();
    expect(screen.getByRole("button", { name: /open a folder/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /new project/i })).toBeTruthy();
    // Talk belongs to plain conversations, and never shows beside project work.
    expect(screen.queryByRole("button", { name: /talk/i })).toBeNull();
    expect(localStorage.getItem("draggy_mode")).toBe("code");
  });

  const chats = {
    id: "default",
    name: "",
    kind: "chat",
    rootPath: null,
    permissionMode: "auto",
    settings: {},
    grants: [],
    createdAt: 0,
    updatedAt: 0,
  };
  const weather = {
    ...chats,
    id: "weather",
    name: "weather-cli",
    kind: "project",
    rootPath: "C:\\projects\\weather-cli",
    permissionMode: "acceptEdits",
  };

  /** Opens the app on a project in Code. */
  async function openProject(api: FakeApi) {
    api.workspaces = [chats, weather];
    localStorage.setItem("draggy_mode", "code");
    localStorage.setItem("draggy_workspace", "weather");
    render(<App />);
    return screen.findByRole("button", { name: /accept edits/i });
  }

  it("keeps running code and permissions out of the Chat composer", async () => {
    render(<App />);
    await screen.findByRole("radio", { name: "Chat" });

    expect(screen.queryByRole("button", { name: /run code/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /accept edits/i })).toBeNull();
  });

  it("gives the Code composer the project's permissions, with no switch for running code", async () => {
    const api = installFakeElectronApi();
    const picker = await openProject(api);

    expect(picker).toBeTruthy();
    // Running code and commands are always on in Code; the permission mode governs them.
    expect(screen.queryByRole("button", { name: /run code/i })).toBeNull();

    await act(async () => picker.click());
    const plan = screen.getByRole("menuitemradio", { name: /plan only/i });
    await act(async () => plan.click());

    // Saved on the project, not on the app.
    expect(api.savedWorkspaces.at(-1)).toMatchObject({ id: "weather", permissionMode: "plan" });
  });

  it("writes a Code composer toggle to Code's settings and leaves Chat's alone", async () => {
    const api = installFakeElectronApi();
    await openProject(api);

    const thinking = screen.getByRole("button", { name: /balanced/i });
    await act(async () => thinking.click());

    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    expect(saved.codeThinkingMode).toBe("high");
    expect(saved.thinkingMode ?? "medium").toBe("medium");
  });

  it("comes back in the mode it was left in", async () => {
    localStorage.setItem("draggy_mode", "code");
    render(<App />);

    const code = await screen.findByRole("radio", { name: "Code" });
    expect(code.getAttribute("aria-checked")).toBe("true");

    await act(async () => screen.getByRole("radio", { name: "Chat" }).click());
    expect(screen.queryByText("Open a project")).toBeNull();
    expect(localStorage.getItem("draggy_mode")).toBe("chat");
  });
});
