// Golden fixtures for the local engine: CPU topology, hardware probe and benchmark, GPU memory and runner, release asset
// choice, the engine updater and host, and the failure classifier. Each case drives the Electron/CJS reference
// (electron/cpuTopology.cjs, hardwareProbe.cjs, binaryManager.cjs, engineUpdater.cjs, engineHost.cjs, llamaProcess.cjs,
// platform.cjs) and checks what it returns. core/crates/engine/tests/fixtures.rs runs the same inputs against the Rust
// port, so both must agree. Platform flags and the NVIDIA driver check are switched on the reference's own exports.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { windowsCases } from "./windowsScope";
import { runAcceptance, runDraftStats, runFailureReason, runKvCache, runLlamaArgs, runSizing } from "./engineLlama";

const require = createRequire(import.meta.url);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../../../../shared/fixtures/engine");

// RUNNERS START
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Case = { name: string; input: unknown; expected: unknown };
type Input = Record<string, unknown>;
type Space = { sizeBytes: number; freeBytes: number };

const cpuTopology = require("../../../electron/cpuTopology.cjs") as {
  fromCounts: (logical: number, physical: number) => unknown;
  windowsTopology: (cpus: { model: string }[]) => unknown;
};
const hardwareProbe = require("../../../electron/hardwareProbe.cjs") as {
  createHardwareProbe: (options: Record<string, unknown>) => {
    probe: () => Promise<unknown>;
    runBenchmark: (volume: string, options: { sizeGB: number }) => Promise<unknown>;
    benchmarks: () => unknown;
  };
  parseMountedDevices: (text: string) => Map<string, { usb: boolean }>;
  parseDiskEnum: (text: string) => unknown[];
  buildDrives: (letters: Map<string, { usb: boolean }>, disks: unknown[], space: (volume: string) => Space | null) => unknown[];
  parseSmartAppControl: (text: string) => string;
  summarize: (timings: Record<string, unknown>) => unknown;
  isFresh: (entry: { at: number } | undefined, now: number) => boolean;
};
const platform = require("../../../electron/platform.cjs") as {
  IS_WINDOWS: boolean;
  IS_MAC: boolean;
  IS_LINUX: boolean;
  largestQword: (text: string) => number;
  parseNvidiaInfo: (text: string) => unknown;
};
const binaryManager = require("../../../electron/binaryManager.cjs") as {
  pickReleaseAssets: (assets: { name: string }[], options: Record<string, unknown>) => {
    main?: { name: string };
    extra?: { name: string };
    variant?: string;
  };
  variantOf: (name: string) => string;
  buildNumber: (tag: string) => number;
  whyPicked: (profile: Record<string, unknown>, variant: string) => string;
  recommendedReleaseAsset: (vramGB: number) => string;
  validateDownloadUrl: (url: string) => boolean;
  detectGpuRunner: (llamaDir: string, vramGB: number) => { runnerDir: string; backendDll: string | null; runnerType: string };
  engineState: (llamaDir: string, vramGB: number) => { present: boolean; complete: boolean; runnerType: string };
  getEngineEnvironment: (
    userDataDir: string,
    vramGB: number,
    explicitBinary?: string,
  ) => { env: Record<string, string>; runnerDir: string; runnerType: string; binaryPath: string | null };
  serverName: () => string;
};
const engineUpdater = require("../../../electron/engineUpdater.cjs") as {
  variantFamily: (variant: string) => string;
  sameFamily: (installed: string, wanted: string) => boolean;
  parseBuild: (output: string) => number;
  cudaMajorIn: (dir: string) => number;
  applyPendingEngine: (userDataDir: string, options: { log: unknown }) => unknown;
  confirmEngine: (userDataDir: string) => boolean;
  rollbackEngine: (userDataDir: string, options: { log: unknown }) => unknown;
  isUnconfirmed: (userDataDir: string) => boolean;
};
const engineHost = require("../../../electron/engineHost.cjs") as {
  createEngineHost: (engines: { llamacpp: unknown; colibri: unknown }) => {
    start: (kind: string, launch: () => Promise<unknown>) => Promise<{ success: boolean; kind?: string }>;
    stop: () => void;
    status: () => { kind?: string | null; running: boolean; port?: number | null; model?: string | null };
    readonly active: string | null;
  };
};
const llamaProcess = require("../../../electron/llamaProcess.cjs") as {
  classifyFailure: (lines: string[]) => string;
  watchEngineLine: (line: string, options: Record<string, unknown>) => void;
};

/** Whole numbers stay JSON numbers; a value that JSON cannot carry fails the run. Undefined object keys drop out. */
function canon(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite output ${value}`);
    return value === 0 ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => canon(item));
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = canon(item);
    }
    return out;
  }
  return value as Json;
}

/** Inputs carry plain numbers, except the strings NaN, Infinity and -Infinity for non-finite values. */
function num(value: unknown): number {
  if (value === "NaN") return Number.NaN;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  return value as number;
}

function withTempDir<T>(body: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-engine-fixture-"));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-engine-fixture-"));
  try {
    return await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes a folder listing: names ending in "/" are folders, others are files with the text "x". */
function materialize(root: string, names: string[]): void {
  for (const name of names) {
    const target = path.join(root, name);
    if (name.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "x");
    }
  }
}

/** Replaces the server name with the one this host uses, so a Windows run writes llama-server.exe. */
function hostName(name: string): string {
  return name.replace("llama-server", binaryManager.serverName());
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(root, hostName(name));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}

/** Every file under the root with its text; engine.json is parsed and its install time dropped. */
function readTree(root: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const relative = path.relative(root, full).split(path.sep).join("/").replace(binaryManager.serverName(), "llama-server");
      const text = fs.readFileSync(full, "utf8");
      if (entry.name === "engine.json") {
        const meta = JSON.parse(text) as Record<string, unknown>;
        delete meta.installedAt;
        out[relative] = meta;
      } else {
        out[relative] = text;
      }
    }
  };
  walk(root);
  return out;
}

/** Runs `run` with the reference's platform flags switched, as its own tests do. */
function withPlatform<T>(name: string, run: () => T): T {
  const saved = { IS_WINDOWS: platform.IS_WINDOWS, IS_MAC: platform.IS_MAC, IS_LINUX: platform.IS_LINUX };
  Object.assign(platform, { IS_WINDOWS: name === "win32", IS_MAC: name === "darwin", IS_LINUX: name === "linux" });
  try {
    return run();
  } finally {
    Object.assign(platform, saved);
  }
}

const LINUX_DRIVER_FILES = [
  "/usr/lib/x86_64-linux-gnu/libcuda.so.1",
  "/usr/lib/aarch64-linux-gnu/libcuda.so.1",
  "/usr/lib64/libcuda.so.1",
  "/usr/lib/libcuda.so.1",
  "/usr/lib/wsl/lib/libcuda.so.1",
];

/** Runs `run` with an NVIDIA driver present or absent: a System32 folder on Windows, the driver paths on Linux. */
function withNvidia<T>(nvidia: boolean, root: string, run: () => T): T {
  const sysRoot = path.join(root, "sysroot");
  if (nvidia) {
    fs.mkdirSync(path.join(sysRoot, "System32"), { recursive: true });
    fs.writeFileSync(path.join(sysRoot, "System32", "nvcuda.dll"), "x");
  }
  const realExists = fs.existsSync;
  const savedRoot = process.env.SystemRoot;
  process.env.SystemRoot = sysRoot;
  fs.existsSync = ((file: fs.PathLike) => (LINUX_DRIVER_FILES.includes(String(file)) ? nvidia : realExists(file))) as typeof fs.existsSync;
  try {
    return run();
  } finally {
    fs.existsSync = realExists;
    if (savedRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = savedRoot;
  }
}

/** A path relative to a base folder, with "." for the base itself. */
function rel(base: string, target: string): string {
  return path.relative(base, target).split(path.sep).join("/") || ".";
}

function runCpu(input: Input): unknown {
  switch (input.op) {
    case "fromCounts":
      return cpuTopology.fromCounts(num(input.logical), num(input.physical));
    case "windowsTopology": {
      const cores = os as unknown as { availableParallelism: () => number };
      const saved = cores.availableParallelism;
      cores.availableParallelism = () => num(input.logical);
      try {
        return cpuTopology.windowsTopology(input.model === null ? [] : [{ model: input.model as string }]);
      } finally {
        cores.availableParallelism = saved;
      }
    }
  }
  throw new Error(`unknown cpu op ${String(input.op)}`);
}

function runRegistry(input: Input): unknown {
  switch (input.op) {
    case "mountedDevices":
      return [...hardwareProbe.parseMountedDevices(input.text as string).entries()].map(([letter, info]) => ({ letter, usb: info.usb }));
    case "diskEnum":
      return hardwareProbe.parseDiskEnum(input.text as string).map((disk) => {
        const d = disk as { index: number; bus: string; name: string; instance: string };
        return { index: d.index, bus: d.bus, name: d.name, instance: d.instance };
      });
    case "drives": {
      const spaces = input.space as Record<string, Space>;
      return hardwareProbe.buildDrives(
        hardwareProbe.parseMountedDevices(input.mounted as string),
        hardwareProbe.parseDiskEnum(input.disks as string),
        (volume) => spaces[volume] ?? null,
      );
    }
    case "smartAppControl":
      return hardwareProbe.parseSmartAppControl(input.text as string);
  }
  throw new Error(`unknown registry op ${String(input.op)}`);
}

async function runHardwareProbe(input: Input): Promise<unknown> {
  const memory = input.memory as { totalBytes: number; freeBytes: number };
  const home = input.homedir === undefined ? "/root" : (input.homedir as string);
  const osMutable = os as unknown as Record<string, unknown>;
  const saved = { totalmem: os.totalmem, freemem: os.freemem, homedir: os.homedir };
  osMutable.totalmem = () => memory.totalBytes;
  osMutable.freemem = () => memory.freeBytes;
  osMutable.homedir = () => home;
  try {
    return await withTempDirAsync(async (userData) => {
      if (input.cache) fs.writeFileSync(path.join(userData, "disk-bench.json"), JSON.stringify(input.cache));
      let clock = num(input.now);
      const spaces = input.space as Record<string, Space>;
      const probe = hardwareProbe.createHardwareProbe({
        userDataDir: userData,
        platformName: input.platform,
        now: () => clock,
        topology: () => input.cpu,
        getSpecs: async () => input.specs ?? null,
        space: (volume: string) => spaces[volume] ?? null,
        exec: async (_file: string, args: string[]) => {
          const key = args[1] ?? "";
          if (key.endsWith("MountedDevices")) return (input.mounted as string) ?? "";
          if (key.endsWith("disk\\Enum")) return (input.disks as string) ?? "";
          return `    VerifiedAndReputablePolicyState    REG_DWORD    ${input.sac ?? "0x0"}`;
        },
        write: async () => {},
        measure: async () => input.measure,
      });
      const results: unknown[] = [];
      for (const step of input.steps as { op: string; volume?: string; sizeGB?: number; ms?: number }[]) {
        if (step.op === "probe") results.push(await probe.probe());
        else if (step.op === "bench") results.push(await probe.runBenchmark(step.volume as string, { sizeGB: step.sizeGB as number }));
        else if (step.op === "benchmarks") results.push(probe.benchmarks());
        else if (step.op === "advance") clock += step.ms as number;
        else throw new Error(`unknown probe step ${step.op}`);
      }
      return results;
    });
  } finally {
    Object.assign(osMutable, saved);
  }
}

function runBench(input: Input): unknown {
  switch (input.op) {
    case "summarize":
      return hardwareProbe.summarize(input);
    case "isFresh":
      return hardwareProbe.isFresh(input.at === null ? undefined : { at: num(input.at) }, num(input.now));
  }
  throw new Error(`unknown bench op ${String(input.op)}`);
}

function runVideo(input: Input): unknown {
  if (input.op === "largestQword") return platform.largestQword(input.text as string);
  if (input.op === "nvidiaInfo") return platform.parseNvidiaInfo(input.text as string);
  throw new Error(`unknown video op ${String(input.op)}`);
}

function runAssets(input: Input): unknown {
  switch (input.op) {
    case "pick":
      return withPlatform(input.platform as string, () => {
        const assets = (input.assets as string[]).map((name) => ({ name }));
        const picked = binaryManager.pickReleaseAssets(assets, {
          vramGB: num(input.vramGB),
          arch: input.arch,
          nvidia: input.nvidia,
          cuda13: input.cuda13,
        });
        return { main: picked.main?.name ?? null, extra: picked.extra?.name ?? null, variant: picked.variant ?? null };
      });
    case "variantOf":
      return binaryManager.variantOf(input.name as string);
    case "buildNumber":
      return binaryManager.buildNumber(input.tag as string);
    case "whyPicked":
      return binaryManager.whyPicked({ vramGB: num(input.vramGB), nvidia: input.nvidia, cuda13: input.cuda13 }, input.variant as string);
    case "recommended":
      return withPlatform(input.platform as string, () => binaryManager.recommendedReleaseAsset(num(input.vramGB)));
    case "validateUrl":
      return binaryManager.validateDownloadUrl(input.url as string);
  }
  throw new Error(`unknown asset op ${String(input.op)}`);
}

function runGpuRunner(input: Input): unknown {
  return withTempDir((root) => {
    const llama = path.join(root, "llama");
    fs.mkdirSync(llama, { recursive: true });
    materialize(llama, input.files as string[]);
    return withPlatform(input.platform as string, () =>
      withNvidia(input.nvidia === true, root, () => {
        if (input.op === "state") {
          const state = binaryManager.engineState(llama, num(input.vramGB));
          return { present: state.present, complete: state.complete, runnerType: state.runnerType };
        }
        const runner = binaryManager.detectGpuRunner(llama, num(input.vramGB));
        return {
          runnerDir: rel(llama, runner.runnerDir),
          backendDll: runner.backendDll === null ? null : rel(llama, runner.backendDll),
          runnerType: runner.runnerType,
        };
      }),
    );
  });
}

function runEnvironment(input: Input): unknown {
  return withTempDir((root) => {
    const llama = path.join(root, "bin", "llama");
    fs.mkdirSync(llama, { recursive: true });
    materialize(llama, input.files as string[]);
    materialize(root, (input.explicitFiles as string[] | undefined) ?? []);
    const saved = { PATH: process.env.PATH, LD: process.env.LD_LIBRARY_PATH };
    process.env.PATH = (input.path as string) ?? "";
    process.env.LD_LIBRARY_PATH = (input.ldLibraryPath as string) ?? "";
    try {
      return withPlatform(input.platform as string, () =>
        withNvidia(input.nvidia === true, root, () => {
          const explicit = input.explicit === undefined ? undefined : path.join(root, input.explicit as string);
          const engine = binaryManager.getEngineEnvironment(root, num(input.vramGB), explicit);
          // Fixtures spell the folder with "/" and list entries with ":"; a Windows host's separators are mapped to them.
          const scrub = (text: string) => {
            const scrubbed = text.split(root).join("<root>");
            return path.sep === "\\" ? scrubbed.replaceAll("\\", "/").replaceAll(";", ":") : scrubbed;
          };
          const env = Object.fromEntries(Object.entries(engine.env).map(([key, value]) => [key, scrub(value)]));
          return {
            env,
            runnerDir: rel(root, engine.runnerDir),
            runnerType: engine.runnerType,
            binaryPath: engine.binaryPath === null ? null : rel(root, engine.binaryPath),
          };
        }),
      );
    } finally {
      if (saved.PATH === undefined) delete process.env.PATH;
      else process.env.PATH = saved.PATH;
      if (saved.LD === undefined) delete process.env.LD_LIBRARY_PATH;
      else process.env.LD_LIBRARY_PATH = saved.LD;
    }
  });
}

function runUpdater(input: Input): unknown {
  switch (input.op) {
    case "variantFamily":
      return engineUpdater.variantFamily(input.variant as string);
    case "sameFamily":
      return engineUpdater.sameFamily(input.installed as string, input.wanted as string);
    case "parseBuild":
      return engineUpdater.parseBuild(input.output as string);
    case "cudaMajor":
      return withTempDir((dir) => {
        materialize(dir, input.files as string[]);
        return engineUpdater.cudaMajorIn(dir);
      });
    case "steps":
      return withTempDir((root) => {
        writeTree(root, input.files as Record<string, string>);
        const log = { info() {}, debug() {}, warn() {}, error() {} };
        const results = (input.steps as { op: string }[]).map((step) => {
          switch (step.op) {
            case "apply":
              return engineUpdater.applyPendingEngine(root, { log });
            case "confirm":
              return engineUpdater.confirmEngine(root);
            case "rollback":
              return engineUpdater.rollbackEngine(root, { log });
            case "unconfirmed":
              return engineUpdater.isUnconfirmed(root);
          }
          throw new Error(`unknown updater step ${step.op}`);
        });
        return { results, tree: readTree(root) };
      });
  }
  throw new Error(`unknown updater op ${String(input.op)}`);
}

function runHost(input: Input): Promise<unknown> {
  type FakeEngine = { running: boolean; stops: number; stopSync: () => void; status: () => { running: boolean; port: number | null; model: string | null } };
  const fakeEngine = (): FakeEngine => {
    const engine: FakeEngine = {
      running: false,
      stops: 0,
      stopSync: () => {
        engine.stops += 1;
        engine.running = false;
      },
      status: () => ({ running: engine.running, port: engine.running ? 1 : null, model: engine.running ? "m" : null }),
    };
    return engine;
  };
  const llamacpp = fakeEngine();
  const colibri = fakeEngine();
  const host = engineHost.createEngineHost({ llamacpp, colibri });
  const steps = input.steps as { op: string; kind?: string; outcome?: string; detail?: string; message?: string }[];
  return steps.reduce<Promise<unknown[]>>(async (previous, step) => {
    const results = await previous;
    if (step.op === "start") {
      const launch = async () => {
        if (step.outcome === "throw") throw new Error(step.message as string);
        if (step.outcome === "success") (step.kind === "colibri" ? colibri : llamacpp).running = true;
        return step.outcome === "success" ? { success: true } : { success: false, kind: step.detail };
      };
      try {
        const outcome = await host.start(step.kind as string, launch);
        results.push({ success: outcome.success, kind: outcome.kind ?? null });
      } catch (error) {
        results.push({ error: (error as Error).message });
      }
    } else if (step.op === "stop") {
      host.stop();
      results.push(null);
    } else if (step.op === "status") {
      const status = host.status();
      results.push({ kind: status.kind ?? null, running: status.running, port: status.port ?? null, model: status.model ?? null });
    } else if (step.op === "state") {
      results.push({ active: host.active, stops: { llamacpp: llamacpp.stops, colibri: colibri.stops } });
    } else {
      throw new Error(`unknown host step ${step.op}`);
    }
    return results;
  }, Promise.resolve([]));
}

type LogCall = { level: string; scope: string; message: string; data?: Record<string, unknown> };

function runOutput(input: Input): unknown {
  const calls: LogCall[] = [];
  const logger = {
    debug: (scope: string, message: string, data?: Record<string, unknown>) => calls.push({ level: "debug", scope, message, data }),
    warn: (scope: string, message: string, data?: Record<string, unknown>) => calls.push({ level: "warn", scope, message, data }),
    info: () => {},
  };
  llamaProcess.watchEngineLine(input.line as string, { modelPath: "m.gguf", userDataDir: null, drafting: false, logger, moe: input.moe });
  const call = calls[0];
  if (!call) return null;
  if (call.level === "warn") {
    const match = /Only (\d+) of (\d+) layers/.exec(call.message);
    return { kind: "lowOffload", layers: Number(match?.[1]), total: Number(match?.[2]) };
  }
  if (call.message === "prompt evaluated") return { kind: "promptEvaluated", ms: call.data?.ms, tokens: call.data?.tokens };
  return { kind: "promptCacheReused", how: call.data?.how, similarity: call.data?.similarity, kept: call.data?.kept };
}

const RUNNERS: Record<string, (input: never) => unknown> = {
  "cpu-topology.json": (input) => runCpu(input as Input),
  "hardware-registry.json": (input) => runRegistry(input as Input),
  "hardware-probe.json": (input) => runHardwareProbe(input as Input),
  "hardware-bench.json": (input) => runBench(input as Input),
  "video-memory.json": (input) => runVideo(input as Input),
  "binary-assets.json": (input) => runAssets(input as Input),
  "gpu-runner.json": (input) => runGpuRunner(input as Input),
  "engine-environment.json": (input) => runEnvironment(input as Input),
  "engine-updater.json": (input) => runUpdater(input as Input),
  "engine-host.json": (input) => runHost(input as Input),
  "failure.json": (input) => llamaProcess.classifyFailure((input as { lines: string[] }).lines),
  "engine-output.json": (input) => runOutput(input as Input),
  "engine-llama-args.json": (input) => runLlamaArgs(input as never),
  "engine-llama-kv.json": (input) => runKvCache(input as never),
  "engine-llama-sizing.json": (input) => runSizing(input as never),
  "engine-llama-acceptance.json": (input) => runAcceptance(input as never),
  "engine-llama-failure-reason.json": (input) => runFailureReason(input as never),
  "engine-draft-stats.json": (input) => runDraftStats(input as never),
};
// RUNNERS END

describe("engine fixtures", () => {
  for (const file of fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort()) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as { cases: Case[] };
    const cases = windowsCases(file, fixture.cases);
    if (cases.length === 0) continue;
    describe(file, () => {
      for (const testCase of cases) {
        it(testCase.name, async () => {
          const runner = RUNNERS[file];
          if (!runner) throw new Error(`no runner for ${file}`);
          const result = await runner(testCase.input as never);
          expect(canon(result)).toEqual(testCase.expected);
        });
      }
    });
  }
});
