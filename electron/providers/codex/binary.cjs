/** The pinned Codex app-server, downloaded on first sign-in and checked against digests shipped in the app.
 * A `codex` on PATH is ignored: it is usually an npm shim, and of whatever version the user has. */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const VERSION = "0.157.1";
const RELEASE = `https://github.com/openai/codex/releases/download/rust-v${VERSION}`;

// From the release's own metadata, read on 2026-09-28; Windows x64 was also hashed by hand in the spike.
const ASSETS = {
  "win32-x64": ["x86_64-pc-windows-msvc.exe.zip", "85ca951a6859757fe425407c4afe3ee1c59f3d35f739cdbd3be109393493048c", 79967102],
  "win32-arm64": ["aarch64-pc-windows-msvc.exe.zip", "6c63db9e1b7f8f1395235c818a606e85348fe2c82c52d9eb67926d7adabe2cdb", 73709402],
  "darwin-x64": ["x86_64-apple-darwin.tar.gz", "21bbe629d147e3ef965550a4a248aaab29c21336ec8b21df65177c7c459d2646", 79136797],
  "darwin-arm64": ["aarch64-apple-darwin.tar.gz", "a427487e775e3053feacb9dee699439e36e1dac2fe9516fa5c22e922fcc70d60", 72664357],
  "linux-x64": ["x86_64-unknown-linux-musl.tar.gz", "4bccc8c9f59dbbc473ce602ec9ef332e9e763d04ef4e1a3c206bfb9f132e7234", 83275904],
  "linux-arm64": ["aarch64-unknown-linux-musl.tar.gz", "c9bd7ae2864a11f324eb99dfd6a3260865894739c2014024805baabd0f4659d3", 77526660],
};

function assetFor(platformName = process.platform, arch = process.arch, table = ASSETS) {
  const entry = table[`${platformName}-${arch}`];
  if (!entry) return null;
  const [target, sha256, size] = entry;
  const name = `codex-app-server-${target}`;
  return { name, url: `${RELEASE}/${name}`, sha256, size };
}

const installDir = (appData) => path.join(appData, "codex", "bin", VERSION);

/** The installed executable, or null; the archive holds one file named after the target, whatever the OS. */
function installedBinary(appData) {
  const dir = installDir(appData);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const found = names.find((name) => name.startsWith("codex-app-server") && !/\.(zip|tar\.gz|part)$/.test(name));
  return found ? path.join(dir, found) : null;
}

function downloadRelease(url, file, onBytes) {
  const { downloadAsset } = require("../../binaryManager.cjs");
  return downloadAsset({ browser_download_url: url, name: path.basename(file) }, file, { add: onBytes });
}

function extractRelease(archive, dir) {
  return require("../../binaryManager.cjs").extractArchive(archive, dir);
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Resolves to the executable, downloading and verifying it first if needed. `download(url, file, onBytes)`
 * and `extract(archive, dir)` come from the engine's installer, so both are replaced in tests. */
async function ensureCodex(
  appData,
  { download = downloadRelease, extract = extractRelease, onProgress = () => {}, platformName, arch, assets = ASSETS } = {},
) {
  const existing = installedBinary(appData);
  if (existing) return existing;
  const asset = assetFor(platformName, arch, assets);
  if (!asset) {
    throw Object.assign(new Error(`Codex has no build for ${platformName ?? process.platform} ${arch ?? process.arch}`), {
      code: "account-runtime-unavailable",
    });
  }

  const dir = installDir(appData);
  const staging = `${dir}.part`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const archive = path.join(staging, asset.name);
  let completed = 0;
  await download(asset.url, archive, (bytes) => {
    completed += bytes;
    onProgress({ completed, total: asset.size, percent: Number(((completed / asset.size) * 100).toFixed(1)) });
  });

  // Checked here as well as in the download, so a change there can never let an unchecked binary run.
  const digest = await sha256File(archive);
  if (digest !== asset.sha256) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw Object.assign(new Error(`Checksum mismatch for ${asset.name}`), { code: "account-runtime-unavailable" });
  }
  await extract(archive, staging);
  fs.rmSync(archive, { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(staging, dir);

  const binary = installedBinary(appData);
  if (!binary) throw Object.assign(new Error("The Codex archive held no app-server"), { code: "account-runtime-unavailable" });
  if (process.platform !== "win32") fs.chmodSync(binary, 0o755);
  return binary;
}

module.exports = { VERSION, ASSETS, assetFor, installDir, installedBinary, ensureCodex, sha256File };
