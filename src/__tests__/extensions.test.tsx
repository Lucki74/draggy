// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ExtensionsPanel from "../extensions/ExtensionsPanel";
import SkillsTab from "../extensions/SkillsTab";
import RemoteServers from "../extensions/RemoteServers";
import { translations } from "../translations";

/**
 * The one screen for everything that extends Draggy. What the tests hold to:
 * a remote server is labelled as one before it is switched on, and a switch
 * belongs to the workspace rather than to the app.
 */

const t = (key: string) => translations.en[key] || key;

function stubBridge(overrides: Record<string, unknown> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];

  const record =
    (method: string, answer: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return answer;
    };

  vi.stubGlobal("window", {
    electronAPI: {
      mcp: {
        catalogue: record("catalogue", { servers: [] }),
        config: record("config", { config: {} }),
        running: record("running", { servers: [] }),
        enabled: record("enabled", { success: true, ids: [] }),
        setEnabled: record("setEnabled", { success: true, ids: [] }),
        save: record("save", { success: true }),
        forget: record("forget", { success: true }),
        signIn: record("signIn", { success: true }),
        signOut: record("signOut", { success: true }),
        search: record("search", { success: true, entries: [] }),
        start: record("start", {}),
        stop: record("stop", {}),
        ...overrides,
      },
      skills: {
        list: record("skills.list", { success: true, skills: [] }),
        openFolder: record("skills.openFolder", ""),
      },
    },
  });

  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the three lists", () => {
  it("opens on the servers Draggy ships", async () => {
    stubBridge();
    render(<ExtensionsPanel workspaceId="w1" t={t} />);

    expect(screen.getByRole("tab", { name: "Servers" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Remote" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Skills" })).toBeTruthy();
  });

  it("switches to the skills it knows about", async () => {
    stubBridge();
    render(<ExtensionsPanel workspaceId="w1" t={t} />);

    await act(async () => screen.getByRole("tab", { name: "Skills" }).click());

    expect(screen.getByText("No skills yet")).toBeTruthy();
  });
});

describe("the skills list", () => {
  it("says where each one applies", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        skills: {
          list: async () => ({
            success: true,
            skills: [
              {
                id: "invoices",
                name: "Invoices",
                description: "How we invoice.",
                path: "C:\\skills\\invoices",
                source: "user",
              },
              {
                id: "release",
                name: "Release",
                description: "How we release.",
                path: "C:\\project\\.draggy\\skills\\release",
                source: "project",
              },
            ],
          }),
          openFolder: async () => "",
        },
      },
    });

    await act(async () => {
      render(<SkillsTab workspaceId="w1" t={t} />);
    });

    expect(screen.getByText("Invoices")).toBeTruthy();
    expect(screen.getByText("Everywhere")).toBeTruthy();
    expect(screen.getByText("This project")).toBeTruthy();
  });
});

describe("a server somewhere else", () => {
  const config = {
    tickets: {
      enabled: false,
      env: {},
      arguments: {},
      url: "https://tickets.example/mcp",
      name: "Tickets",
    },
  };

  it("says plainly that it leaves the machine", () => {
    stubBridge();
    render(
      <RemoteServers
        config={config}
        enabled={[]}
        workspaceId="w1"
        t={t}
        onChanged={() => {}}
      />,
    );

    expect(screen.getByText(/leaves this machine/i)).toBeTruthy();
    expect(screen.getByText("https://tickets.example/mcp")).toBeTruthy();
  });

  it("switches on for this workspace, not for the app", async () => {
    const calls = stubBridge();
    render(
      <RemoteServers
        config={config}
        enabled={[]}
        workspaceId="w1"
        t={t}
        onChanged={() => {}}
      />,
    );

    await act(async () => screen.getByRole("checkbox", { name: "Tickets" }).click());

    expect(calls).toContainEqual({
      method: "setEnabled",
      args: ["w1", "tickets", true],
    });
  });

  it("signs in through the server it was given", async () => {
    const calls = stubBridge();
    render(
      <RemoteServers
        config={config}
        enabled={[]}
        workspaceId="w1"
        t={t}
        onChanged={() => {}}
      />,
    );

    await act(async () => screen.getByRole("button", { name: "Sign in" }).click());

    expect(calls).toContainEqual({ method: "signIn", args: ["tickets"] });
  });

  it("saves a new one with the address the user typed", async () => {
    const calls = stubBridge();
    const { container } = render(
      <RemoteServers
        config={{}}
        enabled={[]}
        workspaceId="w1"
        t={t}
        onChanged={() => {}}
      />,
    );

    const inputs = container.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "Our tools" } });
    fireEvent.change(inputs[1], { target: { value: "https://tools.example/mcp" } });

    await act(async () => screen.getByRole("button", { name: "Add" }).click());

    const saved = calls.find((call) => call.method === "save");
    expect(saved?.args[0]).toBe("our-tools");
    expect(saved?.args[1]).toMatchObject({
      url: "https://tools.example/mcp",
      name: "Our tools",
      // Never on by default: a remote server waits to be asked.
      enabled: false,
    });
  });
});
