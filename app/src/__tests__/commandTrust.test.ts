import { beforeEach, describe, expect, it, vi } from "vitest";

/** A workspace's own commands run only once the user trusts that folder. */

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});
vi.mock("../logger", () => ({ logRendererEvent: vi.fn(), logSwallow: vi.fn() }));

const projectFile = { name: "review.md", path: ".draggy/agents/review.md", isDirectory: false };
const body = "---\ndescription: Reviews\n---\nCheck the diff.";
const files = {
  list: vi.fn(async () => ({ success: true, entries: [projectFile] })),
  read: vi.fn(async () => ({ success: true, text: body })),
};
vi.stubGlobal("window", { draggy: { files }, confirm: vi.fn(() => false) });

const store_ = await import("../chat/customCommandStore");
const { getCustomCommands, loadCustomCommands, setCommandTrustPrompt } = store_;

describe("project command trust", () => {
  beforeEach(() => {
    store.clear();
    files.list.mockClear();
    files.read.mockClear();
    setCommandTrustPrompt(async () => false);
  });

  it("loads nothing when the folder is not trusted", async () => {
    await loadCustomCommands("ws-1");
    expect(getCustomCommands().map((c) => [c.id, c.source])).toEqual([]);
    expect(files.list).not.toHaveBeenCalled();
  });

  it("asks once and remembers a refusal for that folder", async () => {
    const ask = vi.fn(async () => false);
    setCommandTrustPrompt(ask);
    await loadCustomCommands("ws-1");
    await loadCustomCommands("ws-1");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(store.get("commandTrust:ws-1")).toBe("no");
  });

  it("loads the folder's agents after the user trusts it, and remembers that", async () => {
    const ask = vi.fn(async () => true);
    setCommandTrustPrompt(ask);
    await loadCustomCommands("ws-2");
    expect(getCustomCommands().map((c) => [c.id, c.source])).toEqual([["review", "project"]]);
    await loadCustomCommands("ws-2");
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("keeps trust per folder", async () => {
    store.set("commandTrust:ws-3", "yes");
    setCommandTrustPrompt(async () => false);
    await loadCustomCommands("ws-3");
    expect(getCustomCommands().some((c) => c.source === "project")).toBe(true);
    await loadCustomCommands("ws-4");
    expect(getCustomCommands().some((c) => c.source === "project")).toBe(false);
  });
});
