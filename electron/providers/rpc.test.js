import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createRpc, drainStderr, redact, RpcError } = require("./rpc.cjs");

/** A fake runtime: what the client writes lands in `sent`, and `reply` plays the runtime's side. */
function pair(options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent = [];
  output.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) sent.push(JSON.parse(line));
  });
  const rpc = createRpc({ input, output, ...options });
  const reply = (message) => input.write(`${JSON.stringify(message)}\n`);
  return { rpc, input, sent, reply };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => vi.useRealTimers());

describe("rpc", () => {
  it("matches answers to calls by id, whatever order they come back in", async () => {
    const { rpc, sent, reply } = pair();
    const first = rpc.call("thread/start", { model: "a" });
    const second = rpc.call("model/list");
    await tick();
    expect(sent).toEqual([
      { id: 1, method: "thread/start", params: { model: "a" } },
      { id: 2, method: "model/list" },
    ]);
    reply({ id: 2, result: { data: [] } });
    reply({ id: 1, result: { thread: { id: "t" } } });
    await expect(first).resolves.toEqual({ thread: { id: "t" } });
    await expect(second).resolves.toEqual({ data: [] });
  });

  it("adds the jsonrpc field only when the protocol wants it", async () => {
    const codex = pair();
    const acp = pair({ jsonrpc: true });
    codex.rpc.notify("initialized");
    acp.rpc.notify("initialized");
    await tick();
    expect(codex.sent[0]).toEqual({ method: "initialized" });
    expect(acp.sent[0]).toEqual({ jsonrpc: "2.0", method: "initialized" });
  });

  it("turns an error answer into an RpcError carrying the runtime's code", async () => {
    const { rpc, reply } = pair();
    const call = rpc.call("account/read");
    reply({ id: 1, error: { code: -32000, message: "not signed in", data: { x: 1 } } });
    await expect(call).rejects.toMatchObject({ name: "RpcError", code: -32000, message: "not signed in" });
  });

  it("hands notifications over, split across chunks and joined in one", async () => {
    const onNotification = vi.fn();
    const { input } = pair({ onNotification });
    input.write('{"method":"item/agentMessage/delta","params":{"delta":"he');
    input.write('llo"}}\n{"method":"turn/completed","params":{}}\n');
    await tick();
    expect(onNotification.mock.calls).toEqual([
      ["item/agentMessage/delta", { delta: "hello" }],
      ["turn/completed", {}],
    ]);
  });

  it("answers the runtime's own requests, and refuses them when nothing handles them", async () => {
    const onRequest = vi.fn(async (method) => {
      if (method === "item/tool/call") return { success: true };
      throw Object.assign(new Error("denied"), { code: -32001 });
    });
    const handled = pair({ onRequest });
    handled.reply({ id: "a", method: "item/tool/call", params: {} });
    handled.reply({ id: "b", method: "execCommandApproval", params: {} });
    const bare = pair();
    bare.reply({ id: 7, method: "item/tool/call" });
    await tick();
    await tick();
    expect(handled.sent).toEqual([
      { id: "a", result: { success: true } },
      { id: "b", error: { code: -32001, message: "denied" } },
    ]);
    expect(bare.sent).toEqual([{ id: 7, error: { code: -32601, message: "item/tool/call is not handled" } }]);
  });

  it("gives up on a call that gets no answer in time", async () => {
    vi.useFakeTimers();
    const { rpc } = pair({ timeoutMs: 1000 });
    const slow = rpc.call("turn/start", {}, { timeoutMs: 50 });
    const expectation = expect(slow).rejects.toMatchObject({ code: "timeout" });
    vi.advanceTimersByTime(60);
    await expectation;
  });

  it("drops a line over the limit and keeps reading the next one", async () => {
    const log = vi.fn();
    const onNotification = vi.fn();
    const { input } = pair({ maxLineBytes: 64, onNotification, log });
    input.write(`{"method":"big","params":"${"x".repeat(40)}`);
    input.write(`${"y".repeat(40)}"}\n{"method":"small"}\n`);
    await tick();
    expect(onNotification.mock.calls).toEqual([["small", undefined]]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/over the limit/));
  });

  it("rejects every waiting call when the runtime goes away, and refuses new ones", async () => {
    const onClose = vi.fn();
    const { rpc, input } = pair({ onClose });
    const a = rpc.call("a");
    const b = rpc.call("b");
    input.end();
    await expect(a).rejects.toBeInstanceOf(RpcError);
    await expect(b).rejects.toMatchObject({ code: "closed" });
    await expect(rpc.call("c")).rejects.toMatchObject({ code: "closed" });
    expect(rpc.closed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never logs a line it cannot parse", async () => {
    const log = vi.fn();
    const { input } = pair({ log });
    input.write("not json code=secret123\n");
    await tick();
    expect(log.mock.calls.join(" ")).not.toContain("secret123");
  });
});

describe("redact", () => {
  const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXBhcnQ";
  const cases = [
    ["a sign-in callback", "GET /auth/callback?code=ac_8Hq2kLmn0pQ&state=Zx81Kq0 HTTP/1.1", ["ac_8Hq2kLmn0pQ", "Zx81Kq0"]],
    ["a JWT", `id token ${jwt} received`, ["eyJhbGci", "c2lnbmF0dXJl"]],
    ["an OpenAI key", "key sk-proj-AbC123dEf456GhI789", ["sk-proj", "AbC123"]],
    ["an Anthropic OAuth token", "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-Qw3rTy8uIoP", ["sk-ant", "Qw3rTy"]],
    ["a Google access token", "using ya29.a0AfB_byC9x-Q1", ["ya29", "a0AfB"]],
    ["a bearer header", "Authorization: Bearer abc.def-ghi", ["abc.def"]],
    ["a JSON auth payload", '{"access_token":"opaque value","refresh_token":"r1","code":"12-34"}', ["opaque value", '"r1"', "12-34"]],
    ["a long opaque run", "session 9fK2mQ7xL0pR4tV8wY1zA3cE5gH6jN2b ok", ["9fK2mQ7x"]],
  ];

  it.each(cases)("keeps no part of %s", (_, line, secrets) => {
    const clean = redact(line);
    for (const secret of secrets) expect(clean).not.toContain(secret);
    expect(clean).toContain("[redacted]");
  });

  it("leaves ordinary lines alone", () => {
    const line = "codex_app_server: listening on stdio, model gpt-5.5, C:/Users/me/AppData/Roaming/Draggy/codex/a1";
    expect(redact(line)).toBe(line);
  });

  it("drains stderr line by line, redacted", async () => {
    const stream = new PassThrough();
    const lines = [];
    drainStderr(stream, (line) => lines.push(line));
    stream.write("first line\nopen https://auth.openai.com/oauth?state=Zx81Kq0&x=1\n");
    await tick();
    expect(lines).toEqual(["first line", "open https://auth.openai.com/oauth?state=[redacted]&x=1"]);
  });
});
