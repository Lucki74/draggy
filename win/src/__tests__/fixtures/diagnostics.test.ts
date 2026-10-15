// Golden fixtures for the diagnostics writer. Each case drives the Electron reference (electron/logger.cjs,
// logScrub.cjs, logThresholds.cjs) and checks what it produced. core/crates/diagnostics/tests/fixtures.rs
// runs the same ops and inputs against the Rust port, so both must print the same lines.
// RUNNERS START
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const LOGGER = require.resolve("../../../electron/logger.cjs");
const SCRUB = require.resolve("../../../electron/logScrub.cjs");
const THRESHOLDS = require.resolve("../../../electron/logThresholds.cjs");
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/diagnostics");

/** A timer starts at MONO_START on the monotonic clock and ends `elapsedMs` later. */
const MONO_START = 1000;
const LOG_OPS: readonly string[] = ["debug", "info", "warn", "error"];
const ENV_KEYS = ["LOG_LEVEL", "APP_LOG_LEVEL", "DEBUG_LOG_LEVEL", "DRAGGY_DEBUG"] as const;

type Op = { op: string } & Record<string, unknown>;
type Input = {
  env?: Record<string, string>;
  clock?: number;
  session?: string;
  pid?: number;
  ops: Op[];
  packaged?: boolean;
  envLocal?: string | null;
  files?: Record<string, unknown>;
  /** Bytes written to a log file before the writer starts, for cases that need a file already large. */
  fill?: { file: string; bytes: number };
  /** The rotation cap in bytes; absent keeps the default. */
  maxBytes?: number;
  tail?: { file: string; bytes?: unknown; summary?: boolean } | null;
};
type LogFiles = { appFile: string; debugFile: string; eventsFile: string };
type Init = LogFiles & {
  sessionId: string;
  previousCrashed: boolean;
  previousSession: string | null;
  previousStartedAt: string | null;
};
type Timer = { end: (extra?: unknown) => void; fail: (error: Error, extra?: unknown) => void };
type Logger = {
  init: (app: object) => Init;
  flush: () => Promise<void>;
  closeStreams: () => Promise<void>;
  registerSecret: (value: string) => void;
  dumpRecent: (reason: string) => void;
  setMaxBytes: (value: number) => void;
  setLevel: (change: { level?: string; scopes?: string | string[] | null; durationMs?: number; keep?: boolean }) => unknown;
  getLevelState: () => { level: string; scopes: string[]; keep: boolean; until: number | null };
  ingestRendererEntries: (input: unknown) => void;
  noteSlow: (name: string, durMs: number) => void;
  noteStat: (kind: string, value?: number) => void;
  endSession: (clean?: boolean) => void;
  readTail: (target?: string, bytes?: number) => string;
  log: {
    debug: (scope: string, ...parts: unknown[]) => void;
    info: (scope: string, ...parts: unknown[]) => void;
    warn: (scope: string, ...parts: unknown[]) => void;
    error: (scope: string, ...parts: unknown[]) => void;
    fail: (scope: string, message: string, error: Error, data?: unknown) => void;
    swallow: (scope: string, error: Error | undefined, why: string) => void;
    swallowed: (scope: string, why: string, fallback: unknown) => (error?: Error) => unknown;
    time: (scope: string, label: string, data?: unknown, options?: { warnMs?: number }) => Timer;
    once: (key: string, scope: string, message: string, data?: unknown, level?: string) => boolean;
    limited: (key: string, level: string, scope: string, message: string, data?: unknown, windowMs?: number) => boolean;
  };
};

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Each case loads a fresh module, as a fresh process would: the logger keeps its recent lines and keystore at module level.
 * Its `init` adds process handlers, which are removed again so the cases do not pile up listeners. */
function freshLogger(): Logger {
  for (const id of [LOGGER, SCRUB]) delete require.cache[id];
  const events = ["uncaughtException", "unhandledRejection"] as const;
  const known = new Map(events.map((name) => [name, new Set(process.listeners(name))]));
  cleanups.push(() => {
    for (const name of events) {
      for (const listener of process.listeners(name)) {
        if (!known.get(name)?.has(listener)) process.removeListener(name, listener);
      }
    }
  });
  return require(LOGGER) as Logger;
}

/** Sets the four logger variables for one case and clears the others. The previous values come back in cleanup. */
function setEnv(env: Record<string, string> = {}): void {
  const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  cleanups.push(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/** The process id is pinned because events.jsonl records it. */
function pinPid(pid: number): void {
  const original = Object.getOwnPropertyDescriptor(process, "pid");
  Object.defineProperty(process, "pid", { value: pid, configurable: true });
  cleanups.push(() => {
    if (original) Object.defineProperty(process, "pid", original);
  });
}

/** An Error with the fields the fixture names. A missing stack stays missing, as it does for a stackless error. */
function buildError(spec: unknown): Error {
  const fields = spec as {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    errno?: number;
    syscall?: string;
    status?: number;
    cause?: unknown;
  };
  const error = new Error(fields.message) as Error & Record<string, unknown>;
  error.name = fields.name;
  error.stack = fields.stack;
  for (const key of ["code", "errno", "syscall", "status"] as const) {
    if (fields[key] !== undefined) error[key] = fields[key];
  }
  if (fields.cause !== undefined) error.cause = buildError(fields.cause);
  return error;
}

function runOp(logger: Logger, op: Op): void {
  const scope = op.scope as string;
  const message = op.message as string;
  switch (op.op) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      if (op.data === undefined) logger.log[op.op](scope, message);
      else logger.log[op.op](scope, message, op.data);
      return;
    case "fail":
      logger.log.fail(scope, message, buildError(op.error), op.data);
      return;
    case "swallow":
      logger.log.swallow(scope, op.error === undefined ? undefined : buildError(op.error), op.why as string);
      return;
    case "swallowed":
      logger.log.swallowed(scope, op.why as string, null)(op.error === undefined ? undefined : buildError(op.error));
      return;
    case "time": {
      const perf = vi
        .spyOn(performance, "now")
        .mockReturnValueOnce(MONO_START)
        .mockReturnValueOnce(MONO_START + (op.elapsedMs as number));
      const options = op.warnMs === undefined ? {} : { warnMs: op.warnMs as number };
      const timer = logger.log.time(scope, op.label as string, op.data, options);
      if (op.end === "fail") timer.fail(buildError(op.error), op.endData);
      else timer.end(op.endData);
      perf.mockRestore();
      return;
    }
    case "once":
      logger.log.once(op.key as string, scope, message, op.data, op.level as string | undefined);
      return;
    case "limited":
      logger.log.limited(
        op.key as string,
        op.level as string,
        scope,
        message,
        op.data,
        op.windowMs as number | undefined,
      );
      return;
    case "ingest": {
      const list =
        op.repeat === undefined
          ? (op.entries ?? op.entry)
          : Array.from({ length: op.repeat as number }, () => op.entry);
      logger.ingestRendererEntries(list);
      return;
    }
    case "advance":
      vi.advanceTimersByTime(op.ms as number);
      return;
    case "register":
      logger.registerSecret(op.value as string);
      return;
    case "setLevel": {
      const change: { level?: string; scopes?: string | string[] | null; durationMs?: number; keep?: boolean } = {};
      if (op.level !== undefined) change.level = op.level as string;
      if (op.scopes !== undefined) change.scopes = op.scopes as string | string[] | null;
      if (op.durationMs !== undefined) change.durationMs = op.durationMs as number;
      if (op.keep !== undefined) change.keep = op.keep as boolean;
      logger.setLevel(change);
      return;
    }
    case "noteSlow":
      logger.noteSlow(op.channel as string, op.durMs as number);
      return;
    case "noteStat":
      logger.noteStat(op.kind as string, op.value as number | undefined);
      return;
    case "endSession":
      logger.endSession(op.clean as boolean | undefined);
      return;
    case "dumpRecent":
      logger.dumpRecent(op.reason as string);
      return;
    default:
      throw new Error(`unknown op ${op.op}`);
  }
}

function runOps(logger: Logger, ops: Op[]): void {
  for (const op of ops) runOp(logger, op);
}

const readText = (file: string): string => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The three log files as text, read together so a case can diff them before and after its ops. */
function snapshot(init: LogFiles): { app: string; debug: string; events: string } {
  return { app: readText(init.appFile), debug: readText(init.debugFile), events: readText(init.eventsFile) };
}

/** The boot line is the first line of every file, sequence 1. Its text names the Node version, so no case pins it. */
function withoutBoot(lines: string[]): string[] {
  return lines.filter((line) => {
    if (line.startsWith("{")) return (JSON.parse(line) as { seq: number }).seq !== 1;
    return !/^\S+ \S+ \S+\.1 /.test(line);
  });
}

/** Starts a writer the way the app does, on a fake clock that only moves when an op advances it. Returns once the boot line is on disk. */
async function startWriter(input: Input): Promise<{ logger: Logger; init: Init; root: string; logDir: string }> {
  setEnv(input.env);
  pinPid(input.pid ?? 4242);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-diag-fixture-"));
  const logDir = path.join(root, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  for (const [name, content] of Object.entries(input.files ?? {})) {
    fs.writeFileSync(path.join(logDir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  if (input.fill) fs.writeFileSync(path.join(logDir, input.fill.file), "a".repeat(input.fill.bytes));
  if (typeof input.envLocal === "string") fs.writeFileSync(path.join(root, ".env.local"), input.envLocal);
  const session = input.session ?? "";
  const logger = freshLogger();
  if (input.maxBytes !== undefined) logger.setMaxBytes(input.maxBytes);
  // ERROR lines are mirrored to the console, and unpackaged runs mirror INFO and WARN; the fixtures compare files.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: input.clock ?? 0 });
  const random = vi.spyOn(crypto, "randomBytes").mockImplementation(() => Buffer.from(session, "hex"));
  let init: Init;
  try {
    init = logger.init({
      getPath: () => root,
      getName: () => "Draggy",
      getVersion: () => "0",
      getAppPath: () => root,
      isPackaged: input.packaged ?? true,
    });
  } finally {
    random.mockRestore();
  }
  await logger.flush();
  return { logger, init, root, logDir };
}

/** Runs the ops, flushes, and returns each file's lines written after the boot line. */
async function runFormat(input: Input): Promise<{ app: string[]; debug: string[]; events: string[] }> {
  const { logger, init, root } = await startWriter(input);
  try {
    const before = snapshot(init);
    runOps(logger, input.ops);
    await logger.flush();
    const after = snapshot(init);
    return {
      app: splitLines(after.app.slice(before.app.length)),
      debug: splitLines(after.debug.slice(before.debug.length)),
      events: splitLines(after.events.slice(before.events.length)),
    };
  } finally {
    await logger.closeStreams();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** A long tail is checked by its length and both ends, so a case never pins megabytes of text. */
function tailOf(text: string, summary: boolean | undefined): string | { length: number; start: string; end: string } {
  if (!summary) return text;
  return { length: text.length, start: text.slice(0, 10), end: text.slice(-30) };
}

/** Format lines, plus the text `readTail` returns for the file the case names. */
async function runHelpers(input: Input): Promise<{ app: string[]; debug: string[]; events: string[]; tail: unknown }> {
  const { logger, init, root } = await startWriter(input);
  try {
    const before = snapshot(init);
    runOps(logger, input.ops);
    await logger.flush();
    const after = snapshot(init);
    const tail = input.tail
      ? tailOf(logger.readTail(input.tail.file, input.tail.bytes as number | undefined), input.tail.summary)
      : null;
    return {
      app: splitLines(after.app.slice(before.app.length)),
      debug: splitLines(after.debug.slice(before.debug.length)),
      events: splitLines(after.events.slice(before.events.length)),
      tail,
    };
  } finally {
    await logger.closeStreams();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Probe messages that reached each file, in op order, plus the level state after the ops. */
async function runLevels(input: Input): Promise<{ level: string; scopes: string[]; app: string[]; debug: string[] }> {
  const { logger, init, root } = await startWriter(input);
  try {
    runOps(logger, input.ops);
    await logger.flush();
    const appText = readText(init.appFile);
    const debugText = readText(init.debugFile);
    const probes = input.ops.filter((op) => LOG_OPS.includes(op.op)).map((op) => op.message as string);
    const state = logger.getLevelState();
    return {
      level: state.level,
      scopes: state.scopes,
      app: probes.filter((message) => appText.includes(message)),
      debug: probes.filter((message) => debugText.includes(message)),
    };
  } finally {
    await logger.closeStreams();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Renderer ingestion: how many renderer lines reached events.jsonl, and the count each dropped-entries warning reported. */
async function runCaps(input: Input): Promise<{ rendered: number; dropped: number[] }> {
  const { logger, init, root } = await startWriter(input);
  try {
    runOps(logger, input.ops);
    await logger.flush();
    const events = splitLines(readText(init.eventsFile)).map((line) => JSON.parse(line) as Record<string, unknown>);
    return {
      rendered: events.filter((event) => String(event.scope).startsWith("renderer.")).length,
      dropped: events
        .filter((event) => event.scope === "logger" && event.msg === "renderer entries dropped")
        .map((event) => (event.data as { count: number }).count),
    };
  } finally {
    await logger.closeStreams();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Lifecycle: the previous run's marker, the restored level file, the state after the ops, and every line written, boot line left out. */
async function runSession(input: Input): Promise<unknown> {
  const { logger, init, root, logDir } = await startWriter(input);
  try {
    runOps(logger, input.ops);
    await logger.flush();
    const rawFile = (name: string): string | null => {
      const file = path.join(logDir, name);
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    };
    const lines = (name: string): string[] => withoutBoot(splitLines(readText(path.join(logDir, name))));
    return {
      previous: {
        crashed: init.previousCrashed,
        session: init.previousSession,
        startedAt: init.previousStartedAt,
      },
      state: logger.getLevelState(),
      marker: rawFile("session.json"),
      level: rawFile("level.json"),
      app: lines("app.log"),
      debug: lines("debug.log"),
      events: lines("events.jsonl"),
    };
  } finally {
    await logger.closeStreams();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Recent-line dumps: the data of each `recent events before failure` record, in the order they were written. */
async function runRecent(input: Input): Promise<unknown[]> {
  const { logger, init, root } = await startWriter(input);
  try {
    runOps(logger, input.ops);
    await logger.flush();
    return splitLines(readText(init.eventsFile))
      .map((line) => JSON.parse(line) as { msg?: string; data?: unknown })
      .filter((record) => record.msg === "recent events before failure")
      .map((record) => record.data);
  } finally {
    await logger.closeStreams();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Rotation: every log file in the folder after the ops, with its size, line count and first and last lines cut to 60 units. */
async function runRotation(input: Input): Promise<Record<string, unknown>> {
  const { logger, logDir, root } = await startWriter(input);
  try {
    runOps(logger, input.ops);
    await logger.flush();
    const files: Record<string, unknown> = {};
    const names = fs
      .readdirSync(logDir)
      .filter((name) => name !== "session.json" && name !== "level.json")
      .sort();
    for (const name of names) {
      const lines = splitLines(readText(path.join(logDir, name)));
      files[name] = {
        bytes: fs.statSync(path.join(logDir, name)).size,
        lines: lines.length,
        first: lines[0]?.slice(0, 60) ?? null,
        last: lines.at(-1)?.slice(0, 60) ?? null,
      };
    }
    return files;
  } finally {
    await logger.closeStreams();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The value the writer stores in place of `text` under a `prompt` key, read back from events.jsonl. */
async function runHash(text: string): Promise<string> {
  const { logger, init, root } = await startWriter({ ops: [] });
  try {
    logger.log.info("hash", "hashed", { prompt: text });
    await logger.flush();
    const last = splitLines(readText(init.eventsFile)).at(-1) ?? "{}";
    return (JSON.parse(last) as { data: { prompt: string } }).data.prompt;
  } finally {
    await logger.closeStreams();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runScrub(text: string): string {
  delete require.cache[SCRUB];
  const scrub = require(SCRUB) as { scrubSecrets: (value: string) => string };
  return scrub.scrubSecrets(text);
}

function runPaths(input: { text: string; home?: string; user?: string }): string {
  delete require.cache[SCRUB];
  const scrub = require(SCRUB) as {
    scrubPaths: (text: string, options: { home?: string; user?: string }) => string;
  };
  return scrub.scrubPaths(input.text, { home: input.home, user: input.user });
}

/** A channel the table does not hold falls back to the default. A prototype member such as `constructor` is not a number: it never warns. */
function runThreshold(channel: string): number | "never" {
  const table = require(THRESHOLDS) as {
    DEFAULT_IPC_SLOW_MS: number;
    IPC_SLOW_MS: Record<string, number | undefined>;
  };
  const limit: unknown = table.IPC_SLOW_MS[channel] ?? table.DEFAULT_IPC_SLOW_MS;
  return typeof limit === "number" ? limit : "never";
}

const RUNNERS: Record<string, (input: unknown) => Promise<unknown> | unknown> = {
  "scrub.json": (input) => runScrub(input as string),
  "paths.json": (input) => runPaths(input as { text: string; home?: string; user?: string }),
  "hash.json": (input) => runHash(input as string),
  "format.json": (input) => runFormat(input as Input),
  "values.json": (input) => runFormat(input as Input),
  "ingest.json": (input) => runFormat(input as Input),
  "levelLines.json": (input) => runFormat(input as Input),
  "helpers.json": (input) => runHelpers(input as Input),
  "ingestCaps.json": (input) => runCaps(input as Input),
  "levels.json": (input) => runLevels(input as Input),
  "session.json": (input) => runSession(input as Input),
  "recent.json": (input) => runRecent(input as Input),
  "rotation.json": (input) => runRotation(input as Input),
  "thresholds.json": (input) => runThreshold(input as string),
};
// RUNNERS END

describe("diagnostics fixtures", () => {
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as {
      cases: { name: string; input: unknown; expected: unknown }[];
    };
    describe(file, () => {
      for (const testCase of fixture.cases) {
        it(testCase.name, async () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          expect(await runner(testCase.input)).toEqual(testCase.expected);
        });
      }
    });
  }
});
