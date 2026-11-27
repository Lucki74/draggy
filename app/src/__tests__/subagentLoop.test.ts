import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireSubagent, resetTailNotesForTests, runAgentTurn } from "../agent/agentLoop";
import { forgetContextSize, forgetModelInfo } from "../llama";
import { registerSubagentTools } from "../tools/subagent";
import type { ToolEnvironment } from "../tools/registry";
import { registerTools, resetRegistry } from "../tools/registry";
import type { AgentHost } from "../agent/agentLoop";
import type { AppSettings, Message, SearchStep } from "../types";

/** A parent turn that calls run_subagent, a child turn that answers, then the parent's final answer. */
const MODEL = "subagent-test-model";
const ENVIRONMENT = { webMode: "off" as const, codeExecution: false, libraryReady: false };
const SETTINGS = { subagents: true, subagentConcurrency: 2, customInstructions: [], researchModelStart: true, researchMaxDepth: "deep", researchKeep: "forever", theme: "light", accent: "vermilion", defaultEffort: "medium", codeInstructions: [], codeEffort: "medium", codeWebMode: "on", codePermissionMode: "acceptEdits", codeModel: "", libraryEnabled: true, embedModel: "", showMetrics: false, fitContext: 8192, compactLimit: null, fixedContextSize: null, webMode: "on" } as unknown as AppSettings;

interface Turn {
  content?: string;
  /** The model request fails with a server error. */
  fail?: boolean;
  toolCall?: { name: string; arguments: Record<string, unknown> };
}

/** Streams one scripted pass in llama-server's SSE shape. */
function sse(turn: Turn): Response {
  const chunks: unknown[] = [];
  if (turn.toolCall) {
    chunks.push({
      choices: [{
        delta: { tool_calls: [{ index: 0, id: "call_0", function: { name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.arguments) } }] },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      timings: { predicted_ms: 100, predicted_n: 5, prompt_ms: 10, prompt_n: 10 },
    });
  } else {
    chunks.push({ choices: [{ delta: { content: turn.content ?? "" }, finish_reason: null }] });
    chunks.push({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      timings: { predicted_ms: 100, predicted_n: 5, prompt_ms: 10, prompt_n: 10 },
    });
  }
  chunks.push("[DONE]");
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) return controller.close();
      controller.enqueue(encoder.encode(`data: ${typeof chunks[index] === "string" ? chunks[index] : JSON.stringify(chunks[index])}\n\n`));
      index += 1;
    },
  });
  return new Response(body, { status: 200 });
}

/** Scripts the model in order and records every request body it received. */
function scriptModel(turns: Turn[]) {
  const requests: { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] }[] = [];
  let next = 0;
  vi.stubGlobal("window", {
    draggy: {
      gguf: {
        status: async () => ({ running: true, model: MODEL, contextSize: 32768 }),
        start: async () => ({ success: true }),
        listModels: async () => [{ filename: MODEL, contextLength: 32768, blockCount: 32, architecture: "gguf", fileType: 0, capabilities: ["tools"] }],
      },
    },
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== "draggy-ai://chat") throw new Error(`unexpected fetch to ${url}`);
    requests.push(JSON.parse(String(init?.body)));
    const turn = turns[Math.min(next++, turns.length - 1)];
    if (turn.fail) return new Response("model unavailable", { status: 500 });
    return sse(turn);
  }));
  return requests;
}

function makeHost(answer: "no" | "once" = "no") {
  let steps: SearchStep[] = [];
  /** Tools that asked the user, in order. The parent's own run_subagent is always allowed. */
  const approvals: string[] = [];
  const host: AgentHost = {
    t: (key) => key,
    onPatch: (patch) => {
      steps = patch.steps;
    },
    onSteps: (next) => {
      steps = next;
    },
    onOutOfContext: () => undefined,
    onMetrics: () => undefined,
    requestApproval: async (request) => {
      if (request.tool === "run_subagent") return "once";
      approvals.push(request.tool);
      return answer;
    },
  };
  return { host, approvals, get steps() { return steps; } };
}

const PARENT_QUESTION: Message = { id: "u1", role: "user", content: "Where is the config?" };

async function runTurn(
  settings: AppSettings = SETTINGS,
  environment: ToolEnvironment = ENVIRONMENT,
  permission?: { mode: "plan" | "ask" | "acceptEdits" | "auto" },
  answer: "no" | "once" = "no",
) {
  const host = makeHost(answer);
  const result = await runAgentTurn(
    {
      model: MODEL,
      settings,
      environment,
      messages: [PARENT_QUESTION],
      compaction: null,
      permission,
      signal: new AbortController().signal,
    },
    host.host,
  );
  return { ...host, result };
}

beforeEach(() => {
  resetTailNotesForTests();
  resetRegistry();
  registerSubagentTools();
  forgetModelInfo(MODEL);
  forgetContextSize(MODEL);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("run_subagent through the agent loop with a scripted model", () => {
  const SUBAGENT_CALL: Turn = {
    toolCall: { name: "run_subagent", arguments: { task: "Find the config file", label: "Config", tools: "files" } },
  };

  it("runs the child with a fresh context and returns its summary to the parent", async () => {
    const requests = scriptModel([
      SUBAGENT_CALL,
      { content: "The config is in settings.json." },
      { content: "It is settings.json." },
    ]);

    const { steps } = await runTurn();

    const child = steps.find((step) => step.type === "subagent");
    expect(child?.subagent?.status).toBe("done");
    expect(child?.subagent?.summary).toBe("The config is in settings.json.");
    expect(child?.subagent?.readOnly).toBe(true);
    expect(child?.isComplete).toBe(true);

    // The child's request holds only its task, not the parent's question.
    const childRequest = requests[1];
    const childText = JSON.stringify(childRequest.messages);
    expect(childText).toContain("Find the config file");
    expect(childText).not.toContain("Where is the config?");
    // And it cannot start another child.
    expect(childRequest.tools?.map((tool) => tool.function.name) ?? []).not.toContain("run_subagent");
  });

  it("keeps the child's own steps nested under its step", async () => {
    scriptModel([SUBAGENT_CALL, { content: "Done." }, { content: "Final." }]);
    const { steps } = await runTurn();
    const child = steps.find((step) => step.type === "subagent");
    expect(Array.isArray(child?.subagent?.steps)).toBe(true);
    expect(steps.filter((step) => step.type === "subagent")).toHaveLength(1);
  });

  it("reports a child whose asked-for groups are all closed here, without a model call", async () => {
    const requests = scriptModel([
      { toolCall: { name: "run_subagent", arguments: { task: "Read the files", tools: "files" } } },
      { content: "Nothing to read." },
    ]);
    const { steps } = await runTurn(SETTINGS, { ...ENVIRONMENT, allowedGroups: ["agent", "web"] });
    expect(steps.some((step) => step.type === "subagent")).toBe(false);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages)).toContain("did not run");
  });

  it("counts the child's tool calls in the parent turn's statistics", async () => {
    scriptModel([
      SUBAGENT_CALL,
      { toolCall: { name: "read_file", arguments: { path: "settings.json" } } },
      { content: "Found it." },
      { content: "Done." },
    ]);
    const { result } = await runTurn();
    expect(result.toolCalls.run_subagent).toBe(1);
    expect(result.toolCalls.read_file).toBe(1);
  });

  it("does not start an editing child from a plan-mode turn", async () => {
    const requests = scriptModel([
      { toolCall: { name: "run_subagent", arguments: { task: "Fix the config", tools: "files", allow_edits: true } } },
      { content: "Plan only." },
    ]);
    const { steps } = await runTurn(SETTINGS, ENVIRONMENT, { mode: "plan" });
    expect(steps.some((step) => step.type === "subagent")).toBe(false);
    expect(requests.length).toBeGreaterThan(0);
  });

  it("gives the child only the groups asked for, never the shell tools when files only", async () => {
    const requests = scriptModel([SUBAGENT_CALL, { content: "Found." }, { content: "Done." }]);
    await runTurn();
    const names = requests[1].tools?.map((tool) => tool.function.name) ?? [];
    expect(names).not.toContain("run_command");
    expect(names).not.toContain("run_subagent");
  });

  it("gives a child no group its parent lacks, even when it asks for one", async () => {
    const web: Turn = { toolCall: { name: "run_subagent", arguments: { task: "Look it up", label: "Web", tools: "web,files" } } };
    const requests = scriptModel([web, { content: "Nothing." }, { content: "Done." }]);
    await runTurn(SETTINGS, { ...ENVIRONMENT, allowedGroups: ["agent", "files"] });
    const names = requests[1].tools?.map((tool) => tool.function.name) ?? [];
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("run_subagent");
  });

  it("reports a child that fails as a failed summary to the parent", async () => {
    // Every call after the parent's fails, so the child's retries never reach a real answer.
    scriptModel([SUBAGENT_CALL, { fail: true }]);
    const host = makeHost();
    // The parent's own next call fails too, so the turn rejects after the child has settled.
    await expect(
      runAgentTurn({ model: MODEL, settings: SETTINGS, environment: ENVIRONMENT, messages: [PARENT_QUESTION], compaction: null, signal: new AbortController().signal }, host.host),
    ).rejects.toThrow();
    const child = host.steps.find((step) => step.type === "subagent");
    expect(child?.subagent?.status).toBe("failed");
    expect(child?.subagent?.summary).toBeTruthy();
  });

  it("stops the child when the parent is stopped during it", async () => {
    const controller = new AbortController();
    scriptModel([SUBAGENT_CALL, { content: "partial" }, { content: "never" }]);
    const fetchMock = vi.mocked(globalThis.fetch);
    const original = fetchMock.getMockImplementation();
    let calls = 0;
    fetchMock.mockImplementation(async (url, init) => {
      calls += 1;
      if (calls === 2) controller.abort();
      return original!(url as string, init);
    });
    const host = makeHost();
    await runAgentTurn(
      { model: MODEL, settings: SETTINGS, environment: ENVIRONMENT, messages: [PARENT_QUESTION], compaction: null, signal: controller.signal },
      host.host,
    );
    // The parent returns on stop while the child settles, so wait for the child's last patch.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const child = host.steps.find((step) => step.type === "subagent");
    expect(child?.subagent?.status).toBe("stopped");
    expect(child?.isComplete).toBe(true);
  });

  it("hands the abort to a child tool still running when the parent is stopped", async () => {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const probe = { seen: false };
    registerTools([{
      name: "hang_probe",
      group: "files",
      description: "Never finishes unless the run is stopped.",
      parameters: {},
      required: [],
      usage: "hang_probe()",
      annotations: { readOnlyHint: true },
      run: (_args, context) => new Promise<string>((resolve) => {
        markStarted();
        context.signal.addEventListener("abort", () => {
          probe.seen = context.signal.aborted;
          resolve("TOOL RESULT (hang_probe): stopped");
        });
      }),
    }]);
    scriptModel([SUBAGENT_CALL, { toolCall: { name: "hang_probe", arguments: {} } }, { content: "never" }]);
    const host = makeHost();
    const run = runAgentTurn(
      { model: MODEL, settings: SETTINGS, environment: ENVIRONMENT, messages: [PARENT_QUESTION], compaction: null, signal: controller.signal },
      host.host,
    );
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error("probe never started")), 5000))]);
    controller.abort();
    await run;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const child = host.steps.find((step) => step.type === "subagent");
    expect(probe.seen).toBe(true);
    expect(child?.isComplete).toBe(true);
    expect(child?.subagent?.status).toBe("stopped");
  });

  it("holds children beyond the cap until a slot frees", async () => {
    const releases: (() => void)[] = [];
    const first = acquireSubagent(true, 2);
    const second = acquireSubagent(true, 2);
    let thirdStarted = false;
    const third = acquireSubagent(true, 2).then((release) => {
      thirdStarted = true;
      releases.push(release!);
    });
    releases.push((await first)!, (await second)!);
    await Promise.resolve();
    expect(thirdStarted).toBe(false);
    releases[0]();
    await third;
    expect(thirdStarted).toBe(true);
    releases.slice(1).forEach((release) => release());
  });

  it("settles a queued child at once when stopped, without waiting for the running one", async () => {
    const running = await acquireSubagent(true, 1);
    const controller = new AbortController();
    const queued = acquireSubagent(true, 1, controller.signal);
    controller.abort();
    expect(await queued).toBeNull();
    running!();
    // The queue is empty again: a new child gets the slot straight away.
    const next = await acquireSubagent(true, 1);
    expect(next).not.toBeNull();
    next!();
  });

  it("keeps each queued child on the limit it was queued under", async () => {
    const first = (await acquireSubagent(true, 2))!;
    const second = (await acquireSubagent(true, 2))!;
    let lateStarted = false;
    // Queued under a limit of 1 while two run: it waits until both have finished.
    const late = acquireSubagent(true, 1).then((release) => {
      lateStarted = true;
      return release!;
    });
    first();
    await Promise.resolve();
    expect(lateStarted).toBe(false);
    second();
    (await late)();
    expect(lateStarted).toBe(true);
  });

  it("refuses the ninth child in a turn without a model call for it", async () => {
    const turns: Turn[] = [];
    for (let i = 0; i < 8; i++) turns.push(SUBAGENT_CALL, { content: "ok" });
    turns.push(SUBAGENT_CALL, { content: "Done." });
    const requests = scriptModel(turns);
    const { steps } = await runTurn();
    expect(steps.filter((step) => step.type === "subagent")).toHaveLength(8);
    // 9 parent calls, 8 child calls and the parent's reply after the refusal: no child call for the ninth.
    expect(requests).toHaveLength(18);
    expect(JSON.stringify(requests[requests.length - 1].messages)).toContain("TOOL ERROR");
  });

  it("does not start a child when subagents are turned off", async () => {
    const requests = scriptModel([
      SUBAGENT_CALL,
      { content: "I cannot delegate." },
    ]);
    const { steps } = await runTurn({ ...SETTINGS, subagents: false } as AppSettings);
    expect(steps.some((step) => step.type === "subagent")).toBe(false);
    expect(requests.length).toBeGreaterThan(0);
  });
});

/** Probe tools that stand in for the real shell and external groups, so the gate and approvals can be seen. */
function registerShellAndExternalProbes(ran: string[]) {
  registerTools([
    {
      name: "run_command",
      group: "shell",
      description: "Runs a command.",
      parameters: { command: { type: "string", description: "command" } },
      required: ["command"],
      usage: "run_command(command)",
      annotations: { executes: true },
      run: async (args) => {
        ran.push(`run_command:${String(args.command)}`);
        return "TOOL RESULT (run_command): ran";
      },
    },
    {
      name: "mcp_probe",
      group: "external",
      description: "An external tool.",
      parameters: {},
      required: [],
      usage: "mcp_probe()",
      annotations: {},
      run: async () => {
        ran.push("mcp_probe");
        return "TOOL RESULT (mcp_probe): ran";
      },
    },
  ]);
}

describe("child tool groups follow the parent chat and its permission prompts", () => {
  const SHELL_CHILD: Turn = { toolCall: { name: "run_subagent", arguments: { task: "Build it", label: "Build", tools: "shell", allow_edits: true } } };
  const EXTERNAL_CHILD: Turn = { toolCall: { name: "run_subagent", arguments: { task: "Ask the server", label: "Server", tools: "external", allow_edits: true } } };
  const ASK = { mode: "ask" as const };

  /** Runs a parent turn in ask mode; every prompt the child raises is answered with the given answer. */
  async function runAsked(turns: Turn[], answer: "no" | "once", environment: ToolEnvironment) {
    const requests = scriptModel(turns);
    const { approvals, steps } = await runTurn(SETTINGS, environment, ASK, answer);
    return { requests, approvals, steps };
  }

  it("refuses a child shell request when the parent chat has no shell tools", async () => {
    const requests = scriptModel([SHELL_CHILD, { content: "Cannot build." }]);
    const { steps } = await runTurn(SETTINGS, ENVIRONMENT, ASK);
    expect(steps.some((step) => step.type === "subagent")).toBe(false);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages)).toContain("no shell tools enabled right now");
  });

  it("refuses a child external request when the parent chat has no external tools", async () => {
    const requests = scriptModel([EXTERNAL_CHILD, { content: "Cannot ask." }]);
    const { steps } = await runTurn(SETTINGS, ENVIRONMENT, ASK);
    expect(steps.some((step) => step.type === "subagent")).toBe(false);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages)).toContain("no external tools enabled right now");
  });

  it("refuses a child shell request when the parent's allowed groups close shell", async () => {
    const ran: string[] = [];
    registerShellAndExternalProbes(ran);
    const requests = scriptModel([SHELL_CHILD, { content: "Cannot build." }]);
    const { steps } = await runTurn(SETTINGS, { ...ENVIRONMENT, hasFolder: true, canRunCommands: true, allowedGroups: ["agent", "files"] }, ASK);
    expect(steps.some((step) => step.type === "subagent")).toBe(false);
    expect(JSON.stringify(requests[1].messages)).toContain("no shell tools enabled right now");
    expect(ran).toEqual([]);
  });

  it("starts a child shell request when the parent chat has shell tools", async () => {
    const ran: string[] = [];
    registerShellAndExternalProbes(ran);
    const { requests, steps } = await runAsked(
      [SHELL_CHILD, { content: "Built." }, { content: "Done." }],
      "no",
      { ...ENVIRONMENT, hasFolder: true, canRunCommands: true },
    );
    expect(steps.some((step) => step.type === "subagent")).toBe(true);
    expect(JSON.stringify(requests[1].messages)).toContain("Build it");
  });

  it("asks the user before a child shell command in ask mode, and runs nothing when refused", async () => {
    const ran: string[] = [];
    registerShellAndExternalProbes(ran);
    const { approvals } = await runAsked(
      [SHELL_CHILD, { toolCall: { name: "run_command", arguments: { command: "make build" } } }, { content: "Stopped." }, { content: "Done." }],
      "no",
      { ...ENVIRONMENT, hasFolder: true, canRunCommands: true },
    );
    expect(approvals).toEqual(["run_command"]);
    expect(ran).toEqual([]);
  });

  it("asks the user before a child external call, and runs it only when allowed", async () => {
    const ran: string[] = [];
    registerShellAndExternalProbes(ran);
    const { approvals } = await runAsked(
      [EXTERNAL_CHILD, { toolCall: { name: "mcp_probe", arguments: {} } }, { content: "Stopped." }, { content: "Done." }],
      "no",
      { ...ENVIRONMENT, hasFolder: true, canRunCommands: true },
    );
    expect(approvals).toEqual(["mcp_probe"]);
    expect(ran).toEqual([]);
  });

  it("runs a child external call once the user allows it", async () => {
    const ran: string[] = [];
    registerShellAndExternalProbes(ran);
    const { approvals } = await runAsked(
      [EXTERNAL_CHILD, { toolCall: { name: "mcp_probe", arguments: {} } }, { content: "Ran." }, { content: "Done." }],
      "once",
      { ...ENVIRONMENT, hasFolder: true, canRunCommands: true },
    );
    expect(approvals).toEqual(["mcp_probe"]);
    expect(ran).toEqual(["mcp_probe"]);
  });
});
