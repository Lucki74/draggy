import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_TOOLS, serialized } from "../tools/memory";
import { setFolderTrusted, USER_MEMORY_KEY } from "../project/autoMemory";

const tool = MEMORY_TOOLS[0];
const store = new Map<string, string>();
let writes: unknown[][] = [];
let reads: string[] = [];

function ctx(extra: Record<string, unknown> = {}) {
  return {
    environment: {},
    permissionMode: "default",
    workspaceId: "ws1",
    projectRoot: "/repo",
    chatId: "chat-7",
    pushStep: () => undefined,
    newId: () => "s1",
    t: (key: string) => key,
    ...extra,
  } as never;
}

beforeEach(() => {
  store.clear();
  writes = [];
  reads = [];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.stubGlobal("window", {
    draggy: {
      files: {
        read: async (workspaceId: string, path: string) => {
          reads.push(`${workspaceId}:${path}`);
          return { success: true, text: "" };
        },
        write: async (...args: unknown[]) => {
          writes.push(args);
          return { success: true };
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("save_memory run", () => {
  it("saves a note with no switch to turn auto memory off", async () => {
    const result = await tool.run({ scope: "user", action: "add", text: "Likes tabs" }, ctx());
    expect(String(result)).not.toMatch(/off/);
    expect(store.size).toBe(1);
  });

  it("refuses writes in plan mode", async () => {
    const result = await tool.run({ scope: "user", action: "add", text: "Likes tabs" }, ctx({ permissionMode: "plan" }));
    expect(String(result)).toMatch(/Plan mode/);
    expect(store.size).toBe(0);
  });

  it("rejects an unknown scope", async () => {
    const result = await tool.run({ scope: "team", action: "add", text: "x" }, ctx());
    expect(String(result)).toMatch(/Scope must be/);
  });

  it("needs an open folder for project notes", async () => {
    const result = await tool.run({ scope: "project", action: "add", text: "x" }, ctx({ workspaceId: undefined, projectRoot: undefined }));
    expect(String(result)).toMatch(/need an open folder/);
  });

  it("refuses project notes in an untrusted folder without reading the file", async () => {
    const result = await tool.run({ scope: "project", action: "add", text: "x" }, ctx());
    expect(String(result)).toMatch(/not trusted/);
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("passes the chat id through when saving project notes in a trusted folder", async () => {
    setFolderTrusted("ws1", true);
    await tool.run({ scope: "project", action: "add", text: "Uses pnpm" }, ctx());
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("ws1");
    expect(writes[0][3]).toBe("chat-7");
  });

  it("lists every note, including ones the prompt would hide", async () => {
    const long = "lorem ipsum ".repeat(7).trim();
    store.set(USER_MEMORY_KEY, Array.from({ length: 30 }, (_, index) => `- [m${index + 1}] ${long}`).join("\n"));
    const result = String(await tool.run({ scope: "user", action: "list" }, ctx()));
    expect(result).toContain("[m1]");
    expect(result).toContain("[m30]");
  });

  it("removes a hidden note by id", async () => {
    const long = "lorem ipsum ".repeat(7).trim();
    store.set(USER_MEMORY_KEY, Array.from({ length: 30 }, (_, index) => `- [m${index + 1}] ${long}`).join("\n"));
    const result = String(await tool.run({ scope: "user", action: "remove", id: "m1" }, ctx()));
    expect(result).toMatch(/Saved to user notes/);
    expect(store.get(USER_MEMORY_KEY)).not.toContain("[m1]");
  });
});

describe("serialized writes", () => {
  it("keeps both notes when two adds interleave", async () => {
    const order: string[] = [];
    const first = serialized("user", async () => {
      order.push("first start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("first end");
      return "a";
    });
    const second = serialized("user", async () => {
      order.push("second start");
      return "b";
    });
    expect(await Promise.all([first, second])).toEqual(["a", "b"]);
    expect(order).toEqual(["first start", "first end", "second start"]);
  });

  it("keeps the queue moving after a failed job", async () => {
    await expect(serialized("k", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await serialized("k", async () => "next")).toBe("next");
  });
});
