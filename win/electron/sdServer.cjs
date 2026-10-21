const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const platform = require("./platform.cjs");
const llamaProcess = require("./llamaProcess.cjs");
const imageModels = require("./imageModels.cjs");
const { log: defaultLog, noteStat } = require("./logger.cjs");

const DEFAULT_IDLE_SEC = 300;
const POLL_MS = 400;
const MAX_PROMPT = 4000;
const MAX_STEPS = 150;
const FALLBACK_LIMITS = { min_width: 64, max_width: 2048, min_height: 64, max_height: 2048 };

/** A failure with a code the renderer can put into words, never the engine's English. */
class SdError extends Error {
  constructor(code, message, params = {}) {
    super(message);
    this.name = "SdError";
    this.code = code;
    this.params = params;
  }
}

let getLaunch = null;
let options = { idleTimeoutSec: DEFAULT_IDLE_SEC };
let child = null;
let port = 0;
let loadedKey = null;
let loadedModelId = null;
let capabilities = null;
let starting = null;
let idleTimer = null;
let queue = Promise.resolve();
let pending = 0;
let crashedDuringJob = false;
/** Set when a job stopped the chat model to make room; the engine holds that memory until it stops. */
let tookChatMemory = false;
const requests = new Map();

function configure(provider) {
  getLaunch = provider;
}

/** An idle timeout of 0 stops the engine as soon as its queue is empty, which is how Draggy runs it. */
function setOptions(next = {}) {
  const idle = Number(next.idleTimeoutSec);
  options = { ...options, idleTimeoutSec: Number.isFinite(idle) && idle >= 0 ? idle : DEFAULT_IDLE_SEC };
  if (child && pending === 0) scheduleIdleStop();
}

function status() {
  return {
    running: Boolean(child && child.exitCode === null),
    model: loadedModelId,
    busy: pending > 0,
    queued: Math.max(0, pending - 1),
  };
}

function scheduleIdleStop() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (!options.idleTimeoutSec) return stopSync();
  idleTimer = setTimeout(stopSync, options.idleTimeoutSec * 1000);
  idleTimer.unref?.();
}

/** Kills sd-server and its children; safe when none is running. */
function stopSync() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (!child) return;
  const dying = child;
  child = null;
  tookChatMemory = false;
  loadedKey = null;
  loadedModelId = null;
  capabilities = null;
  platform.killTreeSync(dying);
}

/** A port nobody holds right now, asked of the system rather than fixed. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port: found } = server.address();
      server.close(() => resolve(found));
    });
  });
}

/** Where the job runs: the GPU, the GPU once the chat model steps aside, weights in RAM, or nowhere. */
function planMemory({ needGB, freeVramGB = null, totalVramGB = 0, loadedLlmGB = 0, unified = false, freeRamGB = 0, totalRamGB = 0, runner = "" }) {
  const need = Math.max(0.5, Number(needGB) || 0);

  if (runner === "cpu" || unified) {
    const totalMem = totalRamGB > 0 ? totalRamGB : freeRamGB;
    if (totalMem > 0 && totalMem < need) return "fail";
    if (freeRamGB >= need) return "gpu";
    if (loadedLlmGB > 0) return "unload-chat";
    return totalRamGB >= need || freeRamGB >= need ? "gpu" : "fail";
  }

  const totalSystemMem = (totalVramGB > 0 ? totalVramGB : 0) + (totalRamGB > 0 ? totalRamGB : freeRamGB);
  if (totalSystemMem > 0 && totalSystemMem < need) return "fail";

  const free = typeof freeVramGB === "number" ? freeVramGB : totalVramGB > 0 ? totalVramGB - loadedLlmGB - 0.5 : null;
  // Unknown VRAM: sd-server's own auto-fit measures it, so the job goes ahead.
  if (free === null) return "gpu";
  if (free >= need) return "gpu";
  if (loadedLlmGB > 0) return "unload-chat";
  return "offload";
}

/** Sizes the engine accepts: multiples of 64 inside its limits, with everything else kept in range. */
function clampRequest(request = {}, limits = FALLBACK_LIMITS, defaults = {}) {
  const lim = { ...FALLBACK_LIMITS, ...(limits || {}) };
  const size = (value, fallback, min, max) => {
    const raw = Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
    const rounded = Math.round(raw / 64) * 64;
    const low = Math.ceil(min / 64) * 64;
    const high = Math.floor(max / 64) * 64;
    return Math.min(high, Math.max(low, rounded));
  };
  const int = (value, fallback) => (Number.isInteger(Number(value)) ? Number(value) : fallback);

  const prompt = String(request.prompt ?? "").trim().slice(0, MAX_PROMPT);
  if (!prompt) throw new SdError("E_PROMPT", "An image needs a description");

  const strength = Number(request.strength);
  const asked = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);
  let width = asked(request.width, defaults.width || 512);
  let height = asked(request.height, defaults.height || 512);
  // A size the chat model picked is scaled to what the image model was trained on: SD 1.5 at 1024 took 409 s here.
  if (request.fitModel && defaults.maxSide && Math.max(width, height) > defaults.maxSide) {
    const scale = defaults.maxSide / Math.max(width, height);
    width = Math.floor((width * scale) / 64) * 64;
    height = Math.floor((height * scale) / 64) * 64;
  }
  return {
    prompt,
    negativePrompt: String(request.negativePrompt ?? "").slice(0, MAX_PROMPT),
    width: size(width, 512, lim.min_width, lim.max_width),
    height: size(height, 512, lim.min_height, lim.max_height),
    steps: Math.min(MAX_STEPS, Math.max(1, int(request.steps, defaults.steps || 20))),
    cfgScale: Number.isFinite(Number(request.cfgScale)) ? Math.min(30, Math.max(0, Number(request.cfgScale))) : defaults.cfgScale ?? 7,
    seed: int(request.seed, -1) >= 0 ? int(request.seed, -1) : -1,
    initImage: typeof request.initImage === "string" && request.initImage ? request.initImage : null,
    strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.75,
    lora: Array.isArray(request.lora) ? request.lora.slice(0, 4) : [],
    hires: Boolean(request.hires),
    outputFormat: ["jpeg", "webp"].includes(request.outputFormat) ? request.outputFormat : "png",
  };
}

/** The native job request. Only fields the pinned server documents are sent. */
function buildJobBody(clamped) {
  return {
    prompt: clamped.prompt,
    negative_prompt: clamped.negativePrompt,
    width: clamped.width,
    height: clamped.height,
    seed: clamped.seed,
    batch_count: 1,
    strength: clamped.strength,
    init_image: clamped.initImage,
    lora: clamped.lora.map((entry) => ({ path: entry.path, multiplier: entry.multiplier ?? 1, is_high_noise: false })),
    hires: { enabled: clamped.hires, upscaler: "Latent", scale: 2 },
    sample_params: {
      sample_steps: clamped.steps,
      guidance: { txt_cfg: clamped.cfgScale },
    },
    output_format: clamped.outputFormat,
  };
}

async function request(method, route, body, timeoutMs = 10_000) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(defaultLog.swallowed("engine", "the body is not JSON", null));
  return { status: response.status, data };
}

async function waitForCapabilities(proc, deadlineMs) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    if (child !== proc || proc.exitCode !== null) return null;
    try {
      const { status: code, data } = await request("GET", "/sdcpp/v1/capabilities", null, 2000);
      if (code === 200 && data) return data;
    } catch (error) {
      defaultLog.swallow("engine", error, "still loading the weights");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function launch(info, resolved, { offload, safe }) {
  const logger = info.log || defaultLog;
  // Replacing the engine does not give the chat model its memory back; the new one takes it over.
  const holdsChatMemory = tookChatMemory;
  stopSync();
  tookChatMemory = holdsChatMemory;

  port = await freePort();
  const args = [
    // Arguments a wrapper needs before the engine's own, such as a script run by Node.
    ...(info.argsPrefix || []),
    ...imageModels.modelArgs(resolved),
    "--listen-ip", "127.0.0.1",
    "--listen-port", String(port),
    "-t", String(info.threads || Math.min(8, os.cpus().length)),
    ...(info.loraDir ? ["--lora-model-dir", info.loraDir] : []),
    // Auto-fit places weights by live free memory; forcing them all into RAM made a 4070 Ti decode for minutes.
    ...(offload || safe ? ["--vae-tiling"] : []),
    // After a crash: lean attention, weights in RAM, so a driver or memory fault has less to hit.
    ...(safe ? ["--diffusion-fa", "--offload-to-cpu"] : []),
  ];
  logger.info("sd", `Starting sd-server: model=${resolved.entry.id} port=${port} tiled=${Boolean(offload || safe)} safe=${Boolean(safe)}`);
  const spawnedAt = Date.now();
  logger.info("proc.engine", "sd launch", { binary: path.basename(info.binaryPath), model: resolved.entry.id, port, threads: info.threads || null, tiled: Boolean(offload || safe), safe: Boolean(safe), argc: args.length });

  const proc = platform.spawnHidden(info.binaryPath, args, {
    cwd: path.dirname(info.binaryPath),
    env: info.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  const recent = [];
  llamaProcess.attachOutputLogger(proc.stdout, "sd:out", (prefix, line) => logger.debug(prefix, line));
  llamaProcess.attachOutputLogger(proc.stderr, "sd:err", (prefix, line) => {
    logger.debug(prefix, line);
    recent.push(line);
    if (recent.length > 200) recent.shift();
  });
  proc.on("exit", (code, signal) => {
    logger.info("sd", `sd-server exited (code=${code}, signal=${signal})`);
    // The stderr tail goes out as one block so a crash sits next to its cause.
    if (child === proc && code !== 0 && recent.length) logger.error("proc.engine", "sd exited unexpectedly", { code, signal, cause: llamaProcess.classifyFailure(recent), stderr: recent.join("\n") });
    if (child === proc) {
      child = null;
      loadedKey = null;
      loadedModelId = null;
      capabilities = null;
      if (pending > 0) crashedDuringJob = true;
    }
  });
  proc.on("error", (error) => logger.error("sd", `sd-server could not start: ${error.message} (${info.binaryPath})`));

  const sizeGB = Object.values(resolved.paths).reduce((sum, file) => {
    try {
      return sum + fs.statSync(file).size / 1024 ** 3;
    } catch {
      return sum;
    }
  }, 0);
  const deadline = Math.max(60_000, Math.min(600_000, Math.ceil(sizeGB) * 30_000));
  const caps = await waitForCapabilities(proc, deadline);
  if (!caps) {
    const reason = llamaProcess.failureReason(recent);
    const exited = proc.exitCode !== null;
    if (child === proc) stopSync();
    throw new SdError(
      exited ? "E_ENGINE_START" : "E_LOAD_TIMEOUT",
      `The image engine did not start${reason ? `: ${reason}` : ""}`,
      { reason, code: String(proc.exitCode ?? "") },
    );
  }
  capabilities = caps;
  logger.info("proc.engine", "sd healthy", { model: resolved.entry.id, ms: Date.now() - spawnedAt });
  return caps;
}

/** A running engine with this model loaded, starting or restarting one when needed. */
async function ensure(info, resolved, plan) {
  const key = `${resolved.entry.id}|${plan}`;
  if (child && child.exitCode === null && loadedKey === key && capabilities) return capabilities;
  if (starting && starting.key === key) return starting.promise;

  const entry = { key, promise: null };
  entry.promise = launch(info, resolved, { offload: plan === "offload", safe: plan === "safe" })
    .then((caps) => {
      loadedKey = key;
      loadedModelId = resolved.entry.id;
      return caps;
    })
    .finally(() => {
      if (starting === entry) starting = null;
    });
  starting = entry;
  return entry.promise;
}

function tmpPathFor(info, requestId, format = "png") {
  const dir = info.tmpDir || path.join(os.tmpdir(), "draggy-images");
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(requestId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || String(Date.now());
  return path.join(dir, `${safe}.${format === "jpeg" ? "jpg" : format}`);
}

/** Whether a dropped connection was the engine dying. Its exit event can land just after the socket error. */
async function engineGone(proc, waitMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    if (child !== proc || proc.exitCode !== null) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function runJob(info, clamped, record, onProgress) {
  const proc = child;
  let submitted;
  try {
    submitted = await request("POST", "/sdcpp/v1/img_gen", buildJobBody(clamped), 30_000);
  } catch (error) {
    if (await engineGone(proc)) throw new SdError("E_CRASH", "The image engine stopped during the job");
    throw new SdError("E_FAILED", error.message);
  }
  if (submitted.status === 429) throw new SdError("E_BUSY", "The image engine queue is full");
  if (submitted.status !== 202 || !submitted.data?.id) {
    throw new SdError("E_FAILED", submitted.data?.error?.message || `The image engine refused the request (HTTP ${submitted.status})`);
  }
  record.jobId = submitted.data.id;
  if (record.cancelled) await cancelJob(record.jobId);

  let lastState = "";
  let lastAnswer = Date.now();
  const patience = info.pollPatienceMs ?? 600_000;
  for (;;) {
    if (!child) throw new SdError("E_CRASH", "The image engine stopped during the job");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    let polled;
    try {
      polled = await request("GET", `/sdcpp/v1/jobs/${encodeURIComponent(record.jobId)}`, null, info.pollTimeoutMs ?? 15_000);
      lastAnswer = Date.now();
    } catch (error) {
      if (await engineGone(proc)) throw new SdError("E_CRASH", "The image engine stopped during the job");
      // The server does not answer while it decodes the image; that is the engine busy, not failing.
      if (Date.now() - lastAnswer < patience) continue;
      throw new SdError("E_FAILED", error.message);
    }
    if (polled.status === 404 || polled.status === 410) throw new SdError("E_FAILED", "The image engine lost the job");
    const job = polled.data || {};

    if (job.status !== lastState || job.status === "queued") {
      lastState = job.status;
      if (job.status === "queued") onProgress({ status: "queued", position: job.queue_position ?? 0 });
      if (job.status === "generating") onProgress({ status: "generating" });
    }
    if (job.status === "completed") {
      const encoded = job.result?.images?.[0]?.b64_json;
      if (!encoded) throw new SdError("E_FAILED", "The image engine returned no image");
      const target = tmpPathFor(info, record.requestId, clamped.outputFormat);
      fs.writeFileSync(target, Buffer.from(encoded, "base64"));
      return target;
    }
    if (job.status === "cancelled") throw new SdError("E_CANCELLED", "Cancelled");
    if (job.status === "failed") throw new SdError("E_FAILED", job.error?.message || "Generation failed");
  }
}

/** Whether the engine took the cancel. The pinned build refuses one for a job already generating. */
async function cancelJob(jobId) {
  try {
    const answer = await request("POST", `/sdcpp/v1/jobs/${encodeURIComponent(jobId)}/cancel`, null, 5000);
    return answer.status === 200;
  } catch {
    return false;
  }
}

/** One image, start to finish. Jobs run one at a time; a crash is retried once, never in a loop. */
function generate(requestId, requestBody = {}, onProgress = () => {}) {
  const record = { requestId: String(requestId || Date.now()), jobId: null, cancelled: false };
  requests.set(record.requestId, record);
  pending += 1;
  clearTimeout(idleTimer);
  idleTimer = null;
  if (pending > 1) onProgress({ status: "queued", position: pending - 1 });

  const job = queue.then(async () => {
    if (record.cancelled) throw new SdError("E_CANCELLED", "Cancelled");
    if (!getLaunch) throw new SdError("E_ENGINE_MISSING", "The image engine is not configured");
    const info = await getLaunch();
    if (!info.binaryPath) throw new SdError("E_ENGINE_MISSING", "The image engine is not installed");

    const resolved = imageModels.resolveImageModel(info.modelsDir, requestBody.model || info.defaultModel);
    if (!resolved) throw new SdError("E_MODEL_MISSING", "The image model is not downloaded");

    // A running engine already holds its memory, which a fresh measurement would count against it.
    const running = child && child.exitCode === null && loadedModelId === resolved.entry.id && loadedKey;
    let plan = running ? loadedKey.split("|")[1] : null;
    let evicted = false;
    if (!plan) {
      // The user's "stop the chat model for images" frees the memory before it is measured.
      if (requestBody.stopChat) {
        await info.freeChatModel?.();
        evicted = true;
        tookChatMemory = true;
      }
      const memory = info.memory ? await info.memory() : {};
      const needGB = imageModels.memoryNeedGB(resolved);
      plan = planMemory({ needGB, runner: info.runner, ...memory });
      if (plan === "fail") throw new SdError("E_VRAM", "Not enough memory for this image model", { needGB: needGB.toFixed(1) });
      if (plan === "unload-chat") {
        (info.log || defaultLog).info("sd", "Stopping the chat model so the image model fits on the GPU");
        await info.freeChatModel?.();
        const totalVram = memory.totalVramGB || 0;
        const freeAfter = (memory.freeVramGB || 0) + (memory.loadedLlmGB || 0);
        // The decode needs about 3 GB beyond the weights; without it a 1024 px image fails in the VAE, so tile.
        plan = totalVram >= needGB + 3 || freeAfter >= needGB + 3 ? "gpu" : "offload";
        evicted = true;
        tookChatMemory = true;
      }
    }

    try {
      for (let attempt = 0; ; attempt++) {
        if (!child || loadedModelId !== resolved.entry.id) onProgress({ status: "loading-model" });
        const caps = await ensure(info, resolved, plan);
        // Set once the engine is up, since starting it clears the flag along with the old engine.
        if (evicted) tookChatMemory = true;
        if (record.cancelled) throw new SdError("E_CANCELLED", "Cancelled");
        const clamped = clampRequest(requestBody, caps?.limits, resolved.entry.defaults);
        onProgress({ status: "generating" });
        crashedDuringJob = false;
        try {
          const tmpPath = await runJob(info, clamped, record, onProgress);
          return { tmpPath, width: clamped.width, height: clamped.height, seed: clamped.seed, model: resolved.entry.id };
        } catch (error) {
          // A stop that had to end the engine looks like a crash from here, but it is the stop.
          if (record.cancelled) throw new SdError("E_CANCELLED", "Cancelled");
          const crashed = error.code === "E_CRASH" || crashedDuringJob;
          if (crashed) noteStat("engineCrash");
          if (crashed && attempt === 0) {
            (info.log || defaultLog).warn("sd", "sd-server stopped during a job; restarting it once in safe mode");
            plan = "safe";
            continue;
          }
          throw crashed ? new SdError("E_CRASH", "The image engine stopped during the job") : error;
        }
      }
    } finally {
      if (tookChatMemory && pending <= 1 && info.reloadChatModel) {
        stopSync();
        try {
          await info.reloadChatModel();
        } catch (err) {
          defaultLog.swallow("sd", err, "reloading chat model after image generation");
        }
      }
    }
  });

  queue = job.catch(defaultLog.swallowed("engine", "the caller of this step already reports its failure")).finally(() => {
    pending -= 1;
    requests.delete(record.requestId);
    if (pending === 0 && child) scheduleIdleStop();
  });
  return job;
}

/** Stops one request: dropped if still waiting, cancelled in the engine if queued there, and the engine
 * stopped if it is already drawing, since the pinned build cannot cancel that. */
async function cancel(requestId) {
  const record = requests.get(String(requestId));
  if (!record) return false;
  record.cancelled = true;
  if (record.jobId && child && !(await cancelJob(record.jobId))) stopSync();
  return true;
}

/** Called before the chat model starts. If images pushed it out, the next chat waits for the running job and
 * then has the GPU back, rather than both crawling in memory that holds only one. */
async function yieldToChat() {
  if (!tookChatMemory) return false;
  await queue;
  stopSync();
  return true;
}

module.exports = {
  SdError,
  DEFAULT_IDLE_SEC,
  configure,
  setOptions,
  status,
  stopSync,
  generate,
  cancel,
  yieldToChat,
  planMemory,
  clampRequest,
  buildJobBody,
  freePort,
};
