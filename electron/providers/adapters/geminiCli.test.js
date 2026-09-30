import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createGeminiCliAdapter, toPrompt } = require("./geminiCli.cjs");
const { RpcError } = require("../rpc.cjs");

let appData;
beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-gemini-cli-"));
});
afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

const geminiDir = () => path.join(appData, "gemini", "g", ".gemini");
function signIn() {
  fs.mkdirSync(geminiDir(), { recursive: true });
  fs.writeFileSync(path.join(geminiDir(), "oauth_creds.json"), "{}");
}

/** Plays the CLI's side: each start is one process whose updates, requests and prompt answers the test sends. */
function fakeGemini({ newSession, promptMs = 60_000 } = {}) {
  const gemini = { starts: [], endpoints: [] };
  const start = vi.fn(async (options) => {
    let exited = false;
    const proc = {
      options,
      prompts: [],
      cwd: "C:/work",
      typeLine: vi.fn(() => true),
      stop: vi.fn(async () => {
        if (exited) return;
        exited = true;
        options.onExit?.(null);
      }),
      update: (update, sessionId = proc.sessionId) => options.onNotification("session/update", { sessionId, update }),
      ask: (method, params) => options.onRequest(method, params),
      answer: (result) => proc.prompts.at(-1).resolve(result),
      refuse: (error) => proc.prompts.at(-1).reject(error),
    };
    proc.rpc = {
      notify: vi.fn(),
      call: vi.fn(async (method, params) => {
        if (method === "session/new") {
          if (newSession) return newSession();
          proc.sessionId = `s${gemini.starts.length}`;
          return { sessionId: proc.sessionId, models: { availableModels: [{ modelId: "auto" }, { modelId: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }, {}] } };
        }
        return new Promise((resolve, reject) => proc.prompts.push({ params, resolve, reject }));
      }),
    };
    gemini.starts.push(proc);
    await options.beforeInitialize?.({ typeLine: proc.typeLine, stop: proc.stop });
    return proc;
  });
  const mcp = {
    register: vi.fn(async (endpoint) => {
      const entry = { ...endpoint, url: `http://127.0.0.1:1/mcp/${gemini.endpoints.length}`, closed: false };
      entry.close = () => (entry.closed = true);
      gemini.endpoints.push(entry);
      return entry;
    }),
    stop: vi.fn(async () => {}),
  };
  gemini.ensure = vi.fn(async () => "gemini.js");
  let ids = 0;
  const adapter = createGeminiCliAdapter({
    appData,
    version: "2.2.0",
    ensure: gemini.ensure,
    installed: () => "gemini.js",
    start,
    mcp,
    paths: () => ({ link: path.join(appData, "neutral", "gemini-g"), cwd: path.join(appData, "neutral", "gemini-g-work") }),
    settleMs: 0,
    promptMs,
    supervisor: { sleep: async () => {} },
    newId: () => `id${++ids}`,
  });
  gemini.last = () => gemini.starts.at(-1);
  return { adapter, gemini, start };
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

const connection = { instance: { id: "g", label: "Google" } };
const system = { role: "system", content: "Draggy's prompt" };
const user = (id, content = id) => ({ role: "user", content, draggy_ref: { id, hash: `h-${content}` } });
const reply = (id, content, state) => ({ role: "assistant", content, draggy_ref: { id, hash: `h-${content}` }, provider_state: state });
const TOOLS = [{ type: "function", function: { name: "read_file", description: "Reads", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const DONE = { stopReason: "end_turn", _meta: { quota: { token_count: { input_tokens: 5, output_tokens: 2 } } } };

async function leg(adapter, messages, modelId = "gemini-2.5-pro") {
  const sse = recorder();
  const controller = new AbortController();
  const done = adapter.stream({ body: { stream: true, messages, tools: TOOLS }, connection, modelId, sse, signal: controller.signal });
  done.catch(() => undefined);
  await tick();
  return { sse, done, controller };
}

const stateOf = (sse) => sse.events.find(([kind]) => kind === "state")[1];

describe("the Google account adapter", () => {
  it("starts a process with Draggy's prompt, model and tools, and streams the turn back", async () => {
    signIn();
    const { adapter, gemini } = fakeGemini();
    const { sse, done } = await leg(adapter, [system, user("u1", "hi")]);
    const proc = gemini.last();
    expect(proc.options).toMatchObject({ entry: "gemini.js", instanceId: "g", tools: ["read_file"], model: "gemini-2.5-pro", mcpUrl: "http://127.0.0.1:1/mcp/0", systemPrompt: "Draggy's prompt" });
    expect(proc.rpc.call.mock.calls[0]).toEqual(["session/new", { cwd: "C:/work", mcpServers: [] }]);
    expect(proc.prompts[0].params).toEqual({ sessionId: "s1", prompt: [{ type: "text", text: "hi" }] });

    proc.update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
    proc.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } });
    proc.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "not this session" } }, "other");
    proc.answer(DONE);
    await done;
    expect(sse.events).toEqual([
      ["delta", { reasoning: "hmm" }],
      ["delta", { content: "Hello" }],
      ["state", { instanceId: "g", state: expect.objectContaining({ sessionId: "id1", consumed: 1 }) }],
      ["finish", "stop", { promptTokens: 5, outputTokens: 2 }],
    ]);
  });

  it("sends only the new input to the same process on the next turn", async () => {
    signIn();
    const { adapter, gemini } = fakeGemini();
    const first = await leg(adapter, [system, user("u1")]);
    gemini.last().answer(DONE);
    await first.done;
    const second = await leg(adapter, [system, user("u1"), reply("r1", "hello", stateOf(first.sse)), user("u2", "more")]);
    expect(gemini.starts).toHaveLength(1);
    expect(gemini.last().prompts[1].params.prompt).toEqual([{ type: "text", text: "more" }]);
    gemini.last().answer(DONE);
    await second.done;
    expect(stateOf(second.sse).state).toMatchObject({ sessionId: "id1", consumed: 3 });
  });

  it("serves Draggy's tools over MCP, holds a call open for approval, and answers it with the next request", async () => {
    signIn();
    const { adapter, gemini } = fakeGemini();
    const first = await leg(adapter, [system, user("u1", "read a")]);
    const endpoint = gemini.endpoints[0];
    expect(endpoint.tools()).toEqual([{ name: "read_file", description: "Reads", inputSchema: TOOLS[0].function.parameters }]);
    const call = endpoint.call("read_file", { path: "a" });
    await first.done;
    const id = first.sse.events[0][1].toolCalls[0].id;
    expect(first.sse.events).toEqual([
      ["delta", { toolCalls: [{ index: 0, id, type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }] }],
      ["finish", "tool_calls", {}],
    ]);

    const messages = [system, user("u1", "read a"), { role: "assistant", content: "", tool_calls: [{ id, function: { name: "read_file", arguments: '{"path":"a"}' } }] }, { role: "tool", tool_call_id: id, content: "file a" }];
    const second = await leg(adapter, messages);
    expect(await call).toEqual({ content: [{ type: "text", text: "file a" }], isError: false });
    gemini.last().update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "It says file a." } });
    gemini.last().answer(DONE);
    await second.done;
    expect(second.sse.events.at(-1)).toEqual(["finish", "stop", { promptTokens: 5, outputTokens: 2 }]);
    expect(gemini.last().prompts).toHaveLength(1);
  });

  it("refuses any permission request for a tool that is not Draggy's, cancels, and fails the turn", async () => {
    signIn();
    const { adapter, gemini } = fakeGemini();
    const { done } = await leg(adapter, [system, user("u1")]);
    const proc = gemini.last();
    const options = [{ optionId: "proceed_once", kind: "allow_once" }, { optionId: "cancel", kind: "reject_once" }];
    expect(await proc.ask("session/request_permission", { sessionId: "s1", options, toolCall: { toolCallId: "run_shell_command-1", title: "rm -rf /" } })).toEqual({
      outcome: { outcome: "selected", optionId: "cancel" },
    });
    expect(proc.rpc.notify).toHaveBeenCalledWith("session/cancel", { sessionId: "s1" });
    proc.answer({ stopReason: "cancelled" });
    await expect(done).rejects.toMatchObject({ failure: { kind: "provider-unknown-error" } });
    expect(proc.stop).toHaveBeenCalled();
    await expect(proc.ask("fs/read_text_file", { path: "C:/secret" })).rejects.toThrow("not available");
    await expect(proc.ask("terminal/create", { command: "cmd" })).rejects.toThrow("not available");
  });

  it("cancels on Stop and reseeds a new process with the transcript, since the cut session is not reused", async () => {
    signIn();
    const { adapter, gemini } = fakeGemini();
    const first = await leg(adapter, [system, user("u1")]);
    gemini.last().answer(DONE);
    await first.done;
    const history = [system, user("u1"), reply("r1", "hello", stateOf(first.sse))];

    const stopped = await leg(adapter, [...history, user("u2", "long")]);
    stopped.controller.abort();
    await stopped.done;
    expect(gemini.starts[0].rpc.notify).toHaveBeenCalledWith("session/cancel", { sessionId: "s1" });
    await tick();
    expect(gemini.starts[0].stop).toHaveBeenCalled();
    expect(gemini.endpoints[0].closed).toBe(true);

    const again = await leg(adapter, [...history, user("u3", "short")]);
    expect(gemini.starts).toHaveLength(2);
    expect(gemini.last().prompts[0].params.prompt).toEqual([
      { type: "text", text: "<conversation_so_far>\nUser: u1\n\nAssistant: hello\n</conversation_so_far>" },
      { type: "text", text: "short" },
    ]);
    gemini.last().answer(DONE);
    await again.done;
  });

  it("restarts with the transcript when the model changes, and fails a turn whose process dies", async () => {
    signIn();
    const { adapter, gemini } = fakeGemini();
    const first = await leg(adapter, [system, user("u1")]);
    gemini.last().answer(DONE);
    await first.done;
    const history = [system, user("u1"), reply("r1", "hello", stateOf(first.sse))];
    const second = await leg(adapter, [...history, user("u2", "next")], "gemini-3.8-flash");
    expect(gemini.starts).toHaveLength(2);
    expect(gemini.last().options.model).toBe("gemini-3.8-flash");
    expect(gemini.last().prompts[0].params.prompt[0].text).toContain("<conversation_so_far>");

    await gemini.last().stop();
    await expect(second.done).rejects.toMatchObject({ failure: { kind: "account-runtime-unavailable" } });
  });

  it("maps the CLI's refusals: signed out before any start, a quota on the turn, expired credentials at start", async () => {
    const signedOut = fakeGemini();
    const out = await leg(signedOut.adapter, [system, user("u1")]);
    await expect(out.done).rejects.toMatchObject({ failure: { kind: "account-signed-out" } });
    expect(signedOut.start).not.toHaveBeenCalled();

    signIn();
    const { adapter, gemini } = fakeGemini();
    const quota = await leg(adapter, [system, user("u1")]);
    gemini.last().refuse(new RpcError("You have exhausted your capacity on this model. RESOURCE_EXHAUSTED", -32603));
    await expect(quota.done).rejects.toMatchObject({ failure: { kind: "account-limit-reached" } });

    const expired = fakeGemini({ newSession: () => Promise.reject(new RpcError("Authentication required", -32000)) });
    const turn = await leg(expired.adapter, [system, user("u1")]);
    await expect(turn.done).rejects.toMatchObject({ failure: { kind: "account-signed-out" } });
  });

  it("says how much the first sign-in installs while the CLI is not on disk, and nothing once it is", () => {
    const missing = createGeminiCliAdapter({ appData, version: "2.2.0", installed: () => null, runtimeBytes: 98 });
    expect(missing.download()).toBe(98);
    expect(fakeGemini().adapter.download()).toBeNull();
  });

  it("reads status from the private home without downloading, and signs out by removing it and its link", async () => {
    const { adapter, gemini } = fakeGemini();
    expect(await adapter.status("g")).toEqual({ signedIn: false });
    signIn();
    fs.writeFileSync(path.join(geminiDir(), "google_accounts.json"), JSON.stringify({ active: "a@b.c", old: [] }));
    expect(await adapter.status("g")).toEqual({ signedIn: true, email: "a@b.c" });
    expect(gemini.ensure).not.toHaveBeenCalled();

    const outside = path.join(appData, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "keep.txt"), "mine");
    const link = path.join(appData, "neutral", "gemini-g");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(appData, "gemini", "g"), link, "junction");
    fs.mkdirSync(path.join(appData, "neutral", "gemini-g-work"));

    await adapter.signOut("g");
    expect(fs.existsSync(path.join(appData, "gemini", "g"))).toBe(false);
    expect(() => fs.lstatSync(link)).toThrow();
    expect(fs.existsSync(path.join(appData, "neutral", "gemini-g-work"))).toBe(false);
    expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("mine");
    expect(await adapter.status("g")).toEqual({ signedIn: false });
  });

  it("lists the models session/new offers, leaving out auto, and none before sign-in", async () => {
    const { adapter, gemini } = fakeGemini();
    expect(await adapter.models("g")).toEqual([]);
    signIn();
    expect(await adapter.models("g")).toEqual([{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", inputModalities: ["text", "image"] }]);
    expect(gemini.last().options).not.toHaveProperty("mcpUrl");
    expect(gemini.last().stop).toHaveBeenCalled();
    await adapter.models("g");
    expect(gemini.starts).toHaveLength(1);
  });

  const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fcodeassist.google.com%2Fauthcode&state=s";

  it("takes the code the CLI asks for while it starts, before any protocol message could be read as the code", async () => {
    const { adapter, gemini, start } = fakeGemini();
    const steps = [];
    const openExternal = vi.fn(async () => {});
    const pending = adapter.signIn("g", { onProgress: (p) => steps.push(p), openExternal });
    await vi.waitFor(() => expect(gemini.last()).toBeDefined());
    const proc = gemini.last();
    expect(proc.options).toMatchObject({ noBrowser: true, instanceId: "g" });
    expect(adapter.submitCode("g", "early")).toBe(false);

    proc.options.onOutput(`Please visit the following URL to authorize the application:\n\n${url}\n\nEnter the authorization code: `);
    expect(adapter.submitCode("g", " 4/0Wrong ")).toBe(true);
    expect(proc.typeLine).toHaveBeenCalledWith("4/0Wrong");
    proc.options.onOutput(`Please visit the following URL to authorize the application:\n\n${url}\n\nEnter the authorization code: `);
    expect(steps.filter((s) => s.step === "code")).toHaveLength(2);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(adapter.submitCode("g", "4/0Right")).toBe(true);
    expect(proc.typeLine).toHaveBeenLastCalledWith("4/0Right");

    signIn();
    await expect(pending).resolves.toEqual({ signedIn: true, email: undefined });
    expect(proc.rpc.call).not.toHaveBeenCalled();
    expect(proc.stop).toHaveBeenCalled();
    expect(steps.at(-1)).toEqual({ step: "done" });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("says Google refused the code when the CLI quits after its second try", async () => {
    const start = vi.fn(async (options) => {
      options.onOutput(`${url}\n`);
      throw new RpcError("The runtime closed its connection", "closed");
    });
    const adapter = createGeminiCliAdapter({ appData, version: "2.2.0", ensure: async () => "gemini.js", start, paths: () => ({ link: "l", cwd: "c" }) });
    await expect(adapter.signIn("g", { openExternal: vi.fn(async () => {}) })).resolves.toEqual({ signedIn: false, cancelled: false, error: "Google did not accept the code." });
  });

  it("asks through authenticate when the CLI started without asking: Google's address opened, the pasted code typed to the CLI alone", async () => {
    const { adapter, gemini, start } = fakeGemini({ promptMs: 0 });
    const steps = [];
    const openExternal = vi.fn(async () => {});
    const pending = adapter.signIn("g", { onProgress: (p) => steps.push(p), openExternal });
    await vi.waitFor(() => expect(gemini.last()?.rpc.call).toHaveBeenCalledWith("authenticate", { methodId: "oauth-personal" }, expect.anything()));
    const proc = gemini.last();
    expect(proc.options).toMatchObject({ noBrowser: true, instanceId: "g" });
    expect(adapter.submitCode("g", "early")).toBe(false);

    proc.options.onOutput("\x1B[?1049h\x1B[2J\x1B[HVisit https://evil.example/x now\nPlease visit the following URL to authorize the application:\n\n");
    proc.options.onOutput(url.slice(0, 40));
    expect(openExternal).not.toHaveBeenCalled();
    proc.options.onOutput(`${url.slice(40)}\n\nEnter the authorization code: `);
    expect(steps).toContainEqual({ step: "code", url });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(url);

    expect(adapter.submitCode("g", "  4/0Secret-code \n")).toBe(true);
    expect(proc.typeLine).toHaveBeenCalledWith("4/0Secret-code");
    expect(adapter.submitCode("g", "again")).toBe(false);
    signIn();
    proc.answer({});
    await expect(pending).resolves.toEqual({ signedIn: true, email: undefined });
    expect(proc.stop).toHaveBeenCalled();
    expect(steps.at(-1)).toEqual({ step: "done" });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("skips the CLI when already signed in, and stops it on cancel or when the opener refuses the address", async () => {
    const { adapter, gemini, start } = fakeGemini();
    signIn();
    await expect(adapter.signIn("g", { openExternal: vi.fn() })).resolves.toEqual({ signedIn: true, email: undefined });
    expect(start).not.toHaveBeenCalled();
    fs.rmSync(geminiDir(), { recursive: true });

    const cancelled = adapter.signIn("g", { openExternal: vi.fn() });
    await vi.waitFor(() => expect(gemini.starts.length).toBe(1));
    await adapter.cancel("g");
    expect(gemini.last().stop).toHaveBeenCalled();
    await expect(cancelled).resolves.toEqual({ signedIn: false, cancelled: true, error: null });

    const refused = adapter.signIn("g", { openExternal: vi.fn(async () => Promise.reject(new Error("not a sign-in host"))) });
    await vi.waitFor(() => expect(gemini.starts.length).toBe(2));
    const second = gemini.last();
    second.options.onOutput("https://accounts.google.com/o/oauth2/auth?x=1\n");
    await expect(refused).rejects.toThrow("not a sign-in host");
    expect(second.stop).toHaveBeenCalled();
    expect(second.rpc.call).not.toHaveBeenCalled();
    expect(adapter.submitCode("g", "code")).toBe(false);
  });

  it("sends images as ACP image blocks", () => {
    const input = { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] };
    expect(toPrompt([], input)).toEqual([{ type: "text", text: "look" }, { type: "image", mimeType: "image/png", data: "AAAA" }]);
  });
});
