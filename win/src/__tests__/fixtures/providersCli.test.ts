/* eslint-disable @typescript-eslint/no-explicit-any -- the drivers take untyped fixture JSON and call CJS modules, so their values are dynamic */
// Golden fixtures for the CLI runtimes and the gateway (electron/providers): each case names its driver in input.fn and
// is run against the Electron/CJS reference. core/crates/providers/tests/fixtures_cli.rs runs the same files against the port.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/providers");
const P = "../../../electron/providers";
const rpcMod = require(`${P}/rpc.cjs`);
const envMod = require(`${P}/account/env.cjs`);
const threadsMod = require(`${P}/account/threads.cjs`);
const claude = require(`${P}/adapters/claude.cjs`);
const codex = require(`${P}/adapters/codex.cjs`);
const claudeBin = require(`${P}/claude/binary.cjs`);
const claudeProc = require(`${P}/claude/process.cjs`);
const codexBin = require(`${P}/codex/binary.cjs`);
const codexProc = require(`${P}/codex/process.cjs`);
import { runClaudeInstall, runCodexInstall } from "./installDriver";
import { runSupervisor } from "./supervisorDriver";
const gateway = require(`${P}/gateway.cjs`);
const { createRegistry } = require(`${P}/registry.cjs`);

/**
 * Fixtures spell a rooted path with "/". On a Windows host path.join makes it "\data\...", so any string that starts
 * with a single backslash is mapped back. Strings that name a drive (C:\Windows) are the fixture's own and stay.
 */
const hostPath = (v: unknown): unknown => {
  if (process.platform !== "win32") return v;
  if (typeof v === "string") return /^\\(?!\\)/.test(v) ? v.replaceAll("\\", "/") : v;
  if (Array.isArray(v)) return v.map(hostPath);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hostPath(x)]));
  return v;
};
const plain = (v: unknown): any => (v === undefined ? null : hostPath(JSON.parse(JSON.stringify(v))));
const tick = async (n = 12) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

// ---------- rpc ----------
function fakeStream() {
  const handlers: Record<string, (...a: any[]) => void> = {};
  return {
    on(name: string, fn: (...a: any[]) => void) {
      handlers[name] = fn;
    },
    emit(name: string, ...a: any[]) {
      handlers[name]?.(...a);
    },
  };
}
const bytesOf = (c: string | number[]) => (typeof c === "string" ? Buffer.from(c) : Buffer.from(c));

function runFrames(input: any) {
  const stream = fakeStream();
  const lines: string[] = [];
  const oversize: number[] = [];
  rpcMod.splitLines(stream, input.maxLineBytes, (l: string) => lines.push(l), (n: number) => oversize.push(n));
  for (const chunk of input.chunks) stream.emit("data", bytesOf(chunk));
  return { lines, oversize };
}

async function runRpcSession(input: any) {
  if (input.fakeTimers) vi.useFakeTimers();
  try {
    return await runRpcSessionInner(input);
  } finally {
    if (input.fakeTimers) vi.useRealTimers();
  }
}

async function runRpcSessionInner(input: any) {
  const input_ = fakeStream() as any;
  const output = fakeStream() as any;
  const sent: any[] = [];
  const sentRaw: string[] = [];
  output.write = (text: string) => {
    sentRaw.push(text);
    for (const line of text.split("\n").filter(Boolean)) sent.push(JSON.parse(line));
  };
  const notifications: any[] = [];
  const logs: string[] = [];
  const settled: any[] = [];
  let callIndex = 0;
  const onRequest = input.handlesRequests
    ? async (method: string) => {
        if (method === "ok") return { ok: true };
        if (method === "deny") throw Object.assign(new Error("denied"), { code: -32001 });
        throw new Error("x");
      }
    : null;
  const rpc = rpcMod.createRpc({
    input: input_,
    output,
    jsonrpc: Boolean(input.jsonrpc),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.maxLineBytes ? { maxLineBytes: input.maxLineBytes } : {}),
    onNotification: (method: string, params: any) => notifications.push([method, plain(params)]),
    onRequest,
    log: (text: string) => logs.push(text),
  });
  const results: any[] = [];
  for (const op of input.ops) {
    if (op.op === "call") {
      const k = ++callIndex;
      const p = rpc.call(op.method, op.params, op.timeoutMs ? { timeoutMs: op.timeoutMs } : {});
      p.then(
        (value: any) => settled.push({ call: k, value: plain(value) }),
        (error: any) => settled.push({ call: k, error: { code: plain(error.code), message: error.message, data: plain(error.data) } }),
      );
    } else if (op.op === "notify") {
      results.push(rpc.notify(op.method, op.params));
    } else if (op.op === "input") {
      input_.emit("data", Buffer.from(op.text));
    } else if (op.op === "advance") {
      vi.advanceTimersByTime(op.ms);
    } else if (op.op === "end") {
      input_.emit("end");
    } else if (op.op === "error") {
      input_.emit("error", new Error(op.message));
    }
    await tick();
  }
  return { sent: plain(sent), settled, notifications, logs, closed: rpc.closed, results, rawWrites: sentRaw.length };
}

// ---------- env / threads ----------
function runEnv(input: any) {
  try {
    if (input.fn === "privateHome") return { home: envMod.privateHome(input.appData, input.runtime, input.instanceId) };
    const { env, home } = envMod.accountEnv({ runtime: input.runtime, appData: input.appData, instanceId: input.instanceId, parent: input.parent, extra: input.extra || {} });
    return { env: plain(env), home };
  } catch (error: any) {
    return { error: error.message };
  }
}

function runThreads(input: any) {
  const threads = threadsMod.createThreads({ instanceId: input.instanceId, key: input.key });
  return input.ops.map((op: any) => {
    if (op.op === "plan") return plain(threads.plan(op.messages));
    if (op.op === "stored") return plain(threads.stored(op.messages));
    if (op.op === "record") return plain(threads.record(op.id, op.messages));
    if (op.op === "forget") return (threads.forget(op.id), null);
    if (op.op === "clear") return (threads.clear(), null);
    throw new Error(op.op);
  });
}

// ---------- gateway ----------
const SSE_TIMINGS = (frame: any) => (frame && typeof frame === "object" && frame.timings ? (delete frame.timings, frame) : frame);

async function readFrames(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const data = frame.replace(/^data: /, "");
      return data === "[DONE]" ? "[DONE]" : SSE_TIMINGS(JSON.parse(data));
    });
}

/** Reads the whole body, handing the caller a way to stop reading it, as a renderer that goes away does. */
async function readBody(response: Response, onReader: (leave: () => void) => void): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  onReader(() => void reader.cancel());
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
  }
}

async function runRoutes(input: any) {
  const kv = new Map<string, string>();
  const vault = new Map<string, any>();
  const registry = createRegistry({
    storage: { getValue: (k: string) => kv.get(k) ?? null, setValue: (k: string, v: string) => kv.set(k, String(v)) },
    secrets: {
      available: () => true,
      get: (owner: string) => vault.get(owner) ?? {},
      set: (owner: string, values: any) => (vault.set(owner, values), true),
      remove: (owner: string) => vault.delete(owner),
    },
  });
  for (const inst of input.instances) {
    const added = registry.add({ type: inst.type, ...(inst.baseUrl ? { baseUrl: inst.baseUrl } : {}) });
    if (inst.key) registry.setKey(added.id, inst.key);
    registry.update(added.id, { enabled: inst.enabled !== false });
  }
  const queue = [...(input.upstream || [])];
  const upstreamRequests: any[] = [];
  // A reply marked readerLeaves makes the renderer stop reading once the reply is in, just before the retry's wait.
  let leaveReader = () => {};
  const fetchImpl = async (url: string, init: any = {}) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = String(v);
    upstreamRequests.push({ url, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
    const next = queue.shift();
    if (!next) throw new Error("no scripted reply");
    if (next.readerLeaves) setTimeout(() => leaveReader(), 0);
    if (next.error) throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    return new Response(next.body ?? "", { status: next.status ?? 200, headers: { "Content-Type": next.contentType ?? "application/json", ...(next.headers || {}) } });
  };
  const accounts: Record<string, any> = {};
  const accountCalls: any[] = [];
  if (input.accountProtocol) {
    accounts[input.accountProtocol] = {
      stream: async (args: any) => {
        accountCalls.push({ modelId: args.modelId, instanceId: args.connection.instance.id });
        for (const op of input.script || []) {
          if (op.delta) args.sse.delta(op.delta);
          if (op.providerState) args.sse.providerState(op.providerState);
          if (op.finish) args.sse.finish(op.finish.reason, op.finish.usage);
          if (op.throwFailure) throw Object.assign(new Error(op.throwFailure.message), { failure: op.throwFailure });
          if (op.throwPlain) throw new Error(op.throwPlain);
        }
      },
    };
  }
  const handle = gateway.createGateway({
    enginePort: () => 9,
    isAllowedOrigin: (origin: string) => origin === input.allowedOrigin,
    registry,
    fetchImpl,
    accounts,
  });
  const r = input.request;
  const headers: Record<string, string> = {};
  if (r.origin) headers.origin = r.origin;
  if (r.requestId) headers["x-request-id"] = r.requestId;
  if (r.contentType) headers["content-type"] = r.contentType;
  const request = new Request(r.url ?? "draggy-ai://chat", {
    method: r.method ?? "POST",
    headers,
    body: r.method === "GET" || r.method === "OPTIONS" ? undefined : r.body ?? "",
  });
  const response: Response = await handle(request);
  const contentType = response.headers.get("content-type");
  const text = await readBody(response, (leave) => (leaveReader = leave));
  const out: any = {
    status: response.status,
    contentType,
    allowOrigin: response.headers.get("access-control-allow-origin"),
  };
  if (contentType?.startsWith("text/event-stream")) out.frames = await readFrames(text);
  else if (contentType?.startsWith("application/json")) out.json = text ? JSON.parse(text) : null;
  else out.text = text;
  out.upstream = upstreamRequests;
  out.accountCalls = accountCalls;
  return out;
}


/** One case through its driver: the reference's answer, normalised as the fixture files record it. */
async function driveCase(file: string, input: any): Promise<any> {
  const f = input.fn;
  if (f === "redact") return rpcMod.redact(input.text);
  if (f === "frames") return runFrames(input);
  if (f === "rpcSession") return runRpcSession(input);
  if (f === "accountEnv" || f === "privateHome") return runEnv(input);
  if (f === "threads") return runThreads(input);
  if (f === "textOf") return claude.textOf(input.content);
  if (f === "flatten") return claude.flatten(input.history);
  if (f === "toContent") return plain(claude.toContent(input.history, input.input));
  if (f === "mcpTools") return plain(claude.mcpTools(input.tools));
  if (f === "effortOf") return plain((file.includes("codex") ? codex : claude).effortOf(input.body));
  if (f === "listedModels") return plain(claude.listedModels(input.listed));
  if (f === "turnFailure") {
    if (file.includes("codex")) return plain(codex.turnFailure(input.error, input.limits));
    return plain(claude.turnFailure(input.text, input.limit));
  }
  if (f === "toItems") return plain(codex.toItems(input.message));
  if (f === "toInput") return plain(codex.toInput(input.message));
  if (f === "resetsAtOf") return plain(codex.resetsAtOf(input.limits));
  if (f === "assetFor") {
    if (file.includes("claude")) return plain(claudeBin.assetFor(input.platformName, input.arch, undefined, input.musl));
    return plain(codexBin.assetFor(input.platformName, input.arch));
  }
  if (f === "installDir") {
    const mod = file.includes("claude") ? claudeBin : codexBin;
    return mod.installDir(input.appData);
  }
  if (f === "configToml") return codexProc.configToml(input.catalogPath, { topLevel: input.topLevel, tables: input.tables });
  if (f === "workFolder") return claudeProc.workFolder(input.instanceId, { platformName: input.platformName, env: input.env, uid: input.uid });
  if (f === "sessionArgs") return claudeProc.sessionArgs(input);
  if (f === "claudeInstall") return runClaudeInstall(input);
  if (f === "codexInstall") return runCodexInstall(input);
  if (f === "supervisor") return runSupervisor(input);
  if (f === "gatewayRoutes") return runRoutes(input);
  if (f === "constants") {
    const table: Record<string, any> = {
      ARGS: codexProc.ARGS, FEATURES_OFF: codexProc.FEATURES_OFF, CATALOG_NAME: codexProc.CATALOG_NAME,
      FLAGS: claudeProc.FLAGS,
      QUIET: claudeProc.QUIET, TOOL_TIMEOUT_MS: claudeProc.TOOL_TIMEOUT_MS,
      VERSION: claudeBin.VERSION,
    };
    return plain(table[input.name]);
  }
  throw new Error(`no driver for ${file} (${f})`);
}

import { windowsCases } from "./windowsScope";

describe("providers CLI and gateway fixtures", () => {
  const names = fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => /^providers-(cli|gateway)-.*\.json$/.test(file))
    .sort();
  for (const name of names) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as { cases: { name: string; input: any; expected: unknown }[] };
    describe(name, () => {
      for (const testCase of windowsCases(name, fixture.cases)) {
        // Windows has no execute bit, so a case that expects one cannot be observed there; the Rust runner gates the same way.
        const needsExecuteBit =
          process.platform === "win32" && JSON.stringify(testCase.expected).includes('"executable":true');
        it.skipIf(needsExecuteBit)(testCase.name, async () => {
          expect(plain(await driveCase(name, testCase.input))).toEqual(testCase.expected);
        });
      }
    });
  }
});
