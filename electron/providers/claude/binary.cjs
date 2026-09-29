/** The pinned Claude Code binary, downloaded on first sign-in since its licence grants no redistribution, and
 * checked against digests shipped in the app rather than the release's own manifest (claude/MODE.md §2). */
const fs = require("node:fs");
const path = require("node:path");
const { sha256File } = require("../codex/binary.cjs");

const VERSION = "2.1.274";
const RELEASE = `https://downloads.claude.ai/claude-code-releases/${VERSION}`;

// From the release's manifest.json, read on 2026-09-29; Windows x64 was also hashed by hand in the spike.
const ASSETS = {
  "win32-x64": ["4e4c1746aff835bb05e5ed14cda72d21ee6fbda4147aa99b3135718614da117e", 233691808],
  "win32-arm64": ["da93e462c34ec86efee80c70ac791d3232ed98bd44c6abbafb1b5ffa2a9185c4", 224916128],
  "darwin-x64": ["b18e8c9d7666d8987a174ac65e0019f4ba6befa73d2f75c05cbe92e5093431eb", 222955360],
  "darwin-arm64": ["3509913f9d1576316c8845b88837f8fd3bbbcf26625833ac82cfb6b8985da94a", 214149552],
  "linux-x64": ["15e2d05148f801b5774032faad87e624ecd172e9903288bda448b892eb58fa07", 230580536],
  "linux-arm64": ["2db904daea17addff9de557ba26a725916888aa7b546e2c5dd989c20d9d49ab3", 230482160],
  "linux-x64-musl": ["9f64fb9e79752c676234087573f05a794e2a8fbd49c91482c6567be258752e15", 224501720],
  "linux-arm64-musl": ["5d50bd99667904879d95142dbd604b24d0273c13fb79f3abc2346cb00048049f", 223098528],
};

// A glibc build does not start on musl (Alpine and the like), which reports no glibc version.
const isMusl = () => process.platform === "linux" && !process.report?.getReport?.().header?.glibcVersionRuntime;

function assetFor(platformName = process.platform, arch = process.arch, table = ASSETS, musl = isMusl()) {
  const target = `${platformName}-${arch}${platformName === "linux" && musl ? "-musl" : ""}`;
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

function downloadRelease(url, file, onBytes) {
  const { downloadAsset } = require("../../binaryManager.cjs");
  return downloadAsset({ browser_download_url: url, name: path.basename(file) }, file, { add: onBytes });
}

/** Resolves to the executable, downloading and verifying it first if needed; `download` is replaced in tests. */
async function ensureClaude(appData, { download = downloadRelease, onProgress = () => {}, platformName, arch, assets = ASSETS, musl } = {}) {
  const existing = installedBinary(appData);
  if (existing) return existing;
  const asset = assetFor(platformName, arch, assets, musl);
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
  return installedBinary(appData);
}

module.exports = { VERSION, ASSETS, assetFor, installDir, installedBinary, ensureClaude };
