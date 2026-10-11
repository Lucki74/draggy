"use strict";

const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const platform = require("./platform.cjs");
const colibriBinary = require("./colibriBinary.cjs");
const cpuTopology = require("./cpuTopology.cjs");
const { log } = require("./logger.cjs");

/** The gateway only listens once the engine has loaded, so a quiet process is not yet a dead one. */
const IDLE_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 1000;
const TELEMETRY_MS = 4000;
const RECENT_LINES = 200;

/** What the gateway prints when the engine says why it could not load (`LOAD_FAIL kind=...`). */
const LOAD_FAIL_KINDS = {
  nomem: "colibri-nomem",
  io: "colibri-io",
  format: "colibri-format",
  unsupported: "colibri-unsupported",
};
/** Windows application control (Smart App Control, WDAC) refusing an unsigned binary. */
const BLOCKED = /WinError 4551|Application Control policy|blocked this file|blocked by .*policy/i;

/** One gateway output line, as the event it means for us. */
function parseGatewayLine(line) {
  const failed = /engine load failed: kind=(\w+)\s*(.*)$/.exec(line);
  if (failed) return { type: "load-fail", kind: failed[1], detail: failed[2].trim() };
  const raw = /^LOAD_FAIL kind=(\w+)\s*(.*)$/.exec(line);
  if (raw) return { type: "load-fail", kind: raw[1], detail: raw[2].trim() };
  if (/OpenAI-compatible API listening on/i.test(line)) return { type: "listening" };
  if (BLOCKED.test(line)) return { type: "blocked" };
  return { type: "line" };
}

const PHASE_ORDER = ["engine", "dense", "experts", "ready"];
/**
 * The load phase a gateway line implies, never going backwards. The lines are matched by their words,
 * so a gateway that words them differently leaves the phase at "engine" until it is listening.
 */
function loadPhase(line, current = "engine") {
  let next = current;
  if (/\b(dense|backbone|shared)\b.*\b(load|read|weights)/i.test(line) || /\bload(ing)?\b.*\b(dense|weights)\b/i.test(line)) next = "dense";
  if (/\b(warm(ing)?|pin(ned|ning)?|hot set|prefetch)/i.test(line)) next = "experts";
  return PHASE_ORDER.indexOf(next) > PHASE_ORDER.indexOf(current) ? next : current;
}

/** A load failure as the app reports it: a kind the renderer translates, plus the engine's own words. */
function loadFailure(event, model) {
  const kind = LOAD_FAIL_KINDS[event.kind] || "stopped-loading";
  const error = `colibri could not load ${model}: ${event.kind}${event.detail ? ` ${event.detail}` : ""}`;
  return { success: false, error, kind, params: { model, reason: event.detail || event.kind } };
}

/**
 * The environment the engines read, from a tier plan. The plan's RAM budget is the dense weights
 * plus the expert cache; VRAM, when the build can use it, gets the hottest experts. Mirrors are
 * joined the way colibri reads them: with `;`.
 */
function planEnvironment(plan, { cudaBuild = false, physicalCores = 0, direct = false, lossy = false } = {}) {
  const env = {};
  if (plan?.ram) env.RAM_GB = String(Math.max(1, Math.floor(plan.ram.denseGB + plan.ram.expertCacheGB)));
  if (cudaBuild) {
    env.COLI_CUDA = "1";
    env.COLI_GPU = "0";
    env.CUDA_DENSE = "1";
    if (plan?.vram?.expertGB > 0) env.CUDA_EXPERT_GB = String(Math.floor(plan.vram.expertGB));
  }
  if (plan?.disk?.coldGB > 0) env.PILOT = "1";
  if (direct) env.DIRECT = "1";
  // Routes to experts already in memory when the true ones are not: faster, and the answers may change.
  // Top-p expert selection reads fewer experts per token (30 to 40% less disk), also at the cost of exactness.
  if (lossy) {
    env.CACHE_ROUTE = "1";
    env.TOPP = "0.7";
  }
  if (plan?.disk?.mirrors?.length) env.COLI_MODEL_MIRROR = plan.disk.mirrors.join(";");
  if (physicalCores > 0) env.OMP_NUM_THREADS = String(physicalCores);
  env.PYTHONUTF8 = "1";
  env.PYTHONUNBUFFERED = "1";
  return env;
}

/** The command line and environment for one start. Never a shell, never `coli.cmd`. */
function buildLaunch({ runtime, modelDir, port, plan, kvSlots = 1, cudaBuild = false, physicalCores = 0, direct = false, lossy = false, baseEnv = process.env }) {
  const keep = new Set(Object.keys(planEnvironment(plan, { cudaBuild, physicalCores, direct, lossy })).map((key) => key.toUpperCase()));
  const inherited = Object.fromEntries(Object.entries(baseEnv).filter(([key]) => !keep.has(key.toUpperCase())));
  return {
    file: runtime.python,
    args: ["-u", runtime.script, "--model", modelDir, "--host", "127.0.0.1", "--port", String(port), "--kv-slots", String(kvSlots)],
    options: { cwd: runtime.dir, env: { ...inherited, ...planEnvironment(plan, { cudaBuild, physicalCores, direct, lossy }) }, stdio: ["ignore", "pipe", "pipe"] },
  };
}

/** Port 8000 is where the provider list looks for colibri, so it is tried first; any free port otherwise. */
function freePort(preferred = 8000) {
  const listen = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const { port: bound } = server.address();
        server.close(() => resolve(bound));
      });
    });
  return listen(preferred).catch(() => listen(0));
}

function getJson(port, route, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${route}`, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function lineSplitter(onLine) {
  let buffer = "";
  return {
    write(chunk) {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) onLine(line.trim());
    },
    end() {
      if (buffer.trim()) onLine(buffer.trim());
      buffer = "";
    },
  };
}

/** `/health`'s tiers and scheduler as one telemetry record. */
function telemetryFrom(health) {
  if (!health) return null;
  const tiers = health.tiers
    ? { vramExperts: health.tiers.vram, ramExperts: health.tiers.ram, diskExperts: health.tiers.disk, vramGB: health.tiers.vram_gb, ramGB: health.tiers.ram_gb }
    : null;
  const s = health.scheduler || {};
  return { status: health.status || null, tiers, scheduler: { active: s.active ?? 0, queued: s.queued ?? 0, capacity: s.capacity ?? 1, completed: s.completed ?? 0 } };
}

function createColibriProcess({
  launcher = platform.spawnHidden,
  kill = platform.killTreeSync,
  getFreePort = freePort,
  fetchJson = getJson,
  prepareRuntime = colibriBinary.prepareRuntime,
  topology = cpuTopology.getCpuTopology,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
  pollMs = POLL_MS,
  telemetryMs = TELEMETRY_MS,
  now = Date.now,
} = {}) {
  let child = null;
  let state = { model: null, port: null, startedAt: null };
  let telemetryTimer = null;
  const listeners = new Set();

  function stopTelemetry() {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }

  function startTelemetry(port) {
    stopTelemetry();
    telemetryTimer = setInterval(async () => {
      if (!listeners.size || !child) return;
      const record = telemetryFrom(await fetchJson(port, "/health"));
      if (record) for (const callback of listeners) callback(record);
    }, telemetryMs);
    telemetryTimer.unref?.();
  }

  function stopSync() {
    stopTelemetry();
    if (!child) return;
    const dying = child;
    child = null;
    state = { model: null, port: null, startedAt: null };
    log.info("colibri", `Terminating gateway PID ${dying.pid}`);
    kill(dying);
  }

  /**
   * Starts the gateway on a free port and waits for it. The wait ends when the gateway says it is
   * listening and /health answers, when the process dies, or when it has been silent for too long:
   * loading hundreds of gigabytes is slow but never silent for minutes.
   */
  async function start({ userDataDir, modelDir, plan, modelName = path.basename(modelDir), kvSlots = 1, direct = false, lossy = false, onPhase = null }) {
    stopSync();
    const runtime = prepareRuntime(userDataDir);
    if (!runtime) {
      return { success: false, error: "colibri is not installed", kind: "engine-missing", params: { model: modelName } };
    }
    const port = await getFreePort();
    const cudaBuild = runtime.variant === "cuda";
    const launch = buildLaunch({ runtime, modelDir, port, plan, kvSlots, cudaBuild, physicalCores: topology().physical, direct, lossy });

    const started = now();
    const recent = [];
    let lastActivity = now();
    let listening = false;
    let failure = null;
    let blocked = false;
    let spawnError = null;
    let exited = null;
    let phase = "engine";
    const setPhase = (next) => {
      if (next === phase) return;
      phase = next;
      onPhase?.({ phase, elapsedMs: now() - started });
    };

    log.info("colibri", `Starting gateway for ${modelName} on 127.0.0.1:${port}`);
    log.info("proc.engine", "colibri launch", {
      model: modelName,
      port,
      variant: runtime.variant,
      kvSlots,
      direct,
      lossy,
      physicalCores: topology().physical,
      flags: launch.args.filter((arg) => String(arg).startsWith("-")),
    });
    let proc;
    try {
      proc = launcher(launch.file, launch.args, launch.options);
    } catch (error) {
      return spawnFailure(error, modelName);
    }
    child = proc;
    let healthy = false;
    state = { model: modelName, port, startedAt: now() };

    const onLine = (line) => {
      lastActivity = now();
      log.debug("colibri", line);
      recent.push(line);
      if (recent.length > RECENT_LINES) recent.shift();
      const event = parseGatewayLine(line);
      setPhase(loadPhase(line, phase));
      if (event.type === "load-fail") failure = event;
      else if (event.type === "listening") listening = true;
      else if (event.type === "blocked") blocked = true;
    };
    const out = lineSplitter(onLine);
    const err = lineSplitter(onLine);
    proc.stdout?.on("data", (chunk) => out.write(chunk));
    proc.stderr?.on("data", (chunk) => err.write(chunk));
    proc.stdout?.on("end", () => out.end());
    proc.stderr?.on("end", () => err.end());
    proc.on("error", (error) => {
      spawnError = error;
    });
    proc.on("exit", (code, signal) => {
      exited = { code, signal };
      // Gone after it answered /health: nobody is waiting on a load, so the dump is logged here.
      if (child === proc && healthy) {
        log.error("proc.engine", "colibri exited after loading", { code, signal, model: modelName, stderr: recent.join(String.fromCharCode(10)) });
      }
      if (child === proc) {
        child = null;
        state = { model: null, port: null, startedAt: null };
        stopTelemetry();
      }
    });

    while (true) {
      if (spawnError) return spawnFailure(spawnError, modelName);
      if (exited) {
        // Give the last lines a moment to land: they say why.
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (failure) return loadFailure(failure, modelName);
        if (blocked) return blockedFailure(modelName);
        const reason = recent.slice(-3).join(" | ");
        log.error("proc.engine", "colibri exited while loading", { code: exited.code, signal: exited.signal, model: modelName, stderr: recent.join("\n") });
        return {
          success: false,
          error: `colibri stopped while loading ${modelName} (exit code ${exited.code ?? exited.signal})${reason ? `: ${reason}` : ""}`,
          kind: "stopped-loading",
          params: { model: modelName, code: String(exited.code ?? exited.signal), reason, log: recent.slice(-40).join("\n") },
        };
      }
      if (child !== proc) return { success: false, error: "Another model was started before this one finished loading", kind: "another-model" };
      if (listening && (await fetchJson(port, "/health"))) {
        healthy = true;
        break;
      }
      if (now() - lastActivity > idleTimeoutMs) {
        stopSync();
        return { success: false, error: `${modelName} took too long to load. Try again, or choose a smaller model.`, kind: "load-timeout", params: { model: modelName } };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    setPhase("ready");
    startTelemetry(port);
    log.info("colibri", `Gateway ready on 127.0.0.1:${port} in ${now() - started}ms`);
    return { success: true, port, baseUrl: `http://127.0.0.1:${port}/v1`, loadMs: now() - started };
  }

  function spawnFailure(error, model) {
    if (error?.code === "EACCES" || error?.code === "EPERM" || error?.code === "UNKNOWN") return blockedFailure(model);
    return { success: false, error: error?.message || String(error), kind: "engine-missing", params: { model } };
  }

  function blockedFailure(model) {
    return { success: false, error: "Windows blocked the colibri engine from starting", kind: "colibri-blocked", params: { model } };
  }

  function status() {
    return { running: Boolean(child) && child.exitCode === null, port: state.port, model: state.model, baseUrl: state.port ? `http://127.0.0.1:${state.port}/v1` : null };
  }

  async function health() {
    return state.port ? telemetryFrom(await fetchJson(state.port, "/health")) : null;
  }

  /** The expert heat map and hit counts, for the usage history. Counts only; the gateway sends no text. */
  async function experts() {
    return state.port ? fetchJson(state.port, "/experts", 3000) : null;
  }

  function onTelemetry(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  return { start, stop: async () => stopSync(), stopSync, status, health, experts, onTelemetry };
}

module.exports = { createColibriProcess, parseGatewayLine, loadPhase, loadFailure, planEnvironment, buildLaunch, telemetryFrom, freePort, LOAD_FAIL_KINDS };
