/** The pinned Claude Code binary, downloaded on first sign-in since its licence grants no redistribution, and
 * checked against digests shipped in the app rather than the release's own manifest (claude/MODE.md §2). */
const fs = require("node:fs");
const path = require("node:path");
const { sha256File } = require("../codex/binary.cjs");
const { log } = require("../../logger.cjs");

// The model list is built into the binary: 2.1.274 still named Opus 5, so a new model needs a new pin.
const VERSION = "2.1.284";
const RELEASE = `https://downloads.claude.ai/claude-code-releases/${VERSION}`;

// From the release's manifest.json, read on 2026-09-29; Windows x64 was also hashed by hand.
const ASSETS = {
  "win32-x64": ["0416631e846f743110da5282409776fa1313e65f33a588aae066eaf8db0fda7d", 246480032],
  "win32-arm64": ["8a968e1500576eea43d04d7cffd40cf39b1c83e5b443522bafe0e92e50d6a389", 234005152],
};

function assetFor(platformName = process.platform, arch = process.arch, table = ASSETS) {
  const target = `${platformName}-${arch}`;
  const entry = table[target];
  if (!entry) return null;
  const [sha256, size] = entry;
  const name = platformName === "win32" ? "claude.exe" : "claude";
  return { name, url: `${RELEASE}/${target}/${name}`, sha256, size };
}

const installDir = (appData) => path.join(appData, "claude", "bin", VERSION);

function installedBinary(appData) {
  for (const name of ["claude.exe", "claude"]) {
    const file = path.join(installDir(appData), name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** An earlier pin's binary, still able to say who is signed in until the new one has downloaded. */
function previousBinary(appData) {
  const bin = path.join(appData, "claude", "bin");
  let dirs;
  try {
    dirs = fs.readdirSync(bin).filter((name) => name !== VERSION && !name.endsWith(".part"));
  } catch {
    return null;
  }
  for (const dir of dirs) {
    for (const name of ["claude.exe", "claude"]) {
      const file = path.join(bin, dir, name);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

function downloadRelease(url, file, onBytes) {
  const { downloadAsset } = require("../../binaryManager.cjs");
  return downloadAsset({ browser_download_url: url, name: path.basename(file) }, file, { add: onBytes });
}

const installing = new Map();

/** Resolves to the executable, downloading and verifying it first if needed; `download` is replaced in tests.
 * Callers at once share one download: a listing and a sign-in would otherwise empty each other's staging folder. */
function ensureClaude(appData, options = {}) {
  const existing = installedBinary(appData);
  if (existing) return Promise.resolve(existing);
  if (!installing.has(appData)) {
    installing.set(appData, install(appData, options).finally(() => installing.delete(appData)));
  }
  return installing.get(appData);
}

async function install(appData, { download = downloadRelease, onProgress = () => {}, platformName, arch, assets = ASSETS } = {}) {
  const asset = assetFor(platformName, arch, assets);
  if (!asset) {
    throw Object.assign(new Error(`Claude Code has no build for ${platformName ?? process.platform} ${arch ?? process.arch}`), {
      code: "account-runtime-unavailable",
    });
  }

  const dir = installDir(appData);
  const staging = `${dir}.part`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const file = path.join(staging, asset.name);
  let completed = 0;
  await download(asset.url, file, (bytes) => {
    completed += bytes;
    onProgress({ completed, total: asset.size, percent: Number(((completed / asset.size) * 100).toFixed(1)) });
  });

  if ((await sha256File(file)) !== asset.sha256) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw Object.assign(new Error(`Checksum mismatch for ${asset.name}`), { code: "account-runtime-unavailable" });
  }
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(staging, dir);
  // Each pin is over 200 MB; the one it replaces is never run again. One still running is locked on Windows.
  for (const old of fs.readdirSync(path.dirname(dir))) {
    if (old === VERSION) continue;
    try {
      fs.rmSync(path.join(path.dirname(dir), old), { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {
      log.swallow("providers", error, "left for the next pin's install to remove");
    }
  }
  return installedBinary(appData);
}

module.exports = { VERSION, ASSETS, assetFor, installDir, installedBinary, previousBinary, ensureClaude };
