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

describe("browser tool failures", () => {
  const failure = {
    ok: false,
    error: { code: "element_not_found", message: "No element has that index.", hint: "Call browser_get_elements again." },
  };

  function stubBrowser(methods: Record<string, unknown>) {
    vi.stubGlobal("window", { electronAPI: methods });
  }

  it("gives the model the reason and the hint when a click fails", async () => {
    stubBrowser({ browserClick: vi.fn().mockResolvedValue(failure) });

    const { context } = harness();
    const result = await runTool("browser_click", { index: 3 }, context, ALL_ON);

    expect(result).toContain("No element has that index.");
    expect(result).toContain("Call browser_get_elements again.");
  });

  it("does the same for a refused navigation", async () => {
    stubBrowser({
      browserNavigate: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "refused_url", message: "Private address.", hint: "Use a public address." },
      }),
    });

    const { context } = harness();
    const result = await runTool("browser_navigate", { url: "http://10.0.0.1/" }, context, ALL_ON);

    expect(result).toContain("Private address.");
    expect(result).toContain("Use a public address.");
  });

  it("reports a successful click with the page it landed on", async () => {
    stubBrowser({ browserClick: vi.fn().mockResolvedValue({ ok: true, title: "Cart", url: "https://shop.test/cart" }) });

    const { context } = harness();
    const result = await runTool("browser_click", { index: 0 }, context, ALL_ON);

    expect(result).toContain('Clicked. Page: "Cart"');
  });
});

describe("browser snapshot and screenshot tools", () => {
  function stubBrowser(methods: Record<string, unknown>) {
    vi.stubGlobal("window", { electronAPI: methods });
  }

  it("hands the model the snapshot text", async () => {
    const browserSnapshot = vi.fn().mockResolvedValue({ ok: true, title: "Shop", url: "https://shop.test/", text: 'e1 button "Buy"', total: 1, omitted: 0 });
    stubBrowser({ browserSnapshot });
    const { context } = harness();
    const result = await runTool("browser_snapshot", { scope: "e4", maxItems: 20 }, context, ALL_ON);
    expect(browserSnapshot).toHaveBeenCalledWith({ scope: "e4", maxItems: 20 });
    expect(result).toContain('e1 button "Buy"');
  });

  it("attaches the screenshot for a vision model", async () => {
    const browserScreenshot = vi.fn().mockResolvedValue({ ok: true, data: "JPEG", width: 800, height: 600, url: "https://shop.test/" });
    stubBrowser({ browserScreenshot });
    const { context } = harness();
    const attachImage = vi.fn();
    const result = await runTool("browser_screenshot", { mode: "full", marks: true }, { ...context, vision: true, attachImage }, ALL_ON);
    expect(browserScreenshot).toHaveBeenCalledWith({ mode: "full", ref: undefined, marks: true });
    expect(attachImage).toHaveBeenCalledWith("JPEG");
    expect(result).toContain("800x600");
  });

  it("skips the capture and points a text-only model to the snapshot", async () => {
    const browserScreenshot = vi.fn();
    stubBrowser({ browserScreenshot });
    const { context } = harness();
    const result = await runTool("browser_screenshot", {}, { ...context, vision: false }, ALL_ON);
    expect(browserScreenshot).not.toHaveBeenCalled();
    expect(result).toContain("browser_snapshot");
  });

  it("passes a ref to click and to get_text", async () => {
    const browserClick = vi.fn().mockResolvedValue({ ok: true, title: "Cart", url: "u" });
    const browserGetText = vi.fn().mockResolvedValue({ ok: true, title: "t", url: "u", text: "hello" });
    stubBrowser({ browserClick, browserGetText });
    const { context } = harness();
    await runTool("browser_click", { ref: "e7" }, context, ALL_ON);
    await runTool("browser_get_text", { ref: "e7", selector: "main" }, context, ALL_ON);
    expect(browserClick).toHaveBeenCalledWith("e7");
    expect(browserGetText).toHaveBeenCalledWith({ ref: "e7", selector: "main" });
  });
});
