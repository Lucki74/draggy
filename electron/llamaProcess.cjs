const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");
const platform = require("./platform.cjs");
const binaryManager = require("./binaryManager.cjs");
const { parseShard, shardNames } = require("./shards.cjs");
const mmproj = require("./mmproj.cjs");
const cpuTopology = require("./cpuTopology.cjs");
const { parseGgufHeader } = require("./ggufParser.cjs");
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

/** Windows a model is loaded at without being asked: each is a reload the conversation will not need. */
const ROOMY_CONTEXTS = [32768, 16384, 8192];
/** Growing the window reloads the model and throws its cache away, so a MoE model, whose load is the
 * slowest and whose cache --fit places, starts no smaller than this. */
const MOE_MIN_CONTEXT = 16384;

/** Picks the KV cache type and a context that fits VRAM, since WDDM spills overflow into slow system RAM.
 * When the card has room to spare, the window is also rounded up, so a conversation that grows does
 * not reload the model (and reprocess everything) at every size step. */
function determineKvCache(modelPath, contextSize, vramGB = 0, traits = {}) {
  const { moe = false, trainedContext = null, kvBytesQ8 = null, exact = false } = traits;
  const ceiling = trainedContext || 16384;
  // A mixture-of-experts file is mostly expert weights, which --fit parks in system RAM before it
  // gives up any of the cache: the file size says nothing about what stays on the card.
  if (moe) {
    const floor = exact ? contextSize : Math.min(MOE_MIN_CONTEXT, ceiling);
    return { cacheType: "q8_0", effectiveContext: Math.max(contextSize, floor) };
  }
  const usableGB = vramGB > 0 ? vramGB * 0.9 - 0.8 : 0;
  let modelSizeGB = 0;
  try {
    if (fs.existsSync(modelPath)) modelSizeGB = fs.statSync(modelPath).size / (1024 ** 3);
  } catch {
    modelSizeGB = 0;
  }

  const known = vramGB > 0 && modelSizeGB > 0;
  const freeForKv = usableGB - modelSizeGB;
  const q8PerToken = kvBytesQ8 || DEFAULT_KV_Q8_BYTES;
  // q4_0 stores 32 values in 18 bytes.
  const q4PerToken = q8PerToken * (18 / 34);
  const fitsGB = (tokens, perToken) => (tokens * perToken) / 1024 ** 3;
  const cacheType = known && freeForKv < fitsGB(contextSize, q8PerToken) ? "q4_0" : "q8_0";
  let effectiveContext = known && freeForKv > 0
    ? Math.max(4096, Math.min(contextSize, Math.floor((freeForKv * 1024 ** 3) / q4PerToken)))
    : contextSize;

  // A window the user fixed is theirs; only an automatic one is rounded up.
  if (known && cacheType === "q8_0" && !exact) {
    // Keep a fifth of the headroom free: --fit, the compute buffer and the desktop share it.
    const roomy = ROOMY_CONTEXTS.find((size) => size <= ceiling && fitsGB(size, q8PerToken) <= freeForKv * 0.8);
    if (roomy) effectiveContext = Math.max(effectiveContext, roomy);
  }
  return { cacheType, effectiveContext };
}

/** Fallback KV cost per token at q8_0 when the header does not say, from typical 7-14B GQA models. */
const DEFAULT_KV_Q8_BYTES = 105 * 1024;

/** What the header says about a model, read once per file: whether it is a mixture of experts, the
 * context it was trained for, and what one token of KV cache costs at q8_0. */
const traitsCache = new Map();
function modelTraits(modelPath) {
  let key;
  try {
    key = `${modelPath}|${fs.statSync(modelPath).mtimeMs}`;
  } catch {
    return { moe: false, trainedContext: null, kvBytesQ8: null };
  }
  if (!traitsCache.has(key)) {
    const header = parseGgufHeader(modelPath);
    const { blockCount, headCountKv, keyLength, valueLength } = header || {};
    // q8_0 stores 32 values in 34 bytes.
    const kvBytesQ8 = blockCount && headCountKv && keyLength && valueLength
      ? Math.ceil(blockCount * headCountKv * (keyLength + valueLength) * (34 / 32))
      : null;
    traitsCache.set(key, {
      moe: (header?.expertCount || 0) > 1,
      trainedContext: header?.contextLength || null,
      kvBytesQ8,
    });
  }
  return traitsCache.get(key);
}

/** The flags this llama-server build accepts, from its own --help, so a newer flag never crashes an
 * older engine. Null when the build could not be asked. Kept on disk, since asking starts the GPU
 * backends and costs a second or two. */
const flagsCache = new Map();
function engineFlags(binaryPath, env, cacheDir = null) {
  let key;
  try {
    const stat = fs.statSync(binaryPath);
    key = `${binaryPath}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    return Promise.resolve(null);
  }
  if (flagsCache.has(key)) return flagsCache.get(key);

  const cacheFile = cacheDir ? path.join(cacheDir, "engine-flags.json") : null;
  try {
    const saved = cacheFile && JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (saved && saved.key === key && Array.isArray(saved.flags)) {
      const flags = new Set(saved.flags);
      flagsCache.set(key, Promise.resolve(flags));
      return flagsCache.get(key);
    }
  } catch {
    // No usable cache yet: ask the engine.
  }

  const pending = new Promise((resolve) => {
    platform.execFileHidden(
      binaryPath,
      ["--help"],
      { cwd: path.dirname(binaryPath), env, encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      (_err, stdout, stderr) => {
        const flags = new Set(`${stdout || ""}\n${stderr || ""}`.match(/--[a-z0-9][a-z0-9-]*/g) || []);
        if (flags.size <= 20) return resolve(null);
        try {
          if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify({ key, flags: [...flags] }));
        } catch {
          // Asking again next launch is fine.
        }
        resolve(flags);
      },
    );
  });
  flagsCache.set(key, pending);
  return pending;
}

/** Prompt batch sizes. A bigger micro-batch processes a long prompt much faster on CUDA, and with
 * experts in system RAM it amortises streaming them to the card; --fit budgets the larger compute
 * buffer, so it is paid for with weights moved off the card rather than a failed load. */
function batchSizes(runnerType, vramGB, moe) {
  let ubatch = 512;
  if (runnerType === "cuda") ubatch = moe || vramGB >= 10 ? 2048 : 1024;
  else if (runnerType === "rocm" && vramGB >= 12) ubatch = 1024;
  return { batch: Math.max(2048, ubatch), ubatch };
}

/** How much RAM llama-server may keep earlier prompts in, so returning to another chat skips
 * reprocessing it. llama.cpp's fixed 8 GB is too little on 64 GB and dangerous on 16 GB, where the
 * weights that did not fit on the card already live in RAM. */
function promptCacheMiB(modelPath, totalRamBytes = os.totalmem()) {
  let modelBytes;
  try {
    modelBytes = fs.statSync(modelPath).size;
  } catch {
    modelBytes = 0;
  }
  const spareGB = (totalRamBytes - modelBytes) / 1024 ** 3 - 6;
  return Math.round(Math.min(16384, Math.max(1024, (spareGB / 2) * 1024)));
}

/** Generation on the performance cores; prompt processing on every physical core. */
async function threadCounts(requested) {
  const { physical, performance } = await cpuTopology.getCpuTopology();
  const threads = Number.isInteger(requested) && requested > 0 ? requested : performance;
  return { threads, threadsBatch: Math.max(threads, physical) };
}

/** Whether a model loaded at `loaded` can serve a start that works out to `wanted`: the same window,
 * or a bigger one, since shrinking would reload the model and lose its cache for nothing. */
function servesWindow(loaded, wanted, exact) {
  return loaded === wanted || (!exact && loaded > wanted);
}

/** The window a start asks for. A caller that does not say (voice replies) gets whatever the same
 * model is already loaded or loading at, instead of a default that would reload it at another size. */
function requestedContext({ modelPath, contextSize }) {
  if (Number.isInteger(contextSize) && contextSize > 0) return contextSize;
  if (starting && starting.modelPath === modelPath) return starting.context;
  if (activeProcess && activeModel === modelPath && activeContext) return activeContext;
  return 8192;
}

/** Spawns llama-server hidden and returns once its health check answers. */
function startServer(options) {
  const { modelPath, vramGB = 0, exactContext = false } = options;
  const contextSize = requestedContext(options);
  const traits = { ...modelTraits(modelPath), exact: exactContext };
  const { effectiveContext } = determineKvCache(modelPath, contextSize, vramGB, traits);
  if (starting && starting.modelPath === modelPath && servesWindow(starting.context, effectiveContext, exactContext)) {
    return starting.promise;
  }

  const entry = { modelPath, context: effectiveContext, promise: null };
  entry.promise = launchServer({ ...options, contextSize }).finally(() => {
    if (starting === entry) starting = null;
  });
  starting = entry;
  return entry.promise;
}

async function launchServer(options) {
  const {
    binaryPath,
    modelPath,
    contextSize = 8192,
    port = 11435,
    gpuLayers,
    userDataDir,
    vramGB = 0,
    log,
    skipProjector = false,
    threads: requestedThreads,
    speculative = true,
    exactContext = false,
  } = options;
  const logger = log || defaultLog;

  // llama-server opens the other parts itself and exits at once when one is absent.
  const missing = missingShards(modelPath);
  if (missing.length > 0) {
    const total = shardNames(modelPath).length;
    logger.error("llama", `Split model is incomplete: ${missing.join(", ")}`);
    return {
      success: false,
      error: `${path.basename(modelPath)} is one of ${total} parts and ${missing.length} ${missing.length === 1 ? "is" : "are"} missing (${missing.join(", ")}). Delete it and download the model again to get every part.`,
      kind: "parts-missing",
      params: { model: path.basename(modelPath), parts: missing.join(", ") },
    };
  }

  const traits = { ...modelTraits(modelPath), exact: exactContext };
  const { cacheType, effectiveContext } = determineKvCache(modelPath, contextSize, vramGB, traits);
  if (activeProcess) {
    if (activeModel === modelPath && servesWindow(activeContext, effectiveContext, exactContext) && (await pingHealth(port))) {
      logger.info("llama", `Reusing existing running instance on port ${port}`);
      // Said again on every start, so a screen that missed the first one still learns of it.
      const noProjector = mmproj.wasRefused(path.dirname(modelPath), path.basename(modelPath));
      return {
        success: true,
        port,
        alreadyRunning: true,
        contextSize: activeContext,
        ...(noProjector ? { projectorRefused: true } : {}),
      };
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

  const engine = userDataDir ? binaryManager.getEngineEnvironment(userDataDir, vramGB, binaryPath) : { env: {} };
  const engineEnv = buildEnv({
    ...engine.env,
    LLAMA_ARG_FLASH_ATTN: "on",
    LLAMA_ARG_CACHE_TYPE_K: cacheType,
    LLAMA_ARG_CACHE_TYPE_V: cacheType,
  });
  const flags = await engineFlags(binaryPath, engineEnv, userDataDir);
  const supports = (flag) => Boolean(flags && flags.has(flag));
  const { batch, ubatch } = batchSizes(engine.runnerType, vramGB, traits.moe);
  const { threads, threadsBatch } = await threadCounts(requestedThreads);

  const args = [
    "-m", modelPath,
    "--port", String(port),
    "--host", "127.0.0.1",
    "-c", String(effectiveContext),
    "-ctk", cacheType,
    "-ctv", cacheType,
    // Any -ngl, even 99, disables llama.cpp's --fit, so a model bigger than VRAM spills into shared memory.
    // --fit also places a mixture-of-experts model: attention on the card, experts in RAM as needed.
    ...(Number.isInteger(gpuLayers) ? ["-ngl", String(gpuLayers)] : []),
    // One slot: each extra slot multiplies the KV cache and pushes layers back onto the CPU.
    "--parallel", "1",
    "-b", String(batch),
    "-ub", String(ubatch),
    "-t", String(threads),
    "-tb", String(threadsBatch),
    "--cache-reuse", "256",
    "--jinja",
  ];
  // Drafts from n-grams already in the context: no second model, near-zero cost when nothing
  // repeats, and a large speed-up when the model rewrites code or text it has already seen.
  if (speculative && supports("--spec-default")) args.push("--spec-default");
  if (supports("--cache-ram")) args.push("--cache-ram", String(promptCacheMiB(modelPath)));

  // Without its projector a vision model answers as if no image had been sent.
  const projector = skipProjector ? null : mmproj.findCompanion(path.dirname(modelPath), path.basename(modelPath));
  if (projector) args.push("--mmproj", projector);

  // Adopt a server already on the port; spawning would fail to bind and stall the health check.
  if (!activeProcess && (await pingHealth(port, 1000))) {
    activeModel = modelPath;
    activePort = port;
    return { success: true, port };
  }

  try {
    logger.info(
      "llama",
      `Starting llama-server: model=${modelPath}, port=${port}, context=${effectiveContext}, kvCache=${cacheType}, ` +
        `gpuLayers=${gpuLayers ?? "auto"}, runner=${engine.runnerType || "none"}, moe=${traits.moe}, ` +
        `ubatch=${ubatch}, threads=${threads}/${threadsBatch}, speculative=${args.includes("--spec-default")}`,
    );
    logger.debug("llama", `Spawning ${binaryPath} with args: ${args.join(" ")}`);

    const child = platform.spawnHidden(binaryPath, args, {
      cwd: path.dirname(binaryPath),
      env: engineEnv,
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
        // A projector this engine cannot read must not take the text side of the model down with it.
        if (projector && /multimodal|mmproj|clip_init|mtmd/i.test(recent.join("\n"))) {
          logger.warn("llama", `The image projector was refused (${reason}); starting ${path.basename(modelPath)} without image support`);
          mmproj.markRefused(projector);
          const fallback = await launchServer({ ...options, skipProjector: true });
          // The caller has to know, or it keeps offering images to a model that can no longer take them.
          return fallback.success ? { ...fallback, projectorRefused: true } : fallback;
        }
        logger.error("llama", `llama-server stopped after ${Date.now() - readyStart}ms: ${reason}`);
        return {
          success: false,
          // The engine's own words follow, so the app can recognise a known cause and explain it.
          error: `The model engine stopped while loading ${path.basename(modelPath)} (exit code ${crashed.code ?? crashed.signal})${reason ? `: ${reason}` : ""}`,
          kind: "stopped-loading",
          // The last two error lines are always the generic wrapper; the cause is earlier in the output.
          params: { model: path.basename(modelPath), code: String(crashed.code ?? crashed.signal), reason, log: recent.join("\n") },
        };
      }
      if (activeProcess !== child) {
        // Another model was started, or the server was stopped, while this one loaded; that one owns the engine now.
        logger.info("llama", "Start abandoned: the engine was stopped or given another model");
        return { success: false, error: "Another model was started before this one finished loading", kind: "another-model" };
      }
      logger.error("llama", `Server failed health check after ${Date.now() - readyStart}ms`);
      stopServerSync();
      return {
        success: false,
        error: `${path.basename(modelPath)} took too long to load. Try again, or choose a smaller model.`,
        kind: "load-timeout",
        params: { model: path.basename(modelPath) },
      };
    }

    logger.info("llama", `llama-server ready on 127.0.0.1:${port} in ${Date.now() - readyStart}ms`);
    return { success: true, port, contextSize: effectiveContext };
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
  batchSizes,
  promptCacheMiB,
  engineFlags,
  missingShards,
  waitForReady,
  buildEnv,
  attachOutputLogger,
  failureReason,
};
