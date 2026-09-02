import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentTurn, toWireMessage } from "../agent/agentLoop";
import type { AgentHost } from "../agent/agentLoop";
import { registerTool, resetRegistry } from "../tools/registry";
import type { ToolEnvironment, ToolSpec } from "../tools/registry";
import { forgetContextSize, forgetModelInfo, warmModel } from "../ollama";
import type {
  AppSettings,
  CompactionState,
  Message,
  SearchStep,
  TurnMetrics,
} from "../types";

const MODEL = "test-model";

const SETTINGS = {
  theme: "light",
  fontSize: "base",
  language: "en",
  modelName: MODEL,
  customInstructions: [],
  thinkingMode: "medium",
  webMode: "auto",
  voiceName: "",
  voiceModel: "",
  voiceEngine: "system",
  neuralVoice: "af_heart",
  voiceRate: 1,
  searchProvider: "auto",
  searxngUrl: "",
  braveApiKey: "",
  codeExecution: true,
  libraryEnabled: true,
  embedModel: "nomic-embed-text",
  showMetrics: true,
  fitContext: 8192,
  autoUpdate: true,
} as AppSettings;

const ENVIRONMENT: ToolEnvironment = {
  webMode: "auto",
  codeExecution: true,
  libraryReady: true,
};

const NS = 1e6;

function ndjsonStream(lines: unknown[]) {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= lines.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(JSON.stringify(lines[index++]) + "\n"));
    },
  });
}

const finalChunk = (extra: Record<string, unknown> = {}) => ({
  done: true,
  done_reason: "stop",
  eval_count: 40,
  eval_duration: 400 * NS,
  prompt_eval_count: 120,
  prompt_eval_duration: 60 * NS,
  total_duration: 500 * NS,
  ...extra,
});

interface Turn {
  content?: string[];
  thinking?: string[];
  toolCalls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  final?: Record<string, unknown>;
}

function installFetch(turns: Turn[], capabilities: string[]) {
  const requests: Record<string, unknown>[] = [];
  let turnIndex = 0;

  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/show")) {
      return new Response(
        JSON.stringify({
          capabilities,
          model_info: {
            "test.context_length": 32768,
            "test.block_count": 32,
            "test.embedding_length": 4096,
            "test.attention.head_count": 32,
            "test.attention.head_count_kv": 8,
          },
          details: { parameter_size: "8B", quantization_level: "Q4_K_M" },
        }),
        { status: 200 },
      );
    }

    if (url.endsWith("/api/ps")) {
      return new Response(
        JSON.stringify({ models: [{ name: MODEL, size: 100, size_vram: 80 }] }),
        { status: 200 },
      );
    }

    if (url.endsWith("/api/chat")) {
      const body = JSON.parse(String(init?.body));
      requests.push(body);

      const turn = turns[Math.min(turnIndex++, turns.length - 1)];

      const lines: unknown[] = [];
      for (const piece of turn.thinking ?? []) {
        lines.push({ message: { thinking: piece } });
      }
      for (const piece of turn.content ?? []) {
        lines.push({ message: { content: piece } });
      }
      if (turn.toolCalls) {
        lines.push({ message: { content: "", tool_calls: turn.toolCalls } });
      }
      lines.push(finalChunk(turn.final));

      return new Response(ndjsonStream(lines), { status: 200 });
    }

    throw new Error(`unexpected fetch to ${url}`);
  });

  vi.stubGlobal("fetch", impl);
  return { requests };
}

function makeHost() {
  const patches: { content: string; textContent: string }[] = [];
  let steps: SearchStep[] = [];
  let metrics: TurnMetrics | null = null;
  let outOfContext = false;

  const host: AgentHost = {
    t: (key) => key,
    onPatch: (patch) => {
      patches.push({ content: patch.content, textContent: patch.textContent });
      steps = patch.steps;
    },
    onSteps: (next) => {
      steps = next;
    },
    onOutOfContext: (flag) => {
      outOfContext = flag;
    },
    onMetrics: (next) => {
      metrics = next;
    },
  };

  return {
    host,
    patches,
    get steps() {
      return steps;
    },
    get metrics() {
      return metrics;
    },
    get outOfContext() {
      return outOfContext;
    },
  };
}

const userMessage = (content: string): Message => ({
  id: "u1",
  role: "user",
  content,
});

const assistantMessage = (content: string): Message => ({
  id: "a1",
  role: "assistant",
  content,
});

function run(
  messages: Message[],
  signal?: AbortSignal,
  host = makeHost(),
  settings: AppSettings = SETTINGS,
  compaction: CompactionState | null = null,
) {
  return {
    host,
    promise: runAgentTurn(
      {
        model: MODEL,
        settings,
        environment: ENVIRONMENT,
        messages,
        compaction,
        signal: signal ?? new AbortController().signal,
      },
      host.host,
    ),
  };
}

let toolCalls: { name: string; args: Record<string, unknown> }[] = [];

const fakeSearch: ToolSpec = {
  name: "search_web",
  group: "web",
  description: "Search the web.",
  parameters: { query: { type: "string", description: "Query." } },
  required: ["query"],
  usage: '{"query": "..."} → results',
  available: (environment) => environment.webMode !== "off",
  run: async (args, ctx) => {
    toolCalls.push({ name: "search_web", args });
    ctx.pushStep({
      id: ctx.newId(),
      type: "searching",
      content: "searching",
      isComplete: true,
    });
    return "TOOL RESULT (search_web): Paris is the capital of France.";
  },
};

beforeEach(() => {
  resetRegistry();
  registerTool(fakeSearch);
  toolCalls = [];
  forgetModelInfo(MODEL);
  // The window is remembered per model, so one test's long conversation would
  // otherwise set the window every later test sees.
  forgetContextSize(MODEL);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a plain answer with no tools", () => {
  it("streams the reply through to the host", async () => {
    installFetch([{ content: ["Hello", " there", "!"] }], []);

    const { host, promise } = run([userMessage("hi")]);
    const result = await promise;

    expect(result.textContent).toBe("Hello there!");
    expect(result.loops).toBe(1);
    expect(host.patches.length).toBeGreaterThan(0);
  });

  it("reports metrics for the turn", async () => {
    installFetch([{ content: ["Hi"] }], []);

    const { host, promise } = run([userMessage("hi")]);
    const result = await promise;

    expect(result.metrics?.responseTokens).toBe(40);
    expect(result.metrics?.tokensPerSecond).toBeCloseTo(100, 5);
    expect(host.metrics?.gpuPercent).toBe(80);
  });

  it("sends a system prompt and the conversation", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await run([userMessage("what is 2+2")]).promise;

    const body = requests[0] as { messages: { role: string; content: string }[] };
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Draggy");
    // The clock is appended to the last user message rather than sent in the
    // system prompt, so the message is no longer exactly what was typed.
    expect(body.messages[1].content).toContain("what is 2+2");
  });

  describe("keeping the cached prefix intact", () => {
    it("does not put a changing clock in the system prompt", async () => {
      const { requests } = installFetch([{ content: ["ok"] }], []);
      await run([userMessage("hello")]).promise;

      const body = requests[0] as { messages: { content: string }[] };
      // A timestamp here ends the common prefix at token zero, which makes
      // every turn re-evaluate the whole conversation.
      expect(body.messages[0].content).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    });

    it("puts the clock on the last user message instead", async () => {
      const { requests } = installFetch([{ content: ["ok"] }], []);
      await run([userMessage("hello")]).promise;

      const body = requests[0] as { messages: { role: string; content: string }[] };
      const last = body.messages[body.messages.length - 1];
      expect(last.content).toContain("Current time:");
    });

    it("keeps the system prompt identical across two turns", async () => {
      const { requests } = installFetch(
        [{ content: ["one"] }, { content: ["two"] }],
        [],
      );

      await run([userMessage("first")]).promise;
      await run([userMessage("second")]).promise;

      const first = requests[0] as { messages: { content: string }[] };
      const second = requests[1] as { messages: { content: string }[] };
      expect(second.messages[0].content).toBe(first.messages[0].content);
    });
  });

  it("asks for a context window that fits the conversation", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await run([userMessage("hi")]).promise;

    const body = requests[0] as { options: { num_ctx: number } };
    expect(body.options.num_ctx).toBe(4096);
  });

  it("does not send tool schemas to a model without the capability", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await run([userMessage("hi")]).promise;

    expect((requests[0] as { tools?: unknown }).tools).toBeUndefined();
  });

  it("flags an answer cut short by the context limit", async () => {
    installFetch([{ content: ["truncated"], final: { done_reason: "length" } }], []);

    const { host, promise } = run([userMessage("hi")]);
    const result = await promise;

    expect(result.outOfContext).toBe(true);
    expect(host.outOfContext).toBe(true);
  });
});

describe("native tool calling", () => {
  it("runs the tool and asks the model again", async () => {
    const { requests } = installFetch(
      [
        { toolCalls: [{ function: { name: "search_web", arguments: { query: "capital of France" } } }] },
        { content: ["Paris."] },
      ],
      ["tools"],
    );

    const result = await run([userMessage("capital of France?")]).promise;

    expect(toolCalls).toEqual([{ name: "search_web", args: { query: "capital of France" } }]);
    expect(result.textContent).toContain("Paris.");
    expect(result.loops).toBe(2);
    expect(requests).toHaveLength(2);
  });

  it("feeds the tool result back as a tool message", async () => {
    const { requests } = installFetch(
      [
        { toolCalls: [{ function: { name: "search_web", arguments: { query: "x" } } }] },
        { content: ["done"] },
      ],
      ["tools"],
    );

    await run([userMessage("q")]).promise;

    const second = requests[1] as { messages: { role: string; tool_name?: string; content: string }[] };
    const toolMessage = second.messages.find((m) => m.role === "tool");

    expect(toolMessage?.tool_name).toBe("search_web");
    expect(toolMessage?.content).toContain("Paris is the capital");
  });

  it("sends tool schemas when the model advertises the capability", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], ["tools"]);

    await run([userMessage("hi")]).promise;

    const body = requests[0] as { tools?: { function: { name: string } }[] };
    expect(body.tools?.map((entry) => entry.function.name)).toEqual(["search_web"]);
  });

  it("records a step for the tool it ran", async () => {
    installFetch(
      [
        { toolCalls: [{ function: { name: "search_web", arguments: { query: "x" } } }] },
        { content: ["done"] },
      ],
      ["tools"],
    );

    const result = await run([userMessage("q")]).promise;
    expect(result.steps.some((step) => step.type === "searching")).toBe(true);
  });

  it("adds up metrics across both requests", async () => {
    installFetch(
      [
        { toolCalls: [{ function: { name: "search_web", arguments: { query: "x" } } }] },
        { content: ["done"] },
      ],
      ["tools"],
    );

    const result = await run([userMessage("q")]).promise;
    expect(result.metrics?.responseTokens).toBe(80);
  });

  it("tells the model when it asks for a tool that does not exist", async () => {
    const { requests } = installFetch(
      [
        { toolCalls: [{ function: { name: "teleport", arguments: {} } }] },
        { content: ["sorry"] },
      ],
      ["tools"],
    );

    await run([userMessage("q")]).promise;

    const second = requests[1] as { messages: { role: string; content: string }[] };
    expect(second.messages.find((m) => m.role === "tool")?.content).toContain(
      "no tool called",
    );
  });
});

describe("text-mode tool calling", () => {
  it("recovers a tool call from plain text and hides it from the user", async () => {
    installFetch(
      [
        { content: ['Let me look.\n<tool>{"name": "search_web", "args": {"query": "france"}}</tool>'] },
        { content: ["Paris."] },
      ],
      [],
    );

    const result = await run([userMessage("capital?")]).promise;

    expect(toolCalls).toHaveLength(1);
    expect(result.textContent).not.toContain('"name"');
    expect(result.textContent).toContain("Paris.");
  });

  it("feeds the result back as a user message for models without tool roles", async () => {
    const { requests } = installFetch(
      [
        { content: ['<tool>{"name": "search_web", "args": {"query": "x"}}</tool>'] },
        { content: ["done"] },
      ],
      [],
    );

    await run([userMessage("q")]).promise;

    const second = requests[1] as { messages: { role: string; content: string }[] };
    const last = second.messages[second.messages.length - 1];

    expect(last.role).toBe("user");
    expect(last.content).toContain("TOOL RESULT");
  });

  it("strips reasoning tags from the visible answer", async () => {
    installFetch([{ content: ["<think>hmm</think>", "The answer is 4."] }], []);

    const result = await run([userMessage("2+2")]).promise;

    expect(result.textContent).toBe("The answer is 4.");
    expect(result.textContent).not.toContain("<think>");
  });

  it("keeps the reasoning as a thinking step", async () => {
    installFetch([{ content: ["<think>working it out</think>", "Four."] }], []);

    const result = await run([userMessage("2+2")]).promise;
    const thinking = result.steps.find((step) => step.type === "thinking");

    expect(thinking?.content).toContain("working it out");
    expect(thinking?.isComplete).toBe(true);
  });
});

describe("native thinking models", () => {
  it("asks for thinking and keeps it out of the answer", async () => {
    const { requests } = installFetch(
      [{ thinking: ["let me see"], content: ["Four."] }],
      ["thinking"],
    );

    const result = await run([userMessage("2+2")]).promise;

    expect((requests[0] as { think?: boolean }).think).toBe(true);
    expect(result.textContent).toBe("Four.");
    expect(result.steps.find((s) => s.type === "thinking")?.content).toContain("let me see");
  });

  it("drops an empty thinking step rather than showing a blank panel", async () => {
    installFetch([{ content: ["Four."] }], ["thinking"]);

    const result = await run([userMessage("2+2")]).promise;
    expect(result.steps.filter((step) => step.type === "thinking")).toHaveLength(0);
  });
});

describe("fast thinking mode", () => {
  const FAST_SETTINGS = { ...SETTINGS, thinkingMode: "low" } as AppSettings;

  it("tells a native-capable model not to think, explicitly rather than by omission", async () => {
    const { requests } = installFetch([{ content: ["Four."] }], ["thinking"]);

    await run([userMessage("2+2")], undefined, undefined, FAST_SETTINGS).promise;

    expect((requests[0] as { think?: boolean }).think).toBe(false);
    const system = String(
      (requests[0] as { messages: { content: string }[] }).messages[0].content,
    );
    expect(system).not.toContain("CRITICAL REASONING INSTRUCTION");
  });

  it("asks a non-native model for the answer, rather than saying nothing", async () => {
    const { requests } = installFetch([{ content: ["Four."] }], []);

    await run([userMessage("2+2")], undefined, undefined, FAST_SETTINGS).promise;

    expect((requests[0] as { think?: boolean }).think).toBeUndefined();
    const system = String(
      (requests[0] as { messages: { content: string }[] }).messages[0].content,
    );
    expect(system).not.toContain("CRITICAL REASONING INSTRUCTION");
    expect(system).not.toContain("You MUST use <think>");
    expect(system).toContain("Answer immediately");
  });

  it("tells a native-capable model to skip the scratchpad as well", async () => {
    const { requests } = installFetch([{ content: ["Four."] }], ["thinking"]);

    await run([userMessage("2+2")], undefined, undefined, FAST_SETTINGS).promise;

    const system = String(
      (requests[0] as { messages: { content: string }[] }).messages[0].content,
    );
    expect(system).toContain("Answer immediately");
  });

  it("still asks a native-capable model to think in the other modes", async () => {
    const { requests } = installFetch([{ content: ["Four."] }], ["thinking"]);

    await run([userMessage("2+2")]).promise;

    expect((requests[0] as { think?: boolean }).think).toBe(true);
  });
});

describe("keeping the model loaded", () => {
  type ChatBody = { options: { num_ctx: number } };

  it("asks for the window the warm-up already loaded", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await warmModel(MODEL, "30m", 0);
    await run([userMessage("hi")]).promise;

    // Two /api/chat calls: the warm-up, then the turn. Ollama unloads and
    // reloads the weights when num_ctx changes, so these have to agree.
    expect(requests).toHaveLength(2);
    expect((requests[1] as ChatBody).options.num_ctx).toBe(
      (requests[0] as ChatBody).options.num_ctx,
    );
  });

  it("does not give a window back once the conversation has needed it", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await run([userMessage("x".repeat(60000))]).promise;
    const grown = (requests[0] as ChatBody).options.num_ctx;

    await run([userMessage("hi")]).promise;

    expect(grown).toBeGreaterThan(4096);
    expect((requests[1] as ChatBody).options.num_ctx).toBe(grown);
  });
});

describe("stopping", () => {
  it("reports an aborted turn", async () => {
    const controller = new AbortController();
    installFetch([{ content: ["partial"] }], []);
    controller.abort();

    const result = await run([userMessage("hi")], controller.signal).promise;
    expect(result.aborted).toBe(true);
  });
});

describe("web access turned off", () => {
  it("does not offer browsing tools to the model", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], ["tools"]);

    await runAgentTurn(
      {
        model: MODEL,
        settings: { ...SETTINGS, webMode: "off" },
        environment: { ...ENVIRONMENT, webMode: "off" },
        messages: [userMessage("hi")],
        signal: new AbortController().signal,
      },
      makeHost().host,
    );

    expect((requests[0] as { tools?: unknown[] }).tools).toEqual([]);
  });
});

describe("continuing a truncated answer", () => {
  it("keeps the earlier text and appends to it", async () => {
    installFetch([{ content: [" and then it ended."] }], []);

    const result = await runAgentTurn(
      {
        model: MODEL,
        settings: SETTINGS,
        environment: ENVIRONMENT,
        messages: [userMessage("tell me a story")],
        isContinuation: true,
        seed: { content: "Once upon a time", textContent: "Once upon a time", steps: [] },
        signal: new AbortController().signal,
      },
      makeHost().host,
    );

    expect(result.textContent).toContain("Once upon a time");
    expect(result.textContent).toContain("and then it ended.");
  });
});

describe("putting attachments on the wire", () => {
  const image = (content: string, name = "photo.jpg") => ({
    id: "u1",
    role: "user" as const,
    content: "look at this",
    attachments: [{ name, type: "image/jpeg", content }],
  });

  const REAL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD";

  it("strips the data URL prefix and sends only base64", () => {
    const wire = toWireMessage(image(REAL), true);

    expect(wire.images).toEqual(["/9j/4AAQSkZJRgABAQEAYABgAAD"]);
    expect(wire.images?.[0]).not.toContain("data:");
  });

  it("keeps base64 that arrives without a prefix", () => {
    const wire = toWireMessage(image("/9j/4AAQSkZJRg"), true);
    expect(wire.images).toEqual(["/9j/4AAQSkZJRg"]);
  });

  it("does not truncate base64 containing padding or slashes", () => {
    const payload = "a/b+c/d==";
    const wire = toWireMessage(image(`data:image/png;base64,${payload}`), true);

    expect(wire.images).toEqual([payload]);
  });

  it("never sends an empty image, which the model rejects outright", () => {
    const wire = toWireMessage(image("data:image/jpeg;base64,"), true);

    expect(wire.images).toBeUndefined();
    expect(wire.content).toContain("could not be read");
  });

  it("never sends a whitespace-only image", () => {
    const wire = toWireMessage(image("data:image/jpeg;base64,   \n  "), true);

    expect(wire.images).toBeUndefined();
    expect(wire.content).toContain("could not be read");
  });

  it("never sends a completely empty attachment", () => {
    const wire = toWireMessage(image(""), true);
    expect(wire.images).toBeUndefined();
  });

  it("still explains the limitation when the model has no vision", () => {
    const wire = toWireMessage(image(REAL), false);

    expect(wire.images).toBeUndefined();
    expect(wire.content).toContain("cannot read images");
  });

  it("sends several images in order", () => {
    const wire = toWireMessage(
      {
        id: "u1",
        role: "user",
        content: "two",
        attachments: [
          { name: "a.jpg", type: "image/jpeg", content: "data:image/jpeg;base64,AAA" },
          { name: "b.png", type: "image/png", content: "data:image/png;base64,BBB" },
        ],
      },
      true,
    );

    expect(wire.images).toEqual(["AAA", "BBB"]);
  });

  it("drops only the broken image and keeps the good one", () => {
    const wire = toWireMessage(
      {
        id: "u1",
        role: "user",
        content: "two",
        attachments: [
          { name: "broken.jpg", type: "image/jpeg", content: "data:image/jpeg;base64," },
          { name: "good.png", type: "image/png", content: "data:image/png;base64,BBB" },
        ],
      },
      true,
    );

    expect(wire.images).toEqual(["BBB"]);
    expect(wire.content).toContain("broken.jpg");
  });

  it("recognises an image by extension when the type is missing", () => {
    const wire = toWireMessage(
      {
        id: "u1",
        role: "user",
        content: "x",
        attachments: [{ name: "shot.png", type: "", content: "data:image/png;base64,CCC" }],
      },
      true,
    );

    expect(wire.images).toEqual(["CCC"]);
  });
});

describe("keeping prose where the model wrote it", () => {
  const CALL = [{ function: { name: "search_web", arguments: { query: "paris" } } }];

  it("leaves text written before a tool call in the timeline, not at the end", async () => {
    installFetch(
      [
        { content: ["Let me look ", "that up."], toolCalls: CALL },
        { content: ["Paris is the capital of France."] },
      ],
      ["tools"],
    );

    const result = await run([userMessage("capital of france?")]).promise;

    const texts = result.steps.filter((step) => step.type === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0].content).toBe("Let me look that up.");

    // The preamble must not be glued onto the front of the answer.
    expect(result.textContent).toBe("Paris is the capital of France.");
  });

  it("orders the preamble before the tool it introduces", async () => {
    installFetch(
      [
        { content: ["Searching now."], toolCalls: CALL },
        { content: ["Done."] },
      ],
      ["tools"],
    );

    const result = await run([userMessage("hi")]).promise;

    const order = result.steps
      .filter((step) => step.type === "text" || step.type === "searching")
      .map((step) => step.type);

    expect(order).toEqual(["text", "searching"]);
  });

  it("keeps each round of prose separate across several tool calls", async () => {
    installFetch(
      [
        { content: ["First I will check."], toolCalls: CALL },
        { content: ["Now the other one."], toolCalls: CALL },
        { content: ["Here is the answer."] },
      ],
      ["tools"],
    );

    const result = await run([userMessage("hi")]).promise;

    expect(
      result.steps.filter((step) => step.type === "text").map((step) => step.content),
    ).toEqual(["First I will check.", "Now the other one."]);

    expect(result.textContent).toBe("Here is the answer.");
  });

  it("adds no text step when the model goes straight to the tool", async () => {
    installFetch(
      [{ content: [], toolCalls: CALL }, { content: ["Answer."] }],
      ["tools"],
    );

    const result = await run([userMessage("hi")]).promise;

    expect(result.steps.some((step) => step.type === "text")).toBe(false);
    expect(result.textContent).toBe("Answer.");
  });

  it("does not leave the final answer duplicated in the timeline", async () => {
    installFetch(
      [
        { content: ["One moment."], toolCalls: CALL },
        { content: ["The answer is four."] },
      ],
      ["tools"],
    );

    const result = await run([userMessage("hi")]).promise;

    expect(
      result.steps.some((step) => step.content.includes("The answer is four.")),
    ).toBe(false);
  });

  it("streams the prose into the timeline rather than into the reply body", async () => {
    installFetch(
      [
        { content: ["Thinking out loud."], toolCalls: CALL },
        { content: ["Final."] },
      ],
      ["tools"],
    );

    const { host, promise } = run([userMessage("hi")]);
    await promise;

    // Before the last pass, the body stays empty: everything visible is a step.
    expect(host.patches.some((patch) => patch.textContent === "Thinking out loud.")).toBe(
      false,
    );
  });

  it("works the same for a model that writes its tool calls as text", async () => {
    installFetch(
      [
        {
          content: [
            "Let me search for that.\n",
            '<tool>{"name": "search_web", "args": {"query": "paris"}}</tool>',
          ],
        },
        { content: ["Paris."] },
      ],
      [],
    );

    const result = await run([userMessage("hi")]).promise;

    const texts = result.steps.filter((step) => step.type === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0].content).toBe("Let me search for that.");
    expect(result.textContent).toBe("Paris.");
  });

  it("keeps what was written when the user stops the reply", async () => {
    const controller = new AbortController();
    installFetch([{ content: ["Half a thought"] }], []);

    const { promise } = run([userMessage("hi")], controller.signal);
    // Abort once the stream has had a chance to deliver something.
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    const result = await promise;
    expect(result.textContent).toContain("Half a thought");
  });
});

describe("carrying on a reply that was cut short", () => {
  const partial: Message = {
    id: "a1",
    role: "assistant",
    content: "I have started the report",
    textContent: "I have started the report",
  };

  const seedWith = (steps: SearchStep[]) => ({
    content: "I have started the report",
    textContent: "I have started the report",
    steps,
  });

  function continueWith(steps: SearchStep[], host = makeHost()) {
    const { requests } = installFetch([{ content: [" and finished it."] }], ["tools"]);
    return {
      requests,
      promise: runAgentTurn(
        {
          model: MODEL,
          settings: SETTINGS,
          environment: ENVIRONMENT,
          messages: [userMessage("write me a report"), partial],
          isContinuation: true,
          seed: seedWith(steps),
          signal: new AbortController().signal,
        },
        host.host,
      ),
    };
  }

  const wireText = (requests: Record<string, unknown>[]) =>
    (requests[0].messages as { role: string; content: string }[])
      .map((message) => message.content)
      .join("\n");

  it("tells the model about a file it already wrote", async () => {
    const { requests, promise } = continueWith([
      {
        id: "s1",
        type: "create_file",
        content: "Created **report.docx**",
        filename: "report.docx",
        filepath: "C:/out/report.docx",
        isComplete: true,
      },
    ]);
    await promise;

    const sent = wireText(requests);
    expect(sent).toContain("report.docx");
    expect(sent).toContain("C:/out/report.docx");
    expect(sent).toContain("do not create it again");
  });

  it("tells the model about code it already ran, and its output", async () => {
    const { requests, promise } = continueWith([
      {
        id: "s1",
        type: "run_code",
        content: "Code ran",
        language: "python",
        stdout: "788454",
        isComplete: true,
      },
    ]);
    await promise;

    const sent = wireText(requests);
    expect(sent).toContain("788454");
    expect(sent).toContain("Do not run it again");
  });

  it("carries the reasoning across", async () => {
    const { requests, promise } = continueWith([
      {
        id: "s1",
        type: "thinking",
        content: "I planned three sections before writing.",
        isComplete: true,
      },
    ]);
    await promise;

    expect(wireText(requests)).toContain("three sections");
  });

  it("still asks it to carry on rather than restart", async () => {
    const { requests, promise } = continueWith([]);
    await promise;

    const sent = wireText(requests);
    expect(sent).toContain("Carry straight on from the exact character it stopped at");
    expect(sent).toContain("no repeating work you already finished");
  });

  it("adds nothing about past work when there was none", async () => {
    const { requests, promise } = continueWith([]);
    await promise;

    expect(wireText(requests)).not.toContain("already done");
  });

  it("keeps what was already written in the finished reply", async () => {
    const { promise } = continueWith([]);
    const result = await promise;

    expect(result.textContent).toContain("I have started the report");
    expect(result.textContent).toContain("and finished it.");
  });

  it("says nothing about past work on an ordinary turn", async () => {
    const { requests } = installFetch([{ content: ["Hello."] }], ["tools"]);
    await run([userMessage("hi there, how are you")]).promise;

    expect(wireText(requests)).not.toContain("cut short");
  });
});

describe("picking up at the exact word it stopped", () => {
  const cutOff = "The sea is a vast expanse of salt";

  function resume(reply: string[], host = makeHost()) {
    const { requests } = installFetch([{ content: reply }], ["tools"]);
    return {
      requests,
      promise: runAgentTurn(
        {
          model: MODEL,
          settings: SETTINGS,
          environment: ENVIRONMENT,
          messages: [
            userMessage("tell me about the sea"),
            { id: "a1", role: "assistant", content: cutOff, textContent: cutOff },
          ],
          isContinuation: true,
          seed: { content: cutOff, textContent: cutOff, steps: [] },
          signal: new AbortController().signal,
        },
        host.host,
      ),
    };
  }

  const messagesOf = (requests: Record<string, unknown>[]) =>
    requests[0].messages as { role: string; content: string }[];

  it("ends the conversation with the half-written reply", async () => {
    const { requests, promise } = resume(["water."]);
    await promise;

    const sent = messagesOf(requests);
    const last = sent[sent.length - 1];

    // A model completes a trailing assistant message but starts afresh after
    // a user one, so this ordering is what makes continuation work at all.
    expect(last.role).toBe("assistant");
    expect(last.content).toBe(cutOff);
  });

  it("does not leave the half-written reply in the middle as well", async () => {
    const { requests, promise } = resume(["water."]);
    await promise;

    const sent = messagesOf(requests);
    const copies = sent.filter((message) => message.content === cutOff);
    expect(copies).toHaveLength(1);
  });

  it("completes a word that was split in half", async () => {
    const { promise } = resume(["water", " covers most of the Earth."]);
    const result = await promise;

    expect(result.textContent).toBe(
      "The sea is a vast expanse of saltwater covers most of the Earth.",
    );
    expect(result.textContent).not.toContain("\n");
  });

  it("puts no line break at the seam", async () => {
    const { promise } = resume([" and it is deep."]);
    const result = await promise;

    expect(result.textContent).toBe("The sea is a vast expanse of salt and it is deep.");
  });

  it("drops a repeated tail rather than saying it twice", async () => {
    const { promise } = resume(["a vast expanse of saltwater."]);
    const result = await promise;

    expect(result.textContent).toBe("The sea is a vast expanse of saltwater.");
  });

  it("still starts a fresh reply on an ordinary turn", async () => {
    const { requests } = installFetch([{ content: ["Hello there."] }], ["tools"]);
    await run([userMessage("hello, how are you")]).promise;

    const sent = requests[0].messages as { role: string; content: string }[];
    expect(sent[sent.length - 1].role).toBe("user");
  });
});

describe("carrying a folded conversation", () => {
  const folded: CompactionState = {
    throughIndex: 4,
    summary: "Budget is 4200 GBP. Deadline 14 March.",
    updatedAt: 0,
  };

  const longChat = () => [
    userMessage("one"),
    assistantMessage("first answer"),
    userMessage("two"),
    assistantMessage("second answer"),
    userMessage("three"),
    assistantMessage("third answer"),
    userMessage("four"),
  ];

  it("sends the summary instead of the messages it covers", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await run(longChat(), undefined, makeHost(), SETTINGS, folded).promise;

    const body = requests[0] as { messages: { role: string; content: string }[] };
    const wire = body.messages.map((entry) => entry.content).join(" | ");

    expect(wire).toContain("Budget is 4200 GBP");
    expect(wire).not.toContain("first answer");
    expect(wire).not.toContain("second answer");
  });

  it("still sends everything after the fold", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await run(longChat(), undefined, makeHost(), SETTINGS, folded).promise;

    const body = requests[0] as { messages: { content: string }[] };
    const wire = body.messages.map((entry) => entry.content).join(" | ");

    expect(wire).toContain("third answer");
    expect(wire).toContain("four");
  });

  it("puts the summary directly after the system prompt", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await run(longChat(), undefined, makeHost(), SETTINGS, folded).promise;

    const body = requests[0] as { messages: { role: string; content: string }[] };
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("Budget is 4200 GBP");
  });

  it("ignores a summary that claims more messages than exist", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    const stale: CompactionState = { ...folded, throughIndex: 99 };
    await run([userMessage("only one")], undefined, makeHost(), SETTINGS, stale)
      .promise;

    const body = requests[0] as { messages: { content: string }[] };
    const wire = body.messages.map((entry) => entry.content).join(" | ");

    expect(wire).not.toContain("Budget is 4200 GBP");
    expect(wire).toContain("only one");
  });

  it("sends the conversation whole when nothing has been folded", async () => {
    const { requests } = installFetch([{ content: ["ok"] }], []);

    await run(longChat()).promise;

    const body = requests[0] as { messages: { content: string }[] };
    const wire = body.messages.map((entry) => entry.content).join(" | ");

    expect(wire).toContain("first answer");
  });
});
