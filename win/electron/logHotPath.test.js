import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = import.meta.dirname;
// Lookups run on every start or request, so a plain INFO line inside one repeats without end (I15).
const LOOKUP = /(?:async\s+)?function\s+((?:find|resolve|locate|detect|lookup)\w*)\s*\(/g;
const LOUD = /\blog\.info\(/;
// Each of these logs once per result or only when its answer changes, so it cannot repeat.
const ONCE_BY_DESIGN = ["cpuTopology.cjs detect", "draftModel.cjs findCompanionDraft", "huggingface.cjs resolveModelDownload"];

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
    return entry.name.endsWith(".cjs") ? [full] : [];
  });
}

/** The text of the function whose parameter list starts at `from`, found by counting braces. */
function bodyAt(text, from) {
  const open = text.indexOf("{", text.indexOf(")", from));
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return { start: open, text: text.slice(open, i + 1) };
  }
  return { start: open, text: text.slice(open) };
}

describe("lookup functions do not log loudly", () => {
  it("uses log.once or DEBUG inside find, resolve, locate, detect and lookup functions", () => {
    const offenders = [];
    for (const file of sources(ROOT)) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(LOOKUP)) {
        const body = bodyAt(text, match.index);
        body.text.split("\n").forEach((line, index) => {
          if (LOUD.test(line) && !ONCE_BY_DESIGN.includes(`${path.basename(file)} ${match[1]}`)) offenders.push(`${path.relative(ROOT, file)}:${text.slice(0, body.start).split("\n").length + index} ${match[1]}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
