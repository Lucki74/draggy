import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRepoMapCache, extractSymbols, getRepoMap, parseIgnore, queryRepoMap, REPO_MAP_MAX_DEPTH, REPO_MAP_MAX_FILE_BYTES, REPO_MAP_MAX_FILES, REPO_MAP_MAX_SYMBOLS, REPO_MAP_SAFETY_TTL_MS } from "../project/repoMap";
import { registerFileTools } from "../tools/files";
import { resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";

/** A fake file bridge: a tree of folders and files, served through list and read. */
interface Tree {
  [name: string]: string | Tree;
}

function fakeBridge(tree: Tree) {
  const get = (path: string): string | Tree | undefined => {
    let node: string | Tree | undefined = tree;
    for (const part of path === "." || path === "" ? [] : path.split("/")) {
      if (!node || typeof node === "string") return undefined;
      node = node[part];
    }
    return node;
  };
  const listeners: Array<(change: { workspaceId: string; path: string; from?: string }) => void> = [];
  return {
    onChanged: vi.fn((callback: (typeof listeners)[number]) => {
      listeners.push(callback);
      return () => undefined;
    }),
    emit: (change: { workspaceId: string; path: string; from?: string }) => listeners.forEach((l) => l(change)),
    list: vi.fn(async (_ws: string, path = ".") => {
      const node = get(path);
      if (!node || typeof node === "string") return { success: false };
      const entries = Object.entries(node).map(([name, value]) => ({
        name,
        path: path === "." ? name : `${path}/${name}`,
        isDirectory: typeof value !== "string",
        size: typeof value === "string" ? value.length : 0,
        modified: 0,
      }));
      return { success: true, entries };
    }),
    read: vi.fn(async (_ws: string, path: string) => {
      const node = get(path);
      if (typeof node !== "string") return { success: false, error: "missing" };
      return { success: true, text: node };
    }),
  };
}

describe("repo map", () => {
  beforeEach(() => {
    clearRepoMapCache();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts exported declarations from TypeScript with line numbers", () => {
    const text = "import x from 'y';\nexport function useSession() {}\nexport const LIMIT = 3;\nfunction hidden() {}\nexport interface Turn {}\n";
    expect(extractSymbols("src/a.ts", text)).toEqual([
      { path: "src/a.ts", line: 2, kind: "function", name: "useSession" },
      { path: "src/a.ts", line: 3, kind: "const", name: "LIMIT" },
      { path: "src/a.ts", line: 5, kind: "type", name: "Turn" },
    ]);
  });

  it("extracts pub items from Rust, def and class from Python, and func from Go", () => {
    expect(extractSymbols("core/x.rs", "pub fn run() {}\nfn private() {}\npub struct Map {}\n").map((s) => s.name)).toEqual(["run", "Map"]);
    expect(extractSymbols("tool.py", "def load():\n    pass\nclass Repo:\n    pass\n").map((s) => s.kind)).toEqual(["def", "class"]);
    expect(extractSymbols("main.go", "func Serve() {}\ntype Store struct {}\n").map((s) => s.name)).toEqual(["Serve", "Store"]);
  });

  it("honours plain, directory and glob .gitignore rules", () => {
    const ignored = parseIgnore("# comment\nsecret.ts\nbuild-out/\n*.gen.ts\n");
    expect(ignored("secret.ts", false)).toBe(true);
    expect(ignored("a/secret.ts", false)).toBe(true);
    expect(ignored("build-out", true)).toBe(true);
    expect(ignored("build-out", false)).toBe(false);
    expect(ignored("api.gen.ts", false)).toBe(true);
    expect(ignored("api.ts", false)).toBe(false);
  });

  it("skips dot folders, node_modules and gitignored files, and keeps source files only", async () => {
    vi.stubGlobal("window", {
      draggy: {
        files: fakeBridge({
          ".gitignore": "private.ts\n",
          "a.ts": "export function alpha() {}",
          "private.ts": "export function hidden() {}",
          "notes.md": "# not code",
          node_modules: { "dep.ts": "export function dep() {}" },
          ".git": { "hook.ts": "export function git() {}" },
          src: { "b.rs": "pub fn beta() {}" },
        }),
      },
    });
    const map = await getRepoMap("ws");
    expect(map.files).toBe(2);
    expect(map.symbols.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("serves the cache inside the TTL and rebuilds after it", async () => {
    const bridge = fakeBridge({ "a.ts": "export function one() {}" });
    vi.stubGlobal("window", { draggy: { files: bridge } });
    await getRepoMap("ws");
    const calls = bridge.list.mock.calls.length;
    await getRepoMap("ws");
    expect(bridge.list.mock.calls.length).toBe(calls);

    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(realNow() + REPO_MAP_SAFETY_TTL_MS + 1);
    await getRepoMap("ws");
    expect(bridge.list.mock.calls.length).toBeGreaterThan(calls);
  });

  it("filters by query and caps the number of lines", () => {
    const map = {
      builtAt: 0,
      files: 2,
      truncated: false,
      reasons: [],
      symbols: [
        { path: "src/a.ts", line: 1, kind: "function", name: "useSession" },
        { path: "src/b.ts", line: 4, kind: "const", name: "other" },
      ],
    };
    expect(queryRepoMap(map, "session")).toBe("src/a.ts:1 function useSession");
    expect(queryRepoMap(map, "nothing")).toContain('No symbol matches "nothing"');
    expect(queryRepoMap(map, "", 1)).toContain("1 more, narrow the query");
  });

  it("ranks exact names first, then prefixes, then substrings", () => {
    const map = {
      builtAt: 0,
      files: 1,
      truncated: false,
      reasons: [],
      symbols: [
        { path: "a.ts", line: 1, kind: "function", name: "useSessionStore" },
        { path: "b.ts", line: 2, kind: "function", name: "loadSession" },
        { path: "c.ts", line: 3, kind: "function", name: "session" },
      ],
    };
    expect(queryRepoMap(map, "session").split("\n").map((row) => row.split(" ").pop())).toEqual(["session", "useSessionStore", "loadSession"]);
  });

  it("states why the map is partial", () => {
    const map = { builtAt: 0, files: 1, truncated: true, reasons: ["more than 2000 files"], symbols: [] };
    expect(queryRepoMap(map, "anything")).toContain("Map is partial: more than 2000 files");
  });

  it("supports ** globs, ? and negated rules", () => {
    const ignored = parseIgnore("**/gen/*.ts\nlog?.txt\n*.log\n!keep.log\n");
    expect(ignored("src/gen/a.ts", false)).toBe(true);
    expect(ignored("log1.txt", false)).toBe(true);
    expect(ignored("debug.log", false)).toBe(true);
    expect(ignored("keep.log", false)).toBe(false);
  });

  it("shares one walk between concurrent callers", async () => {
    const bridge = fakeBridge({ "a.ts": "export function alpha() {}" });
    vi.stubGlobal("window", { draggy: { files: bridge } });
    const [first, second] = await Promise.all([getRepoMap("ws"), getRepoMap("ws")]);
    expect(first).toBe(second);
    expect(bridge.list.mock.calls.length).toBe(1);
  });

  it("reports symbol, depth and size limits", async () => {
    const many = Array.from({ length: REPO_MAP_MAX_SYMBOLS + 100 }, (_, i) => `export const c${i} = ${i};`).join("\n");
    let deep: Tree = { "leaf.ts": "export function leaf() {}" };
    for (let level = 8; level >= 1; level--) deep = { [`d${level}`]: deep };
    vi.stubGlobal("window", { draggy: { files: fakeBridge({ "many.ts": many, "big.ts": "x".repeat(REPO_MAP_MAX_FILE_BYTES + 1), deep }) } });
    const map = await getRepoMap("ws");
    expect(map.symbols.length).toBe(REPO_MAP_MAX_SYMBOLS);
    expect(map.reasons).toEqual(expect.arrayContaining([`more than ${REPO_MAP_MAX_SYMBOLS} symbols`, "files over 200 KB", `folders deeper than ${REPO_MAP_MAX_DEPTH} levels`]));
    expect(map.symbols.some((s) => s.name === "leaf")).toBe(false);
  });

  it("forces a full rebuild on request", async () => {
    const bridge = fakeBridge({ "a.ts": "export function alpha() {}" });
    vi.stubGlobal("window", { draggy: { files: bridge } });
    await getRepoMap("ws");
    const lists = bridge.list.mock.calls.length;
    await getRepoMap("ws", true);
    expect(bridge.list.mock.calls.length).toBeGreaterThan(lists);
  });

  it("skips a file that fails to read and keeps the rest", async () => {
    const bridge = fakeBridge({ "ok.ts": "export function ok() {}", "bad.ts": "export function bad() {}" });
    const realRead = bridge.read;
    bridge.read = vi.fn(async (ws: string, path: string) => (path === "bad.ts" ? { success: false, error: "gone" } : realRead(ws, path)));
    vi.stubGlobal("window", { draggy: { files: bridge } });
    const map = await getRepoMap("ws");
    expect(map.symbols.map((s) => s.name)).toEqual(["ok"]);
  });

  it("accepts Windows separators in watcher paths", async () => {
    const tree: Tree = { src: { "a.ts": "export function one() {}" } };
    const bridge = fakeBridge(tree);
    vi.stubGlobal("window", { draggy: { files: bridge } });
    await getRepoMap("ws");
    (tree.src as Tree)["a.ts"] = "export function two() {}";
    bridge.emit({ workspaceId: "ws", path: "src\\a.ts" });
    const map = await getRepoMap("ws");
    expect(map.symbols.map((s) => s.name)).toEqual(["two"]);
  });

  it("serves the repo_map tool through the registry", async () => {
    vi.stubGlobal("window", { draggy: { files: fakeBridge({ "src": { "app.ts": "export function useSession() {}" } }) } });
    registerFileTools();
    const context = {
      t: (key: string) => key,
      settings: {},
      workspaceId: "ws",
      pushStep: () => undefined,
      patchStep: () => undefined,
      syncSteps: () => undefined,
      newId: () => "id",
      signal: new AbortController().signal,
      memo: new Map(),
    } as unknown as ToolContext;
    const environment = { codeExecution: false, libraryReady: false, hasFolder: true } as unknown as ToolEnvironment;
    const output = await runTool("repo_map", { query: "useSession" }, context, environment);
    expect(output).toContain("src/app.ts:1 function useSession");
    resetRegistry();
  });

  it("reports the file limit in the map", async () => {
    const tree: Tree = {};
    for (let i = 0; i < REPO_MAP_MAX_FILES + 5; i++) tree[`f${i}.ts`] = "export const x = 1;";
    vi.stubGlobal("window", { draggy: { files: fakeBridge(tree) } });
    const map = await getRepoMap("ws");
    expect(map.truncated).toBe(true);
    expect(map.reasons).toContain(`more than ${REPO_MAP_MAX_FILES} files`);
  });

  it("re-reads only the file the watcher reports, and drops deleted files", async () => {
    const tree: Tree = { "a.ts": "export function alpha() {}", "b.ts": "export function beta() {}" };
    const bridge = fakeBridge(tree);
    vi.stubGlobal("window", { draggy: { files: bridge } });
    await getRepoMap("ws");
    const reads = bridge.read.mock.calls.length;

    tree["a.ts"] = "export function alphaRenamed() {}";
    bridge.emit({ workspaceId: "ws", path: "a.ts" });
    const changed = await getRepoMap("ws");
    expect(bridge.read.mock.calls.length - reads).toBe(1);
    expect(changed.symbols.map((s) => s.name).sort()).toEqual(["alphaRenamed", "beta"]);

    delete tree["b.ts"];
    bridge.emit({ workspaceId: "ws", path: "b.ts" });
    const removed = await getRepoMap("ws");
    expect(removed.symbols.map((s) => s.name)).toEqual(["alphaRenamed"]);
  });

  it("moves symbols when the watcher reports a rename", async () => {
    const tree: Tree = { "old.ts": "export function moved() {}" };
    const bridge = fakeBridge(tree);
    vi.stubGlobal("window", { draggy: { files: bridge } });
    await getRepoMap("ws");

    tree["new.ts"] = tree["old.ts"];
    delete tree["old.ts"];
    bridge.emit({ workspaceId: "ws", path: "new.ts", from: "old.ts" });
    const map = await getRepoMap("ws");
    expect(map.symbols.map((s) => s.path)).toEqual(["new.ts"]);
  });

  it("ignores events for other workspaces and untracked files", async () => {
    const tree: Tree = { "a.ts": "export function alpha() {}", "notes.md": "# text" };
    const bridge = fakeBridge(tree);
    vi.stubGlobal("window", { draggy: { files: bridge } });
    await getRepoMap("ws");
    const reads = bridge.read.mock.calls.length;

    bridge.emit({ workspaceId: "other", path: "a.ts" });
    bridge.emit({ workspaceId: "ws", path: "notes.md" });
    await getRepoMap("ws");
    expect(bridge.read.mock.calls.length).toBe(reads);
  });

  it("rebuilds fully when the .gitignore changes", async () => {
    const tree: Tree = { "a.ts": "export function alpha() {}" };
    const bridge = fakeBridge(tree);
    vi.stubGlobal("window", { draggy: { files: bridge } });
    await getRepoMap("ws");
    const lists = bridge.list.mock.calls.length;

    bridge.emit({ workspaceId: "ws", path: ".gitignore" });
    await getRepoMap("ws");
    expect(bridge.list.mock.calls.length).toBeGreaterThan(lists);
  });

  it("does not re-read a file that is gitignored after a change", async () => {
    const tree: Tree = { ".gitignore": "private.ts\n", "private.ts": "export function secret() {}" };
    const bridge = fakeBridge(tree);
    vi.stubGlobal("window", { draggy: { files: bridge } });
    const map = await getRepoMap("ws");
    expect(map.symbols).toEqual([]);

    bridge.emit({ workspaceId: "ws", path: "private.ts" });
    const after = await getRepoMap("ws");
    expect(after.symbols).toEqual([]);
  });
});
