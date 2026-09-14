// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import ExtensionsPanel from "../extensions/ExtensionsPanel";
import SkillsTab from "../extensions/SkillsTab";
import RemoteServers from "../extensions/RemoteServers";
import { translations } from "../translations";

/** The extensions screen: a remote server is labelled before it is switched on, and switches are
 * global, the same for Chat and every project. */

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
    render(<ExtensionsPanel t={t} />);

    expect(screen.getByRole("tab", { name: "Servers" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Remote" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Skills" })).toBeTruthy();
  });

  it("switches to the skills it knows about", async () => {
    stubBridge();
    render(<ExtensionsPanel t={t} />);

    await act(async () => screen.getByRole("tab", { name: "Skills" }).click());

    expect(screen.getByText("No skills yet")).toBeTruthy();
  });
});

describe("the skills list", () => {
  const SHELF = [
    {
      id: "invoices",
      name: "Invoices",
      description: "How we invoice.",
      path: "C:\\skills\\invoices",
      source: "user",
      surface: "both",
      enabled: true,
    },
    {
      id: "release",
      name: "Release",
      description: "How we release.",
      path: "C:\\project\\.draggy\\skills\\release",
      source: "project",
      surface: "both",
      enabled: true,
    },
    {
      id: "proofreader",
      name: "proofreader",
      description: "Corrects spelling and grammar.",
      path: "C:\\draggy\\skills-library\\proofreader",
      source: "library",
      category: "writing",
      surface: "chat",
      enabled: true,
    },
    {
      id: "dockerfile",
      name: "dockerfile",
      description: "Containerises applications.",
      path: "C:\\draggy\\skills-library\\dockerfile",
      source: "library",
      category: "code",
      surface: "code",
      enabled: false,
    },
  ];

  function stubSkills() {
    const setEnabled = vi.fn(async () => ({ success: true }));
    const read = vi.fn(async (_workspace: string, id: string) => ({
      success: true,
      skill: { ...SHELF.find((one) => one.id === id), body: `Steps for ${id}.`, files: ["checklist.md"] },
    }));

    vi.stubGlobal("window", {
      electronAPI: {
        skills: {
          list: async () => ({ success: true, skills: SHELF }),
          read,
          setEnabled,
          openFolder: async () => "",
        },
      },
    });

    return { setEnabled, read };
  }

  async function show() {
    await act(async () => {
      render(<SkillsTab workspaceId="w1" t={t} />);
    });
  }

  it("groups the project's, the user's and the library's under their own headings", async () => {
    stubSkills();
    await show();

    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);

    expect(headings).toEqual(["This project", "Your skills", "Writing", "Code"]);
    expect(screen.getByText("3 of 4 switched on")).toBeTruthy();
  });

  it("says which side a library skill belongs to", async () => {
    stubSkills();
    await show();

    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByText("Code", { selector: "span" })).toBeTruthy();
  });

  it("switches a skill for the whole app when its switch is flipped", async () => {
    const { setEnabled } = stubSkills();
    await show();

    const toggle = screen.getByRole("switch", { name: "dockerfile" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => fireEvent.click(toggle));

    expect(setEnabled).toHaveBeenCalledWith("dockerfile", true);
    expect(screen.getByRole("switch", { name: "dockerfile" }).getAttribute("aria-checked")).toBe("true");
  });

  it("finds a skill by what it does, and by whether it is on", async () => {
    stubSkills();
    await show();

    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), { target: { value: "grammar" } });
    expect(screen.getByText("proofreader")).toBeTruthy();
    expect(screen.queryByText("Invoices")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Off" }));
    expect(screen.getByText("dockerfile")).toBeTruthy();
    expect(screen.queryByText("proofreader")).toBeNull();
  });

  it("shows a skill's instructions and files without switching it on", async () => {
    const { read, setEnabled } = stubSkills();
    await show();

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Instructions: dockerfile" })),
    );

    expect(read).toHaveBeenCalledWith("w1", "dockerfile");
    expect(screen.getByText("Steps for dockerfile.")).toBeTruthy();
    expect(screen.getByText("checklist.md")).toBeTruthy();
    expect(setEnabled).not.toHaveBeenCalled();
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

  it("lists a saved remote server by its address", () => {
    stubBridge();
    render(
      <RemoteServers
        config={config}
        enabled={[]}
        t={t}
        onChanged={() => {}}
      />,
    );

    expect(screen.getByText("https://tickets.example/mcp")).toBeTruthy();
  });

  it("switches on for the whole app, not for one workspace", async () => {
    const calls = stubBridge();
    render(<RemoteServers config={config} enabled={[]} t={t} onChanged={() => {}} />);

    await act(async () => screen.getByRole("checkbox", { name: "Tickets" }).click());

    expect(calls).toContainEqual({ method: "setEnabled", args: ["tickets", true] });
  });

  it("signs in through the server it was given", async () => {
    const calls = stubBridge();
    render(
      <RemoteServers
        config={config}
        enabled={[]}
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
