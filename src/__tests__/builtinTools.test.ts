import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBuiltinTools } from "../tools/builtin";
import {
  availableTools,
  describeToolsForPrompt,
  resetRegistry,
  runTool,
  toolDefinitions,
} from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import type { SearchStep } from "../types";

const ALL_ON: ToolEnvironment = {
  webMode: "auto",
  codeExecution: true,
  libraryReady: true,
};

function harness() {
  const steps: SearchStep[] = [];

  const context: ToolContext = {
    t: (key) => key,
    settings: {} as never,
    pushStep: (step) => steps.push(step),
    patchStep: (id, patch) => {
      const index = steps.findIndex((entry) => entry.id === id);
      if (index !== -1) steps[index] = { ...steps[index], ...patch };
    },
    syncSteps: () => {},
    newId: () => `step-${steps.length}`,
    signal: new AbortController().signal,
  memo: new Map<string, unknown>(),
  };

  return { context, steps };
}

function stubApi(runner: unknown) {
  vi.stubGlobal("window", { electronAPI: { runner } });
}

beforeEach(() => {
  resetRegistry();
  registerBuiltinTools();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("run_code availability", () => {
  it("is offered when code execution is on", () => {
    expect(availableTools(ALL_ON).map((t) => t.name)).toContain("run_code");
  });

  it("is hidden when code execution is off", () => {
    const off = { ...ALL_ON, codeExecution: false };
    expect(availableTools(off).map((t) => t.name)).not.toContain("run_code");
  });

  it("appears in the native tool schemas", () => {
    const schema = toolDefinitions(ALL_ON).find((e) => e.function.name === "run_code");

    expect(schema).toBeDefined();
    expect(schema?.function.parameters.required).toEqual(["language", "source"]);
  });

  it("appears in the text-mode prompt", () => {
    expect(describeToolsForPrompt(ALL_ON)).toContain("run_code");
  });
});

describe("run_code execution", () => {
  it("returns the program output to the model", async () => {
    stubApi({
      run: vi.fn().mockResolvedValue({
        success: true, exitCode: 0, stdout: "42\n", stderr: "",
        durationMs: 30, timedOut: false, language: "python",
      }),
    });

    const { context, steps } = harness();
    const result = await runTool(
      "run_code",
      { language: "python", source: "print(42)" },
      context,
      ALL_ON,
    );

    expect(result).toContain("exit code 0");
    expect(result).toContain("42");
    expect(steps.some((s) => s.type === "run_code")).toBe(true);
  });

  it("records the source and output on the step so the UI can show them", async () => {
    stubApi({
      run: vi.fn().mockResolvedValue({
        success: true, exitCode: 0, stdout: "hi\n", stderr: "warn\n",
        durationMs: 12, timedOut: false,
      }),
    });

    const { context, steps } = harness();
    await runTool("run_code", { language: "python", source: "print('hi')" }, context, ALL_ON);

    const step = steps.find((s) => s.type === "run_code");
    expect(step?.fileContent).toBe("print('hi')");
    expect(step?.language).toBe("python");
    expect(step?.stdout).toBe("hi\n");
    expect(step?.stderr).toBe("warn\n");
    expect(step?.isComplete).toBe(true);
  });

  it("passes the language and source through to the runner", async () => {
    const run = vi.fn().mockResolvedValue({ success: true, exitCode: 0, stdout: "", stderr: "" });
    stubApi({ run });

    const { context } = harness();
    await runTool("run_code", { language: "javascript", source: "console.log(1)" }, context, ALL_ON);

    expect(run).toHaveBeenCalledWith("javascript", "console.log(1)", expect.any(Number));
  });

  it("reports a non-zero exit so the model can fix its code", async () => {
    stubApi({
      run: vi.fn().mockResolvedValue({
        success: false, exitCode: 1, stdout: "", stderr: "NameError: x",
        durationMs: 20, timedOut: false,
      }),
    });

    const { context, steps } = harness();
    const result = await runTool("run_code", { language: "python", source: "print(x)" }, context, ALL_ON);

    expect(result).toContain("exit code 1");
    expect(result).toContain("NameError");
    expect(steps.find((s) => s.type === "run_code")?.stderr).toContain("NameError");
  });

  it("reports a timeout distinctly", async () => {
    stubApi({
      run: vi.fn().mockResolvedValue({
        success: false, exitCode: 1, stdout: "", stderr: "", timedOut: true, durationMs: 20000,
      }),
    });

    const { context } = harness();
    const result = await runTool("run_code", { language: "python", source: "while True: pass" }, context, ALL_ON);

    expect(result).toMatch(/still running|stopped/i);
  });

  it("explains when the runner cannot start at all", async () => {
    stubApi({
      run: vi.fn().mockResolvedValue({
        success: false,
        error: 'Python is not installed on this machine, so Python code cannot be run here.',
      }),
    });

    const { context } = harness();
    const result = await runTool("run_code", { language: "python", source: "print(1)" }, context, ALL_ON);

    expect(result).toContain("Could not run");
    expect(result).toContain("Python is not installed");
  });

  it("says so when the bridge is missing entirely", async () => {
    vi.stubGlobal("window", {});

    const { context } = harness();
    const result = await runTool("run_code", { language: "python", source: "print(1)" }, context, ALL_ON);

    expect(result).toContain("unavailable");
  });

  it("refuses to run with no source", async () => {
    stubApi({ run: vi.fn() });

    const { context } = harness();
    const result = await runTool("run_code", { language: "python" }, context, ALL_ON);

    expect(result).toContain("missing required argument");
  });

  it("tells the model the tool is off rather than failing silently", async () => {
    stubApi({ run: vi.fn() });

    const { context } = harness();
    const result = await runTool(
      "run_code",
      { language: "python", source: "print(1)" },
      context,
      { ...ALL_ON, codeExecution: false },
    );

    expect(result).toContain("not enabled");
  });
});
