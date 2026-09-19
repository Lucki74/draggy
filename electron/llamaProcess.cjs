const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const platform = require("./platform.cjs");
const binaryManager = require("./binaryManager.cjs");
const { parseShard, shardNames } = require("./shards.cjs");
const { log: defaultLog } = require("./logger.cjs");

let activeProcess = null;
let activeModel = null;
let activePort = 11435;
let activeContext = 8192;
/** The start still loading weights, so a second request for the same model joins it instead of restarting it. */
let starting = null;

/** Overlays values on the inherited environment, dropping other-case twins such as Path. */
function buildEnv(overrides) {
  const wanted = new Set(Object.keys(overrides).map((key) => key.toUpperCase()));
  const kept = Object.entries(process.env).filter(([key]) => !wanted.has(key.toUpperCase()));
  return { ...Object.fromEntries(kept), ...overrides };
}

/** Buffers pipe stream and splits into trimmed lines for log capture. */
function attachOutputLogger(stream, prefix, loggerFn) {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) loggerFn(prefix, trimmed);
    }
  });
  stream.on("end", () => {
    const trimmed = buffer.trim();
    if (trimmed) loggerFn(prefix, trimmed);
  });
}

/** Checks if the local llama-server health endpoint responds with HTTP 200. */
function pingHealth(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Waits for llama-server to become responsive with a deadline, giving up as soon as `isAlive` says the process is gone. */
async function waitForReady(port, maxWaitMs = 15000, logger = null, isAlive = () => true) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < maxWaitMs) {
    if (!isAlive()) return false;
    attempt++;
    if (logger) logger.debug("llama", `Health check #${attempt} on 127.0.0.1:${port}`);
    // A server answering after ours died is someone else's, so it must not count as ready.
    if ((await pingHealth(port, 1500)) && isAlive()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** The shard files a split model still needs that are not in its folder. */
function missingShards(modelPath) {
  if (!parseShard(modelPath)) return [];
  const dir = path.dirname(modelPath);
  return shardNames(modelPath).filter((name) => !fs.existsSync(path.join(dir, name)));
}

/** Why the engine stopped, from the last error lines it printed. */
function failureReason(lines) {
  const errors = lines.filter((line) => /\b(error|failed|cannot|unable)\b/i.test(line)).slice(-2);
  const shown = errors.length > 0 ? errors : lines.slice(-2);
  return shown.map((line) => line.replace(/^\d+(\.\d+)+\s+[A-Z]\s+/, "")).join(" ");
}

/** Picks the KV cache type and a context that fits VRAM, since WDDM spills overflow into slow system RAM. */
function determineKvCache(modelPath, contextSize, vramGB = 0) {
  const usableGB = vramGB > 0 ? vramGB * 0.9 - 0.8 : 0;
  let modelSizeGB = 0;
  try {
    if (fs.existsSync(modelPath)) modelSizeGB = fs.statSync(modelPath).size / (1024 ** 3);
  } catch {
    modelSizeGB = 0;
  }

  const known = vramGB > 0 && modelSizeGB > 0;
  const freeForKv = usableGB - modelSizeGB;
  // Roughly 105 KB per token at q8_0 and 55 KB at q4_0, expressed against GB of headroom.
  const cacheType = known && freeForKv < (contextSize * 105) / (1024 * 1024) ? "q4_0" : "q8_0";
  const effectiveContext = known && freeForKv > 0
    ? Math.max(4096, Math.min(contextSize, Math.floor((freeForKv * 1024 * 1024) / 55)))
    : contextSize;
  return { cacheType, effectiveContext };
}

/** Spawns llama-server hidden and returns once its health check answers. */
function startServer(options) {
  const { modelPath, contextSize = 8192, vramGB = 0 } = options;
  const { effectiveContext } = determineKvCache(modelPath, contextSize, vramGB);
  if (starting && starting.modelPath === modelPath && starting.context === effectiveContext) {
    return starting.promise;
  }

  const entry = { modelPath, context: effectiveContext, promise: null };
  entry.promise = launchServer(options).finally(() => {
    if (starting === entry) starting = null;
  });
  starting = entry;
  return entry.promise;
}

async function launchServer({
  binaryPath,
  modelPath,
  contextSize = 8192,
  port = 11435,
  gpuLayers,
  userDataDir,
  vramGB = 0,
  log,
}) {
  const logger = log || defaultLog;

  // llama-server opens the other parts itself and exits at once when one is absent.
  const missing = missingShards(modelPath);
  if (missing.length > 0) {
    const total = shardNames(modelPath).length;
    logger.error("llama", `Split model is incomplete: ${missing.join(", ")}`);
    return {
      success: false,
      error: `${path.basename(modelPath)} is one of ${total} parts and ${missing.length} ${missing.length === 1 ? "is" : "are"} missing (${missing.join(", ")}). Delete it and download the model again to get every part.`,
    };
  }

  const { cacheType, effectiveContext } = determineKvCache(modelPath, contextSize, vramGB);
  if (activeProcess) {
    if (activeModel === modelPath && activeContext === effectiveContext && (await pingHealth(port))) {
      logger.info("llama", `Reusing existing running instance on port ${port}`);
      return { success: true, port, alreadyRunning: true };
    }
    logger.info("llama", "Stopping previous instance before starting new model");
    stopServerSync();
  }

  // Avoid a conflicting spawn when an external process already owns the port.
  if (!activeProcess && (await pingHealth(port, 1000))) {
    logger.info("llama", `Adopting external server already running on port ${port}`);
    activeModel = modelPath;
    activePort = port;
    return { success: true, port };
  }

  const args = [
    "-m", modelPath,
    "--port", String(port),
    "--host", "127.0.0.1",
    "-c", String(effectiveContext),
    "-ctk", cacheType,
    "-ctv", cacheType,
    // Any -ngl, even 99, disables llama.cpp's --fit, so a model bigger than VRAM spills into shared memory.
    ...(Number.isInteger(gpuLayers) ? ["-ngl", String(gpuLayers)] : []),
    // One slot: each extra slot multiplies the KV cache and pushes layers back onto the CPU.
    "--parallel", "1",
    "-b", "2048",
    "-ub", "512",
    "-t", String(Math.min(8, os.cpus().length)),
    "--cache-reuse", "256",
    "--jinja",
  ];

  // Adopt a server already on the port; spawning would fail to bind and stall the health check.
  if (!activeProcess && (await pingHealth(port, 1000))) {
    activeModel = modelPath;
    activePort = port;
    return { success: true, port };
  }

  try {
    logger.info("llama", `Starting llama-server: model=${modelPath}, port=${port}, context=${effectiveContext}, kvCache=${cacheType}, gpuLayers=${gpuLayers ?? "auto"}`);
    logger.debug("llama", `Spawning ${binaryPath} with args: ${args.join(" ")}`);

    const engine = userDataDir ? binaryManager.getEngineEnvironment(userDataDir, vramGB) : { env: {} };
    logger.debug("llama", `GPU runner: ${engine.runnerType || "none"}`);

    const child = platform.spawnHidden(binaryPath, args, {
      cwd: path.dirname(binaryPath),
      env: buildEnv({
        ...engine.env,
        LLAMA_ARG_FLASH_ATTN: "on",
        LLAMA_ARG_CACHE_TYPE_K: cacheType,
        LLAMA_ARG_CACHE_TYPE_V: cacheType,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeProcess = child;
    activeModel = modelPath;
    activePort = port;
    activeContext = effectiveContext;

    const recent = [];
    attachOutputLogger(child.stdout, "llama:out", (p, line) => logger.debug(p, line));
    attachOutputLogger(child.stderr, "llama:err", (p, line) => {
      logger.debug(p, line);
      recent.push(line);
      if (recent.length > 40) recent.shift();
    });

    // Still ours to report on only if nobody stopped or replaced it; an exit while it is still the active
    // process is the engine failing on its own.
    let crashed = null;
    child.on("exit", (code, signal) => {
      logger.info("llama", `llama-server exited (code=${code}, signal=${signal})`);
      if (activeProcess === child) {
        crashed = { code, signal };
        activeProcess = null;
        activeModel = null;
      }
    });

    // Weights load before /health answers, so the wait scales with file size at 20 s per GB.
    let readyTimeoutMs = 90_000;
    try {
      const sizeGB = Math.ceil(fs.statSync(modelPath).size / (1024 ** 3));
      readyTimeoutMs = Math.max(30_000, Math.min(180_000, sizeGB * 20_000));
    } catch {
      // Unreadable size: keep the middle-of-the-road default above.
    }

    const readyStart = Date.now();
    const ready = await waitForReady(port, readyTimeoutMs, logger, () => activeProcess === child && child.exitCode === null);
    if (!ready) {
      if (crashed) {
        const reason = failureReason(recent);
        logger.error("llama", `llama-server stopped after ${Date.now() - readyStart}ms: ${reason}`);
        return {
          success: false,
          error: `llama-server stopped while loading the model (exit code ${crashed.code ?? crashed.signal})${reason ? `: ${reason}` : ""}`,
        };
      }
      if (activeProcess !== child) {
        // Another model was started, or the server was stopped, while this one loaded; that one owns the engine now.
        logger.info("llama", "Start abandoned: the engine was stopped or given another model");
        return { success: false, error: "Another model was started before this one finished loading" };
      }
      logger.error("llama", `Server failed health check after ${Date.now() - readyStart}ms`);
      stopServerSync();
      return { success: false, error: "Server failed to respond to health check in time" };
    }

    logger.info("llama", `llama-server ready on 127.0.0.1:${port} in ${Date.now() - readyStart}ms`);
    return { success: true, port };
  } catch (err) {
    logger.error("llama", `Failed to spawn llama-server: ${err.message}`, err);
    stopServerSync();
    return { success: false, error: err.message };
  }
}

/** Kills active server process tree synchronously on quit or restart. */
function stopServerSync() {
  if (!activeProcess) return;
  const child = activeProcess;
  activeProcess = null;
  activeModel = null;
  defaultLog.info("llama", `Terminating server PID ${child.pid}`);
  platform.killTreeSync(child);
  defaultLog.info("llama", "Server process tree terminated");
}

/** Reports current status and model loaded in memory. */
function getServerStatus() {
  return {
    running: activeProcess !== null && activeProcess.exitCode === null,
    port: activePort,
    model: activeModel,
    contextSize: activeContext,
    baseUrl: `http://127.0.0.1:${activePort}/v1`,
  };
}

module.exports = {
  startServer,
  stopServerSync,
  getServerStatus,
  pingHealth,
  determineKvCache,
  missingShards,
  waitForReady,
  buildEnv,
  attachOutputLogger,
  failureReason,
};
