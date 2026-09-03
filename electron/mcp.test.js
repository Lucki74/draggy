import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  createLineReader,
  renderToolResult,
  qualifiedName,
  splitQualifiedName,
} = require("./mcp.cjs");
const catalogue = require("./mcpCatalogue.cjs");

describe("reading JSON-RPC off a pipe", () => {
  function collect() {
    const seen = [];
    return { seen, push: createLineReader((message) => seen.push(message)) };
  }

  it("reads one whole message", () => {
    const { seen, push } = collect();
    push('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
    expect(seen).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
  });

  it("reads several messages from one chunk", () => {
    const { seen, push } = collect();
    push('{"id":1}\n{"id":2}\n{"id":3}\n');
    expect(seen.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("holds back a message split across two chunks", () => {
    const { seen, push } = collect();

    push('{"id":1,"resu');
    expect(seen).toHaveLength(0);

    push('lt":"done"}\n');
    expect(seen).toEqual([{ id: 1, result: "done" }]);
  });

  it("waits for the newline before delivering anything", () => {
    const { seen, push } = collect();
    push('{"id":1}');
    expect(seen).toHaveLength(0);
  });

  it("ignores the plain logging servers write to stdout", () => {
    const { seen, push } = collect();
    push('Server listening on stdio\n{"id":1}\nanother stray line\n');
    expect(seen).toEqual([{ id: 1 }]);
  });

  it("ignores blank lines", () => {
    const { seen, push } = collect();
    push('\n\n{"id":1}\n\n');
    expect(seen).toHaveLength(1);
  });

  it("carries on after a line of broken JSON", () => {
    const { seen, push } = collect();
    push('{"id":1,"broken":\n{"id":2}\n');
    expect(seen.map((m) => m.id)).toEqual([2]);
  });
});

describe("flattening a tool result", () => {
  it("returns the text of a single block", () => {
    expect(renderToolResult({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
  });

  it("joins several text blocks", () => {
    expect(
      renderToolResult({
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
      }),
    ).toBe("first\n\nsecond");
  });

  it("names an image rather than dropping it silently", () => {
    // A model told nothing came back concludes the tool failed and calls again.
    const text = renderToolResult({
      content: [{ type: "image", mimeType: "image/png", data: "..." }],
    });
    expect(text).toContain("image returned");
    expect(text).toContain("image/png");
  });

  it("reads the text out of an embedded resource", () => {
    expect(
      renderToolResult({
        content: [
          { type: "resource", resource: { uri: "file:///a.txt", text: "contents" } },
        ],
      }),
    ).toBe("contents");
  });

  it("names a resource that carries no text", () => {
    expect(
      renderToolResult({
        content: [{ type: "resource", resource: { uri: "file:///a.bin" } }],
      }),
    ).toContain("file:///a.bin");
  });

  it("falls back to structured content when there are no text blocks", () => {
    expect(
      renderToolResult({ content: [], structuredContent: { rows: 3 } }),
    ).toBe('{"rows":3}');
  });

  it("returns nothing for an empty or malformed result", () => {
    expect(renderToolResult(null)).toBe("");
    expect(renderToolResult({})).toBe("");
    expect(renderToolResult({ content: "not an array" })).toBe("");
  });
});

describe("qualified tool names", () => {
  it("prefixes the tool with the server it came from", () => {
    expect(qualifiedName("github", "create_issue")).toBe("github__create_issue");
  });

  it("replaces characters that cannot appear in a tool name", () => {
    expect(qualifiedName("brave-search", "web.search")).toBe("brave_search__web_search");
  });

  it("round-trips", () => {
    const name = qualifiedName("slack", "post_message");
    expect(splitQualifiedName(name)).toEqual({
      serverId: "slack",
      toolName: "post_message",
    });
  });

  it("keeps a tool name that itself contains the separator", () => {
    expect(splitQualifiedName("memory__create__entities")).toEqual({
      serverId: "memory",
      toolName: "create__entities",
    });
  });

  it("has nothing to split when there is no prefix", () => {
    expect(splitQualifiedName("search_web")).toBeNull();
  });
});

describe("the server catalogue", () => {
  const entries = catalogue.listCatalogue();

  it("offers a useful number of servers", () => {
    expect(entries.length).toBeGreaterThanOrEqual(25);
  });

  it("gives every server a unique id", () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not duplicate anything the app already does", () => {
    // Draggy searches the web, reads pages and drives a browser on its own. A
    // second way to do those is a tool the model has to choose between.
    const overlapping = /brave|duckduckgo|puppeteer|playwright|browserbase/i;
    for (const entry of entries) {
      expect(entry.id, `${entry.id} overlaps a built-in feature`).not.toMatch(overlapping);
    }
  });

  it("links every server to its package documentation", () => {
    for (const entry of entries) {
      expect(entry.docs, entry.id).toBe(
        `https://www.npmjs.com/package/${entry.package}`,
      );
    }
  });

  it("links to the service, where there is one behind it", () => {
    // Memory and sequential thinking have no service, and say so by omission.
    for (const entry of entries) {
      if (entry.site === undefined) continue;
      expect(entry.site, entry.id).toMatch(/^https:\/\//);
    }
  });

  it("gives the servers that talk to a service a website", () => {
    const local = new Set(["filesystem", "memory", "sequential-thinking"]);
    for (const entry of entries) {
      if (local.has(entry.id)) continue;
      expect(entry.site, `${entry.id} has no website`).toBeTruthy();
    }
  });

  it("names a package for every server", () => {
    for (const entry of entries) {
      expect(entry.package, entry.id).toBeTruthy();
      expect(entry.package, entry.id).not.toMatch(/\s/);
    }
  });

  it("describes every server in a sentence", () => {
    for (const entry of entries) {
      expect(entry.name, entry.id).toBeTruthy();
      expect(entry.description.length, entry.id).toBeGreaterThan(20);
    }
  });

  it("gives every credential a label and marks the secret ones", () => {
    for (const entry of entries) {
      for (const variable of entry.env || []) {
        expect(variable.key, entry.id).toMatch(/^[A-Z0-9_]+$/);
        expect(variable.label, `${entry.id}.${variable.key}`).toBeTruthy();
      }
    }
  });

  it("finds a server by id", () => {
    expect(catalogue.findEntry("github")?.name).toBe("GitHub");
    expect(catalogue.findEntry("nope")).toBeNull();
  });
});

describe("searching the catalogue", () => {
  it("matches on name", () => {
    const found = catalogue.searchCatalogue("github");
    expect(found.map((entry) => entry.id)).toContain("github");
  });

  it("matches on what a server does", () => {
    expect(catalogue.searchCatalogue("transcript").length).toBeGreaterThan(0);
  });

  it("matches on the package name", () => {
    const found = catalogue.searchCatalogue("supabase");
    expect(found.map((entry) => entry.id)).toContain("supabase");
  });

  it("ignores case", () => {
    expect(catalogue.searchCatalogue("SLACK").map((e) => e.id)).toContain("slack");
  });

  it("returns everything for an empty search", () => {
    expect(catalogue.searchCatalogue("")).toHaveLength(catalogue.listCatalogue().length);
  });
});

describe("knowing when a server can start", () => {
  const github = catalogue.findEntry("github");
  const memory = catalogue.findEntry("memory");
  const filesystem = catalogue.findEntry("filesystem");

  it("says nothing is missing for a server that needs nothing", () => {
    expect(catalogue.missingRequirements(memory, {})).toEqual([]);
  });

  it("names the credential that has not been entered", () => {
    expect(catalogue.missingRequirements(github, {})).toEqual([
      "GitHub personal access token",
    ]);
  });

  it("is satisfied once the credential is there", () => {
    expect(
      catalogue.missingRequirements(github, {
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x" },
      }),
    ).toEqual([]);
  });

  it("treats whitespace as not entered", () => {
    expect(
      catalogue.missingRequirements(github, {
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "   " },
      }),
    ).toHaveLength(1);
  });

  it("wants at least one folder for a server that takes a list", () => {
    expect(catalogue.missingRequirements(filesystem, {})).toHaveLength(1);
    expect(
      catalogue.missingRequirements(filesystem, { arguments: { roots: [] } }),
    ).toHaveLength(1);
    expect(
      catalogue.missingRequirements(filesystem, { arguments: { roots: ["C:/work"] } }),
    ).toEqual([]);
  });

  it("says so for a server that does not exist", () => {
    expect(catalogue.missingRequirements(null, {})).toHaveLength(1);
  });
});

describe("building the command line", () => {
  it("runs the package through npx", () => {
    const spec = catalogue.commandFor(catalogue.findEntry("memory"), {});
    expect(spec.args).toEqual(["-y", "@modelcontextprotocol/server-memory"]);
  });

  it("leaves how npx is launched to the platform", () => {
    // Windows cannot spawn the `npx.cmd` shim at all, so the launcher is
    // resolved in platform.cjs rather than named here.
    const spec = catalogue.commandFor(catalogue.findEntry("memory"), {});
    expect(spec.command).toBeUndefined();
  });

  it("keeps the fixed arguments an entry declares", () => {
    const spec = catalogue.commandFor(catalogue.findEntry("figma"), {
      env: { FIGMA_API_KEY: "x" },
    });
    expect(spec.args).toContain("--stdio");
  });

  it("appends every folder of a list argument", () => {
    const spec = catalogue.commandFor(catalogue.findEntry("filesystem"), {
      arguments: { roots: ["C:/one", "C:/two"] },
    });
    expect(spec.args.slice(-2)).toEqual(["C:/one", "C:/two"]);
  });

  it("skips a blank entry in a list", () => {
    const spec = catalogue.commandFor(catalogue.findEntry("filesystem"), {
      arguments: { roots: ["C:/one", "", "  "] },
    });
    expect(spec.args.slice(-1)).toEqual(["C:/one"]);
  });

  it("passes the credentials through as environment", () => {
    const spec = catalogue.commandFor(catalogue.findEntry("github"), {
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_secret" },
    });
    expect(spec.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_secret");
  });

  it("has no command for a server that does not exist", () => {
    expect(catalogue.commandFor(null, {})).toBeNull();
  });
});

describe("launching npx", () => {
  const platform = require("./platform.cjs");

  it("finds a launcher on a machine that has npm", () => {
    const npx = platform.resolveNpx();
    expect(npx, "npm should be present in a dev environment").not.toBeNull();
    expect(npx.file).toBeTruthy();
    expect(npx.prefixArgs[0]).toMatch(/npx-cli\.js$/);
  });

  it("never returns the shell shim, which cannot be spawned", () => {
    // Node has refused to spawn a .cmd since the CVE-2024-27980 fix, so
    // pointing at npx.cmd here is what made every server fail with EINVAL.
    const npx = platform.resolveNpx();
    expect(npx.file).not.toMatch(/\.cmd$/i);
    for (const arg of npx.prefixArgs) expect(arg).not.toMatch(/\.cmd$/i);
  });

  it("runs the launcher as plain Node", () => {
    expect(platform.resolveNpx().asNode).toBe(true);
  });
});
