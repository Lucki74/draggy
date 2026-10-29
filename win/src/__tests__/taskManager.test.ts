import { beforeEach, describe, expect, it, vi } from "vitest";
import { contextSizeFor, forgetContextSize } from "../llama";
import type { AgentHost, AgentRequest, AgentResult } from "../agent/agentLoop";
import type { AppSettings, ChatSession, MessageVersion } from "../types";
import type { Grant } from "../agent/permissions";

/** Turns belong to conversations, not the screen: two chats can generate at once, a turn survives
 * looking away, and stopping one spares the other. */

const pending = vi.hoisted(() => {
  const turns: {
    request: AgentRequest;
    host: AgentHost;
    resolve: (result: AgentResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  return turns;
});

vi.mock("../agent/agentLoop", () => ({
  KEEP_ALIVE: "30m",
  runAgentTurn: (request: AgentRequest, host: AgentHost) =>
    new Promise<AgentResult>((resolve, reject) => {
      pending.push({ request, host, resolve, reject });
    }),
}));

const sent = vi.hoisted(() => [] as { data: Record<string, unknown>; cid?: string }[]);

vi.mock("../logger", async (original) => {
  const real = await original<typeof import("../logger")>();
  return {
    ...real,
    logRendererEvent: (scope: string, level: string, msg: string, data?: Record<string, unknown>, cid?: string) => {
      if (msg === "turn sent") sent.push({ data: data ?? {}, cid });
      return (real.logRendererEvent as (...args: unknown[]) => unknown)(scope, level, msg, data, cid);
    },
  };
});

const { createTaskManager } = await import("../agent/taskManager");
import type { MetricRow } from "../types";
import type { TaskHost } from "../agent/taskManager";

const settings = { customInstructions: [] } as unknown as AppSettings;

function finished(): AgentResult {
  return {
    steps: [],
    textContent: "done",
    content: "done",
    exhausted: false,
    outOfContext: false,
  } as unknown as AgentResult;
}

function createHost(workspaceId = "default") {
  const sessions = new Map<string, ChatSession>();
  const granted: Grant[] = [];

  const host: TaskHost = {
    getModel: () => "qwen3:8b",
    getSettings: () => settings,
    getEnvironment: () => ({
      webMode: "off",
      codeExecution: false,
      libraryReady: false,
    }),
    getWorkspaceId: () => workspaceId,
    getPermission: () => ({ mode: "auto" as const, grants: [] }),
    onGrant: (grant) => granted.push(grant),
    getSession: (chatId) => sessions.get(chatId),
    addSession: (session) => sessions.set(session.id, session),
    updateSession: (chatId, updater) => {
      const session = sessions.get(chatId);
      if (session) sessions.set(chatId, updater(session));
    },
    patchActiveMessage: (chatId, patch: Partial<MessageVersion>) => {
      const session = sessions.get(chatId);
      if (!session || session.messages.length === 0) return;

      const messages = session.messages.slice();
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, ...patch };
      sessions.set(chatId, { ...session, messages });
    },
    t: (key) => key,
  };

  return { sessions, granted, host };
}

function seed(sessions: Map<string, ChatSession>, id: string): ChatSession {
  const session: ChatSession = {
    id,
    title: id,
    messages: [],
    updatedAt: 0,
    isGenerating: false,
  };
  sessions.set(id, session);
  return session;
}

describe("the task manager", () => {
  beforeEach(() => {
    pending.length = 0;
  });

  it("names the turn a retry follows so the log can chain them", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);
    sent.length = 0;

    manager.send("chat-1", "question");
    pending[0].reject(new Error("boom"));
    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));
    manager.regenerate("chat-1");

    expect(sent).toHaveLength(2);
    expect(sent[0].data.after).toBeUndefined();
    expect(sent[1].data.retry).toBe(true);
    expect(sent[1].data.after).toBe(sent[0].cid);
  });

  it("starts a conversation the first message arrives for", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "hello");

    expect(sessions.get("chat-1")).toBeTruthy();
    expect(sessions.get("chat-1")?.isGenerating).toBe(true);
    expect(pending).toHaveLength(1);
  });

  it("starts it in the workspace that is open", () => {
    const { sessions, host } = createHost("project-7");
    const manager = createTaskManager(host);

    manager.send("chat-1", "hello");

    expect(sessions.get("chat-1")?.workspaceId).toBe("project-7");
  });

  it("holds a second conversation in a chat of its own until the first one's turn ends", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager({ ...host, oneTurnAtATime: true });

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");

    expect(manager.running()).toEqual(["chat-1"]);
    expect(manager.queues()["chat-2"]).toBeUndefined();
    expect(sessions.get("chat-2")?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);

    pending[pending.length - 1].resolve(finished());
    await vi.waitFor(() => expect(manager.running()).toEqual(["chat-2"]));
    expect(sessions.get("chat-2")?.isGenerating).toBe(true);
    expect(sessions.get("chat-2")?.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("lets the chat that waited go before the finished chat's own queue", async () => {
    const { host } = createHost();
    const manager = createTaskManager({ ...host, oneTurnAtATime: true });

    manager.send("chat-1", "first");
    manager.enqueue("chat-1", "follow-up");
    manager.send("chat-2", "second");

    pending[pending.length - 1].resolve(finished());
    await vi.waitFor(() => expect(manager.running()).toEqual(["chat-2"]));

    pending[pending.length - 1].resolve(finished());
    await vi.waitFor(() => expect(manager.running()).toEqual(["chat-1"]));
  });

  it("finishes a turn for a conversation that is no longer the one on screen", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");

    // Whatever the window is showing, the first turn is still its chat's.
    pending[0].resolve(finished());
    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));

    expect(manager.isRunning("chat-1")).toBe(false);
    expect(manager.isRunning("chat-2")).toBe(true);
  });

  it("stops one conversation without touching the other", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");

    manager.stop("chat-1");

    expect(pending[0].request.signal.aborted).toBe(true);
    expect(pending[1].request.signal.aborted).toBe(false);
    expect(sessions.get("chat-1")?.isGenerating).toBe(false);
    expect(sessions.get("chat-2")?.isGenerating).toBe(true);
    expect(manager.running()).toEqual(["chat-2"]);
  });

  it("ignores a stopped turn that lands afterwards", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.stop("chat-1");

    // The loop notices the abort a moment later; nothing it says then counts.
    pending[0].reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await vi.waitFor(() => expect(manager.running()).toEqual([]));

    const messages = sessions.get("chat-1")?.messages ?? [];
    expect(messages.some((m) => m.content.includes("aborted"))).toBe(false);
  });

  it("stops everything at once", () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");
    manager.stopAll();

    expect(pending.every((turn) => turn.request.signal.aborted)).toBe(true);
    expect(manager.running()).toEqual([]);
  });

  it("tells subscribers which conversations are busy", () => {
    const { host } = createHost();
    const manager = createTaskManager(host);
    const seen: string[][] = [];

    const unsubscribe = manager.subscribe((running) => seen.push(running));

    manager.send("chat-1", "first");
    manager.stop("chat-1");
    unsubscribe();
    manager.send("chat-2", "second");

    expect(seen).toEqual([["chat-1"], []]);
  });

  it("hands the turn the conversation as it stands", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    const session = seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...session,
      messages: [{ id: "m1", role: "user", content: "earlier" }],
    });

    manager.send("chat-1", "later");

    const sent = pending[0].request.messages;
    expect(sent.map((m) => m.content)).toEqual(["earlier", "later"]);
  });

  it("replaces the last reply when regenerating, keeping the old one", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...(sessions.get("chat-1") as ChatSession),
      messages: [
        { id: "m1", role: "user", content: "question" },
        { id: "m2", role: "assistant", content: "first answer" },
      ],
    });

    manager.regenerate("chat-1");

    const messages = sessions.get("chat-1")?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1].versions?.[0]?.content).toBe("first answer");
    expect(messages[1].content).toBe("");
  });

  it("clears failed status when regenerating a failed reply, saving failed on the old version", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...(sessions.get("chat-1") as ChatSession),
      messages: [
        { id: "m1", role: "user", content: "question" },
        { id: "m2", role: "assistant", content: "The model engine stopped", failed: true },
      ],
    });

    manager.regenerate("chat-1");

    const messages = sessions.get("chat-1")?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1].versions?.[0]?.content).toBe("The model engine stopped");
    expect(messages[1].versions?.[0]?.failed).toBe(true);
    expect(messages[1].failed).toBeUndefined();
    expect(messages[1].content).toBe("");
  });

  it("continues a failed reply that kept partial text instead of clearing it", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...(sessions.get("chat-1") as ChatSession),
      messages: [
        { id: "m1", role: "user", content: "question" },
        { id: "m2", role: "assistant", content: "half an answer", textContent: "half an answer", failed: true, error: "context full" },
      ],
    });

    manager.regenerate("chat-1");

    const messages = sessions.get("chat-1")?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe("half an answer");
    expect(messages[1].failed).toBeUndefined();
    expect(messages[1].error).toBeUndefined();
    expect(messages[1].versions).toBeUndefined();
  });

  it("preserves message versions when a retry attempt fails", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...(sessions.get("chat-1") as ChatSession),
      messages: [
        { id: "m1", role: "user", content: "question" },
        { id: "m2", role: "assistant", content: "first error", failed: true },
      ],
    });

    manager.regenerate("chat-1");
    pending.at(-1)?.reject(new Error("second error"));
    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));

    const messages = sessions.get("chat-1")?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1].failed).toBe(true);
    expect(messages[1].content).toBe("");
    expect(messages[1].error).toBe("second error");
    expect(messages[1].versions).toHaveLength(1);
    expect(messages[1].versions?.[0]?.content).toBe("first error");
    expect(messages[1].versions?.[0]?.failed).toBe(true);
  });

  it("resumes a failed reply from its partial text instead of wiping it", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...(sessions.get("chat-1") as ChatSession),
      messages: [
        { id: "m1", role: "user", content: "question" },
        { id: "m2", role: "assistant", content: "half an ans", textContent: "half an ans", failed: true, error: "engine stopped" },
      ],
    });

    manager.continueGeneration("chat-1");

    const reply = sessions.get("chat-1")?.messages[1];
    expect(reply?.textContent).toBe("half an ans");
    expect(reply?.failed).toBeUndefined();
    expect(reply?.error).toBeUndefined();
    expect(pending.at(-1)?.request.isContinuation).toBe(true);
    expect(pending.at(-1)?.request.seed?.textContent).toBe("half an ans");
  });

  it("loads a larger window to continue a reply the context cut", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);
    const model = host.getModel() as string;
    forgetContextSize(model);

    seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...(sessions.get("chat-1") as ChatSession),
      isOutOfContext: true,
      outOfContextInfo: { loaded: 4096, modelMax: 32768, used: 4000, canGrow: true },
      messages: [
        { id: "m1", role: "user", content: "question" },
        { id: "m2", role: "assistant", content: "cut", textContent: "cut" },
      ],
    });

    manager.continueGeneration("chat-1");

    expect(contextSizeFor(model, 100, 32768)).toBe(8192);
    expect(sessions.get("chat-1")?.outOfContextInfo).toBeUndefined();
  });

  it("resumes a reply the context cut at the next window without a button", async () => {
    const { host } = createHost();
    const manager = createTaskManager(host);
    const model = host.getModel() as string;
    forgetContextSize(model);

    manager.send("chat-1", "long question");
    pending[0].host.onOutOfContext(true, { loaded: 4096, modelMax: 32768, used: 4000, canGrow: true });
    pending[0].resolve({ ...finished(), outOfContext: true });

    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].request.isContinuation).toBe(true);
    expect(contextSizeFor(model, 100, 32768)).toBe(8192);
  });

  it("stops auto-resuming when the window cannot grow", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);
    forgetContextSize(host.getModel() as string);

    manager.send("chat-1", "long question");
    pending[0].host.onOutOfContext(true, { loaded: 4096, modelMax: 4096, used: 4000, canGrow: false });
    pending[0].resolve({ ...finished(), outOfContext: true });

    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));
    expect(pending).toHaveLength(1);
    expect(sessions.get("chat-1")?.isOutOfContext).toBe(true);
  });

  it("preserves generated text, steps, and records error when turn fails mid-stream", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "write some code");

    // Simulate stream patching active message before failure
    host.patchActiveMessage("chat-1", {
      content: "Here is the code: function test() {}",
      textContent: "Here is the code: function test() {}",
      steps: [{ id: "s1", type: "text", content: "Here is the code", isComplete: true }],
    });

    // Model throws mid-turn
    pending.at(-1)?.reject(new Error("Engine ran out of memory"));
    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));

    const messages = sessions.get("chat-1")?.messages ?? [];
    expect(messages).toHaveLength(2);
    const assistantMsg = messages[1];
    expect(assistantMsg.failed).toBe(true);
    expect(assistantMsg.error).toBe("Engine ran out of memory");
    expect(assistantMsg.content).toBe("Here is the code: function test() {}");
    expect(assistantMsg.textContent).toBe("Here is the code: function test() {}");
    expect(assistantMsg.steps).toHaveLength(1);
  });

  it("reads the newest host after it is reconfigured", () => {
    const first = createHost();
    const manager = createTaskManager(first.host);

    const second = createHost();
    manager.configure(second.host);

    manager.send("chat-1", "hello");

    expect(second.sessions.get("chat-1")).toBeTruthy();
    expect(first.sessions.get("chat-1")).toBeUndefined();
  });
});

describe("a turn waiting on the user", () => {
  const ask = (chatId: string) =>
    pending[pending.length - 1].host.requestApproval!({
      id: `approval-${chatId}`,
      tool: "write_file",
      target: "C:\\projects\\thing\\notes.md",
      reason: "This changes something outside Draggy.",
    });

  it("carries on with the answer the user gives", async () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "write it");
    const answered = ask("chat-1");

    manager.answerApproval("approval-chat-1", "once");

    expect(await answered).toBe("once");
  });

  it("is refused when the conversation is stopped", async () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "write it");
    const answered = ask("chat-1");

    // Otherwise the turn sits on a question nobody is looking at any more.
    manager.stop("chat-1");

    expect(await answered).toBe("no");
  });

  it("is refused for every conversation when everything stops", async () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "write it");
    const first = ask("chat-1");
    manager.send("chat-2", "write it too");
    const second = ask("chat-2");

    manager.stopAll();

    expect(await first).toBe("no");
    expect(await second).toBe("no");
  });

  it("ignores an answer to something nobody asked", () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    expect(() => manager.answerApproval("not-a-real-id", "once")).not.toThrow();
  });

  it("keeps a lasting permission through the host", () => {
    const { host, granted } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "write it");
    const turn = pending[pending.length - 1];
    turn.host.onGrant!({ tool: "write_file", target: "C:\\projects" });

    expect(granted).toEqual([{ tool: "write_file", target: "C:\\projects" }]);
  });
});

describe("the end of every turn", () => {
  it("says nothing is driving the pane only once the last turn is over", async () => {
    const { host } = createHost();
    const onIdle = vi.fn();
    const manager = createTaskManager({ ...host, onIdle, oneTurnAtATime: true });

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");

    pending[pending.length - 1].resolve(finished());
    await vi.waitFor(() => expect(manager.isRunning("chat-2")).toBe(true));
    expect(onIdle).not.toHaveBeenCalled();

    pending[pending.length - 1].resolve(finished());
    await vi.waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1));
  });

  it("says it when the user stops the only turn", async () => {
    const { host } = createHost();
    const onIdle = vi.fn();
    const manager = createTaskManager({ ...host, onIdle });

    manager.send("chat-1", "go");
    manager.stop("chat-1");
    pending[pending.length - 1].resolve(finished());

    await vi.waitFor(() => expect(onIdle).toHaveBeenCalled());
  });
});

describe("a turn waiting on a question", () => {
  const question = { id: "q-1", text: "Which one?", options: ["A", "B"], multiple: false };
  const ask = () => pending[pending.length - 1].host.requestAnswer!(question);

  it("carries on with the reply the user gives", async () => {
    const manager = createTaskManager(createHost().host);

    manager.send("chat-1", "go");
    const answered = ask();
    manager.answerQuestion("q-1", { choices: ["B"], text: "" });

    expect(await answered).toEqual({ choices: ["B"], text: "" });
  });

  it("gets nothing back when the user skips", async () => {
    const manager = createTaskManager(createHost().host);

    manager.send("chat-1", "go");
    const answered = ask();
    manager.answerQuestion("q-1", null);

    expect(await answered).toBeNull();
  });

  it("is dismissed when the conversation is stopped", async () => {
    const manager = createTaskManager(createHost().host);

    manager.send("chat-1", "go");
    const answered = ask();
    manager.stop("chat-1");

    expect(await answered).toBeNull();
  });

  it("ignores a reply to a question nobody asked", () => {
    const manager = createTaskManager(createHost().host);
    expect(() => manager.answerQuestion("nope", null)).not.toThrow();
  });
});

describe("recording a finished turn for the statistics page", () => {
  beforeEach(() => {
    pending.length = 0;
  });

  const measured = (extra: Partial<AgentResult> = {}) =>
    ({
      ...finished(),
      loops: 3,
      aborted: false,
      toolCalls: { read_file: 2, git_status: 1 },
      metrics: {
        promptTokens: 2000,
        responseTokens: 400,
        promptMs: 100,
        responseMs: 8000,
        loadMs: 0,
        totalMs: 8100,
        tokensPerSecond: 50,
        timeToFirstTokenMs: 300,
        contextWindow: 16384,
        model: "qwen3:8b",
        gpuPercent: 100,
      },
      ...extra,
    }) as unknown as AgentResult;

  it("hands over speed, tokens, tools and how long the task took", async () => {
    const { sessions, host } = createHost();
    const recorded: MetricRow[] = [];
    host.recordMetrics = (row) => recorded.push(row);
    seed(sessions, "a");

    const manager = createTaskManager(host);
    manager.send("a", "hello");
    await Promise.resolve();

    pending[0].resolve(measured());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      chatId: "a",
      model: "qwen3:8b",
      promptTokens: 2000,
      responseTokens: 400,
      responseMs: 8000,
      firstTokenMs: 300,
      loops: 3,
      tools: { read_file: 2, git_status: 1 },
    });
    expect(recorded[0].taskMs).toBeGreaterThanOrEqual(0);
  });

  it("adds what the turn cost to the recorded row", async () => {
    const { sessions, host } = createHost();
    const recorded: MetricRow[] = [];
    host.recordMetrics = (row) => recorded.push(row);
    host.priceTurn = async () => ({ providerId: "openai", kind: "billed", costMicros: 10_500, costSource: "table" });
    seed(sessions, "a");

    const manager = createTaskManager(host);
    manager.send("a", "hello");
    await Promise.resolve();

    pending[0].resolve(measured());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ chatId: "a", providerId: "openai", kind: "billed", costMicros: 10_500, costSource: "table" });
  });

  it("still records the turn when pricing it fails", async () => {
    const { sessions, host } = createHost();
    const recorded: MetricRow[] = [];
    host.recordMetrics = (row) => recorded.push(row);
    host.priceTurn = () => Promise.reject(new Error("no table"));
    seed(sessions, "a");

    const manager = createTaskManager(host);
    manager.send("a", "hello");
    await Promise.resolve();

    pending[0].resolve(measured());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recorded).toHaveLength(1);
    expect(recorded[0].costMicros).toBeUndefined();
  });

  it("stops a send the budget refuses before the model is called", async () => {
    const { sessions, host } = createHost();
    host.checkBudget = async () => "Budget reached: $10.00 of $10.00 daily limit spent.";
    seed(sessions, "a");

    const manager = createTaskManager(host);
    manager.send("a", "hello");
    await vi.waitFor(() => expect(sessions.get("a")?.isGenerating).toBe(false));

    const reply = sessions.get("a")?.messages.at(-1);
    expect(pending).toHaveLength(0);
    expect(reply).toMatchObject({ role: "assistant", failed: true, errorKind: "budget" });
    expect(reply?.error).toContain("Budget reached");
  });

  it("lets Retry carry on over budget once, then asks again", async () => {
    const { sessions, host } = createHost();
    let checks = 0;
    host.checkBudget = async () => {
      checks++;
      return "Budget reached: $10.00 of $10.00 daily limit spent.";
    };
    seed(sessions, "a");

    const manager = createTaskManager(host);
    manager.send("a", "hello");
    await vi.waitFor(() => expect(sessions.get("a")?.isGenerating).toBe(false));
    expect(checks).toBe(1);

    manager.regenerate("a");
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(checks).toBe(1);

    pending[0].resolve(finished());
    await vi.waitFor(() => expect(sessions.get("a")?.isGenerating).toBe(false));

    manager.send("a", "again");
    await vi.waitFor(() => expect(checks).toBe(2));
  });

  it("goes ahead when the budget check itself fails", async () => {
    const { sessions, host } = createHost();
    host.checkBudget = () => Promise.reject(new Error("no metrics"));
    seed(sessions, "a");

    const manager = createTaskManager(host);
    manager.send("a", "hello");
    await vi.waitFor(() => expect(pending).toHaveLength(1));
  });

  it("creates one correlation id per turn and hands it to the agent", async () => {
    const { sessions, host } = createHost();
    seed(sessions, "a");
    seed(sessions, "b");
    const manager = createTaskManager(host);
    manager.send("a", "one");
    await Promise.resolve();
    pending[pending.length - 1].resolve(finished());
    manager.send("b", "two");
    await vi.waitFor(() => expect(manager.isRunning("b")).toBe(true));
    await Promise.resolve();

    const [first, second] = pending.slice(-2).map((turn) => turn.request.correlationId);
    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(first).not.toBe(second);
  });

  it("records nothing for a turn the user stopped", async () => {
    const { sessions, host } = createHost();
    const recorded: MetricRow[] = [];
    host.recordMetrics = (row) => recorded.push(row);
    seed(sessions, "a");

    const manager = createTaskManager(host);
    manager.send("a", "hello");
    await Promise.resolve();

    pending[0].resolve(measured({ aborted: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recorded).toHaveLength(0);
  });

  it("records nothing for a turn that produced no measurement", async () => {
    const { sessions, host } = createHost();
    const recorded: MetricRow[] = [];
    host.recordMetrics = (row) => recorded.push(row);
    seed(sessions, "a");

    const manager = createTaskManager(host);
    manager.send("a", "hello");
    await Promise.resolve();

    pending[0].resolve(measured({ metrics: null }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recorded).toHaveLength(0);
  });
});

describe("a provider's state on the saved reply", () => {
  const state = { instanceId: "anthropic", state: { signature: "s" } };

  beforeEach(() => {
    pending.length = 0;
  });

  it("is stored on the reply the turn wrote", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);
    manager.send("chat-1", "hello");
    pending[0].resolve({ ...finished(), providerState: state });
    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));
    expect(sessions.get("chat-1")?.messages.at(-1)?.provider_state).toEqual(state);
  });

  it("is not stored for a turn the user stopped", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);
    manager.send("chat-1", "hello");
    // Exhausted is the one stopped finish whose reply is still written.
    pending[0].resolve({ ...finished(), aborted: true, exhausted: true, providerState: state });
    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));
    expect(sessions.get("chat-1")?.messages.at(-1)?.provider_state).toBeUndefined();
  });

  it("goes with the old reply into its version when regenerating", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);
    seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...(sessions.get("chat-1") as ChatSession),
      messages: [
        { id: "m1", role: "user", content: "question" },
        { id: "m2", role: "assistant", content: "first answer", provider_state: state },
      ],
    });
    manager.regenerate("chat-1");
    const reply = sessions.get("chat-1")?.messages[1];
    expect(reply?.versions?.[0]?.provider_state).toEqual(state);
    expect(reply?.provider_state).toBeUndefined();
  });
});

describe("turns that overlap", () => {
  beforeEach(() => {
    pending.length = 0;
    localStorage.clear();
  });

  it("keeps what a stopped reply wrote and says it was stopped", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "write");
    pending[0].host.onPatch({ content: "half an answer", textContent: "half an answer", steps: [] });
    manager.stop("chat-1");

    const last = sessions.get("chat-1")!.messages.at(-1)!;
    expect(last.stopped).toBe(true);
    expect(last.textContent).toBe("half an answer");
    expect(last.failed).toBeUndefined();
  });

  it("drops what the old turn says once a new one has started", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    vi.useFakeTimers();
    try {
      manager.send("chat-1", "first");
      manager.send("chat-1", "second");
      // The old turn ignores the abort, so the new one waits out its grace period.
      await vi.advanceTimersByTimeAsync(3500);
      expect(pending).toHaveLength(2);

      pending[0].host.onPatch({ content: "stale", textContent: "stale", steps: [] });
      pending[0].resolve({ ...finished(), content: "stale", textContent: "stale" });
      await vi.advanceTimersByTimeAsync(10);
      const messages = sessions.get("chat-1")!.messages;
      expect(messages.some((m) => m.content === "stale" || m.textContent === "stale")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues a message sent while a reply is running and sends it after", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.enqueue("chat-1", "next");
    expect(manager.queues()["chat-1"].map((item) => item.content)).toEqual(["next"]);
    expect(pending).toHaveLength(1);

    pending[0].resolve(finished());
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(manager.queues()["chat-1"] ?? []).toEqual([]);
    expect(sessions.get("chat-1")!.messages.some((m) => m.role === "user" && m.content === "next")).toBe(true);
  });

  it("holds the queue when a reply fails", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.enqueue("chat-1", "next");
    pending[0].reject(new Error("bad request"));
    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));

    expect(pending).toHaveLength(1);
    expect(manager.queues()["chat-1"]).toHaveLength(1);
  });

  it("edits, reorders and removes queued messages", () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.enqueue("chat-1", "a");
    manager.enqueue("chat-1", "b");
    const [a, b] = manager.queues()["chat-1"];
    manager.moveQueued("chat-1", b.id, -1);
    manager.editQueued("chat-1", a.id, "a2");
    expect(manager.queues()["chat-1"].map((item) => item.content)).toEqual(["b", "a2"]);
    manager.removeQueued("chat-1", b.id);
    expect(manager.queues()["chat-1"].map((item) => item.content)).toEqual(["a2"]);
  });

  it("hands steering notes to the running loop and queues the ones it never read", async () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.steer("chat-1", "use tabs");
    expect(pending[0].host.takeSteering?.()).toEqual(["use tabs"]);
    expect(pending[0].host.takeSteering?.()).toEqual([]);

    manager.steer("chat-1", "late note");
    pending[0].reject(new Error("bad request"));
    await vi.waitFor(() => expect(manager.running()).toEqual([]));
    expect(manager.queues()["chat-1"].map((item) => item.content)).toEqual(["late note"]);
  });

  it("retries a dropped connection quietly before anything is written", async () => {
    vi.useFakeTimers();
    try {
      const { sessions, host } = createHost();
      const manager = createTaskManager(host);

      manager.send("chat-1", "first");
      pending[0].reject(new Error("fetch failed: ECONNRESET"));
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(2000);
        expect(pending).toHaveLength(2);
      });
      expect(sessions.get("chat-1")!.messages.at(-1)!.failed).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a message sent while another chat holds the turn", () => {
  beforeEach(() => {
    pending.length = 0;
    // A queue saved by an earlier test would send the next message down the queued path.
    localStorage.clear();
  });

  function hostWithLabel() {
    const made = createHost();
    const host: TaskHost = {
      ...made.host,
      oneTurnAtATime: true,
      t: (key) => (key === "messageQueued" ? "Message queued ({position}/{total})…" : key),
    };
    return { sessions: made.sessions, host };
  }

  function statusOf(session: ChatSession | undefined): string | undefined {
    const step = session?.messages.at(-1)?.steps?.[0];
    return step?.type === "loading" ? step.content : undefined;
  }

  it("creates the chat at once with a queued status that survives looking away", () => {
    const { sessions, host } = hostWithLabel();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");

    const parked = sessions.get("chat-2");
    expect(parked?.isGenerating).toBe(true);
    expect(parked?.messages[0].content).toBe("second");
    expect(statusOf(parked)).toBe("Message queued (1/1)…");
  });

  it("numbers the waiting chats and renumbers them as the line moves", async () => {
    const { sessions, host } = hostWithLabel();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");
    manager.send("chat-3", "third");
    expect(statusOf(sessions.get("chat-2"))).toBe("Message queued (1/2)…");
    expect(statusOf(sessions.get("chat-3"))).toBe("Message queued (2/2)…");

    pending[pending.length - 1].resolve(finished());
    await vi.waitFor(() => expect(manager.running()).toEqual(["chat-2"]));
    expect(statusOf(sessions.get("chat-3"))).toBe("Message queued (1/1)…");
  });

  it("appends to an existing chat, keeping what it already said", () => {
    const { sessions, host } = hostWithLabel();
    const manager = createTaskManager(host);
    const existing = seed(sessions, "chat-2");
    sessions.set("chat-2", {
      ...existing,
      messages: [
        { id: "m1", role: "user", content: "earlier" },
        { id: "m2", role: "assistant", content: "answer" },
      ],
    });

    manager.send("chat-1", "first");
    manager.send("chat-2", "again");

    const messages = sessions.get("chat-2")!.messages;
    expect(messages.map((m) => m.content).slice(0, 3)).toEqual(["earlier", "answer", "again"]);
    expect(statusOf(sessions.get("chat-2"))).toBe("Message queued (1/1)…");
  });

  it("queues a follow-up behind the held message instead of replacing it", async () => {
    const { sessions, host } = hostWithLabel();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");
    manager.send("chat-2", "more");

    expect(manager.queues()["chat-2"].map((item) => item.content)).toEqual(["more"]);

    pending[pending.length - 1].resolve(finished());
    await vi.waitFor(() => expect(manager.running()).toEqual(["chat-2"]));
    expect(sessions.get("chat-2")?.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("stopping a waiting chat leaves its message sent and its reply stopped", () => {
    const { sessions, host } = hostWithLabel();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");
    manager.stop("chat-2");

    const reply = sessions.get("chat-2")!.messages.at(-1)!;
    expect(reply.stopped).toBe(true);
    expect(reply.steps).toEqual([]);
    expect(manager.running()).toEqual(["chat-1"]);
  });
});

describe("notes handed to a running turn", () => {
  beforeEach(() => {
    pending.length = 0;
  });

  it("stay visible until the turn reads them", () => {
    const { host } = createHost();
    const manager = createTaskManager(host);
    const seen = vi.fn();
    manager.subscribeSteers(seen);

    manager.send("chat-1", "first");
    manager.steer("chat-1", "use tabs");
    expect(manager.pendingSteers()["chat-1"]).toEqual(["use tabs"]);
    expect(seen).toHaveBeenCalled();

    expect(pending[0].host.takeSteering?.()).toEqual(["use tabs"]);
    expect(manager.pendingSteers()["chat-1"]).toBeUndefined();
  });

  it("go when the turn is stopped", () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.steer("chat-1", "use tabs");
    manager.stop("chat-1");

    expect(manager.pendingSteers()["chat-1"]).toBeUndefined();
  });
});
