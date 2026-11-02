/** Re-judges stored replies after a change to checks.mjs: node scripts/prompt-bench/rescore.mjs <run dir> */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "./checks.mjs";
import { summarize } from "./summary.mjs";

const dir = path.resolve(process.argv[2]);
const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
const cases = Object.fromEntries(["en", "fr", "es", "ru"].map((l) => [l, Object.fromEntries(JSON.parse(fs.readFileSync(path.join(here, `corpus.${l}.json`), "utf8")).map((c) => [c.id, c]))]));
// Only language checks are re-run; clock and date checks depend on the time of the original run.
for (const r of data.records) {
  if (r.error) continue;
  const spec = cases[r.lang][r.id].checks.find((c) => c.type === "sameLanguage");
  if (!spec) continue;
  const result = runCheck(spec, { reply: r.reply, lang: r.lang });
  r.wrongLanguage = !result.pass;
  r.failed = (r.failed ?? []).filter((t) => t !== "sameLanguage");
  if (!result.pass) r.failed.push("sameLanguage");
  r.pass = r.failed.length === 0;
}
fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(data, null, 1));
fs.writeFileSync(path.join(dir, "summary.md"), summarize(data.records, data.meta));
console.log("rescored", dir);
