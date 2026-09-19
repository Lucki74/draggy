// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import SettingsPage from "../settings/SettingsPage";
import { defaultSettings } from "../app/settings";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";
import type { SettingsTab } from "../settings/pages";
import type { Workspace } from "../types";

/** Settings in three groups. Extensions belong to the app, Code's preferences write Code's fields,
 * and nothing that deletes asks nothing first. */

const project: Workspace = {
  id: "weather",
  name: "weather-cli",
  kind: "project",
  rootPath: "C:\\projects\\weather-cli",
  permissionMode: "acceptEdits",
  settings: {},
  grants: [{ tool: "run_command", target: "npm test" }],
  createdAt: 0,
  updatedAt: 0,
};

function renderSettings(tab: SettingsTab, overrides: Record<string, unknown> = {}) {
  const handlers = {
    onUpdate: vi.fn(),
    onRemoveProject: vi.fn(),
    onSetPermissionMode: vi.fn(),
    onRevokeGrant: vi.fn(),
    onClearChats: vi.fn(),
    onClearSessions: vi.fn(),
  };

  render(
    <SettingsPage
      settings={{ ...defaultSettings, modelName: "qwen3:8b" }}
      chatModel="qwen3:8b"
      request={{ tab, id: 0 }}
      onSelectChatModel={() => {}}
      projects={[project]}
      activeProjectId="weather"
      onAddProject={async () => null}
      onRenameProject={() => {}}
      onEditProjectMemory={() => {}}
      {...handlers}
      {...overrides}
    />,
  );

  return handlers;
}

beforeEach(() => {
  installFakeElectronApi();
});

afterEach(() => {
  cleanup();
  clearFakeElectronApi();
});

describe("the settings menu", () => {
  it("groups its pages under App, Chat and Code, with Extensions under App", () => {
    renderSettings("general");

    const menu = screen.getByRole("navigation", { name: "Settings" });
    const groups = [...menu.querySelectorAll(":scope > div")].map((group) => ({
      title: group.querySelector("p")?.textContent,
      pages: [...group.querySelectorAll("button")].map((button) => button.textContent),
    }));

    expect(groups.map((group) => group.title)).toEqual(["App", "Chat", "Code"]);
    expect(groups[0].pages).toContain("Extensions");
    expect(groups[1].pages).not.toContain("Extensions");
    expect(groups[2].pages).toEqual(["Preferences", "Projects"]);
  });

  it("moves to the page a later request names", async () => {
    const view = render(
      <SettingsPage
        settings={defaultSettings}
        chatModel="qwen3:8b"
        request={{ tab: "general", id: 0 }}
        onUpdate={() => {}}
        onSelectChatModel={() => {}}
        projects={[]}
        activeProjectId={null}
        onAddProject={async () => null}
        onRenameProject={() => {}}
        onSetPermissionMode={() => {}}
        onRevokeGrant={() => {}}
        onRemoveProject={() => {}}
        onEditProjectMemory={() => {}}
        onClearChats={() => {}}
        onClearSessions={() => {}}
      />,
    );

    view.rerender(
      <SettingsPage
        settings={defaultSettings}
        chatModel="qwen3:8b"
        request={{ tab: "updates", id: 1 }}
        onUpdate={() => {}}
        onSelectChatModel={() => {}}
        projects={[]}
        activeProjectId={null}
        onAddProject={async () => null}
        onRenameProject={() => {}}
        onSetPermissionMode={() => {}}
        onRevokeGrant={() => {}}
        onRemoveProject={() => {}}
        onEditProjectMemory={() => {}}
        onClearChats={() => {}}
        onClearSessions={() => {}}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Updates" })).toBeTruthy();
  });
});

describe("Code's preferences", () => {
  it("writes thinking to Code's own field", async () => {
    const { onUpdate } = renderSettings("code");

    const thinking = screen.getByRole("radiogroup", { name: "Thinking" });
    await act(async () => within(thinking).getByRole("radio", { name: "Deep" }).click());

    expect(onUpdate).toHaveBeenCalledWith({ codeThinkingMode: "high" });
  });
});

describe("a project's settings", () => {
  it("has permissions, and no extensions or library of its own", () => {
    renderSettings("projects");

    expect(screen.getByRole("radiogroup", { name: "Permissions" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Extensions" })).toBeNull();
    // The project folder is what Code searches, so it has no library to index.
    expect(screen.queryByRole("heading", { name: "Library" })).toBeNull();
  });

  it("changes the permission mode of that project", async () => {
    const { onSetPermissionMode } = renderSettings("projects");

    await act(async () => screen.getByRole("radio", { name: /plan only/i }).click());

    expect(onSetPermissionMode).toHaveBeenCalledWith("weather", "plan");
  });

  it("asks before removing a project", async () => {
    const { onRemoveProject } = renderSettings("projects");

    await act(async () => screen.getByRole("button", { name: "Remove project" }).click());
    expect(onRemoveProject).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/sessions are deleted/i)).toBeTruthy();

    await act(async () => within(dialog).getByRole("button", { name: "Remove project" }).click());
    expect(onRemoveProject).toHaveBeenCalledWith("weather");
  });
});

describe("what a project always allows", () => {
  it("lists it, and takes it back", async () => {
    const { onRevokeGrant } = renderSettings("projects");

    expect(screen.getByText("npm test")).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Remove npm test" }).click());

    expect(onRevokeGrant).toHaveBeenCalledWith("weather", { tool: "run_command", target: "npm test" });
  });
});

describe("erasing data", () => {
  it("clears Chat's history alone, and only once confirmed", async () => {
    const { onClearChats, onClearSessions } = renderSettings("data");

    // The erase rows run Chat first, then Code.
    const [chatDelete] = screen.getAllByRole("button", { name: "Delete" });
    await act(async () => chatDelete.click());
    expect(onClearChats).not.toHaveBeenCalled();

    await act(async () =>
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }).click(),
    );

    expect(onClearChats).toHaveBeenCalledTimes(1);
    expect(onClearSessions).not.toHaveBeenCalled();
  });
});

describe("context window settings", () => {
  it("offers Automatic, Max, and bucket sizes", async () => {
    const { onUpdate } = renderSettings("models");

    const trigger = screen.getByRole("button", { name: "Context window" });
    await act(async () => trigger.click());

    const options = screen.getAllByRole("option");
    const optionLabels = options.map((opt) => opt.textContent?.trim());

    expect(optionLabels[0]).toBe("Automatic");
    expect(optionLabels[1]).toBe("Max");
    expect(optionLabels).toContain("32k");

    await act(async () => {
      const maxOption = options.find((opt) => opt.textContent?.includes("Max"));
      maxOption?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith({ fixedContextSize: "max" });

    await act(async () => trigger.click());
    await act(async () => {
      const bucketOption = screen.getAllByRole("option").find((opt) => opt.textContent?.includes("32k"));
      bucketOption?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith({ fixedContextSize: 32768 });

    await act(async () => trigger.click());
    await act(async () => {
      const autoOption = screen.getAllByRole("option").find((opt) => opt.textContent?.includes("Automatic"));
      autoOption?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith({ fixedContextSize: null });
  });
});
