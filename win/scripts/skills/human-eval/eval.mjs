// Scores the human-eval corpus with the human skill's metrics script and prints a table.
// Usage: node scripts/skills/human-eval/eval.mjs [--json] [extra-dir ...]
// Each extra dir holds .txt files that are scored as a third group named after the folder.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { measure } = createRequire(import.meta.url)(path.resolve(here, "../../../electron/skills-library/human/metrics.cjs"));
const KEYS = ["lenCV", "shareNearMean", "ttr100", "repeatedOpeners", "paraShapes", "tellHitsPer1000"];

function load(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort().map((f) => ({ file: f, ...measure(fs.readFileSync(path.join(dir, f), "utf8")) }));
}
const mean = (rows, k) => (rows.length ? rows.reduce((a, r) => a + r[k], 0) / rows.length : NaN);
// Chance that a random text from `a` scores higher than one from `b` (0.5 = no separation).
function auc(a, b, k) {
  let win = 0;
  for (const x of a) for (const y of b) win += x[k] > y[k] ? 1 : x[k] === y[k] ? 0.5 : 0;
  return a.length && b.length ? win / (a.length * b.length) : NaN;
}

const args = process.argv.slice(2);
const groups = { human: load(path.join(here, "corpus/human")), ai: load(path.join(here, "corpus/ai")) };
for (const d of args.filter((a) => !a.startsWith("--"))) groups[path.basename(path.resolve(d))] = load(path.resolve(d));

const report = { counts: {}, means: {}, humanAboveAi: {} };
for (const [g, rows] of Object.entries(groups)) {
  report.counts[g] = rows.length;
  report.means[g] = Object.fromEntries(KEYS.map((k) => [k, Math.round(mean(rows, k) * 100) / 100]));
}
for (const k of KEYS) report.humanAboveAi[k] = Math.round(auc(groups.human, groups.ai, k) * 100) / 100;

if (args.includes("--json")) console.log(JSON.stringify(report, null, 1));
else {
  console.log("group".padEnd(14) + "n".padStart(4) + KEYS.map((k) => k.padStart(17)).join(""));
  for (const g of Object.keys(groups)) console.log(g.padEnd(14) + String(report.counts[g]).padStart(4) + KEYS.map((k) => String(report.means[g][k]).padStart(17)).join(""));
  console.log("human>ai".padEnd(18) + KEYS.map((k) => String(report.humanAboveAi[k]).padStart(17)).join(""));
  console.log("human>ai is the chance a random human text scores higher than a random AI text (0.5 means the metric does not separate them).");
}
