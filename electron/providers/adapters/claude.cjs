/** A Claude Pro or Max account through the pinned Claude Code runtime: one process per conversation, its
 * session kept in the private folder, and Draggy's tools as the only tools (spec §4.7, claude/MODE.md). */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { privateHome } = require("../account/env.cjs");
const { createSupervisor } = require("../account/supervisor.cjs");
const { createThreads } = require("../account/threads.cjs");
const { ensureClaude, installedBinary } = require("../claude/binary.cjs");
const { startClaude, runAuth, sessionArgs, SERVER, TOOL_PREFIX } = require("../claude/process.cjs");

const LEVELS = new Set(["low", "medium", "high"]);
// Claude Code runs a batch of calls one control request each, so the leg waits this long for a sibling.
const SETTLE_MS = 100;
const SPEAKER = { user: "User", assistant: "Assistant", tool: "Tool result" };

const failure = (kind, message, extra = {}) => ({ kind, status: 0, message, providerMessage: message, ...extra });
const fail = (f) => Object.assign(new Error(f.message), { failure: f });

function textOf(content) {
  if (typeof content === "string") return content;
  return (Array.isArray(content) ? content : []).filter((part) => part?.type === "text").map((part) => part.text).join("");
}

function imageBlock(part) {
  const match = part?.type === "image_url" && /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(part.image_url?.url || "");
  return match ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } } : null;
}

/** Earlier messages as one text block, since stdin takes no structured history (MODE.md §6). */
function flatten(history) {
  const turns = [];
  for (const message of history) {
    if (!SPEAKER[message.role]) continue;
    const calls = (message.tool_calls || []).map((call) => {
      const args = call.function?.arguments;
      return `[called ${call.function?.name} with ${typeof args === "string" ? args : JSON.stringify(args ?? {})}]`;
    });
    const body = [textOf(message.content), ...calls].filter((part) => part.trim()).join("\n");
    if (body) turns.push(`${SPEAKER[message.role]}: ${body}`);
  }
  return turns.length ? `<conversation_so_far>\n${turns.join("\n\n")}\n</conversation_so_far>` : "";
}

/** The one user message a turn sends: anything the session has not seen, then the input with its images. */
function toContent(history, input) {
  const content = [];
  const earlier = flatten(history);
  if (earlier) content.push({ type: "text", text: earlier });
  const text = input ? textOf(input.content) : "";
  if (text) content.push({ type: "text", text });
  for (const part of Array.isArray(input?.content) ? input.content : []) {
    const image = imageBlock(part);
    if (image) content.push(image);
  }
  return content;
}

function mcpTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({ name: tool.function.name, description: tool.function.description || "", inputSchema: tool.function.parameters || { type: "object", properties: {} } }));
}

/** The pill maps to `--effort`; thinking off is Claude Code's own switch, not a low effort. */
function effortOf(body) {
  const think = body.think ?? body.chat_template_kwargs?.enable_thinking;
  if (think === false) return { thinking: false };
  if (think === true) return { thinking: true, effort: LEVELS.has(body.thinking_level) ? body.thinking_level : "medium" };
  return { thinking: true };
}

function usageOf(usage = {}) {
  const prompt = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return { promptTokens: prompt, outputTokens: usage.output_tokens ?? 0 };
}

/** Unverified without a plan at its limit: the runtime's own words are matched, keeping a reset time when given. */
function turnFailure(text, limit) {
  const message = String(text || "").trim() || "The turn failed.";
  const epoch = /\|(\d{10})\b/.exec(message)?.[1];
  if (/usage limit|limit reached|hit your limit|rate.?limit/i.test(message)) {
    return failure("account-limit-reached", message, { resetsAt: epoch ? Number(epoch) : limit?.resetsAt });
  }
  if (/\/login|log ?in again|logged out|authenticat|oauth token|invalid api key|401/i.test(message)) return failure("account-signed-out", message);
  if (/overloaded|529/i.test(message)) return failure("provider-rate-limited", message);
  return failure("provider-unknown-error", message);
}

function sameConversation(earlier, messages) {
  const ids = (list) => list.filter((m) => m.draggy_ref).map((m) => m.draggy_ref.id);
  const before = ids(earlier);
  const now = ids(messages);
  return before.length > 0 && before.every((id, i) => now[i] === id);
}

/** Claude Code files each session under a folder named for its working folder, so any of them may hold it. */
function sessionOnDisk(home, sessionId) {
  const projects = path.join(home, "projects");
  try {
    return fs.readdirSync(projects).some((dir) => fs.existsSync(path.join(projects, dir, `${sessionId}.jsonl`)));
  } catch {
    return false;
  }
}

function createClaudeAdapter({
  appData,
  version,
  ensure = ensureClaude,
  installed = installedBinary,
  start = startClaude,
  auth = runAuth,
  log = () => {},
  settleMs = SETTLE_MS,
  supervisor = {},
  newId = crypto.randomUUID,
  onDisk = sessionOnDisk,
}) {
  const runtimes = new Map();

  function runtimeFor(instanceId) {
    if (runtimes.has(instanceId)) return runtimes.get(instanceId);
    const rt = { instanceId, threads: createThreads({ instanceId, key: "sessionId" }), sessions: new Map(), signedIn: false, limit: null, login: null, models: null };
    runtimes.set(instanceId, rt);
    return rt;
  }

  /** `launch` says how the next start finds its session; after a finished turn it is always a resume. */
  function sessionFor(rt, id, launch) {
    const s = { id, rt, launch, config: null, tools: [], key: null, proc: null, turn: null };
    s.supervisor = createSupervisor({
      ...supervisor,
      start: async (onExit) => {
        const binary = await ensure(appData);
        const proc = await start({
          binary,
          appData,
          instanceId: rt.instanceId,
          args: sessionArgs({ ...s.config, ...s.launch }),
          log,
          onMessage: (message) => received(s, message),
          onControl: (request) => control(s, request),
          onExit: (code) => {
            gone(s);
            onExit(code);
          },
        });
        s.proc = proc;
        return { stop: async () => (gone(s), proc.stop()) };
      },
    });
    rt.sessions.set(id, s);
    return s;
  }

  /** A process that went away fails its turn; the session on disk may hold half of it, so it is not reused as is. */
  function gone(s) {
    s.proc = null;
    const turn = s.turn;
    if (!turn) return;
    closeTurn(s, turn);
    s.rt.threads.forget(s.id);
    endLeg(s, turn, failure("account-runtime-unavailable", "Claude Code stopped during the turn."));
  }

  function endLeg(s, turn, result) {
    const leg = turn.leg;
    if (!leg) return;
    turn.leg = null;
    clearTimeout(turn.settle);
    s.supervisor.release();
    leg.resolve(result);
  }

  function closeTurn(s, turn) {
    if (s.turn === turn) s.turn = null;
    for (const answer of turn.pending.values()) answer({ content: [{ type: "text", text: "The turn was stopped." }], isError: true });
    turn.pending.clear();
  }

  function received(s, message) {
    if (message.type === "rate_limit_event") {
      const info = message.rate_limit_info || {};
      s.rt.limit = info;
      if (info.status === "rejected" && s.turn) s.turn.failure ??= failure("account-limit-reached", "The Claude plan's usage limit is reached.", { resetsAt: info.resetsAt });
      return;
    }
    const turn = s.turn;
    if (!turn) return;
    if (message.type === "stream_event") return streamed(turn, message.event || {});
    if (message.type === "assistant") {
      if (message.uuid) turn.at = message.uuid;
      if (message.error) {
        const text = textOf(message.message?.content) || message.error;
        turn.failure ??= message.error === "authentication_failed" ? failure("account-signed-out", text) : turnFailure(text, s.rt.limit);
      }
      return;
    }
    if (message.type === "result") finished(s, turn, message);
  }

  function streamed(turn, event) {
    const sse = turn.leg?.sse;
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") sse?.delta({ content: event.delta.text });
    else if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") sse?.delta({ reasoning: event.delta.thinking });
    else if (event.type === "message_delta" && event.delta?.stop_reason === "max_tokens") turn.length = true;
  }

  function finished(s, turn, result) {
    closeTurn(s, turn);
    const runtime = s.rt;
    const usage = usageOf(result.usage);
    if (!turn.failure && result.subtype === "success" && !result.is_error) {
      const recorded = runtime.threads.record(s.id, turn.messages);
      recorded.state.at = turn.at;
      s.launch = { sessionId: s.id, resume: true };
      turn.leg?.sse.providerState(recorded);
      turn.leg?.sse.finish(turn.length ? "length" : "stop", usage);
      return endLeg(s, turn, null);
    }
    runtime.threads.forget(s.id);
    const f = turn.failure || turnFailure(result.result || (result.errors || []).join(" "), runtime.limit);
    if (f.kind === "account-signed-out") runtime.signedIn = false;
    endLeg(s, turn, f);
  }

  async function control(s, request) {
    if (request.subtype === "mcp_message" && request.server_name === SERVER) return { mcp_response: await mcp(s, request.message || {}) };
    if (request.subtype === "can_use_tool") {
      const name = String(request.tool_name || "");
      if (name.startsWith(TOOL_PREFIX)) return { behavior: "allow", updatedInput: request.input ?? {} };
      log(`claude asked to use ${name}; refused`);
      if (s.turn) {
        s.turn.failure ??= failure("provider-unknown-error", `Claude Code asked to use its own tool (${name}), which Draggy never offers.`);
        interrupt(s);
      }
      return { behavior: "deny", message: "Only Draggy's tools may run." };
    }
    throw new Error(`${request.subtype} is not available in Draggy`);
  }

  async function mcp(s, rpc) {
    const reply = (result) => ({ jsonrpc: "2.0", id: rpc.id ?? 0, result });
    if (rpc.method === "initialize") {
      return reply({ protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: SERVER, version } });
    }
    if (rpc.method === "tools/list") return reply({ tools: s.tools });
    if (rpc.method === "tools/call") return reply(await toolCalled(s, rpc.params || {}));
    return reply({});
  }

  function toolCalled(s, { name, arguments: args }) {
    const turn = s.turn;
    if (!turn?.leg) return { content: [{ type: "text", text: "No turn is waiting for this call." }], isError: true };
    return new Promise((answer) => {
      const id = `call_${newId()}`;
      turn.pending.set(id, answer);
      turn.leg.sse.delta({ toolCalls: [{ index: turn.leg.calls++, id, type: "function", function: { name, arguments: JSON.stringify(args ?? {}) } }] });
      clearTimeout(turn.settle);
      turn.settle = setTimeout(() => {
        turn.leg?.sse.finish("tool_calls", {});
        endLeg(s, turn, null);
      }, settleMs);
    });
  }

  function interrupt(s) {
    s.proc?.request("interrupt").catch(() => undefined);
  }

  /** Stop: the turn ends in Claude Code too, and the session is not reused, since no stored message describes it. */
  function abandon(s, turn) {
    interrupt(s);
    closeTurn(s, turn);
    s.rt.threads.forget(s.id);
    endLeg(s, turn, null);
  }

  function openLeg(s, turn, sse, signal) {
    const leg = new Promise((resolve) => {
      turn.leg = { sse, resolve, calls: 0 };
      signal?.addEventListener("abort", () => s.turn === turn && abandon(s, turn), { once: true });
    }).then((result) => {
      if (result) throw fail(result);
    });
    leg.catch(() => undefined);
    return leg;
  }

  function waitingTurn(runtime, messages) {
    const results = [];
    for (let i = messages.length - 1; i >= 0 && messages[i].role === "tool"; i -= 1) results.unshift(messages[i]);
    if (!results.length) return null;
    for (const s of runtime.sessions.values()) {
      const turn = s.turn;
      if (turn && !turn.leg && results.some((m) => turn.pending.has(m.tool_call_id))) return { s, turn, results };
    }
    return null;
  }

  async function requireSignIn(runtime) {
    if (runtime.signedIn) return;
    if (!(await readAuth(runtime.instanceId)).loggedIn) throw fail(failure("account-signed-out", "The Claude account is signed out."));
    runtime.signedIn = true;
  }

  async function readAuth(instanceId) {
    const binary = installed(appData);
    if (!binary) return { loggedIn: false };
    const { out } = await auth({ binary, appData, instanceId, args: ["status", "--json"], log });
    try {
      return JSON.parse(out) || { loggedIn: false };
    } catch {
      return { loggedIn: false };
    }
  }

  /** The live session when it has seen exactly this much; else a fork of the stored one at its reply; else a new one. */
  async function pickSession(runtime, messages) {
    const planned = runtime.threads.plan(messages);
    if (planned.id && runtime.sessions.has(planned.id)) return { s: runtime.sessions.get(planned.id), history: planned.history, input: planned.input };
    const found = runtime.threads.stored(messages);
    const from = found?.state;
    const id = newId();
    if (from?.at && onDisk(privateHome(appData, "claude", runtime.instanceId), from.sessionId)) {
      const old = runtime.sessions.get(from.sessionId);
      if (old && !old.turn) {
        runtime.sessions.delete(from.sessionId);
        await old.supervisor.stop();
      }
      return { s: sessionFor(runtime, id, { sessionId: id, forkFrom: from.sessionId, at: from.at }), history: found.history, input: found.input };
    }
    return { s: sessionFor(runtime, id, { sessionId: id }), history: planned.history, input: planned.input };
  }

  async function stream({ body, connection, modelId, sse, signal }) {
    const runtime = runtimeFor(connection.instance.id);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    let s = null;
    let turn = null;
    let held = false;
    try {
      const waiting = waitingTurn(runtime, messages);
      if (waiting) {
        ({ s, turn } = waiting);
        await s.supervisor.acquire();
        held = true;
        const leg = openLeg(s, turn, sse, signal);
        const byId = new Map(waiting.results.map((m) => [m.tool_call_id, textOf(m.content)]));
        for (const [callId, answer] of [...turn.pending]) {
          turn.pending.delete(callId);
          const text = byId.get(callId);
          answer({ content: [{ type: "text", text: text ?? "The call was not run." }], isError: text === undefined });
        }
        return await leg;
      }

      await requireSignIn(runtime);
      // A turn this conversation left open by a Stop during a tool call ends before the next one starts.
      for (const open of [...runtime.sessions.values()]) {
        if (open.turn && !open.turn.leg && sameConversation(open.turn.messages, messages)) abandon(open, open.turn);
      }
      const picked = await pickSession(runtime, messages);
      s = picked.s;
      const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n\n");
      const config = { model: modelId, systemPrompt: system, ...effortOf(body) };
      const tools = mcpTools(body.tools);
      const key = JSON.stringify([config, tools]);
      // Model, effort, prompt and tools are fixed at launch, so a change restarts the process on the same session.
      if (s.key !== null && s.key !== key) await s.supervisor.stop();
      s.config = config;
      s.tools = tools;
      s.key = key;

      await s.supervisor.acquire();
      held = true;
      turn = { messages, pending: new Map(), failure: null, leg: null, settle: null, at: null, length: false };
      s.turn = turn;
      const leg = openLeg(s, turn, sse, signal);
      s.proc.sendUser(toContent(picked.history, picked.input));
      if (signal?.aborted) abandon(s, turn);
      return await leg;
    } catch (error) {
      if (turn && s?.turn === turn) {
        closeTurn(s, turn);
        runtime.threads.forget(s.id);
      }
      if (turn?.leg) endLeg(s, turn, null);
      else if (held && !turn) s.supervisor.release();
      if (error.failure) throw error;
      if (error.code === "account-runtime-unavailable") throw fail(failure("account-runtime-unavailable", error.message));
      throw fail(failure("provider-unknown-error", error.message));
    }
  }

  /** A process that only signs in, lists models or reports usage: no session is written for it. */
  async function utility(instanceId) {
    const binary = await ensure(appData);
    return start({ binary, appData, instanceId, args: ["--no-session-persistence"], log, onControl: async (request) => {
      throw new Error(`${request.subtype} is not available in Draggy`);
    } });
  }

  /** Claude Code's own OAuth on Anthropic's page, ending at its own callback, so Draggy never sees a token (MODE.md §7). */
  async function signIn(instanceId, { onProgress = () => {}, openExternal }) {
    await ensure(appData, { onProgress: ({ percent }) => onProgress({ step: "installing", percent }) });
    const runtime = runtimeFor(instanceId);
    if (!(await readAuth(instanceId)).loggedIn) {
      const proc = await utility(instanceId);
      const login = { proc, cancelled: false };
      runtime.login = login;
      try {
        const { automaticUrl } = await proc.request("claude_authenticate", { loginWithClaudeAi: true });
        onProgress({ step: "browser", url: automaticUrl });
        await openExternal(automaticUrl);
        await proc.request("claude_oauth_wait_for_completion");
      } catch (error) {
        if (login.cancelled) return { signedIn: false, cancelled: true, error: null };
        if (error.failure) throw error;
        return { signedIn: false, cancelled: false, error: error.message };
      } finally {
        if (runtime.login === login) runtime.login = null;
        await proc.stop();
      }
    }
    runtime.signedIn = true;
    onProgress({ step: "done" });
    return status(instanceId);
  }

  async function cancel(instanceId) {
    const login = runtimes.get(instanceId)?.login;
    if (!login) return;
    login.cancelled = true;
    await login.proc.stop();
  }

  /** Signs out through the runtime, then removes the whole private folder, sessions included (spec §4.7.3). */
  async function signOut(instanceId) {
    const runtime = runtimeFor(instanceId);
    await Promise.all([...runtime.sessions.values()].map((s) => s.supervisor.stop()));
    runtime.sessions.clear();
    runtime.threads.clear();
    runtime.signedIn = false;
    runtime.models = null;
    const binary = installed(appData);
    if (binary) await auth({ binary, appData, instanceId, args: ["logout"], log });
    fs.rmSync(privateHome(appData, "claude", instanceId), { recursive: true, force: true, maxRetries: 5 });
  }

  /** Never downloads: an account never signed in to has no runtime yet, and opening a page is no reason to fetch one. */
  async function status(instanceId) {
    const read = await readAuth(instanceId);
    if (!read.loggedIn) return { signedIn: false };
    return { signedIn: true, email: read.email || undefined, plan: read.subscriptionType || undefined };
  }

  /** The models the runtime's `initialize` lists, read once per launch of the app; empty until it is installed. */
  async function models(instanceId) {
    if (!installed(appData)) return [];
    const runtime = runtimeFor(instanceId);
    if (!runtime.models) {
      const proc = await utility(instanceId);
      try {
        runtime.models = (proc.init?.models || []).filter((m) => m?.value);
      } finally {
        await proc.stop();
      }
    }
    return runtime.models.map((m) => ({ id: m.value, name: m.displayName || m.value, inputModalities: ["text", "image"] }));
  }

  async function stopAll() {
    const all = [...runtimes.values()].flatMap((runtime) => [...runtime.sessions.values()]);
    await Promise.all([...all.map((s) => s.supervisor.stop()), ...[...runtimes.values()].map((runtime) => runtime.login?.proc.stop())]);
  }

  return { stream, signIn, cancel, signOut, status, models, runtimeFor, stopAll };
}

module.exports = { createClaudeAdapter, toContent, flatten, effortOf, turnFailure, sessionOnDisk };
