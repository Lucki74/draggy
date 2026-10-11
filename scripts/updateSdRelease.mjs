// Pins the image engine to one stable-diffusion.cpp release: rewrites the tag, archive names and hashes in
// electron/sdBinaryManager.cjs. Usage: node scripts/updateSdRelease.mjs master-NNN-abcdef0
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "..", "electron", "sdBinaryManager.cjs");
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
const newline = source.includes("\r\n") ? "\r\n" : "\n";
const oldTag = /const SD_CPP_RELEASE = "([^"]+)";/.exec(source)?.[1];
if (!oldTag) throw new Error("SD_CPP_RELEASE not found");
const oldCommit = oldTag.split("-").pop();
const newCommit = tag.split("-").pop();

// Archive names carry the commit, so the runner table moves with it.
let updated = source.split(oldTag).join(tag).split(`sd-master-${oldCommit}-`).join(`sd-master-${newCommit}-`);

const runnerBlock = /const RUNNER_ASSETS = \{[\s\S]*?\n\};/.exec(updated)?.[0] ?? "";
const needed = [...runnerBlock.matchAll(/"((?:sd-master|cudart)[^"]+\.zip)"/g)].map((match) => match[1]);

const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
const missing = needed.filter((name) => !assets.has(name));
if (missing.length > 0) {
  console.error(`The release has no ${missing.join(", ")}. Check the archive names in RUNNER_ASSETS by hand.`);
  process.exit(1);
}

const rows = [...new Set(needed)].sort().map((name) => {
  const asset = assets.get(name);
  const sha256 = String(asset.digest || "").replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${name} has no published sha256; download it and hash it by hand`);
  return `  "${name}": { sha256: "${sha256}", size: ${asset.size} },`;
});

updated = updated.replace(/const SD_CPP_ASSETS = \{[\s\S]*?\n\};/, `const SD_CPP_ASSETS = {${newline}${rows.join(newline)}${newline}};`);
fs.writeFileSync(target, updated);
console.log(`Pinned ${tag}: ${rows.length} archives. Run npm run check, then test an install on each runner you can.`);
