#!/usr/bin/env node
/** Counts catch blocks that swallow an error without a word: empty, or only a comment, and
 * `.catch(() => {})`. `node scripts/silentCatches.cjs` lists them per file. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ROOTS = ["electron", "src"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", "dist", "fixtures"]);

const BLOCK = /catch\s*(?:\([^)]*\))?\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/g;
const PROMISE = /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:\{(?:\s|\/\/[^\n]*)*\}|undefined|null|void 0)\s*\)/g;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(full);
    const wanted = /\.(cjs|js|mjs|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) && !entry.name.endsWith(".d.ts");
    return wanted ? [full] : [];
  });
}

/** `{ "electron/main.cjs": 12, ... }`, only files with at least one. */
function countSilentCatches(root = ROOT) {
  const counts = {};
  for (const base of ROOTS) {
    const dir = path.join(root, base);
    if (!fs.existsSync(dir)) continue;
    for (const file of sourceFiles(dir)) {
      const text = fs.readFileSync(file, "utf8");
      const n = (text.match(BLOCK) || []).length + (text.match(PROMISE) || []).length;
      if (n) counts[path.relative(root, file).split(path.sep).join("/")] = n;
    }
  }
  return counts;
}

module.exports = { countSilentCatches };

if (require.main === module) {
  const counts = countSilentCatches();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(total);
  for (const [file, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(n, file);
}
