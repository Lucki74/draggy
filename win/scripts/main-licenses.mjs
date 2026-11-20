/** Writes the licenses of the production dependencies the main process ships. The renderer's own
 * bundle is covered by the license plugin in vite.config.ts. */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "license-checker-rseidelsohn";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "THIRD-PARTY-LICENSES-main.txt");

const found = await new Promise((resolve, reject) => {
  init({ start: ROOT, production: true, excludePrivatePackages: true }, (err, json) => (err ? reject(err) : resolve(json)));
});

const own = new RegExp(`^draggy@`);
const npmBlocks = Object.entries(found)
  .filter(([name]) => !own.test(name))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, info]) => {
    const lines = [name, `License: ${info.licenses}`];
    if (info.repository) lines.push(`Source: ${info.repository}`);
    if (info.publisher) lines.push(`Publisher: ${info.publisher}`);
    return lines.join("\n");
  });

// Bundled binaries that npm does not describe, listed by hand.
const handListed = [
  {
    name: "FFmpeg",
    license: "LGPL-2.1-or-later",
    url: "https://ffmpeg.org/legal.html",
    note: "Ships as the ffmpeg/ffprobe sidecars (ffmpeg.exe and ffprobe.exe)",
  },
];
const extraBlocks = handListed.map(({ name, license, url, note }) =>
  [name, `License: ${license}`, `Source: ${url}`, `Note: ${note}`].join("\n"),
);
const blocks = [...npmBlocks, ...extraBlocks];

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `Production dependencies of the Draggy main process\n\n${blocks.join("\n\n")}\n`);
console.log(`${blocks.length} packages written to ${path.relative(ROOT, OUT)}`);
