// Golden fixtures for the local API server: who is let in, reading a completion request, the bodies it writes, the HTTP
// routes, and the stateful sequences (busy replies, abandoned replies, hand-off). Each HTTP and sequence case invokes
// electron/apiServer.cjs's request listener directly, with a fixed clock.
// core/crates/api/tests/fixtures.rs runs the same JSON through the port, so both must agree.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/apiserver");

// RUNNERS START
type Fixture = { op?: string; [field: string]: unknown };
type Golden = { area: string; description: string; cases: { name: string; input: Fixture; expected: unknown }[] };
type Handler = (req: unknown, res: unknown) => void;
type ApiModule = {
  sameKey(given: unknown, expected: unknown): boolean;
  generateKey(): string;
  checkRequest(input: { headers: Record<string, string>; port: number; key: unknown }): { status: number; message: string } | null;
  readCompletionRequest(body: unknown): unknown;
  chunkLine(input: { id: string; model: string; created: number; content?: string; finish?: string | null }): string;
  completionBody(input: { id: string; model: string; created: number; content: string; usage?: unknown }): string;
  modelsBody(names: string[], created: number): string;
  createApiServer(options: unknown): { start(): Promise<unknown>; stop(): Promise<void>; address(): unknown };
};
type HttpModule = { createServer(handler: Handler): unknown };
type Reply = {
  announce?: string;
  chunks?: string[];
  error?: string;
  model?: string;
  content?: string;
  usage?: { promptTokens?: number; responseTokens?: number };
};
type RequestSpec = { method: string; url: string; headers?: Record<string, string>; body?: string; userContentPadding?: number };
type Config = { port: number; key: string; models: string[]; modelsFail?: boolean };
type Hold = "ignore_cancel" | "until_cancelled";
type Call = { request: unknown; signal: AbortSignal; settled: boolean };
type Generate = (request: unknown, options: GenerateOptions) => Promise<unknown>;
type GenerateOptions = {
  signal: AbortSignal;
  onModel?: (name: string) => void;
  onText?: (chunk: string) => void;
};

const require = createRequire(import.meta.url);
const api = require("../../../electron/apiServer.cjs") as ApiModule;
const http = require("node:http") as HttpModule;

/** Fields the reference treats as absent when they are null or missing. */
function optional(value: unknown): unknown {
  return value === null || value === undefined ? undefined : value;
}

function text(input: Fixture, key: string): string {
  return (input[key] ?? "") as string;
}

function runAccess(input: Fixture): unknown {
  switch (input.op) {
    case "sameKey":
      return api.sameKey(input.given, input.expected);
    case "checkRequest":
      return (
        api.checkRequest({
          headers: (input.headers ?? {}) as Record<string, string>,
          port: input.port as number,
          key: input.key,
        }) ?? null
      );
    case "generateKey": {
      // The reference draws its random bytes from node:crypto, so the fixed bytes stand in for them.
      vi.spyOn(crypto, "randomBytes").mockReturnValueOnce(Buffer.from(input.bytes as number[]) as never);
      return api.generateKey();
    }
    default:
      throw new Error(`unknown access op ${String(input.op)}`);
  }
}

function runRequest(input: Fixture): unknown {
  const { request, error } = api.readCompletionRequest(input.body) as { request?: unknown; error?: string };
  return error === undefined ? { request } : { error };
}

function runBodies(input: Fixture): unknown {
  switch (input.op) {
    case "chunkLine":
      return api.chunkLine({
        id: text(input, "id"),
        model: text(input, "model"),
        created: input.created as number,
        content: optional(input.content) as string | undefined,
        finish: (input.finish ?? null) as string | null,
      });
    case "completionBody":
      return api.completionBody({
        id: text(input, "id"),
        model: text(input, "model"),
        created: input.created as number,
        content: text(input, "content"),
        usage: optional(input.usage),
      });
    case "modelsBody":
      return api.modelsBody(input.names as string[], input.created as number);
    default:
      throw new Error(`unknown bodies op ${String(input.op)}`);
  }
}

/** The headers a client can tell apart. The reference sets them, and an absent one reads as null. */
const RELEVANT_HEADERS = ["content-type", "cache-control", "x-content-type-options", "connection"];

/** Completion ids are random, so both runners compare them as a placeholder. */
function normaliseIds(raw: string): string {
  return raw.replace(/chatcmpl-[0-9a-f]{24}/g, "chatcmpl-<random>");
}

/** The body `userContentPadding` stands for: a completion request whose user message is that many characters long. */
function paddedBody(length: number): string {
  return JSON.stringify({ model: "qwen3:8b", messages: [{ role: "user", content: "x".repeat(length) }] });
}

function lowerKeys(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
}

/** A request the way Node hands it to the listener: lowercase header names and a readable body. */
function fakeRequest(spec: RequestSpec) {
  const body = spec.userContentPadding !== undefined ? paddedBody(spec.userContentPadding) : (spec.body ?? "");
  const req = Readable.from(body === "" ? [] : [Buffer.from(body, "utf8")]) as Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = spec.method;
  req.url = spec.url;
  req.headers = lowerKeys(spec.headers ?? {});
  return req;
}

/** Records what the reference writes to a response, and resolves when the response ends. */
class FakeResponse extends EventEmitter {
  statusCode = 0;
  headers: Record<string, string> = {};
  headersSent = false;
  writableFinished = false;
  readonly done: Promise<void>;
  private readonly chunks: string[] = [];
  private resolveDone: () => void = () => undefined;

  constructor() {
    super();
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  writeHead(status: number, headers: Record<string, string>): this {
    this.statusCode = status;
    this.headers = { ...headers };
    this.headersSent = true;
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }

  end(chunk?: string): this {
    if (chunk !== undefined) this.write(chunk);
    this.writableFinished = true;
    this.resolveDone();
    return this;
  }

  text(): string {
    return this.chunks.join("");
  }
}

/** Stands in for the socket server, so start() binds nothing. */
const loopbackStub = {
  once() {
    return this;
  },
  listen(_port: number, _host: string, ready: () => void) {
    ready();
    return this;
  },
  address: () => ({ address: "127.0.0.1", port: 0 }),
  close(done?: () => void) {
    done?.();
  },
  closeAllConnections() {},
};

/** The model answers as the fixture says: an announced model, then text chunks, then a result or an error. */
function stubGenerate(reply: Reply): Generate {
  return async (_request, options) => {
    if (reply.announce !== undefined) options.onModel?.(reply.announce);
    for (const chunk of reply.chunks ?? []) options.onText?.(chunk);
    if (reply.error !== undefined) throw new Error(reply.error);
    return { model: reply.model ?? "", content: reply.content ?? "", usage: reply.usage ?? {} };
  };
}

/** Waits one event-loop turn at a time until the check holds, or the turns run out. Returns whether it held. */
async function settle(done: () => boolean, turns = 1000): Promise<boolean> {
  for (let turn = 0; turn < turns; turn++) {
    if (done()) return true;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return done();
}

async function untilEnded(done: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("no response")), 2000);
  });
  try {
    await Promise.race([done, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** The status, the relevant headers and the body of a finished response, as both runners report them. */
function shape(res: FakeResponse): unknown {
  const headers = lowerKeys(res.headers);
  const relevant = Object.fromEntries(RELEVANT_HEADERS.map((name) => [name, headers[name] ?? null]));
  const raw = normaliseIds(res.text());
  const body = relevant["content-type"] === "text/event-stream" ? raw : JSON.parse(raw);
  return { status: res.statusCode, headers: relevant, body };
}

/** Starts the server with the fixture's config and clock, and hands its request listener to `body`. Nothing is bound. */
async function withListener<T>(input: Fixture, generate: Generate, body: (listener: Handler) => Promise<T>): Promise<T> {
  const config = input.config as Config;
  let listener: Handler | undefined;
  const originalCreateServer = http.createServer;
  http.createServer = (handler: Handler) => {
    listener = handler;
    return loopbackStub;
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime((input.now as number) * 1000);
  try {
    const server = api.createApiServer({
      port: config.port,
      getKey: () => config.key,
      generate,
      listModels: async () => {
        if (config.modelsFail) throw new Error("disk");
        return config.models;
      },
    });
    await server.start();
    if (listener === undefined) throw new Error("the server made no listener");
    return await body(listener);
  } finally {
    http.createServer = originalCreateServer;
    vi.useRealTimers();
  }
}

/** One request through apiServer.cjs. */
async function serve(input: Fixture): Promise<unknown> {
  const reply = (input.reply ?? {}) as Reply;
  const spec = input.request as RequestSpec;
  return withListener(input, stubGenerate(reply), async (listener) => {
    const res = new FakeResponse();
    listener(fakeRequest(spec), res);
    await untilEnded(res.done);
    return shape(res);
  });
}

/**
 * An ordered list of steps against one server. `send` starts a request, and with `hold` its reply does not finish until
 * the client leaves (`until_cancelled`) or ever (`ignore_cancel`); the step reports `pending` while it runs. `abandon`
 * closes the client of a pending request and reports whether the reply saw the cancel and whether it settled. `report`
 * lists every reply the model was asked for, in order.
 */
async function runSteps(input: Fixture): Promise<unknown> {
  const reply = (input.reply ?? {}) as Reply;
  const steps = input.steps as Fixture[];
  const calls: Call[] = [];
  let hold: Hold | null = null;
  const plain = stubGenerate(reply);

  const generate: Generate = async (request, options) => {
    const call: Call = { request, signal: options.signal, settled: false };
    calls.push(call);
    try {
      if (hold === "ignore_cancel") return await new Promise<never>(() => undefined);
      if (hold === "until_cancelled") {
        return await new Promise<never>((_, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("cancelled")));
        });
      }
      return await plain(request, options);
    } finally {
      call.settled = true;
    }
  };

  return withListener(input, generate, async (listener) => {
    const outputs: unknown[] = [];
    const pending = new Map<string, { res: FakeResponse; call: number }>();
    for (const step of steps) {
      switch (step.op) {
        case "send": {
          hold = (step.hold ?? null) as Hold | null;
          const before = calls.length;
          const res = new FakeResponse();
          listener(fakeRequest(step.request as RequestSpec), res);
          const started = () => res.writableFinished || (hold !== null && calls.length > before);
          await settle(started);
          if (res.writableFinished) outputs.push(shape(res));
          else if (calls.length > before) {
            pending.set(String(step.as), { res, call: calls.length - 1 });
            outputs.push({ pending: true });
          } else outputs.push({ timeout: true });
          break;
        }
        case "abandon": {
          const entry = pending.get(String(step.as));
          if (entry === undefined) throw new Error(`no pending request ${String(step.as)}`);
          pending.delete(String(step.as));
          const call = calls[entry.call];
          entry.res.emit("close");
          const cancelled = call.signal.aborted;
          await settle(() => call.settled);
          outputs.push({ cancelled, settled: call.settled });
          break;
        }
        case "report":
          outputs.push({
            calls: calls.map((call) => ({ request: call.request, cancelled: call.signal.aborted, settled: call.settled })),
          });
          break;
        default:
          throw new Error(`unknown step ${String(step.op)}`);
      }
    }
    return outputs;
  });
}

const RUNNERS: Record<string, (input: Fixture) => unknown> = {
  "access.json": runAccess,
  "request.json": runRequest,
  "bodies.json": runBodies,
  "http.json": serve,
  "ops.json": runSteps,
};
// RUNNERS END

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiserver fixtures", () => {
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()) {
    const golden = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as Golden;
    describe(`${golden.area}/${file}`, () => {
      for (const fixture of golden.cases) {
        it(fixture.name, async () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          expect(await runner(fixture.input)).toEqual(fixture.expected);
        });
      }
    });
  }
});
