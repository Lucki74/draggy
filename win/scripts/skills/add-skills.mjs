// Merges a category spec into library.json: node scripts/skills/add-skills.mjs specs/<category>.json
// The spec is {"category": "...", "skills": [{id, job, triggers, gotchas, tools, surface, tags}]}.
// Existing ids keep their entry. New ids are added off by default with summary = spec.summary.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.resolve(here, "../../electron/skills-library/library.json");
const specPath = path.resolve(process.argv[2] ?? "");
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const raw = fs.readFileSync(libPath, "utf8");
const crlf = raw.includes("\r\n");
const lib = JSON.parse(raw);
if (!lib.categories.includes(spec.category)) throw new Error(`unknown category ${spec.category}`);
const have = new Set(lib.skills.map((s) => s.id));
let added = 0;
for (const s of spec.skills) {
  if (have.has(s.id)) continue;
  lib.skills.push({ id: s.id, category: spec.category, surface: s.surface ?? "both", on: false, summary: s.summary, tags: s.tags });
  added += 1;
}
lib.skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
let out = JSON.stringify(lib, null, 2) + "\n";
if (crlf) out = out.replace(/\n/g, "\r\n");
fs.writeFileSync(libPath, out);
console.log(`${spec.category}: ${added} added, ${lib.skills.length} total`);
