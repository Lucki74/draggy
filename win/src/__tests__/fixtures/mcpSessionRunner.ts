/* eslint-disable @typescript-eslint/no-explicit-any -- the drivers take untyped fixture JSON and call CJS modules, so their values are dynamic */
// Replays the recorded MCP sessions through electron/mcp.cjs. The process and HTTP are scripted with the same rules as the
// Rust fakes in core/crates/mcp/tests/client_support, so the two runners compare the same behavior. Timers run on a fake
// clock, so a silent server costs no wait, and the logger records what the reference writes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const mcp = require("../../../electron/mcp.cjs") as {
  init: (dir: string) => void;
  definitionFor: (id: string, config: unknown) => unknown;
  isRemote: (id: string, config: unknown) => boolean;
  startServer: (id: string, config: unknown) => Promise<unknown>;
  stopServer: (id: string) => { success: boolean };
  stopAll: () => void;
  callTool: (server: string, tool: string, args: unknown, options: unknown) => Promise<unknown>;
  listRunning: () => unknown;
  renderToolResult: (result: unknown) => string;
  widgetUri: (result: unknown) => string | null;
  qualifiedName: (server: string, tool: string) => string;
  splitQualifiedName: (name: string) => unknown;
  createLineReader: (onMessage: (message: unknown) => void, meta?: object) => (chunk: string) => void;
};
const platform = require("../../../electron/platform.cjs") as Record<string, (...args: unknown[]) => unknown>;
const { log } = require("../../../electron/logger.cjs") as { log: Record<string, (...args: unknown[]) => void> };
const catalogue = require("../../../electron/mcpCatalogue.cjs") as {
  missingRequirements: (entry: unknown, config: unknown) => unknown;
};

type Input = Record<string, any>;

/** Transport internals the session fixtures do not pin. The HTTP fixtures check them through the wire instead. */
const TRANSPORT_LINES = new Set([
  "http answered",
  "reconnect attempt",
  "session re-initialised",
  "session reset",
]);

const MEMORY_PACKAGE = "@modelcontextprotocol/server-memory";

/** Runs one session fixture file's case, or one of the pure-function files, and returns what the reference produced. */
export async function runSessionCase(file: string, rawInput: unknown): Promise<unknown> {
  const input = expandRepeats(rawInput) as Input;
  switch (file) {
    case "mcp-session-lines.json":
      return runLines(input);
    case "mcp-session-results.json":
      return input.op === "render" ? mcp.renderToolResult(input.result) : (mcp.widgetUri(input.result) ?? null);
    case "mcp-session-names.json":
      return input.op === "qualified"
        ? mcp.qualifiedName(input.server, input.tool)
        : (mcp.splitQualifiedName(input.name) ?? null);
    case "mcp-session-definition.json":
      return runDefinition(input);
    case "mcp-session-stdio.json":
    case "mcp-session-http.json":
      return runSession(input);
    default:
      throw new Error(`no session runner for ${file}`);
  }
}

/** Expands {"repeat": text, "count": n} into the text repeated, so a fixture can hold a long value without writing it out. */
function expandRepeats(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expandRepeats);
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (Object.keys(object).length === 2 && "repeat" in object && "count" in object) {
      return String(object.repeat).repeat(Number(object.count));
    }
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, expandRepeats(item)]));
  }
  return value;
}

function runLines(input: Input) {
  const messages: unknown[] = [];
  vi.spyOn(log, "debug").mockImplementation(() => {});
  try {
    const push = mcp.createLineReader((message) => messages.push(message));
    for (const chunk of input.chunks as string[]) push(chunk);
  } finally {
    vi.restoreAllMocks();
  }
  return { messages: clone(messages) };
}

function runDefinition(input: Input) {
  const config = input.config ?? {};
  const definition = mcp.definitionFor(input.id, config) ?? null;
  return clone({
    definition,
    remote: mcp.isRemote(input.id, config),
    missing: catalogue.missingRequirements(definition, {
      env: config.env ?? {},
      arguments: config.arguments ?? {},
    }),
  });
}

type RawReply = Record<string, any>;
type Session = { stop_code: number; stderr: string[]; replies: RawReply[]; spawn_error: string | null };

/** One scripted run: the sessions in order, the messages the client wrote, and the answers still to give. */
type Script = { sessions: Session[]; current: Session; wire: unknown[] };

function runSession(input: Input) {
  return withServer(input, async (ops, script) => {
    const results: unknown[] = [];
    for (const op of ops) results.push(await applyOp(op, script));
    return results;
  });
}

async function withServer(
  input: Input,
  body: (ops: Input[], script: Script) => Promise<unknown[]>,
): Promise<unknown> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-mcp-session-"));
  const script: Script = {
    sessions: (input.sessions ?? []).map(normaliseSession),
    current: emptySession(),
    wire: [],
  };
  const logs: Record<string, unknown>[] = [];

  mcp.init(root);
  installPackage(path.join(root, "mcp-servers"), MEMORY_PACKAGE);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // A case with "npm": false runs where no npm can be found.
  vi.spyOn(platform, "resolveNpm").mockReturnValue(
    input.npm === false ? null : { file: "npm", prefixArgs: [], asNode: false },
  );
  vi.spyOn(platform, "spawnHidden").mockImplementation(() => {
    if (script.current.spawn_error !== null) throw new Error(script.current.spawn_error);
    return fakeChild(script);
  });
  vi.spyOn(platform, "killTree").mockImplementation(() => {});
  vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
  vi.stubGlobal("fetch", (_url: string, options: RequestInit) => fakeFetch(script, options));
  recordLogs(logs);

  try {
    const results = await body(input.ops ?? [], script);
    return clone({
      results,
      wire: script.wire,
      logs: logs.filter(keepLine).map(normaliseLine),
    });
  } finally {
    mcp.stopAll();
    await flush();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function applyOp(op: Input, script: Script): Promise<unknown> {
  const config = op.config ?? {};
  switch (op.op) {
    case "start": {
      script.current = script.sessions.shift() ?? emptySession();
      return clone(await settle(() => mcp.startServer(op.id, config)));
    }
    case "restart": {
      script.current = script.sessions.shift() ?? emptySession();
      await settle(async () => mcp.stopServer(op.id));
      await flush();
      return clone(await settle(() => mcp.startServer(op.id, config)));
    }
    case "stop": {
      const outcome = await settle(async () => mcp.stopServer(op.id));
      await flush();
      return clone(outcome);
    }
    case "stopAll":
      mcp.stopAll();
      await flush();
      return null;
    case "list":
      return clone(mcp.listRunning());
    case "call":
      return clone(
        await settle(() =>
          mcp.callTool(op.server, op.tool, op.args ?? {}, { cid: op.cid, widgets: op.widgets }),
        ),
      );
    default:
      throw new Error(`unknown session op ${op.op}`);
  }
}

/** Waits for work that may be waiting on a timer. A timer only fires when nothing else can run, as in the Rust runner. */
async function settle<T>(work: () => Promise<T>): Promise<T> {
  let done = false;
  const pending = work().finally(() => {
    done = true;
  });
  for (let turn = 0; !done; turn++) {
    if (turn > 10000) throw new Error("the session is stuck");
    await yieldTurn();
    if (!done && vi.getTimerCount() > 0) await vi.advanceTimersToNextTimerAsync();
  }
  return pending;
}

async function flush() {
  for (let turn = 0; turn < 20; turn++) await yieldTurn();
}

function yieldTurn() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function emptySession(): Session {
  return { stop_code: 0, stderr: [], replies: [], spawn_error: null };
}

function normaliseSession(session: RawReply): Session {
  return {
    stop_code: typeof session.stop_code === "number" ? session.stop_code : 0,
    stderr: (session.stderr ?? []) as string[],
    replies: [...((session.replies ?? []) as RawReply[])],
    spawn_error: typeof session.spawn_error === "string" ? session.spawn_error : null,
  };
}

/** What a scripted reply says, read the way the Rust fixture reader reads it. */
function answerOf(reply: RawReply) {
  if ("result" in reply) return { kind: "result" as const, result: reply.result ?? null };
  if ("error" in reply) return { kind: "error" as const, message: String(reply.error?.message ?? "") };
  if ("silent" in reply) return { kind: "silent" as const };
  if ("process_error" in reply) return { kind: "process_error" as const, message: String(reply.process_error) };
  if ("exit" in reply) return { kind: "exit" as const, code: typeof reply.exit === "number" ? reply.exit : 1 };
  if ("status" in reply) {
    return { kind: "status" as const, status: Number(reply.status), body: String(reply.body ?? "") };
  }
  return { kind: "fail" as const, message: String(reply.fail ?? "") };
}

/** A process that answers from the script. Its exit, when asked to stop, carries the session's stop code. */
function fakeChild(script: Script) {
  const session = script.current;
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: () => void };
  stdout.setEncoding = () => {};
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: () => void };
  stderr.setEncoding = () => {};
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  let closed = false;

  const out = (chunk: string) => queueMicrotask(() => stdout.emit("data", chunk));
  const err = (chunk: string) => queueMicrotask(() => stderr.emit("data", chunk));
  const exit = (code: number) => {
    if (closed) return;
    closed = true;
    child.exitCode = code;
    queueMicrotask(() => child.emit("exit", code));
  };

  child.stdout = stdout;
  child.stderr = stderr;
  child.exitCode = null;
  child.stdin = {
    get writable() {
      return !closed;
    },
    write(text: string) {
      const message = JSON.parse(text);
      script.wire.push(message);
      if (message.id === undefined) return true;

      const reply = session.replies.shift();
      if (!reply) return true;

      for (const chunk of (reply.before ?? []) as string[]) out(chunk);
      for (const line of (reply.stderr ?? []) as string[]) err(`${line}\n`);

      // The process reports an error without ending, as a broken pipe does.
      if ("process_error" in reply) {
        const message = String(reply.process_error);
        queueMicrotask(() => child.emit("error", new Error(message)));
        return true;
      }

      const answer = answerOf(reply);
      if (answer.kind === "exit") {
        exit(answer.code);
        return true;
      }
      if (answer.kind === "result" || answer.kind === "error") {
        const envelope =
          answer.kind === "result"
            ? { jsonrpc: "2.0", id: message.id, result: answer.result }
            : { jsonrpc: "2.0", id: message.id, error: { message: answer.message } };
        const text = `${JSON.stringify(envelope)}\n`;
        if (reply.split === true) {
          const middle = Math.floor(text.length / 2);
          out(text.slice(0, middle));
          out(text.slice(middle));
        } else {
          out(text);
        }
      }
      return true;
    },
    end() {
      exit(session.stop_code);
    },
  };

  for (const line of session.stderr) err(`${line}\n`);
  return child;
}

/** HTTP answers from the same script. Each request takes the next answer; notifications get a 202. */
async function fakeFetch(script: Script, options: RequestInit) {
  const headers = keyHeaders((options.headers ?? {}) as Record<string, string>);

  if (options.method === "DELETE") {
    script.wire.push({ http: "DELETE", headers, message: null });
    return new Response("", { status: 200 });
  }

  const message = options.body ? JSON.parse(String(options.body)) : null;
  script.wire.push({ http: "POST", headers, message });
  if (message?.id === undefined) return new Response("", { status: 202 });

  const reply = script.current.replies.shift();
  if (!reply) return new Response("", { status: 500 });

  const answer = answerOf(reply);
  const extra = (reply.headers ?? {}) as Record<string, string>;
  if (answer.kind === "fail") throw new Error(answer.message);
  if (answer.kind === "status") return new Response(answer.body, { status: answer.status, headers: extra });
  if (answer.kind === "result" || answer.kind === "error") {
    const envelope =
      answer.kind === "result"
        ? { jsonrpc: "2.0", id: message.id, result: answer.result }
        : { jsonrpc: "2.0", id: message.id, error: { message: answer.message } };
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { "content-type": "application/json", ...extra },
    });
  }
  return new Response("", { status: 500 });
}

function keyHeaders(headers: Record<string, string>) {
  const kept: Record<string, string> = {};
  for (const name of ["x-consumer-api-key", "x-api-key"]) {
    if (headers[name] !== undefined) kept[name] = headers[name];
  }
  return kept;
}

/** Records every line the reference writes, with its level, scope, message and data. */
function recordLogs(logs: Record<string, unknown>[]) {
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(log, level).mockImplementation((scope: unknown, message: unknown, data?: unknown) => {
      logs.push({ level, scope, msg: message, data: clone(data ?? null) });
    });
  }
  vi.spyOn(log, "fail").mockImplementation((scope: unknown, message: unknown, error: unknown, data?: unknown) => {
    const reason = (error as Error | undefined)?.message ?? String(error);
    logs.push({ level: "error", scope, msg: message, data: clone({ ...(data as object), reason }) });
  });
  vi.spyOn(log, "swallow").mockImplementation((scope: unknown, _error: unknown, why: unknown) => {
    logs.push({ level: "debug", scope, msg: `swallowed: ${why}`, data: null });
  });
}

function keepLine(line: Record<string, unknown>) {
  return line.scope !== "mcp" && !TRANSPORT_LINES.has(String(line.msg));
}

/** Drops the durations, and names the executable the way the Rust runner does. Everything else is compared exactly. */
function normaliseLine(line: Record<string, unknown>) {
  const data = line.data as Record<string, unknown> | null;
  if (data && typeof data === "object") {
    delete data.durMs;
    if ("command" in data) data.command = "node";
  }
  return line;
}

/** A package the memory server is installed as, so the start finds its entry point without npm. */
function installPackage(serverRoot: string, pkg: string) {
  const dir = path.join(serverRoot, "node_modules", ...pkg.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: pkg, bin: "index.js" }));
  fs.writeFileSync(path.join(dir, "index.js"), "");
}

/** The JSON a fixture would hold: undefined and functions gone, as they are in a file. */
function clone<T>(value: T): T {
  return value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T);
}
