import { describe, expect, it } from "vitest";
import { pickExploreModel } from "../agent/subagent";
import { registerExploreTools } from "../tools/explore";
import { availableTools, resetRegistry, registerTool } from "../tools/registry";
import type { InstalledModel } from "../ollama";
import type { ToolEnvironment } from "../tools/registry";

/**
 * The second model. Its whole reason for existing is context: the reading
 * happens elsewhere and only the answer comes back, so what matters is that it
 * is smaller, that it cannot act, and that it cannot start another one.
 */

const model = (
  name: string,
  size: number,
  capabilities = ["tools"],
): InstalledModel => ({
  name,
  size,
  parameterSize: "",
  family: "",
  capabilities,
});

describe("choosing who does the looking", () => {
  it("takes a much smaller model over the one in use", () => {
    const installed = [model("qwen3:30b", 30), model("qwen3:4b", 4)];

    expect(pickExploreModel(installed, "qwen3:30b")).toBe("qwen3:4b");
  });

  it("stays with the loaded model when the alternative is barely smaller", () => {
    // Swapping models costs a load; it has to buy more than it costs.
    const installed = [model("qwen3:8b", 8), model("qwen3:7b", 7)];

    expect(pickExploreModel(installed, "qwen3:8b")).toBe("qwen3:8b");
  });

  it("ignores a model that cannot call tools", () => {
    const installed = [model("qwen3:8b", 8), model("tiny:1b", 1, [])];

    expect(pickExploreModel(installed, "qwen3:8b")).toBe("qwen3:8b");
  });

  it("ignores an embedding model, which cannot hold a conversation", () => {
    const installed = [
      model("qwen3:8b", 8),
      model("nomic-embed-text", 1, ["tools", "embedding"]),
    ];

    expect(pickExploreModel(installed, "qwen3:8b")).toBe("qwen3:8b");
  });

  it("keeps the current model when nothing else is installed", () => {
    expect(pickExploreModel([], "qwen3:8b")).toBe("qwen3:8b");
  });
});

describe("what an exploration is allowed to do", () => {
  const PROJECT: ToolEnvironment = {
    webMode: "auto",
    codeExecution: true,
    libraryReady: false,
    hasFolder: true,
  };

  const reader = {
    name: "read_thing",
    group: "files" as const,
    description: "Reads.",
    parameters: {},
    required: [],
    usage: "",
    annotations: { readOnly: true },
    run: async () => "read",
  };

  const writer = {
    name: "write_thing",
    group: "files" as const,
    description: "Writes.",
    parameters: {},
    required: [],
    usage: "",
    annotations: {},
    run: async () => "wrote",
  };

  it("keeps only the tools that change nothing", () => {
    resetRegistry();
    registerTool(reader);
    registerTool(writer);

    const names = availableTools({ ...PROJECT, readOnlyTools: true }).map(
      (tool) => tool.name,
    );

    expect(names).toEqual(["read_thing"]);
  });

  it("drops a tool that never said what it does", () => {
    resetRegistry();
    registerTool({ ...reader, name: "unknown_thing", annotations: undefined });

    expect(availableTools({ ...PROJECT, readOnlyTools: true })).toEqual([]);
  });

  it("cannot start another exploration from inside one", () => {
    resetRegistry();
    registerExploreTools();

    expect(availableTools(PROJECT).map((tool) => tool.name)).toEqual(["explore"]);
    expect(availableTools({ ...PROJECT, readOnlyTools: true })).toEqual([]);
  });

  it("is not offered in a conversation with no folder", () => {
    resetRegistry();
    registerExploreTools();

    expect(
      availableTools({ webMode: "auto", codeExecution: false, libraryReady: false }),
    ).toEqual([]);
  });
});
