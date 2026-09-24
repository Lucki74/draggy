const fs = require("node:fs");
const path = require("node:path");
const platform = require("./platform.cjs");
const binaryManager = require("./binaryManager.cjs");
const { log: defaultLog } = require("./logger.cjs");

/**
 * Keeps the llama.cpp engine current and on the fastest build for this GPU, without ever touching the
 * engine that is running:
 *
 *  1. check (background, at most every few days): pick the newest release that has been out long enough
 *     to have been fixed if it was broken, download it beside the engine, and check that it starts;
 *  2. apply (next launch, before anything uses the engine): swap folders, keeping the old one;
 *  3. confirm or roll back: the first model that loads confirms the new build; if the first load
 *     crashes instead, the old engine comes back and that release is never tried again.
 */

const CHECK_EVERY_MS = 3 * 24 * 3600 * 1000;
/** llama.cpp publishes several builds a day; one that survives three days has not been pulled. */
const SETTLE_MS = 3 * 24 * 3600 * 1000;
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
const POLL_MS = 6 * 3600 * 1000;
/** The most GitHub hands out per page, so a settled build is still in the list on a busy week. */
const UPDATE_RELEASES_URL = binaryManager.RELEASES_URL.replace(/per_page=\d+/, "per_page=100");

const pendingDir = (llamaDir) => `${llamaDir}.pending`;
const previousDir = (llamaDir) => `${llamaDir}.previous`;

/** "cuda-12.4" -> "cuda-12", "rocm-10.0" -> "rocm", "vulkan" -> "vulkan". */
function variantFamily(variant) {
  const [kind, version] = String(variant || "").split("-");
  return kind === "cuda" && version ? `cuda-${parseInt(version, 10)}` : kind;
}

/** Which CUDA major a folder's runtime libraries are for, or 0. */
function cudaMajorIn(dir) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const match = name.match(/^(?:cudart64_|libcudart\.so\.)(\d+)/);
      if (match) return Number(match[1]);
    }
  } catch {
    // Unreadable: unknown.
  }
  return 0;
}

/** The family of what is installed, even for an engine installed before engine.json existed. */
function installedFamily(llamaDir, meta, vramGB) {
  if (meta.variant && meta.variant !== "adopted") return variantFamily(meta.variant);
  const { runnerType } = binaryManager.detectGpuRunner(llamaDir, vramGB);
  if (runnerType !== "cuda") return runnerType;
  const major = cudaMajorIn(llamaDir);
  return major ? `cuda-${major}` : "cuda";
}

/** Whether `installed` already is the build `wanted` would give. */
function sameFamily(installed, wanted) {
  const family = variantFamily(wanted);
  return installed === family || (!installed.includes("-") && family.split("-")[0] === installed);
}

/** Reads the build number from `--version` output, old ("version: 6789 (abc)") or new
 * ("version: 0.25.1 (build 11146, commit abc)") format. 0 when absent. */
function parseBuild(output) {
  const text = String(output || "");
  return Number(text.match(/\(build (\d+)/)?.[1] || text.match(/version:\s*(\d+)\s*\(/)?.[1]) || 0;
}

/** Runs `llama-server --version` from `binaryPath`: it loads every backend library, so a build that
 * cannot start here fails now rather than when a model loads. */
function probeEngine(binaryPath, env) {
  return new Promise((resolve) => {
    platform.execFileHidden(
      binaryPath,
      ["--version"],
      { cwd: path.dirname(binaryPath), env, encoding: "utf8", timeout: 30000 },
      (err, stdout, stderr) => {
        const output = `${stdout || ""}\n${stderr || ""}`;
        resolve({ ok: !err && /version:/.test(output), build: parseBuild(output) });
      },
    );
  });
}

function engineEnv(userDataDir, vramGB, binaryPath) {
  const { env } = binaryManager.getEngineEnvironment(userDataDir, vramGB, binaryPath);
  const wanted = new Set(Object.keys(env).map((key) => key.toUpperCase()));
  const kept = Object.entries(process.env).filter(([key]) => !wanted.has(key.toUpperCase()));
  return { ...Object.fromEntries(kept), ...env };
}

/** Looks for a better engine and stages it for the next launch. Never touches the running one. */
async function checkForUpdate(userDataDir, vramGB, { force = false, now = Date.now(), log = defaultLog } = {}) {
  const llamaDir = binaryManager.engineDir(userDataDir);
  const serverPath = path.join(llamaDir, binaryManager.serverName());
  if (!fs.existsSync(serverPath)) return { status: "no-engine" };
  if (fs.existsSync(path.join(pendingDir(llamaDir), binaryManager.serverName()))) return { status: "pending" };

  const meta = binaryManager.readEngineMeta(llamaDir);
  const lastCheck = Date.parse(meta.lastCheck || "") || 0;
  if (!force && now - lastCheck < CHECK_EVERY_MS) return { status: "recent" };

  const gpu = await binaryManager.gpuProfile(vramGB);
  const releases = await binaryManager.fetchJson(UPDATE_RELEASES_URL);
  binaryManager.writeEngineMeta(llamaDir, { ...meta, lastCheck: new Date(now).toISOString() });

  const failed = new Set(meta.failedTags || []);
  const release = (Array.isArray(releases) ? releases : []).find(
    (entry) =>
      !entry.draft &&
      binaryManager.buildNumber(entry.tag_name) > 0 &&
      !failed.has(entry.tag_name) &&
      now - (Date.parse(entry.published_at || "") || now) >= SETTLE_MS &&
      binaryManager.pickReleaseAssets(entry.assets || [], gpu).main,
  );
  if (!release) return { status: "current" };

  const wanted = binaryManager.pickReleaseAssets(release.assets, gpu).variant;
  const family = installedFamily(llamaDir, meta, vramGB);
  const haveBuild =
    binaryManager.buildNumber(meta.tag) || (await probeEngine(serverPath, engineEnv(userDataDir, vramGB, serverPath))).build;
  const newer = binaryManager.buildNumber(release.tag_name) > haveBuild;
  const better = !sameFamily(family, wanted);
  if (!newer && !better) return { status: "current", tag: meta.tag || `b${haveBuild}` };

  log.info(
    "engineUpdate",
    `Staging ${release.tag_name} (${wanted}) over b${haveBuild} (${family})${better ? ": faster build for this GPU" : ""}`,
  );
  const stageDir = `${llamaDir}.update-staging`;
  fs.rmSync(stageDir, { recursive: true, force: true });
  try {
    const { outDir, tag, variant } = await binaryManager.downloadEngine(stageDir, vramGB, () => {}, { gpu, release });
    const stagedServer = path.join(outDir, binaryManager.serverName());
    const { runnerType } = binaryManager.detectGpuRunner(outDir, vramGB);
    const wantsGpu = vramGB > 0 && !platform.IS_MAC;
    if (wantsGpu && runnerType === "cpu") throw new Error(`${tag} has no GPU backend for this machine`);
    if (!platform.IS_WINDOWS) fs.chmodSync(stagedServer, 0o755);
    if (!(await probeEngine(stagedServer, engineEnv(userDataDir, vramGB, stagedServer))).ok) {
      throw new Error(`${tag} does not start on this machine`);
    }

    binaryManager.writeEngineMeta(outDir, {
      tag,
      variant,
      previousTag: meta.tag || (haveBuild ? `b${haveBuild}` : null),
      failedTags: meta.failedTags || [],
      lastCheck: new Date(now).toISOString(),
    });
    fs.rmSync(pendingDir(llamaDir), { recursive: true, force: true });
    fs.renameSync(outDir, pendingDir(llamaDir));
    log.info("engineUpdate", `${tag} staged; it takes over on the next launch`);
    return { status: "staged", tag, variant };
  } catch (err) {
    log.warn("engineUpdate", `Engine update skipped: ${err.message}`);
    // A build that will not run here is not worth downloading again.
    if (/does not start|no GPU backend/.test(err.message)) {
      const latest = binaryManager.readEngineMeta(llamaDir);
      binaryManager.writeEngineMeta(llamaDir, { ...latest, failedTags: [...failed, release.tag_name].slice(-20) });
    }
    return { status: "failed", error: err.message };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

/** Swaps a staged engine in. Only safe before anything has started llama-server. */
function applyPendingEngine(userDataDir, { log = defaultLog } = {}) {
  const llamaDir = binaryManager.engineDir(userDataDir);
  const pending = pendingDir(llamaDir);
  if (!fs.existsSync(path.join(pending, binaryManager.serverName()))) {
    fs.rmSync(pending, { recursive: true, force: true });
    return { applied: false };
  }
  const previous = previousDir(llamaDir);
  try {
    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(llamaDir)) fs.renameSync(llamaDir, previous);
    try {
      fs.renameSync(pending, llamaDir);
    } catch (err) {
      if (fs.existsSync(previous)) fs.renameSync(previous, llamaDir);
      throw err;
    }
  } catch (err) {
    // A locked file leaves both folders as they were; the swap is tried again next launch.
    log.warn("engineUpdate", `Could not switch to the staged engine yet: ${err.message}`);
    return { applied: false, error: err.message };
  }
  const meta = binaryManager.readEngineMeta(llamaDir);
  binaryManager.writeEngineMeta(llamaDir, { ...meta, installedAt: new Date().toISOString(), unconfirmed: true });
  log.info("engineUpdate", `Switched the engine to ${meta.tag || "the staged build"} (was ${meta.previousTag || "unknown"})`);
  return { applied: true, tag: meta.tag };
}

function isUnconfirmed(userDataDir) {
  const llamaDir = binaryManager.engineDir(userDataDir);
  return Boolean(binaryManager.readEngineMeta(llamaDir).unconfirmed) && fs.existsSync(previousDir(llamaDir));
}

/** A model loaded on the new engine: it stays, and the old one goes. */
function confirmEngine(userDataDir) {
  const llamaDir = binaryManager.engineDir(userDataDir);
  const meta = binaryManager.readEngineMeta(llamaDir);
  if (!meta.unconfirmed) return false;
  delete meta.unconfirmed;
  binaryManager.writeEngineMeta(llamaDir, meta);
  fs.rmSync(previousDir(llamaDir), { recursive: true, force: true });
  return true;
}

/** The first load on a new engine crashed: bring the old engine back and never offer that build again. */
function rollbackEngine(userDataDir, { log = defaultLog } = {}) {
  const llamaDir = binaryManager.engineDir(userDataDir);
  if (!isUnconfirmed(userDataDir)) return { rolledBack: false };
  const badTag = binaryManager.readEngineMeta(llamaDir).tag;
  const failedDir = `${llamaDir}.failed`;
  try {
    fs.rmSync(failedDir, { recursive: true, force: true });
    fs.renameSync(llamaDir, failedDir);
    try {
      fs.renameSync(previousDir(llamaDir), llamaDir);
    } catch (err) {
      fs.renameSync(failedDir, llamaDir);
      throw err;
    }
    fs.rmSync(failedDir, { recursive: true, force: true });
  } catch (err) {
    log.error("engineUpdate", `Could not restore the previous engine: ${err.message}`);
    return { rolledBack: false, error: err.message };
  }
  const meta = binaryManager.readEngineMeta(llamaDir);
  const failedTags = [...new Set([...(meta.failedTags || []), badTag].filter(Boolean))].slice(-20);
  binaryManager.writeEngineMeta(llamaDir, { ...meta, failedTags, unconfirmed: undefined });
  log.warn("engineUpdate", `Engine ${badTag || "update"} failed its first load; back on ${meta.tag || "the previous build"}`);
  return { rolledBack: true, tag: badTag };
}

/** Background checks follow the app's own automatic-update setting. */
let timers = [];
let running = null;
function configure({ automatic, userDataDir, getVramGB, log = defaultLog } = {}) {
  dispose();
  if (!automatic || !userDataDir) return;
  const run = () => {
    if (running) return running;
    running = Promise.resolve(getVramGB ? getVramGB() : 0)
      .then((vramGB) => checkForUpdate(userDataDir, vramGB, { log }))
      .catch((err) => log.warn("engineUpdate", `Engine update check failed: ${err.message}`))
      .finally(() => {
        running = null;
      });
    return running;
  };
  timers.push(setTimeout(run, FIRST_CHECK_DELAY_MS), setInterval(run, POLL_MS));
  for (const timer of timers) timer.unref?.();
}

function dispose() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
}

module.exports = {
  checkForUpdate,
  applyPendingEngine,
  confirmEngine,
  rollbackEngine,
  isUnconfirmed,
  configure,
  dispose,
  variantFamily,
  sameFamily,
  cudaMajorIn,
  parseBuild,
  probeEngine,
};
