/** A Google account through the pinned Gemini CLI over ACP: one process per conversation, Draggy's tools
 * served to it over loopback MCP, and nothing else the model can call (spec §4.8, gemini/MODE.md). */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { privateHome } = require("../account/env.cjs");
const { createSupervisor } = require("../account/supervisor.cjs");
const { createThreads } = require("../account/threads.cjs");
const { EXPECTED_BYTES, ensureGemini, installedEntry } = require("../gemini/install.cjs");
const { createMcpServer } = require("../gemini/mcpHttp.cjs");
const { startGemini, neutralPaths, TOOL_PREFIX, TOOL_TIMEOUT_MS } = require("../gemini/process.cjs");
const { flatten, textOf, mcpTools } = require("./claude.cjs");

// The CLI runs a batch of calls one MCP request each, so the leg waits this long for a sibling.
const SETTLE_MS = 100;
const CREDENTIALS = ["oauth_creds.json", "gemini-credentials.json"];
// The CLI allows two tries of five minutes each for the pasted code.
const SIGN_IN_MS = 11 * 60_000;
// The CLI prints Google's address within about a second of starting when it has no credentials.
const PROMPT_MS = 15_000;
const POLL_MS = 250;
// Only a Google address ending in whitespace is taken from the text the CLI prints while signing in.
const SIGN_IN_URL = /https:\/\/accounts\.google\.com\/[^\s"'<>]+(?=\s)/;
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|[@-Z\\\\-_])`, "g");

const failure = (kind, message, extra = {}) => ({ kind, status: 0, message, providerMessage: message, ...extra });
const fail = (f) => Object.assign(new Error(f.message), { failure: f });

/** The prompt of one turn: anything the session has not seen as text, then the input with its images. */
function toPrompt(history, input) {
  const prompt = [];
  const earlier = flatten(history);
  if (earlier) prompt.push({ type: "text", text: earlier });
  const text = input ? textOf(input.content) : "";
  if (text) prompt.push({ type: "text", text });
  for (const part of Array.isArray(input?.content) ? input.content : []) {
    const match = part?.type === "image_url" && /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(part.image_url?.url || "");
    if (match) prompt.push({ type: "image", mimeType: match[1], data: match[2] });
  }
  return prompt;
}

/** Unverified without a signed-in account at its limit: the CLI's own words are matched (MODE.md checklist 3). */
function turnFailure(error) {
  const message = [error?.message, typeof error?.data === "string" ? error.data : error?.data?.details].filter(Boolean).join(" ").trim() || "The turn failed.";
  if (/quota|RESOURCE_EXHAUSTED|usage limit|limit reached|\b429\b/i.test(message)) return failure("account-limit-reached", message);
  if (/auth|sign ?in|log ?in|credential|UNAUTHENTICATED|\b401\b/i.test(message)) return failure("account-signed-out", message);
  if (/overloaded|UNAVAILABLE|\b503\b/i.test(message)) return failure("provider-rate-limited", message);
  return failure("provider-unknown-error", message);
}

function usageOf(meta) {
  const count = meta?.quota?.token_count || {};
  return { promptTokens: count.input_tokens ?? 0, outputTokens: count.output_tokens ?? 0 };
}

function isLink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

function sameConversation(earlier, messages) {
  const ids = (list) => list.filter((m) => m.draggy_ref).map((m) => m.draggy_ref.id);
  const before = ids(earlier);
  const now = ids(messages);
  return before.length > 0 && before.every((id, i) => now[i] === id);
}

function createGeminiCliAdapter({
  appData,
  version,
  ensure = ensureGemini,
  installed = installedEntry,
  runtimeBytes = EXPECTED_BYTES,
  start = startGemini,
  mcp = null,
  paths = neutralPaths,
  log = () => {},
  settleMs = SETTLE_MS,
  promptMs = PROMPT_MS,
  supervisor = {},
  newId = crypto.randomUUID,
}) {
  const runtimes = new Map();
  /** Bytes the first sign-in fetches while the runtime is not on disk; nothing once it is. */
  const download = () => (installed(appData) ? null : runtimeBytes);
  const server = mcp || createMcpServer({ name: "draggy", version, log });

  function runtimeFor(instanceId) {
    if (runtimes.has(instanceId)) return runtimes.get(instanceId);
    const rt = { instanceId, threads: createThreads({ instanceId, key: "sessionId" }), sessions: new Map(), signedIn: false, models: null };
    runtimes.set(instanceId, rt);
    return rt;
  }

  const home = (instanceId) => path.join(privateHome(appData, "gemini", instanceId), ".gemini");
  const hasCredentials = (instanceId) => CREDENTIALS.some((name) => fs.existsSync(path.join(home(instanceId), name)));

  /** One process and one ACP session; history lives only in the process, so its end ends the session. */
  function sessionFor(rt, id) {
    const s = { id, rt, sessionId: null, config: null, tools: [], key: null, proc: null, turn: null };
    s.supervisor = createSupervisor({
      ...supervisor,
      start: async (onExit) => {
        const entry = await ensure(appData);
        const endpoint = await server.register({ tools: () => s.tools, call: (name, args) => toolCalled(s, name, args) });
        let proc = null;
        try {
          proc = await start({
            entry,
            appData,
            instanceId: rt.instanceId,
            tools: s.tools.map((tool) => tool.name),
            model: s.config.model,
            mcpUrl: endpoint.url,
            systemPrompt: s.config.systemPrompt,
            log,
            onNotification: (method, params) => received(s, method, params),
            onRequest: (method, params) => requested(s, method, params),
            onExit: (code) => {
              endpoint.close();
              gone(s);
              onExit(code);
            },
          });
          s.sessionId = (await proc.rpc.call("session/new", { cwd: proc.cwd, mcpServers: [] })).sessionId;
        } catch (error) {
          endpoint.close();
          await proc?.stop();
          throw error;
        }
        s.proc = proc;
        return { stop: async () => (gone(s), proc.stop()) };
      },
    });
    rt.sessions.set(id, s);
    return s;
  }

  /** A process that went away takes its session with it: the turn fails and the conversation starts over. */
  function gone(s) {
    s.proc = null;
    if (s.rt.sessions.get(s.id) === s) s.rt.sessions.delete(s.id);
    s.rt.threads.forget(s.id);
    const turn = s.turn;
    if (!turn) return;
    closeTurn(s, turn);
    endLeg(s, turn, failure("account-runtime-unavailable", "The Gemini CLI stopped during the turn."));
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

  function received(s, method, params) {
    if (method !== "session/update" || params?.sessionId !== s.sessionId) return;
    const sse = s.turn?.leg?.sse;
    const update = params.update || {};
    const text = update.content?.type === "text" ? update.content.text : "";
    if (!text) return;
    if (update.sessionUpdate === "agent_message_chunk") sse?.delta({ content: text });
    else if (update.sessionUpdate === "agent_thought_chunk") sse?.delta({ reasoning: text });
  }

  /** Draggy's tools run behind its own approval card, so the CLI never has to ask; anything else it asks about is refused. */
  async function requested(s, method, params) {
    if (method !== "session/request_permission") throw Object.assign(new Error(`${method} is not available in Draggy`), { code: -32601 });
    const call = String(params?.toolCall?.toolCallId || "");
    const options = Array.isArray(params?.options) ? params.options : [];
    if (call.startsWith(TOOL_PREFIX)) {
      const allow = options.find((option) => option.kind === "allow_once");
      if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } };
    }
    log(`gemini asked permission for ${params?.toolCall?.title || call}; refused`);
    if (s.turn) {
      s.turn.failure ??= failure("provider-unknown-error", "The Gemini CLI asked to use a tool Draggy never offers.");
      cancel(s);
    }
    const reject = options.find((option) => option.kind === "reject_once");
    return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
  }

  function toolCalled(s, name, args) {
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

  function cancel(s) {
    if (s.sessionId) s.proc?.rpc.notify("session/cancel", { sessionId: s.sessionId });
  }

  function finished(s, turn, result) {
    if (s.turn !== turn) return;
    closeTurn(s, turn);
    const reason = result?.stopReason;
    if (!turn.failure && (reason === "end_turn" || reason === "max_tokens")) {
      const recorded = s.rt.threads.record(s.id, turn.messages);
      turn.leg?.sse.providerState(recorded);
      turn.leg?.sse.finish(reason === "max_tokens" ? "length" : "stop", usageOf(result._meta));
      return endLeg(s, turn, null);
    }
    s.rt.threads.forget(s.id);
    endLeg(s, turn, turn.failure || failure("provider-unknown-error", `The Gemini CLI ended the turn (${reason || "no reason"}).`));
    retire(s);
  }

  function failed(s, turn, error) {
    if (s.turn !== turn) return;
    closeTurn(s, turn);
    const f = turn.failure || turnFailure(error);
    if (f.kind === "account-signed-out") s.rt.signedIn = false;
    endLeg(s, turn, f);
    retire(s);
  }

  /** A session whose last turn did not complete holds history no stored message describes, so it is not kept. */
  function retire(s) {
    s.rt.threads.forget(s.id);
    if (s.rt.sessions.get(s.id) === s) s.rt.sessions.delete(s.id);
    void s.supervisor.stop();
  }

  function abandon(s, turn) {
    cancel(s);
    closeTurn(s, turn);
    endLeg(s, turn, null);
    retire(s);
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

  function requireSignIn(runtime) {
    if (runtime.signedIn) return;
    if (!hasCredentials(runtime.instanceId)) throw fail(failure("account-signed-out", "The Google account is signed out."));
    runtime.signedIn = true;
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

      requireSignIn(runtime);
      // A turn this conversation left open by a Stop during a tool call ends before the next one starts.
      for (const open of [...runtime.sessions.values()]) {
        if (open.turn && !open.turn.leg && sameConversation(open.turn.messages, messages)) abandon(open, open.turn);
      }
      const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n\n");
      const config = { model: modelId, systemPrompt: system };
      const tools = mcpTools(body.tools);
      const key = JSON.stringify([config, tools]);
      let planned = runtime.threads.plan(messages);
      s = planned.id ? runtime.sessions.get(planned.id) : null;
      // Model, prompt and tools are fixed at launch, and a new process has none of the old one's history.
      if (s && s.key !== key) {
        retire(s);
        planned = runtime.threads.plan(messages);
        s = null;
      }
      s ??= sessionFor(runtime, newId());
      s.config = config;
      s.tools = tools;
      s.key = key;

      await s.supervisor.acquire();
      held = true;
      turn = { messages, pending: new Map(), failure: null, leg: null, settle: null };
      s.turn = turn;
      const leg = openLeg(s, turn, sse, signal);
      const session = s;
      s.proc.rpc
        .call("session/prompt", { sessionId: s.sessionId, prompt: toPrompt(planned.history, planned.input) }, { timeoutMs: TOOL_TIMEOUT_MS })
        .then((result) => finished(session, turn, result), (error) => failed(session, turn, error));
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
      // A refusal from the CLI while it starts, such as expired credentials, says more than that it did not start.
      if (error.cause?.name === "RpcError") {
        const f = turnFailure(error.cause);
        if (f.kind === "account-signed-out") runtime.signedIn = false;
        throw fail(f);
      }
      if (error.code === "account-runtime-unavailable") throw fail(failure("account-runtime-unavailable", error.message));
      throw fail(turnFailure(error));
    }
  }

  /** The CLI's no-browser route: it prints Google's address and reads the code Google shows back from stdin. */
  async function signIn(instanceId, { onProgress = () => {}, openExternal }) {
    const entry = await ensure(appData, { onProgress: ({ percent }) => onProgress({ step: "installing", percent }) });
    const runtime = runtimeFor(instanceId);
    if (!hasCredentials(instanceId)) {
      const login = { type: null, stop: null, cancelled: false, error: null, asking: false, opened: false };
      runtime.login = login;
      let pending = "";
      const asked = (url) => {
        login.asking = true;
        onProgress({ step: "code", url });
        // A wrong code makes the CLI print the address again; the page Google opened still serves.
        if (login.opened) return;
        login.opened = true;
        Promise.resolve(openExternal(url)).catch((error) => {
          login.error = error;
          login.stop?.();
        });
      };
      // Holds the protocol back until the CLI has signed in while starting, or has shown it will not ask then.
      const beforeInitialize = async ({ typeLine, stop }) => {
        Object.assign(login, { type: typeLine, stop });
        const began = Date.now();
        const waiting = () => !hasCredentials(instanceId) && !login.cancelled && !login.error
          && Date.now() - began < (login.opened ? SIGN_IN_MS : promptMs);
        while (waiting()) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      };
      const onOutput = (chunk) => {
        pending = (pending + chunk).replace(ANSI, "");
        for (let match = SIGN_IN_URL.exec(pending); match; match = SIGN_IN_URL.exec(pending)) {
          pending = pending.slice(match.index + match[0].length);
          asked(match[0]);
        }
        pending = pending.slice(-4096);
      };
      try {
        const proc = await start({ entry, appData, instanceId, log, noBrowser: true, onOutput, beforeInitialize });
        if (login.cancelled) return { signedIn: false, cancelled: true, error: null };
        if (login.error) throw login.error;
        if (!hasCredentials(instanceId)) await proc.rpc.call("authenticate", { methodId: "oauth-personal" }, { timeoutMs: SIGN_IN_MS });
      } catch (error) {
        if (login.cancelled) return { signedIn: false, cancelled: true, error: null };
        if (login.error) throw login.error;
        if (error.failure) throw error;
        // The CLI quits after its second refused code.
        const refused = login.opened && error.code === "closed";
        if (!hasCredentials(instanceId)) return { signedIn: false, cancelled: false, error: refused ? "Google did not accept the code." : error.message };
      } finally {
        if (runtime.login === login) runtime.login = null;
        await login.stop?.();
      }
      if (!hasCredentials(instanceId)) return { signedIn: false, cancelled: false, error: "Google did not finish the sign-in." };
    }
    runtime.signedIn = true;
    onProgress({ step: "done" });
    return status(instanceId);
  }

  /** Hands the pasted code to the CLI and nowhere else: it is never logged or kept. */
  function submitCode(instanceId, code) {
    const login = runtimes.get(instanceId)?.login;
    const line = typeof code === "string" ? code.trim() : "";
    if (!login?.asking || !login.type || !line) return false;
    login.asking = false;
    return login.type(line) !== false;
  }

  async function cancelSignIn(instanceId) {
    const login = runtimes.get(instanceId)?.login;
    if (!login) return;
    login.cancelled = true;
    await login.stop?.();
  }

  /** Signs out by removing the private home, sessions included, and the neutral link to it (spec §4.8.3). */
  async function signOut(instanceId) {
    const runtime = runtimeFor(instanceId);
    await Promise.all([...runtime.sessions.values()].map((s) => s.supervisor.stop()));
    runtime.sessions.clear();
    runtime.threads.clear();
    runtime.signedIn = false;
    runtime.models = null;
    const { link, cwd } = paths(instanceId);
    // Only a link is removed there, and only the link itself, never the folder it names.
    if (isLink(link)) fs.unlinkSync(link);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
    fs.rmSync(privateHome(appData, "gemini", instanceId), { recursive: true, force: true, maxRetries: 5 });
  }

  /** Never downloads: reads what the CLI cached in the private home, and nothing else. */
  async function status(instanceId) {
    if (!hasCredentials(instanceId)) return { signedIn: false };
    let email;
    try {
      email = JSON.parse(fs.readFileSync(path.join(home(instanceId), "google_accounts.json"), "utf8")).active || undefined;
    } catch {
      /* the CLI caches the address after sign-in; its absence is not a sign-out */
    }
    return { signedIn: true, email };
  }

  /** The models `session/new` lists, read once per launch of the app; `auto` is left out, since it routes. */
  async function models(instanceId) {
    if (!installed(appData) || !hasCredentials(instanceId)) return [];
    const runtime = runtimeFor(instanceId);
    if (!runtime.models) {
      const proc = await start({ entry: installed(appData), appData, instanceId, log });
      try {
        const created = await proc.rpc.call("session/new", { cwd: proc.cwd, mcpServers: [] });
        runtime.models = (created?.models?.availableModels || []).filter((m) => m?.modelId && !/^auto/.test(m.modelId));
      } finally {
        await proc.stop();
      }
    }
    return runtime.models.map((m) => ({ id: m.modelId, name: m.name || m.modelId, inputModalities: ["text", "image"] }));
  }

  async function stopAll() {
    const all = [...runtimes.values()].flatMap((runtime) => [...runtime.sessions.values()]);
    await Promise.all(all.map((s) => s.supervisor.stop()));
    await Promise.all([...runtimes.values()].map((runtime) => runtime.login?.proc?.stop()));
    await server.stop();
  }

  return { stream, signIn, submitCode, cancel: cancelSignIn, signOut, status, download, models, runtimeFor, stopAll };
}

module.exports = { createGeminiCliAdapter, toPrompt, turnFailure };
