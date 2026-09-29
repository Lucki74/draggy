import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createClaudeAdapter, toContent, turnFailure } = require("./claude.cjs");

/** Plays Claude Code's side: each start is one process whose messages and control requests the test sends. */
function fakeClaude({ loggedIn = true, onDisk = () => true } = {}) {
  const claude = { starts: [], auth: [] };
  const start = vi.fn(async ({ args, onMessage, onControl, onExit }) => {
    const proc = {
      args,
      sent: [],
      requests: [],
      stopped: false,
      emit: onMessage,
      control: onControl,
      exit: onExit,
      request: vi.fn(async (subtype) => proc.requests.push(subtype)),
      sendUser: vi.fn((content) => proc.sent.push(content)),
      stop: vi.fn(async () => {
        proc.stopped = true;
      }),
    };
    claude.starts.push(proc);
    return proc;
  });
  const auth = vi.fn(async ({ args }) => {
    claude.auth.push(args);
    return { code: 0, out: JSON.stringify({ loggedIn: claude.loggedIn, authMethod: "claude.ai" }) };
  });
  claude.loggedIn = loggedIn;
  let ids = 0;
  const adapter = createClaudeAdapter({
    appData: "C:/data",
    version: "1.3.0",
    ensure: async () => "claude.exe",
    installed: () => "claude.exe",
    start,
    auth,
    settleMs: 0,
    supervisor: { sleep: async () => {} },
    newId: () => `id${++ids}`,
    onDisk,
  });
  claude.last = () => claude.starts.at(-1);
  return { adapter, claude };
}

function recorder() {
  const events = [];
  return {
    events,
    delta: (d) => events.push(["delta", d]),
    finish: (reason, usage) => events.push(["finish", reason, usage]),
    providerState: (state) => events.push(["state", state]),
  };
}

const connection = { instance: { id: "claude", label: "Claude" } };
const system = { role: "system", content: "Draggy's prompt" };
const user = (id, content = id) => ({ role: "user", content, draggy_ref: { id, hash: `h-${content}` } });
const reply = (id, content, state) => ({ role: "assistant", content, draggy_ref: { id, hash: `h-${content}` }, provider_state: state });
const TOOLS = [{ type: "function", function: { name: "read_file", description: "Reads", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function leg(adapter, messages, extra = {}, modelId = "sonnet") {
  const sse = recorder();
  const controller = new AbortController();
  const done = adapter.stream({ body: { stream: true, messages, tools: TOOLS, ...extra }, connection, modelId, sse, signal: controller.signal });
  done.catch(() => undefined);
  await tick();
  return { sse, done, controller };
}

const say = (proc, text) => proc.emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
function succeed(proc, at = "a1", usage = { input_tokens: 5, cache_read_input_tokens: 4, output_tokens: 2 }) {
  proc.emit({ type: "assistant", uuid: at, message: { content: [{ type: "text", text: "..." }] } });
  proc.emit({ type: "result", subtype: "success", is_error: false, usage });
}
const stateOf = (sse) => sse.events.find(([kind]) => kind === "state")[1];

describe("the Claude account adapter", () => {
  it("starts a new session with Draggy's prompt, model and effort, and streams the turn back", async () => {
    const { adapter, claude } = fakeClaude();
    const { sse, done } = await leg(adapter, [system, user("u1", "hi")], { think: true, thinking_level: "high" });
    expect(claude.auth).toEqual([["status", "--json"]]);
    expect(claude.last().args).toEqual([
      "--system-prompt", "Draggy's prompt", "--model", "sonnet", "--effort", "high", "--thinking", "adaptive", "--session-id", "id1",
    ]);
    expect(claude.last().sent).toEqual([[{ type: "text", text: "hi" }]]);

    claude.last().emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } } });
    say(claude.last(), "Hello");
    succeed(claude.last());
    await done;
    expect(sse.events).toEqual([
      ["delta", { reasoning: "hmm" }],
      ["delta", { content: "Hello" }],
      ["state", { instanceId: "claude", state: expect.objectContaining({ sessionId: "id1", consumed: 1, at: "a1" }) }],
      ["finish", "stop", { promptTokens: 9, outputTokens: 2 }],
    ]);
  });

  it("sends only the new input to the same process on the next turn", async () => {
    const { adapter, claude } = fakeClaude();
    const first = await leg(adapter, [system, user("u1")]);
    succeed(claude.last());
    await first.done;
    const second = await leg(adapter, [system, user("u1"), reply("r1", "hello", stateOf(first.sse)), user("u2", "more")]);
    expect(claude.starts).toHaveLength(1);
    expect(claude.last().sent.at(-1)).toEqual([{ type: "text", text: "more" }]);
    succeed(claude.last(), "a2");
    await second.done;
    expect(stateOf(second.sse).state).toMatchObject({ sessionId: "id1", consumed: 3, at: "a2" });
  });

  it("offers only Draggy's tools, holds a call open for approval, and answers it with the next request", async () => {
    const { adapter, claude } = fakeClaude();
    const first = await leg(adapter, [system, user("u1", "read a")]);
    const proc = claude.last();
    const listed = await proc.control({ subtype: "mcp_message", server_name: "draggy", message: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(listed).toEqual({ mcp_response: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "read_file", description: "Reads", inputSchema: TOOLS[0].function.parameters }] } } });
    expect(await proc.control({ subtype: "can_use_tool", tool_name: "mcp__draggy__read_file", input: { path: "a" } })).toEqual({ behavior: "allow", updatedInput: { path: "a" } });

    const call = proc.control({ subtype: "mcp_message", server_name: "draggy", message: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_file", arguments: { path: "a" } } } });
    await first.done;
    const id = first.sse.events[0][1].toolCalls[0].id;
    expect(first.sse.events).toEqual([
      ["delta", { toolCalls: [{ index: 0, id, type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }] }],
      ["finish", "tool_calls", {}],
    ]);

    const messages = [system, user("u1", "read a"), { role: "assistant", content: "", tool_calls: [{ id, function: { name: "read_file", arguments: '{"path":"a"}' } }] }, { role: "tool", tool_call_id: id, content: "file a" }];
    const second = await leg(adapter, messages);
    expect(await call).toEqual({ mcp_response: { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "file a" }], isError: false } } });
    say(proc, "It says file a.");
    succeed(proc);
    await second.done;
    expect(second.sse.events.at(-1)).toEqual(["finish", "stop", { promptTokens: 9, outputTokens: 2 }]);
    expect(proc.sent).toHaveLength(1);
  });

  it("refuses any tool that is not Draggy's, interrupts, and fails the turn", async () => {
    const { adapter, claude } = fakeClaude();
    const { done } = await leg(adapter, [system, user("u1")]);
    const proc = claude.last();
    expect(await proc.control({ subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -rf /" } })).toEqual({ behavior: "deny", message: "Only Draggy's tools may run." });
    expect(proc.requests).toEqual(["interrupt"]);
    proc.emit({ type: "result", subtype: "error_during_execution", is_error: true });
    await expect(done).rejects.toMatchObject({ failure: { kind: "provider-unknown-error", message: expect.stringContaining("Bash") } });
    await expect(proc.control({ subtype: "hook_callback" })).rejects.toThrow("not available");
  });

  it("interrupts on Stop, then forks the stored session at its last reply instead of reusing the cut one", async () => {
    const { adapter, claude } = fakeClaude();
    const first = await leg(adapter, [system, user("u1")]);
    succeed(claude.last(), "a1");
    await first.done;
    const state = stateOf(first.sse);
    const history = [system, user("u1"), reply("r1", "hello", state)];

    const stopped = await leg(adapter, [...history, user("u2", "long")]);
    stopped.controller.abort();
    await stopped.done;
    expect(claude.last().requests).toEqual(["interrupt"]);

    const again = await leg(adapter, [...history, user("u3", "short")]);
    expect(claude.starts).toHaveLength(2);
    expect(claude.starts[0].stopped).toBe(true);
    expect(claude.last().args.slice(-6)).toEqual(["--resume", "id1", "--resume-session-at=a1", "--fork-session", "--session-id", "id2"]);
    expect(claude.last().sent).toEqual([[{ type: "text", text: "short" }]]);
    succeed(claude.last(), "b1");
    await again.done;
    expect(stateOf(again.sse).state).toMatchObject({ sessionId: "id2", consumed: 3, at: "b1" });
  });

  it("after a restart, forks a session still on disk, and reseeds with the transcript when it is gone", async () => {
    const state = { instanceId: "claude", state: { sessionId: "old", consumed: 1, prefixHash: null, at: "a9" } };
    const { hashRefs } = require("../account/threads.cjs");
    state.state.prefixHash = hashRefs([user("u1").draggy_ref]);
    const messages = [system, user("u1", "u1"), reply("r1", "hello", state), user("u2", "next")];

    const kept = fakeClaude();
    const one = await leg(kept.adapter, messages);
    expect(kept.claude.last().args.slice(-6)).toEqual(["--resume", "old", "--resume-session-at=a9", "--fork-session", "--session-id", "id1"]);
    expect(kept.claude.last().sent).toEqual([[{ type: "text", text: "next" }]]);
    succeed(kept.claude.last());
    await one.done;

    const lost = fakeClaude({ onDisk: () => false });
    const two = await leg(lost.adapter, messages);
    expect(lost.claude.last().args.slice(-2)).toEqual(["--session-id", "id1"]);
    expect(lost.claude.last().sent).toEqual([[
      { type: "text", text: "<conversation_so_far>\nUser: u1\n\nAssistant: hello\n</conversation_so_far>" },
      { type: "text", text: "next" },
    ]]);
    succeed(lost.claude.last());
    await two.done;
  });

  it("restarts the process on the same session when the model or effort changes", async () => {
    const { adapter, claude } = fakeClaude();
    const first = await leg(adapter, [system, user("u1")]);
    succeed(claude.last());
    await first.done;
    const second = await leg(adapter, [system, user("u1"), reply("r1", "hello", stateOf(first.sse)), user("u2")], {}, "opus");
    expect(claude.starts[0].stopped).toBe(true);
    expect(claude.last().args).toEqual(expect.arrayContaining(["--model", "opus", "--resume", "id1"]));
    expect(claude.last().args).not.toContain("--session-id");
    succeed(claude.last());
    await second.done;
  });

  it("reports a signed-out account without starting Claude Code", async () => {
    const { adapter, claude } = fakeClaude({ loggedIn: false });
    const { done } = await leg(adapter, [system, user("u1")]);
    await expect(done).rejects.toMatchObject({ failure: { kind: "account-signed-out" } });
    expect(claude.starts).toHaveLength(0);
  });

  it("never retries a plan limit, and keeps the reset time the runtime gave", async () => {
    const { adapter, claude } = fakeClaude();
    const { done } = await leg(adapter, [system, user("u1")]);
    claude.last().emit({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790000000 } });
    claude.last().emit({ type: "result", subtype: "success", is_error: true, result: "You've hit your limit" });
    await expect(done).rejects.toMatchObject({ failure: { kind: "account-limit-reached", resetsAt: 1790000000 } });
    expect(claude.starts).toHaveLength(1);
  });

  it("marks the account signed out when the runtime says so mid-turn", async () => {
    const { adapter, claude } = fakeClaude();
    const first = await leg(adapter, [system, user("u1")]);
    claude.last().emit({ type: "result", subtype: "success", is_error: true, result: "Invalid API key · Please run /login" });
    await expect(first.done).rejects.toMatchObject({ failure: { kind: "account-signed-out" } });
    claude.loggedIn = false;
    const second = await leg(adapter, [system, user("u1")]);
    await expect(second.done).rejects.toMatchObject({ failure: { kind: "account-signed-out" } });
    expect(claude.auth).toHaveLength(2);
  });

  it("fails the turn when the process goes away in the middle of it", async () => {
    const { adapter, claude } = fakeClaude();
    const { done } = await leg(adapter, [system, user("u1")]);
    claude.last().exit(1);
    await expect(done).rejects.toMatchObject({ failure: { kind: "account-runtime-unavailable" } });
  });

  it("reports a max-tokens stop as length", async () => {
    const { adapter, claude } = fakeClaude();
    const { sse, done } = await leg(adapter, [system, user("u1")]);
    claude.last().emit({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "max_tokens" } } });
    succeed(claude.last());
    await done;
    expect(sse.events.at(-1)[1]).toBe("length");
  });
});

describe("claude turn content", () => {
  it("keeps images as base64 blocks and flattens earlier messages, tool calls included", () => {
    const input = { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] };
    const history = [{ role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: '{"path":"a"}' } }] }, { role: "tool", content: "file a" }];
    expect(toContent(history, input)).toEqual([
      { type: "text", text: '<conversation_so_far>\nAssistant: [called read_file with {"path":"a"}]\n\nTool result: file a\n</conversation_so_far>' },
      { type: "text", text: "look" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("reads a limit's reset time from the runtime's message when it carries one", () => {
    expect(turnFailure("Claude AI usage limit reached|1790000000")).toMatchObject({ kind: "account-limit-reached", resetsAt: 1790000000 });
    expect(turnFailure("API Error: 529 overloaded")).toMatchObject({ kind: "provider-rate-limited" });
    expect(turnFailure("")).toMatchObject({ kind: "provider-unknown-error", message: "The turn failed." });
  });
});
