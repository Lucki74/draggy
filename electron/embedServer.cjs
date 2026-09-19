const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const platform = require("./platform.cjs");
const binaryManager = require("./binaryManager.cjs");
const llamaProcess = require("./llamaProcess.cjs");
const { log: defaultLog } = require("./logger.cjs");

const DEFAULT_PORT = 11436;
/** The server is kept between indexing batches and searches, then let go so its memory comes back. */
const IDLE_MS = 60_000;

let getLaunch = null;
let child = null;
let loadedFile = null;
let activePort = DEFAULT_PORT;
/** The start still loading weights, so a second request for the same file joins it. */
let starting = null;
let idleTimer = null;

/** Tells the module how to find the engine; called once by the main process. */
function configure(provider) {
  getLaunch = provider;
}

const stemOf = (name) => name.toLowerCase().replace(/\.gguf$/, "");

/** The file an embedding model name stands for: that exact file, else the first of that family. */
function resolveModelFile(modelsDir, model) {
  const wanted = String(model || "").trim().toLowerCase();
  if (!wanted) return null;

  let names;
  try {
    names = fs.readdirSync(modelsDir).filter((name) => name.toLowerCase().endsWith(".gguf")).sort();
  } catch {
    return null;
  }
  const hit =
    names.find((name) => name.toLowerCase() === wanted || stemOf(name) === wanted) ??
    names.find((name) => stemOf(name).startsWith(wanted));
  return hit ? path.join(modelsDir, hit) : null;
}

function scheduleIdleStop() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stopSync, IDLE_MS);
  idleTimer.unref?.();
}

/** Kills the embedding server and its children; safe when none is running. */
function stopSync() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (!child) return;
  const dying = child;
  child = null;
  loadedFile = null;
  platform.killTreeSync(dying);
}

async function launch(info, file) {
  const logger = info.log || defaultLog;
  stopSync();

  if (!info.binaryPath) throw new Error("The AI engine is not installed yet.");
  activePort = info.port || DEFAULT_PORT;

  // No -ngl: any value disables --fit, and this model must leave the chat model its share of VRAM.
  const args = [
    "-m", file,
    "--port", String(activePort),
    "--host", "127.0.0.1",
    "--embedding",
    "-c", "8192",
    "--parallel", "4",
    "-b", "2048",
    "-ub", "2048",
    "-t", String(Math.min(8, os.cpus().length)),
  ];
  logger.info("embed", `Starting embedding server: ${path.basename(file)} on port ${activePort}`);

  const engine = info.userDataDir ? binaryManager.getEngineEnvironment(info.userDataDir, info.vramGB || 0) : { env: {} };
  const proc = platform.spawnHidden(info.binaryPath, args, {
    cwd: path.dirname(info.binaryPath),
    env: llamaProcess.buildEnv({ ...engine.env }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  loadedFile = file;

  const recent = [];
  llamaProcess.attachOutputLogger(proc.stdout, "embed:out", (prefix, line) => logger.debug(prefix, line));
  llamaProcess.attachOutputLogger(proc.stderr, "embed:err", (prefix, line) => {
    logger.debug(prefix, line);
    recent.push(line);
    if (recent.length > 40) recent.shift();
  });
  proc.on("exit", (code, signal) => {
    logger.info("embed", `Embedding server exited (code=${code}, signal=${signal})`);
    if (child === proc) {
      child = null;
      loadedFile = null;
    }
  });

  const ready = await llamaProcess.waitForReady(activePort, 60_000, logger, () => child === proc && proc.exitCode === null);
  if (!ready) {
    const reason = llamaProcess.failureReason(recent);
    if (child === proc) stopSync();
    throw new Error(`The embedding engine did not start${reason ? `: ${reason}` : "."}`);
  }
  return `http://127.0.0.1:${activePort}`;
}

/** Returns the base URL of an embedding server running this model, starting one when needed. */
async function ensure(model) {
  if (!getLaunch) throw new Error("The embedding engine is not configured.");
  const info = await getLaunch();
  const file = resolveModelFile(info.modelsDir, model);
  if (!file) throw new Error(`The embedding model ${model || "(none)"} is not downloaded.`);

  scheduleIdleStop();
  if (child && loadedFile === file && child.exitCode === null && (await llamaProcess.pingHealth(activePort))) {
    return `http://127.0.0.1:${activePort}`;
  }
  if (starting && starting.file === file) return starting.promise;

  const entry = { file, promise: null };
  entry.promise = launch(info, file).finally(() => {
    if (starting === entry) starting = null;
  });
  starting = entry;
  return entry.promise;
}

module.exports = { configure, ensure, stopSync, resolveModelFile };
