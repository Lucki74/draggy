// Drives the Electron/CJS llama-server reference (electron/llamaProcess.cjs and draftStats.cjs) for the engine fixtures
// engine-llama-*.json. The launch cases run startServer with the process spawn mocked, so the argument list is the one
// the reference would hand to llama-server. Shared by the vitest runner in engine.test.ts and the fixture generator.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const platform = require("../../../electron/platform.cjs") as {
  IS_WINDOWS: boolean;
  spawnHidden: (...args: unknown[]) => unknown;
  killTreeSync: (child: unknown) => void;
  detectFreeVideoMemoryGB: () => Promise<number | null>;
};
const cpuTopology = require("../../../electron/cpuTopology.cjs") as {
  getCpuTopology: () => Promise<{ logical: number; physical: number; performance: number }>;
};
const binaryManager = require("../../../electron/binaryManager.cjs") as {
  getEngineEnvironment: (...args: unknown[]) => unknown;
};
const llamaProcess = require("../../../electron/llamaProcess.cjs") as {
  determineKvCache: (
    modelPath: string,
    contextSize: number,
    vramGB: number,
    traits: Record<string, unknown>,
  ) => { cacheType: string; effectiveContext: number };
  batchSizes: (runnerType: string | null, vramGB: number, moe: boolean) => { batch: number; ubatch: number };
  fitTargetMiB: (vramGB: number) => number;
  promptCacheMiB: (modelPath: string, totalRamBytes: number) => number;
  draftFits: (modelPath: string, draftPath: string, vramGB: number, moe: boolean) => boolean;
  moeStreamArgs: (supports: (flag: string) => boolean, stream: unknown) => string[];
  failureReason: (lines: string[]) => string;
  startServer: (options: Record<string, unknown>) => Promise<{ success: boolean }>;
  getServerStatus: () => { contextSize: number; speculation: string };
  stopServerSync: () => void;
};
const draftStats = require("../../../electron/draftStats.cjs") as {
  parseAcceptance: (line: string) => { rate: number; accepted: number; generated: number } | null;
  record: (dir: string, modelPath: string, sample: { rate: number; generated: number }) => void;
  recordRefusal: (dir: string, modelPath: string) => void;
  draftSettings: (dir: string, modelPath: string) => { enabled: boolean; max: number; rate: number | null };
  resetForTests: () => void;
};

/** The header keys a fixture model declares; absent keys are left out of the file. */
export interface HeaderInput {
  contextLength?: number | null;
  blockCount?: number | null;
  expertCount?: number | null;
  headCountKv?: number | null;
  keyLength?: number | null;
  valueLength?: number | null;
  nextnPredictLayers?: number | null;
}

export interface ArgsInput {
  modelBytes: number;
  header: HeaderInput | null;
  projector: boolean;
  skipProjector: boolean;
  draft: { bytes: number } | null;
  skipDraft: boolean;
  contextSize: number | null;
  exactContext: boolean;
  vramGB: number;
  gpuLayers: number | null;
  threads: number | null;
  speculative: boolean;
  runnerType: string | null;
  windows: boolean;
  flags: string[];
  topology: { logical: number; physical: number; performance: number };
  totalRamBytes: number;
  moeStream: { cacheGB: number; ioThreads: number | null; direct: boolean; vramSlots: number } | null;
}

export interface ArgsOutput {
  args: string[];
  contextSize: number;
  speculation: string;
}

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

/** A file of the given size. Sparse on disk, so a 16 GB fixture costs nothing. */
function sparse(file: string, bytes: number): void {
  fs.writeFileSync(file, "x");
  fs.truncateSync(file, bytes);
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function u64(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function ggufString(text: string): Buffer {
  return Buffer.concat([u64(Buffer.byteLength(text)), Buffer.from(text, "utf8")]);
}

/** A GGUF v3 file whose metadata holds the given keys, for the header reader to read back. */
function writeGguf(file: string, header: HeaderInput): void {
  const keys: [string, number][] = [
    ["llama.context_length", header.contextLength ?? 0],
    ["llama.block_count", header.blockCount ?? 0],
    ["llama.expert_count", header.expertCount ?? 0],
    ["llama.attention.head_count_kv", header.headCountKv ?? 0],
    ["llama.attention.key_length", header.keyLength ?? 0],
    ["llama.attention.value_length", header.valueLength ?? 0],
    ["llama.nextn_predict_layers", header.nextnPredictLayers ?? 0],
  ];
  const present = keys.filter(([, value]) => value > 0);
  const parts: Buffer[] = [Buffer.from("GGUF"), u32(3), u64(0), u64(present.length + 1)];
  parts.push(ggufString("general.architecture"), u32(8), ggufString("llama"));
  for (const [key, value] of present) parts.push(ggufString(key), u32(4), u32(value));
  fs.writeFileSync(file, Buffer.concat(parts));
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

function fakeChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; exitCode: number | null } {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exitCode: null as number | null,
  });
  return child;
}

/** The argument list startServer hands the spawn, with the temp folder and the port named by placeholders. */
export async function runLlamaArgs(input: ArgsInput): Promise<ArgsOutput> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-llama-args-"));
  const userData = path.join(dir, "user");
  const binDir = path.join(dir, "bin");
  fs.mkdirSync(userData);
  fs.mkdirSync(binDir);
  const binary = path.join(binDir, "llama-server");
  const model = path.join(dir, "seer.gguf");
  const savedWindows = platform.IS_WINDOWS;
  const health = http.createServer((_req, res) => res.end("ok"));
  try {
    fs.writeFileSync(binary, "x");
    if (input.header) writeGguf(model, input.header);
    else fs.writeFileSync(model, "x");
    fs.truncateSync(model, input.modelBytes);
    if (input.projector) fs.writeFileSync(path.join(dir, "seer-mmproj.gguf"), "x");
    if (input.draft) sparse(path.join(dir, "seer-draft.gguf"), input.draft.bytes);
    // A cached answer for this exact binary, so no help text is asked for.
    const stat = fs.statSync(binary);
    fs.writeFileSync(
      path.join(userData, "engine-flags.json"),
      JSON.stringify({ key: `${binary}|${stat.size}|${stat.mtimeMs}`, flags: input.flags }),
    );

    const port = await freePort();
    vi.spyOn(platform, "killTreeSync").mockImplementation(() => {});
    vi.spyOn(platform, "detectFreeVideoMemoryGB").mockResolvedValue(null);
    vi.spyOn(cpuTopology, "getCpuTopology").mockResolvedValue(input.topology);
    vi.spyOn(os, "totalmem").mockReturnValue(input.totalRamBytes);
    vi.spyOn(binaryManager, "getEngineEnvironment").mockReturnValue({
      env: {},
      runnerDir: binDir,
      runnerType: input.runnerType ?? undefined,
      binaryPath: binary,
    });
    let spawned: string[] = [];
    vi.spyOn(platform, "spawnHidden").mockImplementation((_file: unknown, args: unknown) => {
      spawned = args as string[];
      if (!health.listening) health.listen(port, "127.0.0.1");
      return fakeChild();
    });
    platform.IS_WINDOWS = input.windows;

    const result = await llamaProcess.startServer({
      binaryPath: binary,
      modelPath: model,
      userDataDir: userData,
      vramGB: input.vramGB,
      gpuLayers: input.gpuLayers ?? undefined,
      contextSize: input.contextSize ?? undefined,
      exactContext: input.exactContext,
      port,
      threads: input.threads ?? undefined,
      speculative: input.speculative,
      moeStream: input.moeStream,
      skipProjector: input.skipProjector,
      skipDraft: input.skipDraft,
      log: quiet,
    });
    if (!result.success) throw new Error(`start failed: ${JSON.stringify(result)}`);
    const status = llamaProcess.getServerStatus();
    const args = spawned.map((arg) => arg.split(dir).join("<dir>"));
    const at = args.indexOf("--port");
    if (at >= 0) args[at + 1] = "<port>";
    return { args, contextSize: status.contextSize, speculation: status.speculation };
  } finally {
    llamaProcess.stopServerSync();
    await closeServer(health);
    platform.IS_WINDOWS = savedWindows;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface KvInput {
  modelBytes: number | null;
  contextSize: number;
  vramGB: number;
  traits: {
    moe: boolean;
    trainedContext: number | null;
    kvBytesQ8: number | null;
    exact: boolean;
    runnerType: string | null;
  };
}

/** determineKvCache for a model of the given size, through a sparse file the reference can stat. */
export function runKvCache(input: KvInput): { cacheType: string; effectiveContext: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-llama-kv-"));
  try {
    const model = path.join(dir, "m.gguf");
    if (input.modelBytes !== null) sparse(model, input.modelBytes);
    return llamaProcess.determineKvCache(model, input.contextSize, input.vramGB, input.traits);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export type SizingInput =
  | { op: "batch"; runnerType: string | null; vramGB: number; moe: boolean }
  | { op: "fitTarget"; windows: boolean; vramGB: number }
  | { op: "promptCache"; modelBytes: number | null; totalRamBytes: number }
  | { op: "draftFits"; modelBytes: number | null; draftBytes: number | null; vramGB: number; moe: boolean }
  | {
      op: "moeStream";
      flags: string[];
      stream: { cacheGB: number; ioThreads: number | null; direct: boolean; vramSlots: number } | null;
    };

/** One sizing rule of the launch, chosen by `op`. Sizes are sparse files, so the reference reads the same numbers. */
export function runSizing(input: SizingInput): unknown {
  if (input.op === "batch") return llamaProcess.batchSizes(input.runnerType, input.vramGB, input.moe);
  if (input.op === "fitTarget") {
    const saved = platform.IS_WINDOWS;
    try {
      platform.IS_WINDOWS = input.windows;
      return { fitTargetMiB: llamaProcess.fitTargetMiB(input.vramGB) };
    } finally {
      platform.IS_WINDOWS = saved;
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-llama-sizing-"));
  try {
    const model = path.join(dir, "m.gguf");
    const draft = path.join(dir, "m-draft.gguf");
    if (input.op === "promptCache") {
      if (input.modelBytes !== null) sparse(model, input.modelBytes);
      return { promptCacheMiB: llamaProcess.promptCacheMiB(model, input.totalRamBytes) };
    }
    if (input.op === "draftFits") {
      if (input.modelBytes !== null) sparse(model, input.modelBytes);
      if (input.draftBytes !== null) sparse(draft, input.draftBytes);
      return { fits: llamaProcess.draftFits(model, draft, input.vramGB, input.moe) };
    }
    const supports = (flag: string) => input.flags.includes(flag);
    return { args: llamaProcess.moeStreamArgs(supports, input.stream) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runAcceptance(input: { line: string }): unknown {
  return draftStats.parseAcceptance(input.line) ?? null;
}

export type DraftStatsStep =
  | { op: "record"; model: string; rate: number; accepted: number; generated: number }
  | { op: "refuse"; model: string };

export interface DraftStatsInput {
  /** The draft-stats.json a previous run left, or null for none. */
  initial: unknown;
  ops: DraftStatsStep[];
  /** The model whose settings are read at the end. */
  model: string;
}

/** Replays the replies and refusals against a folder that starts as `initial`, then reads the draft settings and the file. */
export function runDraftStats(input: DraftStatsInput): { settings: unknown; stored: unknown } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-draft-stats-"));
  try {
    draftStats.resetForTests();
    if (input.initial !== null) fs.writeFileSync(path.join(dir, "draft-stats.json"), JSON.stringify(input.initial));
    for (const step of input.ops) {
      if (step.op === "record") draftStats.record(dir, step.model, { rate: step.rate, generated: step.generated });
      else draftStats.recordRefusal(dir, step.model);
    }
    const settings = draftStats.draftSettings(dir, input.model);
    const file = path.join(dir, "draft-stats.json");
    const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    return { settings, stored };
  } finally {
    draftStats.resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runFailureReason(input: { lines: string[] }): string {
  return llamaProcess.failureReason(input.lines);
}
