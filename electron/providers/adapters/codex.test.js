import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createCodexAdapter, toItems } = require("./codex.cjs");
const { assetFor } = require("../codex/binary.cjs");

/** A runtime that answers the calls a turn makes and lets the test play Codex's side of it. */
function fakeCodex({ account = { email: "a@b.c" }, installed = "codex.exe", more = {} } = {}) {
  const codex = { calls: [], starts: 0, threads: 0, exit: null, notify: null, request: null, account };
  const answers = {
    "account/read": () => ({ account: codex.account, requiresOpenaiAuth: true }),
    "thread/start": () => ({ thread: { id: `t${++codex.threads}` } }),
    "thread/inject_items": () => ({}),
    "turn/start": (params) => ({ turn: { id: `turn-${params.threadId}` } }),
    "turn/interrupt": () => ({}),
    ...more,
  };
  const start = vi.fn(async ({ onNotification, onRequest, onExit }) => {
    codex.starts += 1;
    codex.notify = onNotification;
    codex.request = onRequest;
    codex.exit = onExit;
    return {
      home: "C:/data/codex/chatgpt",
      stop: vi.fn(async () => {}),
      rpc: {
        call: vi.fn(async (method, params) => {
          codex.calls.push({ method, params });
          return answers[method](params);
        }),
      },
    };
  });
  const ensure = vi.fn(async () => "codex.exe");
  const adapter = createCodexAdapter({
    appData: "C:/data",
    version: "1.3.0",
    ensure,
    installed: () => installed,
    start,
    settleMs: 0,
    supervisor: { sleep: async () => {} },
  });
  codex.ensure = ensure;
  codex.methods = () => codex.calls.map((c) => c.method);
  codex.call = (method) => codex.calls.filter((c) => c.method === method).at(-1)?.params;
  return { adapter, codex };
}

function recorder() {
  const events = [];
  return {
    events,
    delta: (d) => events.push(["delta", d]),
    finish: (reason, usage) => events.push(["finish", reason, usage]),
    providerState: (state) => events.push(["state", state]),
    retry: () => {},
  };
}

const connection = { instance: { id: "chatgpt", label: "ChatGPT" } };
const system = { role: "system", content: "Draggy's prompt" };
const user = (id, content = id) => ({ role: "user", content, draggy_ref: { id, hash: `h-${content}` } });
const TOOLS = [{ type: "function", function: { name: "read_file", description: "Reads", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Starts a leg and waits until Codex has been asked to run it. */
async function leg(adapter, codex, messages, extra = {}) {
  const sse = recorder();
  const controller = new AbortController();
  const done = adapter.stream({ body: { stream: true, messages, tools: TOOLS, ...extra }, connection, modelId: "gpt-5.5", sse, signal: controller.signal });
  done.catch(() => undefined);
  await tick();
  return { sse, done, controller };
}

const complete = (codex, threadId, status = "completed", error = null) => codex.notify("turn/completed", { threadId, turn: { id: `turn-${threadId}`, status, error, items: [] } });

describe("the ChatGPT account adapter", () => {
  it("seeds a thread with Draggy's prompt and tools only, then streams the turn back", async () => {
    const { adapter, codex } = fakeCodex();
    const { sse, done } = await leg(adapter, codex, [system, user("u1", "hi")], { think: true, thinking_level: "high" });
    expect(codex.call("thread/start")).toEqual({
      model: "gpt-5.5",
      cwd: "C:/data/codex/chatgpt",
      environments: [],
      ephemeral: true,
      baseInstructions: "Draggy's prompt",
      dynamicTools: [{ type: "function", name: "read_file", description: "Reads", inputSchema: TOOLS[0].function.parameters }],
    });
    expect(codex.call("turn/start")).toEqual({ threadId: "t1", input: [{ type: "text", text: "hi", text_elements: [] }], effort: "high", summary: "auto" });
    expect(codex.methods()).not.toContain("thread/inject_items");

    codex.notify("item/reasoning/summaryTextDelta", { threadId: "t1", delta: "hmm" });
    codex.notify("item/agentMessage/delta", { threadId: "t1", delta: "Hello" });
    codex.notify("thread/tokenUsage/updated", { threadId: "t1", tokenUsage: { last: { inputTokens: 9, outputTokens: 2 } } });
    complete(codex, "t1");
    await done;
    expect(sse.events).toEqual([
      ["delta", { reasoning: "hmm" }],
      ["delta", { content: "Hello" }],
      ["state", { instanceId: "chatgpt", state: expect.objectContaining({ threadId: "t1", consumed: 1 }) }],
      ["finish", "stop", { promptTokens: 9, outputTokens: 2 }],
    ]);
  });

  it("resumes the thread with only the new input on the next turn", async () => {
    const { adapter, codex } = fakeCodex();
    const first = await leg(adapter, codex, [system, user("u1")]);
    complete(codex, "t1");
    await first.done;
    const state = first.sse.events.find(([kind]) => kind === "state")[1];
    const reply = { role: "assistant", content: "r1", draggy_ref: { id: "r1", hash: "h" }, provider_state: state };
    const second = await leg(adapter, codex, [system, user("u1"), reply, user("u2")]);
    expect(codex.methods().filter((m) => m === "thread/start")).toHaveLength(1);
    expect(codex.call("turn/start")).toMatchObject({ threadId: "t1", input: [{ type: "text", text: "u2" }] });
    complete(codex, "t1");
    await second.done;
  });

  it("hands a tool call to Draggy, keeps the turn open, and answers it from the next request", async () => {
    const { adapter, codex } = fakeCodex();
    const messages = [system, user("u1")];
    const first = await leg(adapter, codex, messages);
    const answer = codex.request("item/tool/call", { threadId: "t1", turnId: "turn-t1", callId: "call-1", namespace: null, tool: "read_file", arguments: { path: "a.txt" } });
    await first.done;
    expect(first.sse.events).toEqual([
      ["delta", { toolCalls: [{ index: 0, id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }] }],
      ["finish", "tool_calls", {}],
    ]);

    const call = { role: "assistant", content: "", tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }] };
    const second = await leg(adapter, codex, [...messages, call, { role: "tool", tool_call_id: "call-1", content: "file text" }]);
    await expect(answer).resolves.toEqual({ contentItems: [{ type: "inputText", text: "file text" }], success: true });
    expect(codex.methods().filter((m) => m === "turn/start")).toHaveLength(1);
    codex.notify("item/agentMessage/delta", { threadId: "t1", delta: "It says file text." });
    complete(codex, "t1");
    await second.done;
    expect(second.sse.events.find(([kind]) => kind === "state")[1].state).toMatchObject({ threadId: "t1", consumed: 1 });
  });

  it.each([
    ["item/commandExecution/requestApproval", { decision: "decline" }],
    ["item/fileChange/requestApproval", { decision: "decline" }],
    ["execCommandApproval", { decision: "denied" }],
  ])("refuses Codex's own tool (%s), interrupts the turn and reports it", async (method, refusal) => {
    const { adapter, codex } = fakeCodex();
    const { done } = await leg(adapter, codex, [system, user("u1")]);
    expect(await codex.request(method, { threadId: "t1", turnId: "turn-t1" })).toEqual(refusal);
    expect(codex.call("turn/interrupt")).toEqual({ threadId: "t1", turnId: "turn-t1" });
    complete(codex, "t1", "interrupted");
    await expect(done).rejects.toMatchObject({ failure: { kind: "provider-unknown-error", message: expect.stringContaining(method) } });
  });

  it("never refreshes a token for Codex", () => {
    const { codex, adapter } = fakeCodex();
    adapter.runtimeFor("chatgpt");
    return leg(adapter, codex, [system, user("u1")]).then(() => {
      expect(() => codex.request("account/chatgptAuthTokens/refresh", {})).toThrow();
    });
  });

  it("interrupts on Stop and seeds a new thread next time, since the stopped one matches no stored message", async () => {
    const { adapter, codex } = fakeCodex();
    const first = await leg(adapter, codex, [system, user("u1")]);
    complete(codex, "t1");
    await first.done;
    const state = first.sse.events.find(([kind]) => kind === "state")[1];
    const history = [system, user("u1"), { role: "assistant", content: "r1", draggy_ref: { id: "r1", hash: "h" }, provider_state: state }, user("u2")];
    const second = await leg(adapter, codex, history);
    second.controller.abort();
    await second.done;
    expect(codex.call("turn/interrupt")).toEqual({ threadId: "t1", turnId: "turn-t1" });
    const third = await leg(adapter, codex, history);
    expect(codex.call("thread/start")).toBeDefined();
    expect(codex.call("turn/start").threadId).toBe("t2");
    expect(codex.call("thread/inject_items").items).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "u1" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "r1" }] },
    ]);
    complete(codex, "t2");
    await third.done;
  });

  it("ends a turn left open by a Stop during a tool call before answering the next message", async () => {
    const { adapter, codex } = fakeCodex();
    const first = await leg(adapter, codex, [system, user("u1")]);
    const answer = codex.request("item/tool/call", { threadId: "t1", turnId: "turn-t1", callId: "call-1", tool: "read_file", arguments: {} });
    await first.done;
    const next = await leg(adapter, codex, [system, user("u1"), user("u2")]);
    await expect(answer).resolves.toMatchObject({ success: false });
    expect(codex.call("turn/start").threadId).toBe("t2");
    complete(codex, "t2");
    await next.done;
  });

  it("says the account is signed out before starting anything", async () => {
    const { adapter, codex } = fakeCodex({ account: null });
    const { done } = await leg(adapter, codex, [system, user("u1")]);
    await expect(done).rejects.toMatchObject({ failure: { kind: "account-signed-out" } });
    expect(codex.methods()).toEqual(["account/read"]);
  });

  it("reports a spent plan with its reset time, and never retries it", async () => {
    const { adapter, codex } = fakeCodex();
    const { done } = await leg(adapter, codex, [system, user("u1")]);
    codex.notify("account/rateLimits/updated", { rateLimits: { primary: { usedPercent: 100, resetsAt: 1790000000 }, secondary: null } });
    complete(codex, "t1", "failed", { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" });
    await expect(done).rejects.toMatchObject({ failure: { kind: "account-limit-reached", resetsAt: 1790000000 } });
    expect(codex.methods().filter((m) => m === "turn/start")).toHaveLength(1);
  });

  it("finishes with length when the context runs out", async () => {
    const { adapter, codex } = fakeCodex();
    const { sse, done } = await leg(adapter, codex, [system, user("u1")]);
    complete(codex, "t1", "failed", { message: "full", codexErrorInfo: "contextWindowExceeded" });
    await done;
    expect(sse.events.at(-1)).toEqual(["finish", "length", {}]);
  });

  it("fails a turn in flight when Codex exits, and starts it again for the next", async () => {
    const { adapter, codex } = fakeCodex();
    const { done } = await leg(adapter, codex, [system, user("u1")]);
    codex.exit(1);
    await expect(done).rejects.toMatchObject({ failure: { kind: "account-runtime-unavailable" } });
    const again = await leg(adapter, codex, [system, user("u1")]);
    expect(codex.starts).toBe(2);
    complete(codex, "t2");
    await again.done;
  });
});

describe("seeding items", () => {
  it("replays tool traffic as function calls and outputs, and images as input images", () => {
    expect(toItems({ role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] })).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "see" }, { type: "input_image", image_url: "data:image/png;base64,AA" }] },
    ]);
    expect(toItems({ role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "f", arguments: { a: 1 } } }] })).toEqual([
      { type: "function_call", call_id: "c1", name: "f", arguments: '{"a":1}' },
    ]);
    expect(toItems({ role: "tool", tool_call_id: "c1", content: "out" })).toEqual([{ type: "function_call_output", call_id: "c1", output: "out" }]);
    expect(toItems({ role: "system", content: "x" })).toEqual([]);
  });
});

describe("the ChatGPT account", () => {
  const limits = { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1790000000 }, secondary: null };

  it("signs in through Codex's own browser flow and never touches a token", async () => {
    const opened = [];
    const { adapter, codex } = fakeCodex({
      account: null,
      more: {
        "account/login/start": () => ({ type: "chatgpt", loginId: "L1", authUrl: "https://auth.openai.com/x" }),
        "account/rateLimits/read": () => ({ rateLimits: limits }),
      },
    });
    const progress = [];
    const openExternal = async (url) => {
      opened.push(url);
      codex.account = { type: "chatgpt", email: "a@b.c", planType: "pro" };
      codex.notify("account/login/completed", { loginId: "L1", success: true, error: null });
    };
    const signingIn = adapter.signIn("chatgpt", { onProgress: (p) => progress.push(p), openExternal });
    const answer = await signingIn;
    expect(codex.call("account/login/start")).toEqual({ type: "chatgpt" });
    expect(opened).toEqual(["https://auth.openai.com/x"]);
    expect(progress.map((p) => p.step)).toEqual(["browser", "done"]);
    expect(answer).toEqual({ signedIn: true, email: "a@b.c", plan: "pro", limits: [{ window: 300, usedPercent: 12, resetsAt: 1790000000 }] });
    expect(codex.methods().filter((m) => /token|apiKey/i.test(m))).toEqual([]);
  });

  it("reports the download as the install step", async () => {
    const { adapter, codex } = fakeCodex();
    codex.ensure.mockImplementation(async (dir, { onProgress } = {}) => {
      onProgress?.({ percent: 40 });
      return "codex.exe";
    });
    const progress = [];
    await adapter.signIn("chatgpt", { onProgress: (p) => progress.push(p), openExternal: async () => {} });
    expect(progress[0]).toEqual({ step: "installing", percent: 40 });
    expect(codex.methods()).not.toContain("account/login/start");
  });

  it("cancels a sign-in that is waiting on the browser", async () => {
    const { adapter, codex } = fakeCodex({
      account: null,
      more: { "account/login/start": () => ({ loginId: "L1", authUrl: "https://auth.openai.com/x" }), "account/login/cancel": () => ({}) },
    });
    let opened;
    const browser = new Promise((resolve) => (opened = resolve));
    const signingIn = adapter.signIn("chatgpt", { openExternal: async () => opened() });
    await browser;
    await adapter.cancel("chatgpt");
    expect(await signingIn).toEqual({ signedIn: false, cancelled: true, error: null });
    expect(codex.call("account/login/cancel")).toEqual({ loginId: "L1" });
  });

  it("fails a waiting sign-in when Codex exits", async () => {
    const { adapter, codex } = fakeCodex({ account: null, more: { "account/login/start": () => ({ loginId: "L1", authUrl: "https://x" }) } });
    let opened;
    const browser = new Promise((resolve) => (opened = resolve));
    const signingIn = adapter.signIn("chatgpt", { openExternal: async () => opened() });
    await browser;
    codex.exit(1);
    expect(await signingIn).toMatchObject({ signedIn: false, cancelled: false });
  });

  it("answers the status with the plan and usage, and never downloads to do it", async () => {
    const { adapter, codex } = fakeCodex({ account: { type: "chatgpt", email: "a@b.c", planType: "plus" }, more: { "account/rateLimits/read": () => ({ rateLimits: limits }) } });
    expect(await adapter.status("chatgpt")).toEqual({
      signedIn: true,
      email: "a@b.c",
      plan: "plus",
      limits: [{ window: 300, usedPercent: 12, resetsAt: 1790000000 }],
    });
    const fresh = fakeCodex({ installed: null });
    expect(await fresh.adapter.status("chatgpt")).toEqual({ signedIn: false });
    expect(fresh.adapter.download()).toBe(assetFor().size);
    expect(fakeCodex().adapter.download()).toBeNull();
    expect(await fresh.adapter.models("chatgpt")).toEqual([]);
    await fresh.adapter.signOut("chatgpt");
    expect(fresh.codex.starts).toBe(0);
    expect(fresh.codex.ensure).not.toHaveBeenCalled();
  });

  it("signs out through Codex and forgets its threads", async () => {
    const { adapter, codex } = fakeCodex({ more: { "account/logout": () => ({}) } });
    const { sse, done } = await leg(adapter, codex, [system, user("u1", "hi")]);
    complete(codex, "t1");
    await done;
    const reply = { role: "assistant", content: "ok", provider_state: sse.events.find(([kind]) => kind === "state")[1] };
    const threads = adapter.runtimeFor("chatgpt").threads;
    expect(threads.plan([system, user("u1", "hi"), reply, user("u2")]).id).toBe("t1");
    await adapter.signOut("chatgpt");
    expect(codex.methods()).toContain("account/logout");
    expect(threads.plan([system, user("u1", "hi"), reply, user("u2")]).id).toBeNull();
  });

  it("lists the visible models across pages", async () => {
    const pages = {
      "": { data: [{ id: "gpt-5.5", displayName: "GPT-5.5", hidden: false, inputModalities: ["text", "image"] }], nextCursor: "c2" },
      c2: { data: [{ id: "codex-auto", displayName: "Auto", hidden: true, inputModalities: ["text"] }], nextCursor: null },
    };
    const { adapter } = fakeCodex({ more: { "model/list": (params) => pages[params.cursor || ""] } });
    // The window comes from the catalog Codex is given, which model/list leaves out.
    expect(await adapter.models("chatgpt")).toEqual([{ id: "gpt-5.5", name: "GPT-5.5", contextLength: 272000, inputModalities: ["text", "image"] }]);
  });
});
