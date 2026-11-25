// Pins the image engine's Windows archives to one stable-diffusion.cpp release: rewrites the tag, archive
// names, hashes and sizes in core/crates/engine/src/sd_runner.rs. Usage: node scripts/updateSdRelease.mjs master-NNN-abcdef0
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "..", "..", "core", "crates", "engine", "src", "sd_runner.rs");
const tag = process.argv[2];

if (!/^master-\d+-[0-9a-f]{7}$/.test(tag || "")) {
  console.error("Give the release tag, for example: node scripts/updateSdRelease.mjs master-898-2bb7294");
  process.exit(1);
}

const response = await fetch(`https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/tags/${tag}`, {
  headers: { Accept: "application/vnd.github+json", "User-Agent": "Draggy release pinning" },
});
if (!response.ok) {
  console.error(`GitHub answered ${response.status} for ${tag}`);
  process.exit(1);
}
const release = await response.json();

const source = fs.readFileSync(target, "utf8");
const oldTag = /pub const WINDOWS_RELEASE: &str = "([^"]+)";/.exec(source)?.[1];
if (!oldTag) throw new Error("WINDOWS_RELEASE not found");
const oldCommit = oldTag.split("-").pop();
const newCommit = tag.split("-").pop();

// Archive names carry the commit, so the Windows table moves with it.
let updated = source
  .replace(`pub const WINDOWS_RELEASE: &str = "${oldTag}";`, `pub const WINDOWS_RELEASE: &str = "${tag}";`)
  .split(`sd-master-${oldCommit}-bin-win-`).join(`sd-master-${newCommit}-bin-win-`);

const needed = [...new Set([...updated.matchAll(/"((?:sd-master|cudart-sd)[^"]*-win-[^"]+\.zip)"/g)].map((match) => match[1]))].sort();
const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
const missing = needed.filter((name) => !assets.has(name));
if (missing.length > 0) {
  console.error(`The release has no ${missing.join(", ")}. Check the Windows archive names in sd_runner.rs by hand.`);
  process.exit(1);
}

for (const name of needed) {
  const asset = assets.get(name);
  const sha256 = String(asset.digest || "").replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${name} has no published sha256; download it and hash it by hand`);
  // Each archive(name, sha256, size) call lists its hash and size on the lines after its name.
  const entry = new RegExp(`("${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*)"[0-9a-f]{64}",(\\s*)[0-9_]+`);
  if (!entry.test(updated)) throw new Error(`${name} has no archive entry in sd_runner.rs`);
  updated = updated.replace(entry, (_, head, gap) => `${head}"${sha256}",${gap}${asset.size.toLocaleString("en-US").replace(/,/g, "_")}`);
}

fs.writeFileSync(target, updated);
console.log(`Pinned ${tag}: ${needed.length} Windows archives. Run the core tests, then test an install on each runner you can.`);
