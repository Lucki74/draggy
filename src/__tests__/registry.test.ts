import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  allToolNames,
  availableTools,
  describeToolsForPrompt,
  isBrowsingTool,
  registerTool,
  resetRegistry,
  runTool,
  toolDefinitions,
  unregisterGroup,
  unregisterTool,
} from "../tools/registry";
import type { ToolContext, ToolEnvironment, ToolSpec } from "../tools/registry";

const ALL_ON: ToolEnvironment = {
  webMode: "auto",
  codeExecution: true,
  libraryReady: true,
};

const WEB_OFF: ToolEnvironment = { ...ALL_ON, webMode: "off" };

function makeContext(): ToolContext {
  return {
    t: (key) => key,
    settings: {} as never,
    pushStep: vi.fn(),
    patchStep: vi.fn(),
    syncSteps: vi.fn(),
    newId: () => "id",
    signal: new AbortController().signal,
  memo: new Map<string, unknown>(),
  };
}

const echo: ToolSpec = {
  name: "echo",
  group: "files",
  description: "Echo a value back.",
  parameters: { value: { type: "string", description: "Anything." } },
  required: ["value"],
  usage: 'echo: {"value": "hi"} → returns the value',
  run: async (args) => `TOOL RESULT (echo): ${args.value}`,
};

const webby: ToolSpec = {
  ...echo,
  name: "webby",
  group: "web",
  available: (environment) => environment.webMode !== "off",
};

const codey: ToolSpec = {
  ...echo,
  name: "codey",
  group: "code",
  available: (environment) => environment.codeExecution,
};

beforeEach(() => {
  resetRegistry();
});

describe("registration", () => {
  it("adds a tool at runtime", () => {
    registerTool(echo);
    expect(allToolNames()).toContain("echo");
  });

  it("replaces a tool registered twice under the same name", () => {
    registerTool(echo);
    registerTool({ ...echo, description: "changed" });

    expect(allToolNames().filter((name) => name === "echo")).toHaveLength(1);
    expect(toolDefinitions(ALL_ON)[0].function.description).toBe("changed");
  });

  it("removes a single tool", () => {
    registerTool(echo);
    unregisterTool("echo");
    expect(allToolNames()).toEqual([]);
  });

  it("removes a whole group, which is how an MCP server disconnects", () => {
    registerTool(echo);
    registerTool({ ...echo, name: "remote_a", group: "external" });
    registerTool({ ...echo, name: "remote_b", group: "external" });

    unregisterGroup("external");

    expect(allToolNames()).toEqual(["echo"]);
  });
});

describe("availability", () => {
  it("hides web tools when web access is off", () => {
    registerTool(webby);
    registerTool(echo);

    expect(availableTools(WEB_OFF).map((tool) => tool.name)).toEqual(["echo"]);
  });

  it("hides the code runner unless it is switched on", () => {
    registerTool(codey);

    expect(availableTools({ ...ALL_ON, codeExecution: false })).toHaveLength(0);
    expect(availableTools(ALL_ON)).toHaveLength(1);
  });

  it("classifies browsing tools by group", () => {
    registerTool(webby);
    registerTool(echo);

    expect(isBrowsingTool("webby")).toBe(true);
    expect(isBrowsingTool("echo")).toBe(false);
    expect(isBrowsingTool("nonexistent")).toBe(false);
  });
});

describe("derived artefacts stay in step with the registry", () => {
  it("builds native schemas from the same source as the text prompt", () => {
    registerTool(echo);
    registerTool(webby);

    const names = availableTools(ALL_ON).map((tool) => tool.name);
    const schemaNames = toolDefinitions(ALL_ON).map((entry) => entry.function.name);
    const prompt = describeToolsForPrompt(ALL_ON);

    expect(schemaNames).toEqual(names);
    for (const name of names) expect(prompt).toContain(name);
  });

  it("omits disabled tools from both the schema list and the prompt", () => {
    registerTool(echo);
    registerTool(webby);

    expect(toolDefinitions(WEB_OFF).map((e) => e.function.name)).not.toContain("webby");
    expect(describeToolsForPrompt(WEB_OFF)).not.toContain("webby");
  });

  it("produces an empty prompt when nothing is available", () => {
    registerTool(webby);
    expect(describeToolsForPrompt(WEB_OFF)).toBe("");
  });

  it("emits a valid JSON schema shape", () => {
    registerTool(echo);
    const [definition] = toolDefinitions(ALL_ON);

    expect(definition.type).toBe("function");
    expect(definition.function.parameters.type).toBe("object");
    expect(definition.function.parameters.required).toEqual(["value"]);
  });
});

describe("dispatch", () => {
  it("runs a registered tool", async () => {
    registerTool(echo);
    const result = await runTool("echo", { value: "hi" }, makeContext(), ALL_ON);
    expect(result).toBe("TOOL RESULT (echo): hi");
  });

  it("reports an unknown tool with the list of real ones", async () => {
    registerTool(echo);
    const result = await runTool("nope", {}, makeContext(), ALL_ON);

    expect(result).toContain("no tool called");
    expect(result).toContain("echo");
  });

  it("names the missing arguments instead of failing silently", async () => {
    registerTool(echo);
    const result = await runTool("echo", {}, makeContext(), ALL_ON);
    expect(result).toContain("missing required argument(s): value");
  });

  it("explains that web access is off rather than pretending to search", async () => {
    registerTool(webby);
    const result = await runTool("webby", { value: "x" }, makeContext(), WEB_OFF);
    expect(result).toContain("Web access is turned off");
  });

  it("turns a thrown error into a tool result rather than crashing the turn", async () => {
    registerTool({
      ...echo,
      name: "boom",
      run: async () => {
        throw new Error("disk on fire");
      },
    });

    const result = await runTool("boom", { value: "x" }, makeContext(), ALL_ON);
    expect(result).toContain("disk on fire");
  });

  it("rejects an empty-string argument as missing", async () => {
    registerTool(echo);
    const result = await runTool("echo", { value: "" }, makeContext(), ALL_ON);
    expect(result).toContain("missing required argument");
  });
});
