// Writes the release update feeds for the macOS and Linux jobs.
//   tauri <out.json> <version> <base url> <platform-key=file>...   Tauri updater feed; reads each <file>.sig, notes from $NOTES
//   yml <out.yml> <version> <file>...                              electron-updater bridge feed; the first file is `path`
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [mode, out, version, ...rest] = process.argv.slice(2);
if (!out || !version) throw new Error("usage: release-feeds.mjs tauri|yml <out> <version> ...");

if (mode === "tauri") {
  const [base, ...entries] = rest;
  const platforms = {};
  for (const entry of entries) {
    const [key, file] = entry.split("=");
    platforms[key] = {
      signature: readFileSync(`${file}.sig`, "utf8").trim(),
      url: `${base}/${basename(file)}`,
    };
  }
  const feed = { version, notes: process.env.NOTES ?? "", pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), platforms };
  writeFileSync(out, `${JSON.stringify(feed, null, 2)}\n`);
} else if (mode === "yml") {
  const files = rest.map((file) => ({
    url: basename(file),
    sha512: createHash("sha512").update(readFileSync(file)).digest("base64"),
    size: statSync(file).size,
  }));
  const lines = [`version: ${version}`, "files:"];
  for (const file of files) lines.push(`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`);
  lines.push(`path: ${files[0].url}`, `sha512: ${files[0].sha512}`, `releaseDate: '${new Date().toISOString()}'`);
  writeFileSync(out, `${lines.join("\n")}\n`);
} else {
  throw new Error(`unknown mode ${mode}`);
}
