import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeMcpTool, syncMcpTools } from "../tools/mcp";
import type { McpServerState, McpToolDescription } from "../tools/mcp";
import { allTools, registerTool, resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";

const ENVIRONMENT: ToolEnvironment = {
  webMode: "auto",
  codeExecution: false,
  libraryReady: false,
};

function context(): ToolContext {
  return {
    t: (key) => key,
    settings: {} as ToolContext["settings"],
    pushStep: () => {},
    patchStep: () => {},
    syncSteps: () => {},
    newId: () => "id",
    signal: new AbortController().signal,
    memo: new Map(),
  };
}

const tool = (over: Partial<McpToolDescription> = {}): McpToolDescription => ({
  name: "create_issue",
  qualifiedName: "github__create_issue",
  description: "Open an issue on a repository.",
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Which repository." },
      title: { type: "string", description: "Issue title." },
      count: { type: "integer", description: "How many." },
      draft: { type: "boolean", description: "Open as a draft." },
    },
    required: ["repo", "title"],
  },
  ...over,
});

const server = (over: Partial<McpServerState> = {}): McpServerState => ({
  id: "github",
  status: "ready",
  error: null,
  tools: [tool()],
  ...over,
});

beforeEach(() => {
  resetRegistry();
});

describe("describing an MCP tool to the registry", () => {
  const call = vi.fn(async () => ({ success: true, text: "done" }));

  it("takes the qualified name, so two servers can offer the same tool", () => {
    expect(describeMcpTool("github", tool(), call).name).toBe("github__create_issue");
  });

  it("puts every external tool in one group", () => {
    expect(describeMcpTool("github", tool(), call).group).toBe("external");
  });

  it("carries the scalar types across", () => {
    const spec = describeMcpTool("github", tool(), call);
    expect(spec.parameters.repo.type).toBe("string");
    expect(spec.parameters.count.type).toBe("integer");
    expect(spec.parameters.draft.type).toBe("boolean");
  });

  it("describes a type the registry has no word for as JSON", () => {
    const spec = describeMcpTool(
      "x",
      tool({
        inputSchema: {
          properties: { labels: { type: "array", description: "Labels." } },
          required: [],
        },
      }),
      call,
    );

    expect(spec.parameters.labels.type).toBe("string");
    expect(spec.parameters.labels.description).toContain("JSON");
  });

  it("lists the values of an enum, which a bare type would lose", () => {
    const spec = describeMcpTool(
      "x",
      tool({
        inputSchema: {
          properties: {
            state: { type: "string", description: "State.", enum: ["open", "closed"] },
          },
          required: [],
        },
      }) as McpToolDescription,
      call,
    );

    expect(spec.parameters.state.description).toContain("open, closed");
  });

  it("keeps the required list", () => {
    expect(describeMcpTool("github", tool(), call).required).toEqual(["repo", "title"]);
  });

  it("drops a required name that is not among the parameters", () => {
    // A server that contradicts itself would otherwise make every call fail
    // the registry's own argument check for a parameter the model cannot pass.
    const spec = describeMcpTool(
      "x",
      tool({
        inputSchema: {
          properties: { a: { type: "string" } },
          required: ["a", "ghost"],
        },
      }),
      call,
    );

    expect(spec.required).toEqual(["a"]);
  });

  it("copes with a tool that takes no arguments", () => {
    const spec = describeMcpTool("x", tool({ inputSchema: {} }), call);
    expect(spec.parameters).toEqual({});
    expect(spec.required).toEqual([]);
  });

  it("writes a description when the server gave none", () => {
    const spec = describeMcpTool("x", tool({ description: "" }), call);
    expect(spec.description).toContain("create_issue");
  });
});

describe("calling through to the server", () => {
  it("passes the unqualified name and the arguments", async () => {
    const call = vi.fn(async () => ({ success: true, text: "ok" }));
    const spec = describeMcpTool("github", tool(), call);

    await spec.run({ repo: "a/b", title: "Bug" }, context());

    expect(call).toHaveBeenCalledWith("github", "create_issue", {
      repo: "a/b",
      title: "Bug",
    });
  });

  it("returns what the tool said", async () => {
    const call = vi.fn(async () => ({ success: true, text: "Issue #4 opened" }));
    const spec = describeMcpTool("github", tool(), call);

    const result = await spec.run({ repo: "a/b", title: "Bug" }, context());
    expect(result).toContain("Issue #4 opened");
  });

  it("reports a failure in a way the model can act on", async () => {
    const call = vi.fn(async () => ({ success: false, error: "Bad credentials" }));
    const spec = describeMcpTool("github", tool(), call);

    const result = await spec.run({ repo: "a/b", title: "Bug" }, context());
    expect(result).toContain("Failed");
    expect(result).toContain("Bad credentials");
  });

  it("says so when the server has gone", async () => {
    const call = vi.fn(async () => undefined);
    const spec = describeMcpTool("github", tool(), call);

    const result = await spec.run({ repo: "a/b", title: "Bug" }, context());
    expect(result).toContain("unavailable");
  });
});

describe("keeping the registry in step with the running servers", () => {
  const call = vi.fn(async () => ({ success: true, text: "ok" }));

  it("registers the tools of a ready server", () => {
    expect(syncMcpTools([server()], call)).toBe(1);
    expect(allTools().map((spec) => spec.name)).toContain("github__create_issue");
  });

  it("ignores a server that is not ready", () => {
    expect(syncMcpTools([server({ status: "error" })], call)).toBe(0);
    expect(allTools()).toHaveLength(0);
  });

  it("removes the tools of a server that has stopped", () => {
    syncMcpTools([server()], call);
    expect(allTools()).toHaveLength(1);

    // A tool left in the catalogue after its server is gone is one the model
    // was told it could use and cannot.
    syncMcpTools([], call);
    expect(allTools()).toHaveLength(0);
  });

  it("keeps the tools of servers from more than one source apart", () => {
    const count = syncMcpTools(
      [
        server(),
        server({
          id: "slack",
          tools: [
            {
              name: "post_message",
              qualifiedName: "slack__post_message",
              description: "Post a message to a channel.",
              inputSchema: { properties: {}, required: [] },
            },
          ],
        }),
      ],
      call,
    );

    expect(count).toBe(2);
    expect(allTools().map((spec) => spec.name).sort()).toEqual([
      "github__create_issue",
      "slack__post_message",
    ]);
  });

  it("leaves the built-in tools alone", () => {
    const builtin = {
      name: "search_web",
      group: "web" as const,
      description: "Search.",
      parameters: {},
      required: [],
      usage: "{}",
      run: async () => "ok",
    };

    resetRegistry();
    syncMcpTools([server()], call);
    // Registering a built-in after the sync, then syncing again, must not take
    // it with the external ones.
    registerTool(builtin);

    syncMcpTools([], call);
    expect(allTools().map((spec) => spec.name)).toEqual(["search_web"]);
  });

  it("makes the tool callable through the registry", async () => {
    syncMcpTools([server()], call);

    const result = await runTool(
      "github__create_issue",
      { repo: "a/b", title: "Bug" },
      context(),
      ENVIRONMENT,
    );

    expect(result).toContain("ok");
  });

  it("still enforces required arguments", async () => {
    syncMcpTools([server()], call);

    const result = await runTool(
      "github__create_issue",
      { repo: "a/b" },
      context(),
      ENVIRONMENT,
    );

    expect(result).toContain("missing required argument");
  });
});
