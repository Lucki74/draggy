const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const platform = require("./platform.cjs");
const urlPolicy = require("./urlPolicy.cjs");
const { log } = require("./logger.cjs");

const RELEASES_URL = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10";
const ENGINE_LABEL = "AI Engine";

/** Every shared library beside llama-server, runtime ones included; a missing libc++ is a 0xC0000135 crash. */
const BASE_LIBRARY = /\.(dll|so(\.\d+)*|dylib|metallib)$/i;
/** The engine's own libraries, so a stray runtime DLL beside a lone server does not count as an install. */
const ENGINE_LIBRARY = /^(lib)?(ggml|llama|mtmd)[^\\/]*\.(dll|so(\.\d+)*|dylib|metallib)$/i;
/** GPU runner folders Ollama-style installs keep next to the engine. */
const RUNNER_FOLDER = /^(cuda_v\d+|vulkan|rocm|hip|metal)$/i;

function serverName() {
  return platform.IS_WINDOWS ? "llama-server.exe" : "llama-server";
}

/** The engine lives inside the app's own data so it needs no install step. */
function engineDir(userDataDir) {
  return path.join(userDataDir, "bin", "llama");
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Folders that may already hold a llama-server, most specific first. */
function candidateDirs() {
  const env = process.env;
  const dirs = platform.IS_WINDOWS
    ? [
        path.join(env.LOCALAPPDATA || "", "Programs", "Ollama", "lib", "ollama"),
        path.join(env.ProgramFiles || "C:\\Program Files", "Ollama", "lib", "ollama"),
        path.join(env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Ollama", "lib", "ollama"),
        path.join(env.LOCALAPPDATA || "", "Programs", "llama.cpp"),
      ]
    : [
        "/usr/local/bin",
        "/usr/bin",
        path.join(env.HOME || "", ".local", "bin"),
        "/usr/local/lib/ollama",
        "/usr/lib/ollama",
        "/Applications/Ollama.app/Contents/Resources",
      ];

  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (dir) dirs.push(dir);
  }
  return dirs;
}

/** Look for llama-server in user data or on PATH. */
function findLlamaBinary(userDataDir) {
  const binaryName = serverName();
  log.debug("binaryManager", `Searching for ${binaryName} in userData and standard PATH`);

  if (userDataDir) {
    const customBin = path.join(engineDir(userDataDir), binaryName);
    if (fs.existsSync(customBin)) {
      log.info("binaryManager", `Found llama-server in user data: ${customBin}`);
      return customBin;
    }
  }

  for (const dir of candidateDirs()) {
    const file = path.join(dir, binaryName);
    log.debug("binaryManager", `Checking candidate location: ${file}`);
    if (fs.existsSync(file)) {
      log.info("binaryManager", `Found llama-server on PATH: ${file}`);
      return file;
    }
  }

  log.debug("binaryManager", "No llama-server binary discovered");
  return null;
}

/** Determines recommended release asset name based on platform and detected GPU. */
function recommendedReleaseAsset(vramGB) {
  let asset = "llama-server-vulkan-x64";
  if (platform.IS_WINDOWS) {
    asset = vramGB > 0 ? "llama-server-cuda-x64" : "llama-server-vulkan-x64";
  } else if (platform.IS_MAC) {
    asset = "llama-server-metal-arm64";
  }
  log.debug("binaryManager", `Recommended asset: ${asset} (vramGB=${vramGB})`);
  return asset;
}

/** Verifies that a download URL satisfies app outbound URL policy before fetching. */
function validateDownloadUrl(url) {
  const allowed = urlPolicy.isFetchableUrl(url, { allowPrivate: false });
  log.debug("binaryManager", `URL validation: ${url} -> ${allowed ? "allowed" : "denied"}`);
  return allowed;
}

/** Picks the GPU backend the engine folder can run. Sub-folder layouts come from Ollama installs, flat ones from llama.cpp releases. */
function detectGpuRunner(llamaDir, vramGB = 0) {
  const found = (runnerDir, dllName, runnerType) => ({
    runnerDir,
    backendDll: dllName ? path.join(runnerDir, dllName) : null,
    runnerType,
  });

  if (platform.IS_MAC) return found(llamaDir, null, "metal");

  // AMD and Intel report VRAM too; without an NVIDIA driver a CUDA runner cannot load.
  const cudaUsable = vramGB > 0 && hasNvidiaDriver();

  if (platform.IS_WINDOWS) {
    // CUDA beats Vulkan on NVIDIA in every layout, so a stray vulkan folder must not win over a flat CUDA build.
    if (cudaUsable) {
      for (const name of ["cuda_v12", "cuda_v13"]) {
        const dir = path.join(llamaDir, name);
        if (isDirectory(dir)) return found(dir, "ggml-cuda.dll", "cuda");
      }
      if (fs.existsSync(path.join(llamaDir, "ggml-cuda.dll"))) return found(llamaDir, "ggml-cuda.dll", "cuda");
    }
    const vulkanDir = path.join(llamaDir, "vulkan");
    if (isDirectory(vulkanDir)) return found(vulkanDir, "ggml-vulkan.dll", "vulkan");
    if (fs.existsSync(path.join(llamaDir, "ggml-vulkan.dll"))) {
      return found(llamaDir, "ggml-vulkan.dll", "vulkan");
    }
    return found(llamaDir, null, "cpu");
  }

  const linuxRunners = [
    ...(cudaUsable ? [["cuda_v12", "libggml-cuda.so", "cuda"], ["cuda_v13", "libggml-cuda.so", "cuda"]] : []),
    ["vulkan", "libggml-vulkan.so", "vulkan"],
    ["rocm", "libggml-hip.so", "rocm"],
  ];
  for (const [name, library, runnerType] of linuxRunners) {
    const dir = path.join(llamaDir, name);
    if (isDirectory(dir)) return found(dir, library, runnerType);
    if (fs.existsSync(path.join(llamaDir, library))) return found(llamaDir, library, runnerType);
  }
  return found(llamaDir, null, "cpu");
}

/** Environment the engine needs to find its GPU backend. Returns the binary too, so callers resolve everything once. */
function getEngineEnvironment(userDataDir, vramGB = 0, explicitBinary = null) {
  const binaryPath = explicitBinary || findLlamaBinary(userDataDir);
  // Runners sit beside the binary that runs, which may be an Ollama install rather than the app folder.
  const llamaDir = binaryPath ? path.dirname(binaryPath) : engineDir(userDataDir);
  const { runnerDir, backendDll, runnerType } = detectGpuRunner(llamaDir, vramGB);

  const dirs = [...new Set([runnerDir, llamaDir])];
  const env = { PATH: [...dirs, process.env.PATH || ""].join(path.delimiter) };
  if (!platform.IS_WINDOWS) {
    env.LD_LIBRARY_PATH = [...dirs, process.env.LD_LIBRARY_PATH || ""].filter(Boolean).join(path.delimiter);
  }
  // A flat layout is found beside the executable; loading it twice is pointless.
  if (backendDll && runnerDir !== llamaDir) env.GGML_BACKEND_PATH = backendDll;

  return { env, runnerDir, runnerType, binaryPath };
}

/** True once the engine folder holds the server and, on a GPU machine, a GPU backend. Moving to a
 * faster build (Vulkan to CUDA, CUDA 12 to 13) is engineUpdater's job, in the background. */
function engineState(llamaDir, vramGB) {
  const binaryPath = path.join(llamaDir, serverName());
  const { runnerType } = detectGpuRunner(llamaDir, vramGB);
  const present = fs.existsSync(binaryPath);
  const wantsGpu = vramGB > 0 && !platform.IS_MAC;
  return { present, complete: present && (runnerType !== "cpu" || !wantsGpu), binaryPath, runnerType };
}

/** What is installed: release tag and build variant, written beside the engine. */
const META_FILE = "engine.json";

function readEngineMeta(llamaDir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(llamaDir, META_FILE), "utf8"));
    return meta && typeof meta === "object" ? meta : {};
  } catch {
    return {};
  }
}

function writeEngineMeta(llamaDir, meta) {
  try {
    fs.writeFileSync(path.join(llamaDir, META_FILE), JSON.stringify(meta, null, 2));
  } catch (err) {
    log.warn("binaryManager", `Could not record engine details: ${err.message}`);
  }
}

/** The build flavour named in a release archive: "cuda-12.4", "vulkan", "cpu", or "metal" on macOS. */
function variantOf(assetName) {
  if (/-bin-macos-/.test(assetName || "")) return "metal";
  return String(assetName || "").match(/-bin-(?:win|ubuntu)-(.+?)-(?:x64|arm64)\./)?.[1] || "cpu";
}

/** The build number of a tag such as "b11146", or 0. */
function buildNumber(tag) {
  return Number(String(tag || "").match(/^b(\d+)$/)?.[1]) || 0;
}

/** A folder is worth copying only if the server sits beside its own libraries. */
function isSelfContained(dir) {
  try {
    if (!fs.existsSync(path.join(dir, serverName()))) return false;
    return fs.readdirSync(dir).some((name) => ENGINE_LIBRARY.test(name));
  } catch {
    return false;
  }
}

/** Copies a local install's server, libraries and GPU runners. Returns the folder used, or null. */
function adoptLocalEngine(llamaDir, stageDir) {
  const target = path.resolve(llamaDir);
  for (const source of candidateDirs()) {
    if (path.resolve(source) === target || !isSelfContained(source)) continue;

    log.info("binaryManager", `Adopting local engine from ${source}`);
    fs.mkdirSync(stageDir, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      const to = path.join(stageDir, entry.name);
      if (entry.isDirectory() && RUNNER_FOLDER.test(entry.name)) {
        fs.cpSync(from, to, { recursive: true });
      } else if (entry.isFile() && (entry.name === serverName() || BASE_LIBRARY.test(entry.name))) {
        fs.copyFileSync(from, to);
      }
    }
    return source;
  }
  return null;
}

/** Moves a finished staging folder into place, keeping anything already there. A replacement swaps whole
 * folders, so a locked file leaves the old engine untouched rather than half-overwritten. */
function installStaged(stageDir, llamaDir, { replace = false } = {}) {
  fs.mkdirSync(path.dirname(llamaDir), { recursive: true });
  if (replace && fs.existsSync(llamaDir)) {
    const old = `${llamaDir}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(llamaDir, old);
    try {
      fs.renameSync(stageDir, llamaDir);
    } catch (err) {
      fs.renameSync(old, llamaDir);
      throw err;
    }
    fs.rmSync(old, { recursive: true, force: true });
  } else if (!fs.existsSync(llamaDir)) {
    fs.renameSync(stageDir, llamaDir);
  } else {
    fs.cpSync(stageDir, llamaDir, { recursive: true, force: true });
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  if (!platform.IS_WINDOWS) fs.chmodSync(path.join(llamaDir, serverName()), 0o755);
}

/** Where distributions put the NVIDIA driver library: Debian/Ubuntu, Fedora/openSUSE, Arch, WSL. */
const NVIDIA_LINUX_DRIVER = [
  "/usr/lib/x86_64-linux-gnu/libcuda.so.1",
  "/usr/lib/aarch64-linux-gnu/libcuda.so.1",
  "/usr/lib64/libcuda.so.1",
  "/usr/lib/libcuda.so.1",
  "/usr/lib/wsl/lib/libcuda.so.1",
];

/** Whether an NVIDIA driver is installed. AMD and Intel cards report VRAM too but cannot run CUDA. */
function hasNvidiaDriver() {
  if (platform.IS_WINDOWS) {
    return fs.existsSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvcuda.dll"));
  }
  return NVIDIA_LINUX_DRIVER.some((file) => fs.existsSync(file));
}

/** Chooses release assets for this machine: the engine archive, plus the CUDA runtime when it is not
 * bundled. CUDA 13 goes to Blackwell cards (RTX 50) with a new enough driver: the 12.x builds carry no
 * native code for them. Older cards stay on 12, since 13 dropped the oldest architectures. */
function pickReleaseAssets(assets, { vramGB = 0, arch = os.arch(), nvidia = false, cuda13 = false } = {}) {
  const byName = (pattern) => assets.find((asset) => pattern.test(asset.name));
  const arm = arch === "arm64";
  const cpu = arm ? "arm64" : "x64";
  const withVariant = (picked) => (picked.main ? { ...picked, variant: variantOf(picked.main.name) } : picked);

  if (platform.IS_MAC) return withVariant({ main: byName(new RegExp(`^llama-b\\d+-bin-macos-${cpu}\\.tar\\.gz$`)) });

  const os_ = platform.IS_WINDOWS ? "win" : "ubuntu";
  const ext = platform.IS_WINDOWS ? "zip" : "tar\\.gz";
  if (vramGB > 0 && nvidia && !arm) {
    for (const major of cuda13 ? ["13", "12"] : ["12"]) {
      const main = byName(new RegExp(`^llama-(b\\d+)-bin-${os_}-cuda-${major}\\.[\\d.]+-x64\\.${ext}$`));
      const [, build, version] = main?.name.match(/^llama-(b\d+)-bin-\w+-cuda-([\d.]+)-x64/) || [];
      // Windows names the runtime without the build number, Linux with it.
      const runtimeNames = platform.IS_WINDOWS
        ? [`cudart-llama-bin-win-cuda-${version}-x64.zip`]
        : [`cudart-llama-${build}-bin-ubuntu-cuda-${version}-x64.tar.gz`];
      const runtime = version && assets.find((asset) => runtimeNames.includes(asset.name));
      if (main && runtime) return withVariant({ main, extra: runtime });
    }
  }

  if (platform.IS_WINDOWS) {
    if (arm) return withVariant({ main: byName(/^llama-b\d+-bin-win-cpu-arm64\.zip$/) });
    const vulkan = byName(/^llama-b\d+-bin-win-vulkan-x64\.zip$/);
    if (vramGB > 0 && vulkan) return withVariant({ main: vulkan });
    return withVariant({ main: byName(/^llama-b\d+-bin-win-cpu-x64\.zip$/) });
  }

  const variant = vramGB > 0 ? "vulkan-" : "";
  return withVariant({ main: byName(new RegExp(`^llama-b\\d+-bin-ubuntu-${variant}${cpu}\\.tar\\.gz$`)) });
}

/** What pickReleaseAssets needs to know about the GPU. */
async function gpuProfile(vramGB) {
  const nvidia = vramGB > 0 && hasNvidiaDriver();
  const info = nvidia ? await platform.nvidiaInfo() : null;
  // Blackwell is compute capability 10.x and 12.x; CUDA 13 needs the 580 driver series.
  const cuda13 = Boolean(info && info.computeCapability >= 10 && info.driverMajor >= 580);
  return { vramGB, nvidia, cuda13 };
}

/** GET that follows redirects but never leaves https or the outbound URL policy. */
function fetchStream(url, headers = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith("https:") || !validateDownloadUrl(url)) {
      return reject(new Error("URL refused by outbound security policy"));
    }
    https
      .get(url, { headers: { "User-Agent": "Draggy", ...headers } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
          return resolve(fetchStream(new URL(res.headers.location, url).href, headers, redirectsLeft - 1));
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

async function fetchJson(url) {
  const res = await fetchStream(url, { Accept: "application/vnd.github+json" });
  let body = "";
  for await (const chunk of res) body += chunk;
  return JSON.parse(body);
}

/** Downloads one asset, reporting bytes into the running total and checking GitHub's published sha256. */
async function downloadAsset(asset, destination, progress) {
  const res = await fetchStream(asset.browser_download_url);
  const hash = crypto.createHash("sha256");
  res.on("data", (chunk) => {
    hash.update(chunk);
    progress.add(chunk.length);
  });
  await pipeline(res, fs.createWriteStream(destination));

  const expected = String(asset.digest || "").replace(/^sha256:/, "");
  if (expected && hash.digest("hex") !== expected) {
    throw new Error(`Checksum mismatch for ${asset.name}`);
  }
}

/** Unpacks with the system tar, which reads zip on Windows 10+ and tar.gz everywhere. */
function extractArchive(archive, destination) {
  const tar = platform.IS_WINDOWS
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    : "tar";
  fs.mkdirSync(destination, { recursive: true });
  return new Promise((resolve, reject) => {
    platform.execFileHidden(tar, ["-xf", archive, "-C", destination], { timeout: 600000 }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

/** Archives sometimes wrap everything in one folder; step into it. */
function unwrap(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.length === 1 && entries[0].isDirectory() ? path.join(dir, entries[0].name) : dir;
}

/** Downloads the engine for this machine from `release`, or from the newest release that has one.
 * Returns the unpacked folder with the release tag and build variant. */
async function downloadEngine(stageDir, vramGB, onProgress, { gpu = null, release: wanted = null } = {}) {
  const profile = gpu || (await gpuProfile(vramGB));
  const pick = (entry) => pickReleaseAssets(entry.assets || [], profile);
  let release = wanted;
  if (!release) {
    const releases = await fetchJson(RELEASES_URL);
    // llama.cpp flags every build a prerelease, so only drafts are skipped.
    release = releases.find((entry) => !entry.draft && pick(entry).main);
  }
  if (!release || !pick(release).main) throw new Error("No llama.cpp release matches this platform");

  const { main, extra, variant } = pick(release);
  const assets = [main, extra].filter(Boolean);
  const total = assets.reduce((sum, asset) => sum + (asset.size || 0), 0);
  log.info("binaryManager", `Downloading engine ${release.tag_name}: ${assets.map((a) => a.name).join(", ")}`);

  let completed = 0;
  let lastEmit = 0;
  const progress = {
    add(bytes) {
      completed += bytes;
      const now = Date.now();
      if (now - lastEmit < 100 && completed < total) return;
      lastEmit = now;
      const percent = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;
      onProgress({ percent, completed, total, phase: "downloading", label: ENGINE_LABEL });
    },
  };

  fs.mkdirSync(stageDir, { recursive: true });
  const workDir = path.join(stageDir, "_work");
  fs.mkdirSync(workDir, { recursive: true });

  const outDir = path.join(stageDir, "engine");
  fs.mkdirSync(outDir, { recursive: true });
  for (const [index, asset] of assets.entries()) {
    const archive = path.join(workDir, asset.name);
    await downloadAsset(asset, archive, progress);
    const unpacked = path.join(workDir, `x${index}`);
    await extractArchive(archive, unpacked);
    fs.cpSync(unwrap(unpacked), outDir, { recursive: true, force: true });
  }
  onProgress({ percent: 100, completed: total, total, phase: "extracting", label: ENGINE_LABEL });
  return { outDir, tag: release.tag_name, variant };
}

let setupInFlight = null;

/** Makes sure the engine and its GPU runner sit inside userData, adopting a local install or downloading one. */
function ensureEngineReady(userDataDir, vramGB = 0, onProgress = () => {}) {
  if (!setupInFlight) {
    setupInFlight = runSetup(userDataDir, vramGB, onProgress).finally(() => {
      setupInFlight = null;
    });
  }
  return setupInFlight;
}

async function runSetup(userDataDir, vramGB, onProgress) {
  const llamaDir = engineDir(userDataDir);
  const ready = (state) => ({ ready: true, binaryPath: state.binaryPath, runnerType: state.runnerType });

  let state = engineState(llamaDir, vramGB);
  if (state.complete) return ready(state);

  const stageDir = `${llamaDir}.staging`;
  fs.rmSync(stageDir, { recursive: true, force: true });
  try {
    let stagedRoot = stageDir;
    let meta = { variant: "adopted", installedAt: new Date().toISOString() };
    const adopted = adoptLocalEngine(llamaDir, stageDir);
    if (adopted) {
      meta.source = adopted;
    } else {
      log.info("binaryManager", "No local engine to adopt, downloading a prebuilt release");
      const downloaded = await downloadEngine(stageDir, vramGB, onProgress);
      stagedRoot = downloaded.outDir;
      meta = { tag: downloaded.tag, variant: downloaded.variant, installedAt: meta.installedAt };
    }
    if (!fs.existsSync(path.join(stagedRoot, serverName()))) throw new Error("Engine files are incomplete");

    writeEngineMeta(stagedRoot, meta);
    installStaged(stagedRoot, llamaDir);
  } catch (err) {
    log.error("binaryManager", `Engine setup failed: ${err.message}`, err);
    // A bare server without a GPU runner still runs, so keep it usable.
    state = engineState(llamaDir, vramGB);
    return state.present ? ready(state) : { ready: false, error: err.message };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  state = engineState(llamaDir, vramGB);
  log.info("binaryManager", `Engine ready in ${llamaDir} (runner: ${state.runnerType})`);
  return ready(state);
}

module.exports = {
  findLlamaBinary,
  recommendedReleaseAsset,
  validateDownloadUrl,
  detectGpuRunner,
  getEngineEnvironment,
  ensureEngineReady,
  pickReleaseAssets,
  engineState,
  engineDir,
  serverName,
  fetchJson,
  downloadEngine,
  installStaged,
  gpuProfile,
  readEngineMeta,
  writeEngineMeta,
  variantOf,
  buildNumber,
  RELEASES_URL,
};
