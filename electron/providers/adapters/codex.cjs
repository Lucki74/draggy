/** A ChatGPT account through the pinned Codex app-server: one runtime per instance, one ephemeral thread
 * per conversation, and Draggy's tools as the only tools (spec §4, codex/MODE.md). */
const { createSupervisor } = require("../account/supervisor.cjs");
const { createThreads } = require("../account/threads.cjs");
const { assetFor, ensureCodex, installedBinary } = require("../codex/binary.cjs");
const { startCodex } = require("../codex/process.cjs");

const LEVELS = new Set(["low", "medium", "high"]);
// A call arrives as one server request each, so the leg waits this long for a parallel sibling.
const SETTLE_MS = 100;

// Requests for Codex's own tools: refused, and the turn ends, since a stripped tool asking means the strip failed.
const BUILT_IN = {
  "item/commandExecution/requestApproval": { decision: "decline" },
  "item/fileChange/requestApproval": { decision: "decline" },
  applyPatchApproval: { decision: "denied" },
  execCommandApproval: { decision: "denied" },
  "mcpServer/elicitation/request": { action: "decline", content: null, _meta: null },
  "item/permissions/requestApproval": null,
  "item/tool/requestUserInput": null,
};

const failure = (kind, message, extra = {}) => ({ kind, status: 0, message, providerMessage: message, ...extra });
const fail = (f) => Object.assign(new Error(f.message), { failure: f });

function textOf(content) {
  if (typeof content === "string") return content;
  return (Array.isArray(content) ? content : []).filter((part) => part?.type === "text").map((part) => part.text).join("");
}

function imagesOf(content) {
  return (Array.isArray(content) ? content : []).filter((part) => part?.type === "image_url" && part.image_url?.url).map((part) => part.image_url.url);
}

/** A wire message as the raw Responses items `thread/inject_items` takes. */
function toItems(message) {
  const text = textOf(message.content);
  if (message.role === "user") {
    const content = text ? [{ type: "input_text", text }] : [];
    for (const url of imagesOf(message.content)) content.push({ type: "input_image", image_url: url });
    return content.length ? [{ type: "message", role: "user", content }] : [];
  }
  if (message.role === "tool") return [{ type: "function_call_output", call_id: String(message.tool_call_id || ""), output: text }];
  if (message.role !== "assistant") return [];
  const items = text.trim() ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] : [];
  for (const call of message.tool_calls || []) {
    const args = call.function?.arguments;
    items.push({ type: "function_call", call_id: String(call.id || ""), name: call.function?.name || "", arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) });
  }
  return items;
}

function toInput(message) {
  if (!message) return [];
  const text = textOf(message.content);
  const input = text ? [{ type: "text", text, text_elements: [] }] : [];
  for (const url of imagesOf(message.content)) input.push({ type: "image", url });
  return input;
}

function dynamicTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.type === "function" && tool.function?.name)
    .map((tool) => ({ type: "function", name: tool.function.name, description: tool.function.description || "", inputSchema: tool.function.parameters || { type: "object", properties: {} } }));
}

/** The pill's level; a reasoning model always reasons, so thinking off asks for the least, as the OpenAI adapter does. */
function effortOf(body) {
  const think = body.think ?? body.chat_template_kwargs?.enable_thinking;
  if (typeof think !== "boolean") return {};
  return think ? { effort: LEVELS.has(body.thinking_level) ? body.thinking_level : "medium", summary: "auto" } : { effort: "low", summary: "none" };
}

/** Another conversation's turn may be waiting on its own approval; this one's stored messages start the request. */
function sameConversation(earlier, messages) {
  const ids = (list) => list.filter((m) => m.draggy_ref).map((m) => m.draggy_ref.id);
  const before = ids(earlier);
  const now = ids(messages);
  return before.length > 0 && before.every((id, i) => now[i] === id);
}

/** The wait on the window that ran out, in seconds since the epoch, when Codex has told us. */
function resetsAtOf(limits) {
  const windows = [limits?.primary, limits?.secondary].filter((w) => w && typeof w.resetsAt === "number");
  const spent = windows.filter((w) => w.usedPercent >= 100);
  const pick = (spent.length ? spent : windows).map((w) => w.resetsAt);
  return pick.length ? Math.max(...pick) : undefined;
}

function turnFailure(error, limits) {
  const info = error?.codexErrorInfo;
  const tag = typeof info === "string" ? info : Object.keys(info || {})[0] || "other";
  const message = error?.message || "The turn failed.";
  if (tag === "usageLimitExceeded" || tag === "sessionBudgetExceeded") return failure("account-limit-reached", message, { resetsAt: resetsAtOf(limits) });
  if (tag === "unauthorized") return failure("account-signed-out", message);
  if (tag === "rateLimitExceeded" || tag === "serverOverloaded") return failure("provider-rate-limited", message);
  if (tag === "cyberPolicy" || tag === "misalignmentPolicyViolation") return failure("provider-refused", message);
  if (/Connection|Disconnected|FailedAttempts/.test(tag)) return failure("provider-unreachable", message);
  return failure("provider-unknown-error", message);
}

function createCodexAdapter({
  appData,
  version,
  ensure = ensureCodex,
  installed = installedBinary,
  runtimeBytes = assetFor()?.size ?? null,
  start = startCodex,
  log = () => {},
  settleMs = SETTLE_MS,
  supervisor = {},
}) {
  const runtimes = new Map();
  /** Bytes the first sign-in fetches while the runtime is not on disk; nothing once it is. */
  const download = () => (installed(appData) ? null : runtimeBytes);

  function runtimeFor(instanceId) {
    if (runtimes.has(instanceId)) return runtimes.get(instanceId);
    const rt = { instanceId, threads: createThreads({ instanceId, key: "threadId" }), codex: null, turns: new Map(), signedIn: false, limits: null };
    rt.supervisor = createSupervisor({
      ...supervisor,
      start: async (onExit) => {
        const binary = await ensure(appData);
        const codex = await start({
          binary,
          appData,
          instanceId,
          version,
          log,
          onNotification: (method, params) => notified(rt, method, params),
          onRequest: (method, params) => requested(rt, method, params),
          onExit: (code) => {
            gone(rt);
            onExit(code);
          },
        });
        rt.codex = codex;
        return { stop: async () => (gone(rt), codex.stop()) };
      },
    });
    runtimes.set(instanceId, rt);
    return rt;
  }

  /** A runtime that went away takes its threads with it, so every turn in flight fails and the next reseeds. */
  function gone(rt) {
    rt.codex = null;
    rt.signedIn = false;
    rt.threads.clear();
    for (const turn of rt.turns.values()) endLeg(rt, turn, failure("account-runtime-unavailable", "Codex stopped during the turn."));
    rt.turns.clear();
    rt.login?.finish({ success: false, error: "Codex stopped during sign-in." });
  }

  function endLeg(rt, turn, result) {
    const leg = turn.leg;
    if (!leg) return;
    turn.leg = null;
    clearTimeout(turn.settle);
    rt.supervisor.release();
    leg.resolve(result);
  }

  function closeTurn(rt, turn) {
    rt.turns.delete(turn.threadId);
    for (const answer of turn.pending.values()) answer({ contentItems: [{ type: "inputText", text: "The turn was stopped." }], success: false });
    turn.pending.clear();
  }

  function notified(rt, method, params = {}) {
    if (method === "account/login/completed") return rt.login?.finish(params);
    if (method === "account/rateLimits/updated") {
      rt.limits = { ...(rt.limits || {}), ...Object.fromEntries(Object.entries(params.rateLimits || {}).filter(([, v]) => v !== null)) };
      return;
    }
    const turn = rt.turns.get(params.threadId);
    if (!turn) return;
    const sse = turn.leg?.sse;
    if (method === "item/agentMessage/delta") sse?.delta({ content: params.delta });
    else if (method === "item/reasoning/summaryTextDelta") sse?.delta({ reasoning: params.delta });
    else if (method === "thread/tokenUsage/updated") {
      const last = params.tokenUsage?.last || {};
      turn.usage = { promptTokens: last.inputTokens ?? 0, outputTokens: last.outputTokens ?? 0 };
    } else if (method === "turn/completed") completed(rt, turn, params.turn || {});
  }

  function completed(rt, turn, result) {
    closeTurn(rt, turn);
    if (result.status === "completed" && !turn.failure) {
      const state = rt.threads.record(turn.threadId, turn.messages);
      turn.leg?.sse.providerState(state);
      turn.leg?.sse.finish("stop", turn.usage);
      return endLeg(rt, turn, null);
    }
    rt.threads.forget(turn.threadId);
    if (turn.failure) return endLeg(rt, turn, turn.failure);
    if (result.status === "failed" && result.error?.codexErrorInfo === "contextWindowExceeded") {
      turn.leg?.sse.finish("length", turn.usage);
      return endLeg(rt, turn, null);
    }
    if (result.status === "failed") {
      const f = turnFailure(result.error, rt.limits);
      if (f.kind === "account-signed-out") rt.signedIn = false;
      return endLeg(rt, turn, f);
    }
    endLeg(rt, turn, null);
  }

  function requested(rt, method, params = {}) {
    if (method === "item/tool/call") return toolCalled(rt, params);
    log(`codex asked for ${method}; refused`);
    const turn = rt.turns.get(params.threadId);
    if (method in BUILT_IN && turn) {
      turn.failure = failure("provider-unknown-error", `Codex asked to use its own tool (${method}), which Draggy never offers.`);
      interrupt(rt, turn);
    }
    if (BUILT_IN[method]) return BUILT_IN[method];
    throw new Error(`${method} is not available in Draggy`);
  }

  function toolCalled(rt, params) {
    const turn = rt.turns.get(params.threadId);
    if (!turn?.leg) return { contentItems: [{ type: "inputText", text: "No turn is waiting for this call." }], success: false };
    return new Promise((answer) => {
      turn.pending.set(params.callId, answer);
      const args = params.arguments;
      turn.leg.sse.delta({
        toolCalls: [{ index: turn.leg.calls++, id: params.callId, type: "function", function: { name: params.tool, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) } }],
      });
      clearTimeout(turn.settle);
      turn.settle = setTimeout(() => {
        turn.leg?.sse.finish("tool_calls", turn.usage);
        endLeg(rt, turn, null);
      }, settleMs);
    });
  }

  function interrupt(rt, turn) {
    if (turn.turnId && rt.codex) rt.codex.rpc.call("turn/interrupt", { threadId: turn.threadId, turnId: turn.turnId }).catch(() => undefined);
  }

  /** Stop: the turn ends in Codex too, and its thread is not reused, since no stored message describes it. */
  function abandon(rt, turn) {
    interrupt(rt, turn);
    closeTurn(rt, turn);
    rt.threads.forget(turn.threadId);
    endLeg(rt, turn, null);
  }

  /** Waits for the leg to end: a finished turn, a batch of tool calls, or a failure. */
  function openLeg(rt, turn, sse, signal) {
    const leg = new Promise((resolve) => {
      turn.leg = { sse, resolve, calls: 0 };
      signal?.addEventListener("abort", () => rt.turns.get(turn.threadId) === turn && abandon(rt, turn), { once: true });
    }).then((result) => {
      if (result) throw fail(result);
    });
    // Awaited later, or never when the turn fails to start; either way a failure must not go unhandled.
    leg.catch(() => undefined);
    return leg;
  }

  /** The turn whose pending calls the request's trailing tool results answer, if one is still open. */
  function waitingTurn(rt, messages) {
    const results = [];
    for (let i = messages.length - 1; i >= 0 && messages[i].role === "tool"; i -= 1) results.unshift(messages[i]);
    if (!results.length) return null;
    for (const turn of rt.turns.values()) {
      if (!turn.leg && results.some((m) => turn.pending.has(m.tool_call_id))) return { turn, results };
    }
    return null;
  }

  async function requireSignIn(rt) {
    if (rt.signedIn) return;
    const read = await rt.codex.rpc.call("account/read", {});
    if (!read?.account) throw fail(failure("account-signed-out", "The ChatGPT account is signed out."));
    rt.signedIn = true;
  }

  async function stream({ body, connection, modelId, sse, signal }) {
    const rt = runtimeFor(connection.instance.id);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    await rt.supervisor.acquire();
    let turn = null;
    try {
      const waiting = waitingTurn(rt, messages);
      if (waiting) {
        turn = waiting.turn;
        const leg = openLeg(rt, turn, sse, signal);
        const byId = new Map(waiting.results.map((m) => [m.tool_call_id, textOf(m.content)]));
        for (const [callId, answer] of [...turn.pending]) {
          turn.pending.delete(callId);
          const text = byId.get(callId);
          answer({ contentItems: [{ type: "inputText", text: text ?? "The call was not run." }], success: text !== undefined });
        }
        return await leg;
      }

      await requireSignIn(rt);
      // A turn this conversation left open by a Stop during a tool call ends before the next one starts.
      for (const open of [...rt.turns.values()]) if (!open.leg && sameConversation(open.messages, messages)) abandon(rt, open);
      const planned = rt.threads.plan(messages);
      const { rpc, home } = rt.codex;
      let threadId = planned.id;
      if (!threadId) {
        const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n\n");
        const started = await rpc.call("thread/start", {
          model: modelId,
          cwd: home,
          environments: [],
          ephemeral: true,
          baseInstructions: system,
          dynamicTools: dynamicTools(body.tools),
        });
        threadId = started.thread.id;
      }
      const items = planned.history.flatMap(toItems);
      if (items.length) await rpc.call("thread/inject_items", { threadId, items });

      turn = { threadId, turnId: null, messages, pending: new Map(), usage: {}, failure: null, leg: null, settle: null };
      rt.turns.set(threadId, turn);
      const leg = openLeg(rt, turn, sse, signal);
      const begun = await rpc.call("turn/start", { threadId, input: toInput(planned.input), ...effortOf(body) });
      turn.turnId ??= begun?.turn?.id ?? null;
      if (signal?.aborted) interrupt(rt, turn);
      return await leg;
    } catch (error) {
      if (turn && rt.turns.get(turn.threadId) === turn) {
        closeTurn(rt, turn);
        rt.threads.forget(turn.threadId);
      }
      if (turn?.leg) endLeg(rt, turn, null);
      else if (!turn) rt.supervisor.release();
      if (error.failure) throw error;
      if (error.code === "account-runtime-unavailable") throw fail(failure("account-runtime-unavailable", error.message));
      throw fail(failure("provider-unknown-error", error.message));
    }
  }

  /** Holds the runtime for the whole call, so the idle stop never lands in the middle of one. */
  async function withRuntime(instanceId, work) {
    const rt = runtimeFor(instanceId);
    await rt.supervisor.acquire();
    try {
      return await work(rt, rt.codex.rpc);
    } finally {
      rt.supervisor.release();
    }
  }

  /** Codex's own browser sign-in: OpenAI's page and Codex's own callback, so Draggy never sees a token. */
  async function signIn(instanceId, { onProgress = () => {}, openExternal }) {
    await ensure(appData, { onProgress: ({ percent }) => onProgress({ step: "installing", percent }) });
    return withRuntime(instanceId, async (rt, rpc) => {
      if (!(await rpc.call("account/read", {}))?.account) {
        const { loginId, authUrl } = await rpc.call("account/login/start", { type: "chatgpt" });
        const outcome = new Promise((resolve) => {
          rt.login = { loginId, finish: (result) => (!result?.loginId || result.loginId === loginId) && resolve(result) };
        });
        onProgress({ step: "browser", url: authUrl });
        await openExternal(authUrl);
        const result = await outcome.finally(() => (rt.login = null));
        if (!result.success) return { signedIn: false, cancelled: Boolean(result.cancelled), error: result.error || null };
      }
      rt.signedIn = true;
      onProgress({ step: "done" });
      return readStatus(rpc);
    });
  }

  async function cancel(instanceId) {
    const rt = runtimes.get(instanceId);
    const login = rt?.login;
    if (!login) return;
    await rt.codex?.rpc.call("account/login/cancel", { loginId: login.loginId }).catch(() => undefined);
    login.finish({ loginId: login.loginId, success: false, cancelled: true });
  }

  async function signOut(instanceId) {
    if (!installed(appData)) return;
    await withRuntime(instanceId, async (rt, rpc) => {
      await rpc.call("account/logout", {});
      rt.signedIn = false;
      rt.threads.clear();
    });
  }

  /** Never downloads: an account never signed in to has no runtime yet, and opening a page is no reason to fetch one. */
  async function status(instanceId) {
    if (!installed(appData)) return { signedIn: false };
    return withRuntime(instanceId, (rt, rpc) => readStatus(rpc));
  }

  async function readStatus(rpc) {
    const { account } = (await rpc.call("account/read", {})) || {};
    if (!account) return { signedIn: false };
    const answer = { signedIn: true, email: account.email || undefined, plan: account.planType || undefined };
    const read = await rpc.call("account/rateLimits/read", {}).catch(() => null);
    const windows = [read?.rateLimits?.primary, read?.rateLimits?.secondary].filter(Boolean);
    if (windows.length) answer.limits = windows.map((w) => ({ window: w.windowDurationMins ?? null, usedPercent: w.usedPercent, resetsAt: w.resetsAt ?? null }));
    return answer;
  }

  /** What `model/list` offers, in the shape the model listing reads; empty until the runtime is installed. */
  async function models(instanceId) {
    if (!installed(appData)) return [];
    return withRuntime(instanceId, async (rt, rpc) => {
      const listed = [];
      let cursor = null;
      do {
        const page = await rpc.call("model/list", cursor ? { cursor } : {});
        listed.push(...(page?.data || []));
        cursor = page?.nextCursor || null;
      } while (cursor);
      return listed.filter((m) => !m.hidden).map((m) => ({ id: m.id, name: m.displayName, inputModalities: m.inputModalities }));
    });
  }

  async function stopAll() {
    await Promise.all([...runtimes.values()].map((rt) => rt.supervisor.stop()));
  }

  return { stream, signIn, cancel, signOut, status, download, models, runtimeFor, stopAll };
}

module.exports = { createCodexAdapter, toItems, toInput, effortOf, turnFailure, resetsAtOf };
