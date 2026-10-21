const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");
const platform = require("./platform.cjs");
const binaryManager = require("./binaryManager.cjs");
const { parseShard, shardNames } = require("./shards.cjs");
const mmproj = require("./mmproj.cjs");
const draftModel = require("./draftModel.cjs");
const draftStats = require("./draftStats.cjs");
const cpuTopology = require("./cpuTopology.cjs");
const { createLoadProgress } = require("./loadProgress.cjs");
const { parseGgufHeader } = require("./ggufParser.cjs");
const { log: defaultLog, noteStat } = require("./logger.cjs");
const { createRing } = require("./ringBuffer.cjs");

let activeProcess = null;
let activeModel = null;
let activePort = 11435;
let activeContext = 8192;
/** How much of the model the engine put on the GPU, from its load log: { layers, total } or null. */
let activeOffload = null;
/** How the running engine drafts tokens: "draft", "mtp", "ngram" or "none". */
let activeSpeculation = "none";
/** The start still loading weights, so a second request for the same model joins it instead of restarting it. */
let starting = null;
/** The last options used to successfully start the server, so it can be reloaded after image generation. */
let lastRunningOptions = null;

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

/** The model file a server on the port says it holds, or null when it does not say. */
function servedModel(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/v1/models`, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const entry = parsed?.data?.[0] ?? parsed?.models?.[0];
          const name = entry?.id ?? entry?.model ?? entry?.name;
          resolve(typeof name === "string" && name ? name : null);
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

/** Whether a server already on the port may stand in for ours. One holding another model answered
 * every voice turn with the wrong model, so only a server that says nothing, or names ours, is adopted. */
async function adoptable(port, modelPath) {
  const served = await servedModel(port);
  if (!served) return { ok: true, served: null };
  const base = (file) => path.basename(String(file).replace(/\\/g, "/")).toLowerCase();
  return { ok: base(served) === base(modelPath), served };
}

/** The refusal for a port held by a server running some other model. */
function portTaken(port, served, modelPath) {
  return {
    success: false,
    error: `Port ${port} is held by another engine serving ${path.basename(String(served).replace(/\\/g, "/"))}, not ${path.basename(modelPath)}.`,
    kind: "port-in-use",
    params: { model: path.basename(modelPath) },
  };
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
    if ((await pingHealth(port, 1500)) && isAlive()) {
      if (logger) logger.info?.("engine", "healthy", { port, attempts: attempt, waitedMs: Date.now() - start });
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (logger) logger.warn?.("engine", "never became healthy", { port, attempts: attempt, waitedMs: Date.now() - start });
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

/** Known causes, in the order they are tried, matched against what the engine printed. */
const FAILURE_CAUSES = [
  ["out-of-vram", /out of memory|cudaMalloc failed|failed to allocate .*(cuda|vulkan|metal)|vk::.*OutOfDeviceMemory|ErrorOutOfDeviceMemory/i],
  ["out-of-ram", /unable to allocate|std::bad_alloc|failed to allocate .*(cpu|host)|not enough memory/i],
  ["port-in-use", /address already in use|couldn't bind|failed to bind|EADDRINUSE/i],
  ["missing-shard", /(split|shard).*(missing|not found|no such)|failed to open GGUF.*-0000d-of-/i],
  ["unsupported-architecture", /unknown model architecture|unsupported .*architecture|unknown .*architecture/i],
  ["corrupt-gguf", /not a gguf|invalid magic|failed to load model|tensor .* data is not within|corrupt|truncated (file|gguf|model)|file .*truncated|GGUF.*(invalid|error)/i],
  ["gpu-init", /cuda error|CUDA.*(init|driver)|ggml_vulkan.*(error|fail)|vkCreate|no CUDA-capable|failed to initialize.*(cuda|vulkan|metal)/i],
];

/** A short slug for why the engine stopped, or "unknown". The raw lines are logged beside it. */
function classifyFailure(lines) {
  const text = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
  for (const [cause, pattern] of FAILURE_CAUSES) if (pattern.test(text)) return cause;
  return "unknown";
}

/** Windows a model is loaded at without being asked: each is a reload the conversation will not need. */
const ROOMY_CONTEXTS = [32768, 16384, 8192];
/** Growing the window reloads the model and throws its cache away, so a MoE model, whose load is the
 * slowest and whose cache --fit places, starts no smaller than this. */
const MOE_MIN_CONTEXT = 16384;

/** Backends whose flash attention reads a quantised KV cache slower than f16 during generation. CUDA
 * has fused kernels for q8_0, so it keeps the smaller cache. */
const F16_KV_RUNNERS = new Set(["metal", "vulkan"]);

/** Picks the KV cache type and a context that fits VRAM, since WDDM spills overflow into slow system RAM.
 * When the card has room to spare, the window is also rounded up, so a conversation that grows does
 * not reload the model (and reprocess everything) at every size step. */
function determineKvCache(modelPath, contextSize, vramGB = 0, traits = {}) {
  const { moe = false, trainedContext = null, kvBytesQ8 = null, exact = false, runnerType = null } = traits;
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
    // f16 is twice the size of q8_0 (32 values in 64 bytes against 34), so only where it still fits.
    if (F16_KV_RUNNERS.has(runnerType) && fitsGB(effectiveContext, q8PerToken * (64 / 34)) <= freeForKv * 0.8) {
      return { cacheType: "f16", effectiveContext };
    }
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
    const base = path.basename(modelPath);
    traitsCache.set(key, {
      moe: (header?.expertCount || 0) > 1 || /(?:^|[._-])(?:moe|a\d+b)(?:[._-]|$)/i.test(base),
      trainedContext: header?.contextLength || null,
      kvBytesQ8,
      mtp: Boolean(header?.mtp || /(?:^|[._-])mtp(?:[._-]|$)/i.test(base)),
    });
  }
  return traitsCache.get(key);
}

/**
 * Arguments that stream routed experts from disk, for builds that list them (llama.cpp PR 25294).
 * The names follow the PR as it stands; a rename only changes this mapping. A build without them
 * gets none, so the server starts as it always did. Streaming turns mmap off and serves one context.
 */
function moeStreamArgs(supports, stream) {
  if (!stream) return [];
  const args = [];
  if (supports("--moe-stream-cache") && stream.cacheGB > 0) {
    args.push("--moe-stream-cache", `${Math.max(1, Math.floor(stream.cacheGB))}G`);
    if (supports("--moe-stream-io-threads")) args.push("--moe-stream-io-threads", String(stream.ioThreads || 4));
    if (stream.direct && supports("--moe-stream-direct")) args.push("--moe-stream-direct");
  }
  if (stream.vramSlots > 0 && supports("--moe-expert-cache")) {
    args.push("--moe-expert-cache", String(Math.floor(stream.vramSlots)));
  }
  return args;
}

/** Whether the installed llama-server can stream experts from disk, which the tier planner needs to know. */
async function supportsMoeStream(binaryPath, userDataDir = null) {
  const flags = await engineFlags(binaryPath, buildEnv({}), userDataDir);
  return Boolean(flags && flags.has("--moe-stream-cache"));
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
  } catch (error) {
    defaultLog.swallow("engine", error, "no usable cache yet, ask the engine");
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
        } catch (error) {
          defaultLog.swallow("engine", error, "asking again next launch is fine");
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

/** Headroom --fit reserves so the desktop, Electron and browser do not push
 * allocations over physical VRAM into PCIe shared memory (crushing tok/s). */
function fitTargetMiB(vramGB) {
  if (!vramGB || vramGB <= 0) return 1024;
  const reservedGB = platform.IS_WINDOWS
    ? Math.max(2.0, Math.min(vramGB * 0.25, vramGB * 0.15 + 0.8))
    : Math.max(1.0, vramGB * 0.1);
  return Math.round(reservedGB * 1024);
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

/** Whether a draft model can sit on the card beside a dense model without pushing the model's own
 * layers into system RAM, which would cost more than drafting saves. A mixture of experts already
 * keeps its experts in RAM, and without a known card there is nothing to protect. */
function draftFits(modelPath, draftPath, vramGB, moe) {
  if (!(vramGB > 0) || moe) return true;
  const size = (file) => {
    try {
      return fs.statSync(file).size / 1024 ** 3;
    } catch {
      return 0;
    }
  };
  const usableGB = vramGB * 0.9 - 0.8;
  // The draft brings its own KV cache and compute buffer; a quarter of its size covers both.
  return size(modelPath) + size(draftPath) * 1.25 <= usableGB;
}

/** Which step of a load a line of engine output marks. Only the prompt has a real fraction; reading
 * and placing the weights print none, so they carry no percent. */
function parseEngineStage(line) {
  const text = String(line || "");
  if (/srv\s+load_model: loading model/i.test(text)) return { stage: "reading" };
  if (/srv\s+load_model: initializing, n_slots/i.test(text)) return { stage: "placing" };
  if (/llama_server: model loaded/i.test(text)) return { stage: "ready" };
  const prefill = /prompt processing, n_tokens = \d+, progress = ([0-9.]+)/i.exec(text);
  if (prefill) return { stage: "prefilling", percent: Math.min(100, Math.round(Number(prefill[1]) * 100)) };
  return null;
}

let stageSink = null;
/** Where load stages go. One sink: the window that shows them. */
function onEngineStage(sink) {
  stageSink = typeof sink === "function" ? sink : null;
}

let loadProgress = null;
/** Turns the engine's stages into percents, with the time each stage took going to the log. */
function trackLoad(stage, { modelPath, userDataDir, logger }) {
  if (stage.stage === "reading") {
    loadProgress?.stop();
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(modelPath).size;
    } catch (error) {
      logger.warn("llama.load", `model size unreadable: ${error.name}`);
    }
    loadProgress = createLoadProgress({ modelPath, sizeBytes, userDataDir, logger, emit: (next) => stageSink?.(next) });
  }
  if (!loadProgress) {
    stageSink?.(stage);
    return;
  }
  loadProgress.handle(stage);
}

/** Reads one line of the engine's output for what it says about speed: how many layers reached the
 * GPU, and how many drafted tokens were accepted. */
function watchEngineLine(line, { modelPath, userDataDir, drafting, logger, moe }) {
  const stage = stageSink && parseEngineStage(line);
  if (stage) trackLoad(stage, { modelPath, userDataDir, logger });
  const offload = /offloaded (\d+)\/(\d+) layers to GPU/i.exec(line);
  if (offload) {
    activeOffload = { layers: Number(offload[1]), total: Number(offload[2]) };
    if (activeOffload.layers < activeOffload.total && !moe) {
      logger.warn(
        "llama",
        `Only ${activeOffload.layers} of ${activeOffload.total} layers fit on the GPU; generation runs at system RAM speed for the rest. A smaller quantisation or context would fit entirely.`,
      );
    }
    return;
  }
  // One line per request: how long the prompt took to evaluate, and how fast tokens came after.
  const promptEval = /prompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens/i.exec(line);
  if (promptEval) {
    logger.debug("engine.llama", "prompt evaluated", { ms: Number(promptEval[1]), tokens: Number(promptEval[2]) });
    return;
  }
  // How much of the last prompt the slot kept, so a slow reply can be told from a cold cache.
  const slot = /selected slot by (LCP similarity|LRU).*?f_sim_best = ([0-9.]+).*?f_keep = ([0-9.]+)/i.exec(line);
  if (slot) {
    logger.debug("engine.llama", "prompt cache reused", { how: slot[1], similarity: Number(slot[2]), kept: Number(slot[3]) });
    return;
  }

  if (!drafting || !userDataDir) return;
  const sample = draftStats.parseAcceptance(line);
  if (sample) {
    logger.debug("engine.llama", "draft acceptance", { rate: Number(sample.rate.toFixed(3)), accepted: sample.accepted, generated: sample.generated });
    draftStats.record(userDataDir, modelPath, sample);
  }
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
  const traits = { ...modelTraits(modelPath), exact: exactContext, runnerType: runnerTypeFor(options) };
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

/** The GPU backend a start will run on, so sizing decisions match the launch. */
function runnerTypeFor({ userDataDir, vramGB = 0, binaryPath }) {
  if (!userDataDir) return null;
  try {
    return binaryManager.getEngineEnvironment(userDataDir, vramGB, binaryPath).runnerType;
  } catch {
    return null;
  }
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
    skipDraft = false,
    threads: requestedThreads,
    speculative = true,
    exactContext = false,
    moeStream = null,
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

  const traits = { ...modelTraits(modelPath), exact: exactContext, runnerType: runnerTypeFor(options) };
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
    const check = await adoptable(port, modelPath);
    if (!check.ok) {
      logger.warn("llama", `Port ${port} is held by an engine serving ${check.served}; refusing to adopt it for ${path.basename(modelPath)}`);
      return portTaken(port, check.served, modelPath);
    }
    logger.info("llama", `Adopting external server already running on port ${port}`);
    activeModel = modelPath;
    activePort = port;
    return { success: true, port };
  }

  const engine = userDataDir ? binaryManager.getEngineEnvironment(userDataDir, vramGB, binaryPath) : { env: {} };
  // On a hybrid laptop pin CUDA to the largest NVIDIA card; an explicit user choice is left alone.
  const devicePin = {};
  if (engine.runnerType === "cuda" && process.env.CUDA_VISIBLE_DEVICES === undefined) {
    const [best] = await platform.nvidiaDevices().catch(() => []);
    if (best) {
      devicePin.CUDA_DEVICE_ORDER = "PCI_BUS_ID";
      devicePin.CUDA_VISIBLE_DEVICES = String(best.index);
    }
  }
  const engineEnv = buildEnv({
    ...engine.env,
    ...devicePin,
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
  // Speculative decoding: companion draft model, MTP heads, or context n-grams. A draft is dropped when
  // measured acceptance says it slows this model down, or when it would push the model off the card.
  const companion = skipDraft ? null : draftModel.findCompanionDraft(path.dirname(modelPath), path.basename(modelPath));
  const tuning = userDataDir ? draftStats.draftSettings(userDataDir, modelPath) : { enabled: true, max: 8, rate: null };
  let draft = companion && tuning.enabled ? companion : null;
  if (companion && !tuning.enabled) {
    logger.info("llama", `Draft model off for ${path.basename(modelPath)}: acceptance ${Math.round((tuning.rate || 0) * 100)}% is too low to pay for itself`);
  }
  if (draft && !draftFits(modelPath, draft, vramGB, traits.moe)) {
    logger.info("llama", `Draft model off for ${path.basename(modelPath)}: it would push the model's layers off the GPU`);
    draft = null;
  }
  let speculation = "none";
  if (draft && (supports("--model-draft") || supports("-md"))) {
    speculation = "draft";
    args.push(supports("--model-draft") ? "--model-draft" : "-md", draft);
    if (supports("--draft-max")) args.push("--draft-max", String(tuning.max || 8));
    if (supports("--draft-min")) args.push("--draft-min", "1");
    if (supports("--draft-p-min")) args.push("--draft-p-min", "0.75");
    if (supports("-ngld")) args.push("-ngld", "99");
  } else if (traits.mtp && supports("--spec-type")) {
    speculation = "mtp";
    args.push("--spec-type", "draft-mtp");
    if (supports("--spec-draft-n-max")) args.push("--spec-draft-n-max", "3");
  } else if (speculative && supports("--spec-default")) {
    speculation = "ngram";
    args.push("--spec-default");
  }
  if (!speculation.startsWith("draft")) draft = null;
  if (supports("--cache-ram")) args.push("--cache-ram", String(promptCacheMiB(modelPath)));
  const streamArgs = moeStreamArgs(supports, moeStream);
  if (moeStream && streamArgs.length === 0) {
    logger.warn("llama", "Expert streaming was planned but this llama.cpp build does not list --moe-stream-cache");
  }
  args.push(...streamArgs);
  if (!Number.isInteger(gpuLayers) && supports("--fit-target") && vramGB > 0) {
    args.push("--fit-target", String(fitTargetMiB(vramGB)));
  }
  if (engine.runnerType === "cpu") {
    if (supports("--cpu-strict")) args.push("--cpu-strict", "1");
    const rangeFlag = supports("-Cr") ? "-Cr" : (supports("--cpu-range") ? "--cpu-range" : null);
    if (rangeFlag && threads > 1) args.push(rangeFlag, `0-${threads - 1}`);
  }

  // Without its projector a vision model answers as if no image had been sent.
  const projector = skipProjector ? null : mmproj.findCompanion(path.dirname(modelPath), path.basename(modelPath));
  if (projector) args.push("--mmproj", projector);

  // Adopt a server already on the port; spawning would fail to bind and stall the health check.
  if (!activeProcess && (await pingHealth(port, 1000))) {
    const check = await adoptable(port, modelPath);
    if (!check.ok) return portTaken(port, check.served, modelPath);
    activeModel = modelPath;
    activePort = port;
    return { success: true, port };
  }

  try {
    logger.info(
      "llama",
      `Starting llama-server: model=${modelPath}, port=${port}, context=${effectiveContext}, kvCache=${cacheType}, ` +
        `gpuLayers=${gpuLayers ?? "auto"}, runner=${engine.runnerType || "none"}, moe=${traits.moe}, ` +
        `ubatch=${ubatch}, threads=${threads}/${threadsBatch}, speculative=${speculation}` +
        (args.includes("--fit-target") ? `, fitTarget=${args[args.indexOf("--fit-target") + 1]}` : ""),
    );
    logger.debug("llama", `Spawning ${binaryPath} with args: ${args.join(" ")}`);

    const memoryBefore = await memoryNow();
    const child = platform.spawnHidden(binaryPath, args, {
      cwd: path.dirname(binaryPath),
      env: engineEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeProcess = child;
    activeModel = modelPath;
    activePort = port;
    activeContext = effectiveContext;
    activeOffload = null;
    activeSpeculation = speculation;

    const recent = [];
    // Longer than `recent`, which goes to the UI: this one only feeds the crash block in the log.
    const ring = createRing(200);
    let wasHealthy = false;
    const watch = { modelPath, userDataDir, drafting: Boolean(draft), logger, moe: traits.moe };
    attachOutputLogger(child.stdout, "llama:out", (p, line) => {
      logger.debug(p, line);
      watchEngineLine(line, watch);
    });
    attachOutputLogger(child.stderr, "llama:err", (p, line) => {
      logger.debug(p, line);
      watchEngineLine(line, watch);
      recent.push(line);
      if (recent.length > 40) recent.shift();
      ring.push(line);
    });

    // Still ours to report on only if nobody stopped or replaced it; an exit while it is still the active
    // process is the engine failing on its own.
    let crashed = null;
    // A binary that cannot be started never answers /health and never exits on its own, so without this the
    // wait ends as a load timeout and hides the real cause.
    let spawnError = null;
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("exit", (code, signal) => {
      logger.info("llama", `llama-server exited (code=${code}, signal=${signal})`);
      if (activeProcess === child) {
        // An engine that dies after it answered /health is the crash nobody was watching for.
        if (wasHealthy) {
          noteStat("engineCrash");
          logger.error("proc.engine", "llama exited after loading", { cause: classifyFailure(ring.tail(200)), code, signal, model: path.basename(modelPath), stderr: ring.dump() });
        }
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
    } catch (error) {
      defaultLog.swallow("engine", error, "unreadable size: keep the middle-of-the-road default above");
    }

    const readyStart = Date.now();
    const ready = await waitForReady(port, readyTimeoutMs, logger, () => activeProcess === child && child.exitCode === null);
    if (!ready) {
      if (spawnError && activeProcess === child) {
        activeProcess = null;
        activeModel = null;
        if (spawnError.code === "ENOENT") {
          return { success: false, error: "llama-server binary not found", kind: "engine-missing", params: { model: path.basename(modelPath) } };
        }
        return {
          success: false,
          error: `The model engine could not start for ${path.basename(modelPath)}: ${spawnError.message}`,
          kind: "stopped-loading",
          params: { model: path.basename(modelPath), code: String(spawnError.code ?? ""), reason: spawnError.message, log: "" },
        };
      }
      if (crashed) {
        noteStat("engineCrash");
        const reason = failureReason(recent);
        // A projector this engine cannot read must not take the text side of the model down with it.
        if (projector && /multimodal|mmproj|clip_init|mtmd/i.test(recent.join("\n"))) {
          logger.warn("llama", `The image projector was refused (${reason}); starting ${path.basename(modelPath)} without image support`);
          mmproj.markRefused(projector);
          const fallback = await launchServer({ ...options, skipProjector: true });
          // The caller has to know, or it keeps offering images to a model that can no longer take them.
          return fallback.success ? { ...fallback, projectorRefused: true } : fallback;
        }
        // A refused draft model must not stop the primary model from loading.
        if (draft && /draft|speculative/i.test(recent.join("\n"))) {
          logger.warn("llama", `The draft model was refused (${reason}); starting ${path.basename(modelPath)} without draft model`);
          draftModel.markRefused(draft);
          if (userDataDir) draftStats.recordRefusal(userDataDir, modelPath);
          return launchServer({ ...options, skipDraft: true });
        }
        const cause = classifyFailure(recent);
        logger.error("llama", `llama-server stopped after ${Date.now() - readyStart}ms: ${reason}`);
        // The stderr tail goes out as one block so a crash sits next to its cause, not among DEBUG lines.
        logger.error("proc.engine", "llama exited while loading", { cause, code: crashed.code, signal: crashed.signal, model: path.basename(modelPath), stderr: ring.dump() });
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

    wasHealthy = true;
    lastRunningOptions = { ...options };
    logger.info("llama", `llama-server ready on 127.0.0.1:${port} in ${Date.now() - readyStart}ms`);
    const memoryAfter = await memoryNow();
    logger.info("proc.engine", "engine loaded", {
      model: path.basename(modelPath),
      loadMs: Date.now() - readyStart,
      ramFreeBeforeGB: memoryBefore.ramFreeGB,
      ramFreeAfterGB: memoryAfter.ramFreeGB,
      vramFreeBeforeGB: memoryBefore.vramFreeGB,
      vramFreeAfterGB: memoryAfter.vramFreeGB,
    });
    return { success: true, port, contextSize: effectiveContext };
  } catch (err) {
    logger.error("llama", `Failed to spawn llama-server: ${err.message}`, err);
    stopServerSync();
    return { success: false, error: err.message };
  }
}

/** Kills active server process tree synchronously on quit or restart. */
/** Free RAM and VRAM right now, so a load or unload can be logged with what it cost. VRAM is null where
 * it cannot be measured. */
async function memoryNow() {
  let vramFreeGB = null;
  try {
    vramFreeGB = await platform.detectFreeVideoMemoryGB();
  } catch (error) {
    defaultLog.swallow("proc.engine", error, "free VRAM is a log detail, not worth failing a load for");
  }
  return {
    ramFreeGB: Number((os.freemem() / 1024 ** 3).toFixed(1)),
    vramFreeGB: vramFreeGB === null ? null : Number(vramFreeGB.toFixed(1)),
  };
}

function stopServerSync() {
  if (!activeProcess) return;
  const child = activeProcess;
  const unloaded = activeModel ? path.basename(activeModel) : null;
  activeProcess = null;
  activeModel = null;
  defaultLog.info("llama", `Terminating server PID ${child.pid}`);
  platform.killTreeSync(child);
  defaultLog.info("llama", "Server process tree terminated");
  // Whatever the engine held is only given back a moment after the process is gone.
  setTimeout(() => {
    memoryNow().then((after) => defaultLog.info("proc.engine", "engine unloaded", { model: unloaded, ...after }));
  }, 1500).unref();
}

/** Reports current status and model loaded in memory. */
function getServerStatus() {
  return {
    running: activeProcess !== null && activeProcess.exitCode === null,
    port: activePort,
    model: activeModel,
    contextSize: activeContext,
    offload: activeOffload,
    speculation: activeSpeculation,
    baseUrl: `http://127.0.0.1:${activePort}/v1`,
  };
}

async function reloadServer() {
  if (!lastRunningOptions) return { success: false, error: "No previous chat model to reload" };
  defaultLog.info("llama", `Reloading chat model ${path.basename(lastRunningOptions.modelPath)}`);
  return startServer(lastRunningOptions);
}

module.exports = {
  startServer,
  reloadServer,
  stopServerSync,
  getServerStatus,
  pingHealth,
  servedModel,
  determineKvCache,
  draftFits,
  watchEngineLine,
  parseEngineStage,
  onEngineStage,
  batchSizes,
  fitTargetMiB,
  promptCacheMiB,
  engineFlags,
  moeStreamArgs,
  supportsMoeStream,
  missingShards,
  waitForReady,
  buildEnv,
  attachOutputLogger,
  classifyFailure,
  failureReason,
};
