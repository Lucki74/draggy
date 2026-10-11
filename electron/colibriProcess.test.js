import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const colibri = require("./colibriProcess.cjs");
const { log } = require("./logger.cjs");

const runtime = { tag: "v2.0.0", variant: "cuda", dir: "C:\\ud\\colibri\\v2.0.0", python: "C:\\ud\\colibri\\python\\python.exe", script: "C:\\ud\\colibri\\v2.0.0\\openai_server.py" };
const plan = {
  vram: { expertGB: 2.4 },
  ram: { denseGB: 3.5, expertCacheGB: 12.7 },
  disk: { coldGB: 40, mirrors: ["D:\\m", "E:\\m"] },
};

/** A child process we drive by hand: lines go out on stderr, `exit` ends it. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.say = (line) => child.stderr.emit("data", Buffer.from(`${line}\n`));
  child.die = (code) => {
    child.exitCode = code;
    child.emit("exit", code, null);
  };
  return child;
}

function harness(overrides = {}) {
  const child = fakeChild();
  const spawned = [];
  const killed = [];
  let clock = 0;
  let healthy = false;
  const host = colibri.createColibriProcess({
    launcher: (file, args, options) => {
      spawned.push({ file, args, options });
      return child;
    },
    kill: (proc) => killed.push(proc),
    getFreePort: async () => 51234,
    fetchJson: async (port, route) => (route === "/health" && healthy ? { status: "ok", tiers: { vram: 1, ram: 2, disk: 3 }, scheduler: { active: 1 } } : null),
    prepareRuntime: () => runtime,
    topology: () => ({ physical: 8 }),
    pollMs: 1,
    idleTimeoutMs: 50,
    telemetryMs: 1000,
    now: () => clock,
    ...overrides,
  });
  return { host, child, spawned, killed, tick: (ms) => (clock += ms), setHealthy: (v) => (healthy = v) };
}

const begin = (host) => host.start({ userDataDir: "C:\\ud", modelDir: "D:\\models\\qwen", modelName: "qwen", plan });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("launch", () => {
  it("runs the embedded python on the gateway script, bound to localhost, never through a shell", () => {
    const launch = colibri.buildLaunch({ runtime, modelDir: "D:\\models\\qwen", port: 8000, plan, cudaBuild: true, physicalCores: 8, baseEnv: { PATH: "x", RAM_GB: "1" } });
    expect(launch.file).toBe(runtime.python);
    expect(launch.args).toEqual(["-u", runtime.script, "--model", "D:\\models\\qwen", "--host", "127.0.0.1", "--port", "8000", "--kv-slots", "1"]);
    expect(launch.options.cwd).toBe(runtime.dir);
    expect(launch.options.shell).toBeUndefined();
  });

  it("turns a plan into the variables the engines read", () => {
    const env = colibri.planEnvironment(plan, { cudaBuild: true, physicalCores: 8 });
    expect(env).toMatchObject({ RAM_GB: "16", COLI_CUDA: "1", COLI_GPU: "0", CUDA_DENSE: "1", CUDA_EXPERT_GB: "2", PILOT: "1", COLI_MODEL_MIRROR: "D:\\m;E:\\m", OMP_NUM_THREADS: "8" });
  });

  it("routes to cached experts only when the experimental switch is on", () => {
    const plan = { ram: { denseGB: 3.5, expertCacheGB: 5 }, disk: { coldGB: 0 } };
    expect(colibri.planEnvironment(plan).CACHE_ROUTE).toBeUndefined();
    expect(colibri.planEnvironment(plan).TOPP).toBeUndefined();
    expect(colibri.planEnvironment(plan, { lossy: true })).toMatchObject({ CACHE_ROUTE: "1", TOPP: "0.7" });
    const launch = colibri.buildLaunch({ runtime, modelDir: "m", port: 1, plan, lossy: true, baseEnv: { CACHE_ROUTE: "0" } });
    expect(launch.options.env.CACHE_ROUTE).toBe("1");
  });

  it("leaves the GPU variables out of a Vulkan build and the disk ones out of an in-RAM plan", () => {
    const env = colibri.planEnvironment({ ram: { denseGB: 3.5, expertCacheGB: 5 }, disk: { coldGB: 0 } });
    expect(env.COLI_CUDA).toBeUndefined();
    expect(env.PILOT).toBeUndefined();
    expect(env.COLI_MODEL_MIRROR).toBeUndefined();
  });

  it("lets the plan override inherited values, whatever the key's case", () => {
    const launch = colibri.buildLaunch({ runtime, modelDir: "m", port: 1, plan, baseEnv: { ram_gb: "999", PATH: "p" } });
    expect(launch.options.env.RAM_GB).toBe("16");
    expect(launch.options.env.ram_gb).toBeUndefined();
    expect(launch.options.env.PATH).toBe("p");
  });
});

describe("gateway output", () => {
  it("reads the load failure the gateway prints", () => {
    expect(colibri.parseGatewayLine("[gateway] engine load failed: kind=nomem needs 54 GB")).toEqual({ type: "load-fail", kind: "nomem", detail: "needs 54 GB" });
    expect(colibri.parseGatewayLine("LOAD_FAIL kind=io pread failed")).toMatchObject({ type: "load-fail", kind: "io" });
    expect(colibri.parseGatewayLine("OpenAI-compatible API listening on http://127.0.0.1:8000/v1").type).toBe("listening");
    expect(colibri.parseGatewayLine("[WinError 4551] An Application Control policy has blocked this file").type).toBe("blocked");
    expect(colibri.parseGatewayLine("loading layer 3").type).toBe("line");
  });

  it("maps each kind to an engine error the renderer translates", () => {
    const kinds = { nomem: "colibri-nomem", io: "colibri-io", format: "colibri-format", unsupported: "colibri-unsupported", other: "stopped-loading" };
    for (const [kind, mapped] of Object.entries(kinds)) {
      expect(colibri.loadFailure({ kind, detail: "d" }, "m").kind).toBe(mapped);
    }
  });

  it("moves the load phase forward and never back", () => {
    expect(colibri.loadPhase("starting gateway")).toBe("engine");
    expect(colibri.loadPhase("loading dense weights", "engine")).toBe("dense");
    expect(colibri.loadPhase("warming expert cache", "dense")).toBe("experts");
    expect(colibri.loadPhase("loading dense weights", "experts")).toBe("experts");
  });

  it("shapes /health as telemetry", () => {
    expect(colibri.telemetryFrom({ status: "ok", tiers: { vram: 1, ram: 2, disk: 3 }, scheduler: { active: 1, queued: 2 } })).toMatchObject({ tiers: { vramExperts: 1, ramExperts: 2, diskExperts: 3 }, scheduler: { active: 1, queued: 2, capacity: 1 } });
    expect(colibri.telemetryFrom(null)).toBeNull();
  });
});

describe("starting", () => {
  it("spawns hidden, waits for the listening line and /health, and reports the port", async () => {
    const { host, child, spawned, setHealthy } = harness();
    const started = begin(host);
    await wait(5);
    child.say("loading experts");
    child.say("OpenAI-compatible API listening on http://127.0.0.1:51234/v1");
    setHealthy(true);
    const result = await started;
    expect(result).toMatchObject({ success: true, port: 51234, baseUrl: "http://127.0.0.1:51234/v1" });
    expect(spawned[0].args).toContain("51234");
    expect(host.status()).toMatchObject({ running: true, port: 51234, model: "qwen" });
    host.stopSync();
  });

  it("reports each load phase once, ending with ready", async () => {
    const { host, child, setHealthy } = harness();
    const phases = [];
    const started = host.start({ userDataDir: "C:\\ud", modelDir: "D:\\models\\qwen", modelName: "qwen", plan, onPhase: (event) => phases.push(event.phase) });
    await wait(5);
    child.say("loading dense weights");
    child.say("loading dense weights again");
    child.say("warming expert cache");
    child.say("OpenAI-compatible API listening on http://127.0.0.1:51234/v1");
    setHealthy(true);
    await started;
    expect(phases).toEqual(["dense", "experts", "ready"]);
    host.stopSync();
  });

  it("reports a load failure from the gateway with its kind", async () => {
    const { host, child } = harness();
    const started = begin(host);
    await wait(5);
    child.say("[gateway] engine load failed: kind=nomem needs 54 GB");
    child.die(1);
    const result = await started;
    expect(result).toMatchObject({ success: false, kind: "colibri-nomem" });
    expect(result.error).toMatch(/nomem/);
    expect(host.status().running).toBe(false);
  });

  it("recognises Windows blocking the engine", async () => {
    const { host, child } = harness();
    const started = begin(host);
    await wait(5);
    child.say("OSError: [WinError 4551] An Application Control policy has blocked this file");
    child.die(1);
    expect(await started).toMatchObject({ success: false, kind: "colibri-blocked" });
  });

  it("keeps the tail of the output when it dies without saying why", async () => {
    const { host, child } = harness();
    const started = begin(host);
    await wait(5);
    child.say("loading layer 7");
    child.die(3);
    const result = await started;
    expect(result.kind).toBe("stopped-loading");
    expect(result.params.log).toContain("loading layer 7");
  });

  it("gives up after a long silence, but not while it keeps printing", async () => {
    const quiet = harness();
    const giveUp = begin(quiet.host);
    await wait(5);
    quiet.tick(60);
    expect(await giveUp).toMatchObject({ success: false, kind: "load-timeout" });
    expect(quiet.killed).toHaveLength(1);

    const busy = harness();
    const loading = begin(busy.host);
    await wait(5);
    busy.tick(40);
    busy.child.say("loading layer 12");
    busy.tick(40);
    await wait(5);
    busy.child.say("OpenAI-compatible API listening on http://127.0.0.1:51234/v1");
    busy.setHealthy(true);
    expect(await loading).toMatchObject({ success: true });
    busy.host.stopSync();
  });

  it("says so when colibri is not installed", async () => {
    const { host } = harness({ prepareRuntime: () => null });
    expect(await begin(host)).toMatchObject({ success: false, kind: "engine-missing" });
  });

  it("reports a blocked launch when the OS refuses to spawn it", async () => {
    const { host } = harness({
      launcher: () => {
        throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
      },
    });
    expect(await begin(host)).toMatchObject({ success: false, kind: "colibri-blocked" });
  });
});

describe("stopping", () => {
  it("stops reporting a model once the engine dies mid-generation, as when the drive is unplugged", async () => {
    const { host, child, setHealthy } = harness({ telemetryMs: 5 });
    const seen = [];
    host.onTelemetry((record) => seen.push(record));
    const started = begin(host);
    await wait(5);
    child.say("OpenAI-compatible API listening on http://127.0.0.1:51234/v1");
    setHealthy(true);
    await started;
    child.say("OSError: [Errno 5] Input/output error");
    child.die(1);
    expect(host.status()).toMatchObject({ running: false, port: null, model: null });
    const before = seen.length;
    await wait(30);
    expect(seen.length).toBe(before);
  });

  it("logs the engine's last lines as one error when it dies after loading", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const { host, child, setHealthy } = harness();
    const started = begin(host);
    await wait(5);
    child.say("OpenAI-compatible API listening on http://127.0.0.1:51234/v1");
    setHealthy(true);
    await started;
    child.say("CUDA error: an illegal memory access was encountered");
    child.die(3);
    const line = error.mock.calls.find((call) => call[1] === "colibri exited after loading");
    error.mockRestore();
    expect(line?.[0]).toBe("proc.engine");
    expect(line?.[2]).toMatchObject({ code: 3 });
    expect(line?.[2].stderr).toContain("illegal memory access");
  });

  it("does not log a crash dump when it dies before it answered", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const { host, child } = harness();
    const started = begin(host);
    await wait(5);
    child.die(1);
    await started;
    const dumps = error.mock.calls.filter((call) => call[1] === "colibri exited after loading");
    error.mockRestore();
    expect(dumps).toEqual([]);
  });

  it("names a missing CUDA runtime from the engine's own last lines", async () => {
    const { host, child } = harness();
    const started = begin(host);
    await wait(5);
    child.say("ImportError: DLL load failed while importing coli_cuda: The specified module could not be found.");
    child.die(1);
    const result = await started;
    expect(result).toMatchObject({ success: false, kind: "stopped-loading" });
    expect(result.params.reason).toContain("DLL load failed");
  });

  it("kills the process tree and forgets the model", async () => {
    const { host, child, killed, setHealthy } = harness();
    const started = begin(host);
    await wait(5);
    child.say("OpenAI-compatible API listening on http://127.0.0.1:51234/v1");
    setHealthy(true);
    await started;
    host.stopSync();
    expect(killed).toEqual([child]);
    expect(host.status()).toMatchObject({ running: false, port: null, model: null });
  });

  it("hands telemetry to subscribers and stops when they unsubscribe", async () => {
    const { host, child, setHealthy } = harness({ telemetryMs: 5 });
    const seen = [];
    const off = host.onTelemetry((record) => seen.push(record));
    const started = begin(host);
    await wait(5);
    child.say("OpenAI-compatible API listening on http://127.0.0.1:51234/v1");
    setHealthy(true);
    await started;
    await wait(30);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].tiers.diskExperts).toBe(3);
    off();
    const count = seen.length;
    await wait(30);
    expect(seen.length).toBe(count);
    host.stopSync();
  });
});

describe("port choice", () => {
  it("takes the preferred port when free and another one when it is taken", async () => {
    const net = require("node:net");
    const free = await colibri.freePort(0);
    expect(await colibri.freePort(free)).toBe(free);
    const holder = net.createServer();
    await new Promise((resolve) => holder.listen(free, "127.0.0.1", resolve));
    try {
      const other = await colibri.freePort(free);
      expect(other).not.toBe(free);
      expect(other).toBeGreaterThan(0);
    } finally {
      holder.close();
    }
  });
});
