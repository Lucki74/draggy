const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const platform = require("./platform.cjs");
const urlPolicy = require("./urlPolicy.cjs");
const { log } = require("./logger.cjs");

/** One pinned build, never "latest": its hashes ship inside Draggy, so a moved tag or swapped file is refused. */
const SD_CPP_RELEASE = "master-898-2bb7294";
const SD_CPP_REPO = "leejet/stable-diffusion.cpp";
const ENGINE_LABEL = "Image engine";

/** Written by scripts/updateSdRelease.mjs from the release above; edit the script, not this table. */
const SD_CPP_ASSETS = {
  "cudart-sd-bin-win-cu12-x64.zip": { sha256: "fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d", size: 563452046 },
  "sd-master-2bb7294-bin-Darwin-macOS-26.6.2-arm64.zip": { sha256: "ca4bf4f40c491c4d1d75d3bef57f2600ecb19dedaac17fd1670e2b98ade1ce7e", size: 34322747 },
  "sd-master-2bb7294-bin-Linux-Ubuntu-24.04-x86_64-rocm-7.14.0.zip": { sha256: "8187e62198ff5f56ba95bdc0616b53d029da9736895c23a9b40193b109828807", size: 258091395 },
  "sd-master-2bb7294-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip": { sha256: "c848a914b156fc48d3d67656e779b20009132e874144252407526a32160c298d", size: 38549371 },
  "sd-master-2bb7294-bin-Linux-Ubuntu-24.04-x86_64.zip": { sha256: "d284ae24f61dafc75076d32cde69bd38cdf22c18e3330e8d7b29bcb477519d24", size: 25426079 },
  "sd-master-2bb7294-bin-win-cpu-x64.zip": { sha256: "ae344e272aabf9be51ce8732ef0d079cbd1a977a58d472c221a633791978e987", size: 17185807 },
  "sd-master-2bb7294-bin-win-cuda12-x64.zip": { sha256: "220d2a7e1cd24d8b9c0073e2370c91780e8547cd841d398644fe54543cc5a620", size: 333380261 },
  "sd-master-2bb7294-bin-win-rocm-7.14.0-x64.zip": { sha256: "2699a9cbfe3e89c6130e3257347a50136b7b22807881e835abe9c86bc32f6f8e", size: 192108045 },
  "sd-master-2bb7294-bin-win-vulkan-x64.zip": { sha256: "06bd91f712b0b22f2539749d9ae04c089471f8a3be330a49ec88ecfaea7d71b8", size: 31935877 },
};

/** Which archive each runner needs on each system. CUDA carries its runtime separately, as llama.cpp's does. */
const RUNNER_ASSETS = {
  "win32-x64": {
    cuda: { main: "sd-master-2bb7294-bin-win-cuda12-x64.zip", extra: "cudart-sd-bin-win-cu12-x64.zip" },
    vulkan: { main: "sd-master-2bb7294-bin-win-vulkan-x64.zip" },
    rocm: { main: "sd-master-2bb7294-bin-win-rocm-7.14.0-x64.zip" },
    cpu: { main: "sd-master-2bb7294-bin-win-cpu-x64.zip" },
  },
  "linux-x64": {
    vulkan: { main: "sd-master-2bb7294-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip" },
    rocm: { main: "sd-master-2bb7294-bin-Linux-Ubuntu-24.04-x86_64-rocm-7.14.0.zip" },
    cpu: { main: "sd-master-2bb7294-bin-Linux-Ubuntu-24.04-x86_64.zip" },
  },
  "darwin-arm64": {
    metal: { main: "sd-master-2bb7294-bin-Darwin-macOS-26.6.2-arm64.zip" },
  },
};

function serverName(system = process.platform) {
  return system === "win32" ? "sd-server.exe" : "sd-server";
}

function engineRoot(userDataDir) {
  return path.join(userDataDir, "bin", "sd", SD_CPP_RELEASE);
}

function runnerDir(userDataDir, runner) {
  return path.join(engineRoot(userDataDir), runner);
}

/** The runners this machine could install, most capable first. Empty where no build is published. */
function runnersFor({ system = process.platform, arch = os.arch(), nvidia = false } = {}) {
  const table = RUNNER_ASSETS[`${system}-${arch}`];
  if (!table) return [];
  return Object.keys(table).filter((runner) => runner !== "cuda" || nvidia);
}

/** CUDA on NVIDIA, Metal on Apple, Vulkan on every other GPU. ROCm covers only some AMD cards, so it is never picked. */
function defaultRunner({ system = process.platform, arch = os.arch(), vramGB = 0, nvidia = false } = {}) {
  const available = runnersFor({ system, arch, nvidia });
  if (available.length === 0) return null;
  if (available.includes("metal")) return "metal";
  if (nvidia && available.includes("cuda")) return "cuda";
  if (vramGB > 0 && available.includes("vulkan")) return "vulkan";
  return available.includes("cpu") ? "cpu" : available[0];
}

/** The archives for a runner, or null when this system has none. "auto" resolves through defaultRunner. */
function pickSdAssets({ system = process.platform, arch = os.arch(), vramGB = 0, nvidia = false, runner = "auto" } = {}) {
  const chosen = runner === "auto" ? defaultRunner({ system, arch, vramGB, nvidia }) : runner;
  if (!chosen || !runnersFor({ system, arch, nvidia }).includes(chosen)) return null;

  const entry = RUNNER_ASSETS[`${system}-${arch}`][chosen];
  return { runner: chosen, main: entry.main, ...(entry.extra ? { extra: entry.extra } : {}) };
}

function downloadUrl(name) {
  return `https://github.com/${SD_CPP_REPO}/releases/download/${SD_CPP_RELEASE}/${name}`;
}

/** Archive entries that would land outside the folder they are unpacked into. */
function unsafeEntries(entries) {
  return entries.filter((entry) => {
    const name = String(entry).replace(/\\/g, "/");
    if (!name) return false;
    if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return true;
    return name.split("/").some((part) => part === "..");
  });
}

/** What a failed `sd-server --version` means. An exit with nothing printed counts as a failure. */
function classifySmoke({ error = null, code = null, signal = null, stdout = "" } = {}) {
  const exit = typeof code === "number" ? code >>> 0 : null;
  if (!error && exit === 0 && String(stdout).trim()) return { ok: true };

  if (error?.killed || signal === "SIGTERM") return { ok: false, kind: "timeout" };
  if (exit === 0xc0000135) return { ok: false, kind: "missing-library" };
  if (exit === 0xc000001d || signal === "SIGILL") return { ok: false, kind: "unsupported-cpu" };
  if (error?.code === "ENOENT") return { ok: false, kind: "missing-binary" };
  return { ok: false, kind: "failed" };
}

function smokeTest(binaryPath, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    platform.execFileHidden(
      binaryPath,
      ["--version"],
      { cwd: path.dirname(binaryPath), env: engineEnv(binaryPath), timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve(classifySmoke({ error, code, signal: error?.signal ?? null, stdout }));
      },
    );
  });
}

/** Linux looks for the engine's libraries beside it only when told to. */
function engineEnv(binaryPath) {
  const dir = path.dirname(binaryPath);
  if (platform.IS_WINDOWS) return { ...process.env, PATH: [dir, process.env.PATH || ""].join(path.delimiter) };
  return { ...process.env, LD_LIBRARY_PATH: [dir, process.env.LD_LIBRARY_PATH || ""].filter(Boolean).join(path.delimiter) };
}

/** The server inside an unpacked archive, which may sit one folder down. */
function findServerIn(dir, depth = 3) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const direct = entries.find((entry) => entry.isFile() && entry.name === serverName());
  if (direct) return path.join(dir, direct.name);
  if (depth <= 0) return null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findServerIn(path.join(dir, entry.name), depth - 1);
    if (found) return found;
  }
  return null;
}

function findOnPath() {
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, serverName());
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (error) {
      log.swallow("engine", error, "binary not installed yet");
    }
  }
  return null;
}

/** The installed engine: the preferred runner, then any other the app installed, then one on PATH. */
function findSdBinary(userDataDir, preferred = null) {
  const root = engineRoot(userDataDir);
  let runners;
  try {
    runners = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    runners = [];
  }
  const order = runners.sort().sort((a, b) => Number(b === preferred) - Number(a === preferred));
  for (const runner of order) {
    const binary = findServerIn(path.join(root, runner));
    if (binary) return { binaryPath: binary, runner, source: "app" };
  }
  const onPath = findOnPath();
  return onPath ? { binaryPath: onPath, runner: "external", source: "path" } : null;
}

function fetchStream(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith("https:") || !urlPolicy.isFetchableUrl(url, { allowPrivate: false })) {
      return reject(new Error("URL refused by outbound security policy"));
    }
    https
      .get(url, { headers: { "User-Agent": "Draggy" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
          return resolve(fetchStream(new URL(res.headers.location, url).href, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Server returned HTTP ${res.statusCode}`));
        }
        resolve(res);
      })
      .on("error", reject);
  });
}

/** Downloads one pinned asset and refuses it unless its SHA-256 is the one built into the app. */
async function downloadAsset(name, destination, progress, fetcher = fetchStream) {
  const expected = SD_CPP_ASSETS[name]?.sha256;
  if (!expected) throw new Error(`${name} is not part of the pinned image engine release`);

  const res = await fetcher(downloadUrl(name));
  const hash = crypto.createHash("sha256");
  res.on("data", (chunk) => {
    hash.update(chunk);
    progress.add(chunk.length);
  });
  await pipeline(res, fs.createWriteStream(destination));

  if (hash.digest("hex") !== expected) {
    fs.rmSync(destination, { force: true });
    log.error("engine.binary", "checksum mismatch", { asset: name, release: SD_CPP_RELEASE });
    throw new Error(`Checksum mismatch for ${name}`);
  }
  log.info("engine.binary", "checksum verified", { asset: name, release: SD_CPP_RELEASE });
}

function systemTar() {
  return platform.IS_WINDOWS ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
}

function runTar(args) {
  return new Promise((resolve, reject) => {
    platform.execFileHidden(systemTar(), args, { timeout: 600_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

/** Lists the archive before unpacking it, then checks nothing unpacked is a link out of the folder. */
async function extractSafely(archive, destination) {
  const listing = String(await runTar(["-tf", archive])).split(/\r?\n/).filter(Boolean);
  const unsafe = unsafeEntries(listing);
  if (unsafe.length > 0) throw new Error(`Refused an archive entry outside its folder: ${unsafe[0]}`);

  fs.mkdirSync(destination, { recursive: true });
  await runTar(["-xf", archive, "-C", destination]);

  const root = fs.realpathSync(destination);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = fs.realpathSync(full);
        if (path.relative(root, target).startsWith("..")) throw new Error(`Refused a link outside the engine folder: ${entry.name}`);
      } else if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
}

let setupInFlight = null;

/** Installs the chosen runner once; a second call while one runs joins it. */
function ensureEngine(userDataDir, options = {}, onProgress = () => {}) {
  if (!setupInFlight) {
    setupInFlight = runSetup(userDataDir, options, onProgress).finally(() => {
      setupInFlight = null;
    });
  }
  return setupInFlight;
}

/** Installs the automatic runner; a GPU build that will not run here falls back to Vulkan, then the CPU. */
async function runSetup(userDataDir, { vramGB = 0 } = {}, onProgress) {
  const nvidia = hasNvidiaDriver();
  const tried = [defaultRunner({ vramGB, nvidia }), "vulkan", "cpu"].filter((runner, index, all) => runner && all.indexOf(runner) === index);
  let result = { ready: false, kind: "unsupported-platform", error: "No image engine is published for this system" };
  for (const runner of tried) {
    if (!pickSdAssets({ vramGB, nvidia, runner })) continue;
    result = await installRunner(userDataDir, { vramGB, nvidia, runner }, onProgress);
    if (result.ready || result.kind === "download-failed") return result;
    log.warn("sdEngine", `The ${runner} image engine will not run here (${result.kind}); trying the next one`);
  }
  return result;
}

async function installRunner(userDataDir, { vramGB, nvidia, runner }, onProgress) {
  const pick = pickSdAssets({ vramGB, nvidia, runner });
  if (!pick) return { ready: false, kind: "unsupported-platform", error: "No image engine is published for this system" };

  log.info("engine.binary", "image runner picked", { runner: pick.runner, requested: runner || "auto", vramGB, nvidia, main: pick.main, release: SD_CPP_RELEASE });
  const target = runnerDir(userDataDir, pick.runner);
  const existing = findServerIn(target);
  if (existing) {
    const smoke = await smokeTest(existing);
    if (smoke.ok) return { ready: true, binaryPath: existing, runner: pick.runner };
    log.warn("sdEngine", `Installed ${pick.runner} engine failed its smoke test (${smoke.kind}); reinstalling`);
  }

  const names = [pick.main, pick.extra].filter(Boolean);
  const total = names.reduce((sum, name) => sum + (SD_CPP_ASSETS[name]?.size || 0), 0);
  let completed = 0;
  let lastEmit = 0;
  const progress = {
    add(bytes) {
      completed += bytes;
      const now = Date.now();
      if (now - lastEmit < 100 && completed < total) return;
      lastEmit = now;
      const percent = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;
      onProgress({ phase: "downloading", percent, completed, total, label: ENGINE_LABEL });
    },
  };

  const stage = `${target}.staging`;
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    log.info("sdEngine", `Downloading image engine ${SD_CPP_RELEASE} (${pick.runner}): ${names.join(", ")}`);
    const out = path.join(stage, "engine");
    for (const [index, name] of names.entries()) {
      const archive = path.join(stage, name);
      await downloadAsset(name, archive, progress);
      const unpacked = path.join(stage, `x${index}`);
      await extractSafely(archive, unpacked);
      const server = findServerIn(unpacked);
      // The runtime archive has no server; its libraries go beside the one from the main archive.
      fs.cpSync(server ? path.dirname(server) : unpacked, out, { recursive: true, force: true });
    }
    onProgress({ phase: "extracting", percent: 100, completed: total, total, label: ENGINE_LABEL });

    const binary = findServerIn(out);
    if (!binary) throw new Error("The image engine archive has no sd-server");
    if (!platform.IS_WINDOWS) fs.chmodSync(binary, 0o755);

    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(out, target);
  } catch (err) {
    log.error("sdEngine", `Image engine setup failed: ${err.message}`, err);
    return { ready: false, kind: "download-failed", error: err.message };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  const binary = findServerIn(target);
  const smoke = await smokeTest(binary);
  if (!smoke.ok) {
    log.error("sdEngine", `Image engine installed but will not run: ${smoke.kind}`);
    return { ready: false, kind: smoke.kind, binaryPath: binary, runner: pick.runner, error: `The image engine would not run (${smoke.kind})` };
  }
  log.info("sdEngine", `Image engine ready: ${binary} (${pick.runner})`);
  return { ready: true, binaryPath: binary, runner: pick.runner };
}

function hasNvidiaDriver() {
  if (platform.IS_WINDOWS) {
    return fs.existsSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvcuda.dll"));
  }
  return fs.existsSync("/usr/lib/x86_64-linux-gnu/libcuda.so.1");
}

module.exports = {
  SD_CPP_RELEASE,
  SD_CPP_REPO,
  SD_CPP_ASSETS,
  RUNNER_ASSETS,
  serverName,
  engineRoot,
  runnerDir,
  runnersFor,
  defaultRunner,
  pickSdAssets,
  downloadUrl,
  unsafeEntries,
  classifySmoke,
  smokeTest,
  engineEnv,
  findServerIn,
  findSdBinary,
  downloadAsset,
  extractSafely,
  ensureEngine,
  hasNvidiaDriver,
};
