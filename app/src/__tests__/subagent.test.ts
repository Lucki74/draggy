import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availableTools, resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import { capNestedSteps, capSummary, parseSubagentGroups, registerSubagentTools, runLabel, subagentSlots } from "../tools/subagent";

/** The subagent tool: offered to a top-level turn only, asks for named groups, and returns the
 * child's summary with its tool count. */

const TURN: ToolEnvironment = {
  webMode: "off",
  codeExecution: false,
  libraryReady: false,
};

const names = (environment: ToolEnvironment) => availableTools(environment).map((tool) => tool.name);

function contextWith(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    t: (key: string) => key,
    settings: { subagents: true } as ToolContext["settings"],
    pushStep: () => undefined,
    patchStep: () => undefined,
    syncSteps: () => undefined,
    newId: () => "id",
    signal: new AbortController().signal,
    memo: new Map(),
    ...overrides,
  };
}

describe("subagent tool", () => {
  beforeEach(() => {
    resetRegistry();
    registerSubagentTools();
  });

  afterEach(() => {
    resetRegistry();
    vi.restoreAllMocks();
  });

  it("is offered to a top-level turn", () => {
    expect(names(TURN)).toContain("run_subagent");
  });

  it("is not offered inside a subagent, nor in a read-only run", () => {
    expect(names({ ...TURN, subagentDepth: 1 })).not.toContain("run_subagent");
    expect(names({ ...TURN, readOnlyTools: true })).not.toContain("run_subagent");
  });

  it("parses the group list and refuses names a child may not have", () => {
    expect(parseSubagentGroups(undefined)).toEqual(["files"]);
    expect(parseSubagentGroups("files, code,files")).toEqual(["files", "code"]);
    expect(parseSubagentGroups("files,browser")).toBeNull();
    expect(parseSubagentGroups("agent")).toBeNull();
  });

  it("caps a long summary and keeps the start", () => {
    const long = "a".repeat(5000);
    const capped = capSummary(long);
    expect(capped.startsWith("a".repeat(4000))).toBe(true);
    expect(capped.endsWith("[summary cut]")).toBe(true);
    expect(capSummary("  short  ")).toBe("short");
  });

  it("hands the task to the child and returns its summary", async () => {
    const spawnSubagent = vi.fn(async () => ({ summary: "Found two readers.", toolCount: 3, status: "done" as const }));
    const result = await runTool(
      "run_subagent",
      { task: "Find config readers", label: "Readers", tools: "files,code" },
      contextWith({ spawnSubagent }),
      TURN,
    );
    expect(spawnSubagent).toHaveBeenCalledWith({
      task: "Find config readers",
      label: "Readers",
      groups: ["files", "code"],
      allowEdits: false,
    });
    expect(result).toBe("TOOL RESULT (run_subagent): Subagent done after 3 tool calls.\nFound two readers.");
  });

  it("refuses a bad group list without starting a child", async () => {
    const spawnSubagent = vi.fn();
    const result = await runTool("run_subagent", { task: "x", tools: "browser" }, contextWith({ spawnSubagent }), TURN);
    expect(result.startsWith("TOOL ERROR (run_subagent)")).toBe(true);
    expect(spawnSubagent).not.toHaveBeenCalled();
  });

  it("is turned off by the setting", async () => {
    const spawnSubagent = vi.fn();
    const result = await runTool(
      "run_subagent",
      { task: "x" },
      contextWith({ spawnSubagent, settings: { subagents: false } as ToolContext["settings"] }),
      TURN,
    );
    expect(result).toContain("turned off");
    expect(spawnSubagent).not.toHaveBeenCalled();
  });
  it("refuses a call from a depth-1 environment even when the tool is offered", async () => {
    const spawnSubagent = vi.fn();
    const result = await runTool(
      "run_subagent",
      { task: "x" },
      contextWith({ spawnSubagent, environment: { ...TURN, subagentDepth: 1 } }),
      TURN,
    );
    expect(result).toContain("cannot start another subagent");
    expect(spawnSubagent).not.toHaveBeenCalled();
  });
});

describe("subagent slots", () => {
  it("runs children one at a time on a local model, whatever the setting", () => {
    expect(subagentSlots(false, 4)).toBe(1);
    expect(subagentSlots(false, undefined)).toBe(1);
  });

  it("follows the setting, clamped to 1 to 4, on a remote model", () => {
    expect(subagentSlots(true, 3)).toBe(3);
    expect(subagentSlots(true, 9)).toBe(4);
    expect(subagentSlots(true, 0)).toBe(1);
  });
});

describe("run label", () => {
  it("collapses line breaks and falls back to the task start", () => {
    expect(runLabel(undefined, "Find the\nconfig   readers")).toBe("Find the config readers");
    expect(runLabel("  Readers\n", "task")).toBe("Readers");
    expect(runLabel("", "a".repeat(80))).toHaveLength(60);
  });
});

describe("nested child steps", () => {
  it("keeps only the tail of a 1 MB read so the saved chat stays small", () => {
    const big = "x".repeat(1_000_000);
    const [step] = capNestedSteps([{ id: "r", type: "reading", fileContent: big } as never]);
    expect(step.fileContent?.length).toBe(20000);
    expect(JSON.stringify(capNestedSteps([{ id: "r", type: "reading", fileContent: big } as never])).length).toBeLessThan(21000);
  });
});
