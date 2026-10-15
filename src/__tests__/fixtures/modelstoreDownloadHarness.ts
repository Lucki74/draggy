// Runs electron/modelStorage.cjs downloads against a scripted https server, one scenario at a time.
// core/crates/models/tests/modelstore.rs plays the same scripts through the Rust downloader with fakes, so both must agree.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const STORAGE_PATH = require.resolve("../../../electron/modelStorage.cjs");

export type Item = { data: string } | { fail: string } | { stall: true };
export type Reply = {
  hang?: true;
  error?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: Item[];
};
export type Seed = { name: string; content: string; ageMs?: number };
export type Args = {
  url: string;
  filename?: string;
  keepExtension?: boolean;
  stallMs?: number;
  retries?: number;
  retryDelayMs?: number;
  maxRedirects?: number;
};
export type Op =
  | { op: "download"; args: Args }
  | { op: "start"; id: string; args: Args }
  | { op: "await"; id: string }
  | { op: "cancel"; args: { filename: string; keepExtension?: boolean } };
export type Scenario = { seed?: Seed[]; replies: Reply[]; ops: Op[] };
export type Recorded = {
  results: unknown[];
  files: { name: string; content: string }[];
  requests: { url: string; range: string | null }[];
};

type WriteTarget = { write(chunk: Buffer, done: () => void): unknown; end(): unknown };
type Storage = {
  downloadGgufModel: (options: Record<string, unknown>) => Promise<{ success: boolean; filename: string }>;
  cancelDownloadGgufModel: (dir: string, filename: string, keepExtension?: boolean) => Promise<{ success: boolean }>;
};

/** A request the reference made: the idle clock it arms, and the destroy it can call. */
class FakeRequest extends EventEmitter {
  done = false;
  private limit = 0;
  private onIdle: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;

  setTimeout(ms: number, callback?: () => void): this {
    this.limit = ms;
    this.onIdle = callback ?? null;
    this.rearm();
    return this;
  }

  /** Restarts the idle clock, as activity on a real socket does. */
  rearm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.done || this.limit <= 0 || !this.onIdle) return;
    this.timer = setTimeout(() => this.onIdle?.(), this.limit);
    this.timer.unref();
  }

  /** The answer is complete: nothing is left to time out. */
  finish(): void {
    this.limit = 0;
    this.rearm();
  }

  destroy(error?: Error): this {
    if (this.done) return this;
    this.done = true;
    this.rearm();
    if (error) process.nextTick(() => this.emit("error", error));
    return this;
  }
}

/** An answer whose body arrives as the script says; `pipe` is the write path the reference uses. */
class FakeResponse extends EventEmitter {
  complete = false;
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  private readonly writes: Promise<void>[] = [];

  constructor(statusCode: number, headers: Record<string, string>) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
  }

  resume(): this {
    return this;
  }

  destroy(): this {
    return this;
  }

  pipe(dest: WriteTarget): WriteTarget {
    this.on("data", (chunk: Buffer) => {
      this.writes.push(new Promise<void>((resolve) => dest.write(chunk, () => resolve())));
    });
    this.on("end", () => dest.end());
    return dest;
  }

  /** Waits until the chunks handed to the file are on disk, so a cut-off keeps exactly the bytes sent before it. */
  async flushed(): Promise<void> {
    await Promise.all(this.writes.splice(0));
  }
}

async function drive(res: FakeResponse, req: FakeRequest, body: Item[]): Promise<void> {
  for (const item of body) {
    if (req.done) return;
    if ("data" in item) {
      res.emit("data", Buffer.from(item.data, "utf8"));
      req.rearm();
      await res.flushed();
    } else if ("fail" in item) {
      req.finish();
      res.emit("close");
      return;
    } else {
      // A stall: nothing more arrives, and the idle clock the reference armed ends the request.
      return;
    }
  }
  if (req.done) return;
  req.finish();
  res.complete = true;
  res.emit("end");
  res.emit("close");
}

type Call = { url: string; range: string | null };

function scriptedGet(queue: Reply[], calls: Call[]) {
  return (url: string, options: { headers?: Record<string, string> } | undefined, callback: (res: FakeResponse) => void) => {
    const req = new FakeRequest();
    calls.push({ url, range: options?.headers?.Range ?? null });
    const reply = queue.shift();
    setImmediate(() => {
      if (req.done) return;
      if (!reply) return void req.destroy(new Error("no reply scripted"));
      if (reply.hang) return;
      if (reply.error) return void req.destroy(new Error(reply.error));
      const res = new FakeResponse(reply.status ?? 200, reply.headers ?? {});
      callback(res);
      void drive(res, req, reply.body ?? []);
    });
    return req;
  };
}

/** The outcome the IPC layer shows: success, a cancel as its own result, or the error's message. */
async function settle(promise: Promise<{ success: boolean; filename: string }>): Promise<unknown> {
  try {
    const done = await promise;
    return { success: done.success, filename: done.filename };
  } catch (error) {
    const err = error as Error;
    return err.name === "AbortError" ? { cancelled: true } : { error: err.message };
  }
}

function writeSeed(dir: string, seed: Seed): void {
  const file = path.join(dir, seed.name);
  fs.writeFileSync(file, seed.content);
  if (seed.ageMs !== undefined) {
    const when = (Date.now() - seed.ageMs) / 1000;
    fs.utimesSync(file, when, when);
  }
}

function listFiles(dir: string): { name: string; content: string }[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, content: fs.readFileSync(path.join(dir, name), "utf8") }));
}

/** Plays one scenario through the reference downloader on a scratch folder, then reports what happened. */
export async function runScenario(scenario: Scenario): Promise<Recorded> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-downloads-"));
  const modelsDir = path.join(scratch, "models");
  const https = require("node:https") as { get: unknown };
  const original = https.get;
  const calls: Call[] = [];
  https.get = scriptedGet(structuredClone(scenario.replies), calls);
  try {
    fs.mkdirSync(modelsDir, { recursive: true });
    for (const seed of scenario.seed ?? []) writeSeed(modelsDir, seed);
    delete require.cache[STORAGE_PATH];
    const storage = require(STORAGE_PATH) as Storage;
    const toOptions = (args: Args) => ({
      url: args.url,
      modelsDir,
      filename: args.filename ?? "model.gguf",
      keepExtension: args.keepExtension,
      stallMs: args.stallMs,
      retries: args.retries,
      retryDelayMs: args.retryDelayMs,
      maxRedirects: args.maxRedirects,
    });
    const results: unknown[] = [];
    const started = new Map<string, Promise<unknown>>();
    for (const op of scenario.ops) {
      if (op.op === "download") {
        results.push(await settle(storage.downloadGgufModel(toOptions(op.args))));
      } else if (op.op === "start") {
        started.set(op.id, settle(storage.downloadGgufModel(toOptions(op.args))));
        results.push({ started: op.id });
      } else if (op.op === "await") {
        results.push(await started.get(op.id));
      } else {
        const done = await storage.cancelDownloadGgufModel(modelsDir, op.args.filename, op.args.keepExtension ?? false);
        results.push(done);
      }
    }
    return { results, files: listFiles(modelsDir), requests: calls };
  } finally {
    https.get = original;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
