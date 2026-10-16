"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const platform = require("./platform.cjs");
const binaryManager = require("./binaryManager.cjs");
const { log } = require("./logger.cjs");

const RELEASES_URL = "https://api.github.com/repos/JustVugg/colibri/releases?per_page=5";
const ENGINE_LABEL = "colibri";
const PREVIOUS_KEPT = 1;

/** The Windows embeddable Python (PSF license). Pinned: its hash is checked before it is ever run. */
const PYTHON = {
  version: "3.12.10",
  url: "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
  sha256: "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3",
  pth: "python312._pth",
};

/** Hosts a download may come from, on top of urlPolicy's own checks (https only, no private ranges). */
const ALLOWED_HOSTS = [/^github\.com$/, /^api\.github\.com$/, /(^|\.)githubusercontent\.com$/, /^www\.python\.org$/];

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.some((pattern) => pattern.test(parsed.hostname)) && binaryManager.validateDownloadUrl(url);
  } catch {
    return false;
  }
}

function colibriRoot(userDataDir) {
  return path.join(userDataDir, "colibri");
}

function versionDir(userDataDir, tag) {
  return path.join(colibriRoot(userDataDir), tag);
}

function pythonDir(userDataDir) {
  return path.join(colibriRoot(userDataDir), "python", PYTHON.version);
}

/** `sha256sum` output: "<hex>  <name>" per line, the name optionally starting with `*`. */
function parseSha256Sums(text) {
  const sums = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match) sums[match[2]] = match[1].toLowerCase();
  }
  return sums;
}

/** The release archive for this machine, the CUDA drop-in when the card can use it, and the checksum list. */
function pickColibriAssets(assets, { platformName = process.platform, arch = os.arch(), cudaCapable = false } = {}) {
  const find = (pattern) => assets.find((asset) => pattern.test(asset.name));
  const sums = find(/^SHA256SUMS\.txt$/i);
  let main = null;
  let cuda = null;
  if (platformName === "win32" && arch === "x64") {
    main = find(/windows-x86_64\.zip$/);
    cuda = cudaCapable ? find(/windows-x86_64-cuda\.zip$/) : null;
  }
  return { main, cuda, sums, variant: cuda ? "cuda" : "vulkan" };
}

/** `nvidia-smi --query-gpu=compute_cap`: "8.9" per GPU. The CUDA build needs 8.0 or newer. */
function parseComputeCapability(text) {
  const caps = String(text || "")
    .split(/\r?\n/)
    .map((line) => Number.parseFloat(line.trim()))
    .filter(Number.isFinite);
  return caps.length ? Math.max(...caps) : 0;
}

function detectCudaCapable({ exec = platform.execFileHidden } = {}) {
  return new Promise((resolve) => {
    exec("nvidia-smi", ["--query-gpu=compute_cap", "--format=csv,noheader"], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      const capable = !error && parseComputeCapability(stdout) >= 8;
      log.debug("engine.colibri", "cuda probe", { found: !error, capable, error: error ? error.code ?? error.name : null });
      resolve(capable);
    });
  });
}

function stateFile(userDataDir) {
  return path.join(colibriRoot(userDataDir), "state.json");
}

function readState(userDataDir) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(userDataDir), "utf8"));
    return { current: state.current || null, previous: state.previous || null, variant: state.variant || null };
  } catch {
    return { current: null, previous: null, variant: null };
  }
}

function writeState(userDataDir, state) {
  fs.mkdirSync(colibriRoot(userDataDir), { recursive: true });
  fs.writeFileSync(stateFile(userDataDir), JSON.stringify(state, null, 2));
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

/** Downloads `url` to `destination` and refuses it unless its SHA-256 equals `expected`. */
async function downloadVerified(url, destination, expected, { onBytes = () => {}, fetchStream = binaryManager.fetchStream } = {}) {
  if (!isAllowedUrl(url)) throw new Error("URL refused by outbound security policy");
  if (!/^[0-9a-f]{64}$/i.test(expected || "")) throw new Error("No checksum to verify against");
  const res = await fetchStream(url);
  const hash = crypto.createHash("sha256");
  res.on("data", (chunk) => {
    hash.update(chunk);
    onBytes(chunk.length);
  });
  await pipeline(res, fs.createWriteStream(destination));
  if (hash.digest("hex") !== expected.toLowerCase()) {
    fs.rmSync(destination, { force: true });
    log.error("engine.colibri", "checksum mismatch", { file: path.basename(destination) });
    throw new Error(`Checksum mismatch for ${path.basename(destination)}`);
  }
  log.info("engine.colibri", "checksum verified", { file: path.basename(destination), host: new URL(url).host });
}

async function readText(url, { fetchStream = binaryManager.fetchStream } = {}) {
  if (!isAllowedUrl(url)) throw new Error("URL refused by outbound security policy");
  const res = await fetchStream(url);
  let body = "";
  for await (const chunk of res) body += chunk;
  return body;
}

function progressReporter(total, onProgress) {
  let completed = 0;
  let last = 0;
  return (bytes) => {
    completed += bytes;
    const now = Date.now();
    if (now - last < 100 && completed < total) return;
    last = now;
    onProgress({ percent: total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0, completed, total, phase: "downloading", label: ENGINE_LABEL });
  };
}

function unwrap(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.length === 1 && entries[0].isDirectory() ? path.join(dir, entries[0].name) : dir;
}

/** The engines, the gateway script and the license sit in the version folder; the Python runtime elsewhere. */
function gatewayScript(dir) {
  return path.join(dir, "openai_server.py");
}

function isInstalled(userDataDir, tag) {
  const dir = versionDir(userDataDir, tag);
  return fs.existsSync(gatewayScript(dir));
}

/**
 * Installs a colibri release: download, verify against SHA256SUMS, stage, then swap into place. The
 * old version stays as `previous` for rollback; anything older goes. A failure leaves what ran before.
 */
/** A virus scanner holds a freshly written folder for a moment on Windows; the rename succeeds once it lets go. */
async function renameWithRetry(from, to, attempts = 6) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= attempts || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

async function installColibri(userDataDir, { onProgress = () => {}, release: wanted = null, cudaCapable = null, deps = {} } = {}) {
  const {
    fetchJson = binaryManager.fetchJson,
    fetchStream = binaryManager.fetchStream,
    extract = binaryManager.extractArchive,
    platformName = process.platform,
    arch = os.arch(),
  } = deps;
  const cuda = cudaCapable ?? (await detectCudaCapable());
  let release = wanted;
  if (!release) {
    const releases = await fetchJson(RELEASES_URL);
    release = releases.find((entry) => !entry.draft && !entry.prerelease && pickColibriAssets(entry.assets || [], { platformName, arch, cudaCapable: cuda }).main);
  }
  const picked = release ? pickColibriAssets(release.assets || [], { platformName, arch, cudaCapable: cuda }) : null;
  if (!picked?.main) throw new Error("No colibri release matches this platform");
  if (!picked.sums) throw new Error("The colibri release has no SHA256SUMS.txt");
  const tag = release.tag_name;
  if (!/^[\w.+-]+$/.test(tag)) throw new Error("Unexpected colibri release tag");

  const sums = parseSha256Sums(await readText(picked.sums.browser_download_url, { fetchStream }));
  const assets = [picked.main, picked.cuda].filter(Boolean);
  for (const asset of assets) if (!sums[asset.name]) throw new Error(`SHA256SUMS.txt has no entry for ${asset.name}`);

  const root = colibriRoot(userDataDir);
  const stageDir = path.join(root, `.stage-${tag}`);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  const outDir = path.join(stageDir, "engine");
  fs.mkdirSync(outDir, { recursive: true });

  try {
    const bytes = progressReporter(assets.reduce((sum, asset) => sum + (asset.size || 0), 0), onProgress);
    for (const [index, asset] of assets.entries()) {
      const archive = path.join(stageDir, asset.name);
      await downloadVerified(asset.browser_download_url, archive, sums[asset.name], { onBytes: bytes, fetchStream });
      const unpacked = path.join(stageDir, `x${index}`);
      await extract(archive, unpacked);
      fs.cpSync(unwrap(unpacked), outDir, { recursive: true, force: true });
    }
    if (!fs.existsSync(gatewayScript(outDir))) throw new Error("The colibri archive has no openai_server.py");
    fs.writeFileSync(path.join(outDir, "draggy-install.json"), JSON.stringify({ tag, variant: picked.variant, installedAt: Date.now() }, null, 2));
    onProgress({ percent: 100, phase: "installing", label: ENGINE_LABEL });

    const target = versionDir(userDataDir, tag);
    fs.rmSync(target, { recursive: true, force: true });
    await renameWithRetry(outDir, target);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  const before = readState(userDataDir);
  const previous = before.current && before.current !== tag ? before.current : before.previous;
  writeState(userDataDir, { current: tag, previous: previous && previous !== tag ? previous : null, variant: picked.variant });
  prune(userDataDir);
  log.info("colibriBinary", `Installed colibri ${tag} (${picked.variant})`);
  return { tag, variant: picked.variant, dir: versionDir(userDataDir, tag) };
}

/** Removes every version folder except the current one and the rollback target. */
function prune(userDataDir) {
  const { current, previous } = readState(userDataDir);
  const keep = new Set([current, previous].filter(Boolean).slice(0, 1 + PREVIOUS_KEPT));
  let entries;
  try {
    entries = fs.readdirSync(colibriRoot(userDataDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "python" || entry.name.startsWith(".stage-") || keep.has(entry.name)) continue;
    fs.rmSync(path.join(colibriRoot(userDataDir), entry.name), { recursive: true, force: true });
  }
}

/** Goes back to the previous version. Returns the tag now current, or null when there is nothing to go back to. */
function rollback(userDataDir) {
  const { current, previous, variant } = readState(userDataDir);
  if (!previous || !isInstalled(userDataDir, previous)) return null;
  writeState(userDataDir, { current: previous, previous: current, variant });
  return previous;
}

/**
 * Downloads the embeddable Python, checks it against the pinned hash and unpacks it. The ._pth file
 * confines the interpreter to its own folder, so it is rewritten to include the colibri folder, whose
 * gateway imports its sibling modules.
 */
async function ensurePython(userDataDir, { onProgress = () => {}, deps = {} } = {}) {
  const { fetchStream = binaryManager.fetchStream, extract = binaryManager.extractArchive } = deps;
  const dir = pythonDir(userDataDir);
  const exe = path.join(dir, "python.exe");
  if (fs.existsSync(exe)) return dir;
  const root = path.dirname(dir);
  fs.mkdirSync(root, { recursive: true });
  const stage = path.join(root, `.stage-${PYTHON.version}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  try {
    const archive = path.join(stage, "python-embed.zip");
    await downloadVerified(PYTHON.url, archive, PYTHON.sha256, { onBytes: progressReporter(11.1e6, onProgress), fetchStream });
    const unpacked = path.join(stage, "x");
    await extract(archive, unpacked);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(unpacked, dir);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return dir;
}

/** Points the embedded interpreter at the colibri folder, which holds the gateway and its sibling modules. */
function writePythonPath(pyDir, colibriDir) {
  const lines = ["python312.zip", ".", colibriDir];
  fs.writeFileSync(path.join(pyDir, PYTHON.pth), `${lines.join("\r\n")}\r\n`);
}

/** What the process module needs to start the gateway, or null when something is missing. */
function runtime(userDataDir) {
  const { current, variant } = readState(userDataDir);
  if (!current || !isInstalled(userDataDir, current)) return null;
  const dir = versionDir(userDataDir, current);
  const py = pythonDir(userDataDir);
  const python = platform.IS_WINDOWS ? path.join(py, "python.exe") : "python3";
  if (platform.IS_WINDOWS && !fs.existsSync(python)) return null;
  return { tag: current, variant, dir, python, pythonDir: platform.IS_WINDOWS ? py : null, script: gatewayScript(dir) };
}

/** Everything is in place and the Python path file names this version's folder. */
function prepareRuntime(userDataDir) {
  const found = runtime(userDataDir);
  if (found?.pythonDir) writePythonPath(found.pythonDir, found.dir);
  return found;
}

module.exports = {
  PYTHON,
  RELEASES_URL,
  isAllowedUrl,
  parseSha256Sums,
  pickColibriAssets,
  parseComputeCapability,
  detectCudaCapable,
  readState,
  installColibri,
  rollback,
  prune,
  ensurePython,
  writePythonPath,
  runtime,
  prepareRuntime,
  isInstalled,
  sha256File,
  versionDir,
  pythonDir,
};
