const fs = require("node:fs");
const path = require("node:path");
const { parseShard } = require("./shards.cjs");

const SUFFIX = "-mmproj.gguf";

/** Where a vision model's projector lives: beside it, named after it, so two repositories that both
 * ship `mmproj-F16.gguf` never overwrite each other. A split model's part counter is left out. */
function companionName(filename) {
  const base = path.basename(String(filename));
  const shard = parseShard(base);
  return `${shard ? shard.stem : base.replace(/\.gguf$/i, "")}${SUFFIX}`;
}

/** Projectors are read through their model, so they are never listed as models of their own. */
function isCompanionFile(name) {
  return /mmproj/i.test(String(name));
}

/** Projectors the engine has refused this session. Keyed by size and modification time as well as path,
 * so downloading the file again gets it another try. */
const refused = new Set();

function stampOf(file) {
  try {
    const stat = fs.statSync(file);
    return `${file}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    return file;
  }
}

/** Remembers that the engine could not load this projector, so the model stops claiming to read images. */
function markRefused(file) {
  refused.add(stampOf(file));
}

/** The projector that sits beside this model, or null when it cannot read images. */
function findCompanion(modelsDir, filename) {
  const candidate = path.join(modelsDir, companionName(filename));
  return fs.existsSync(candidate) && !refused.has(stampOf(candidate)) ? candidate : null;
}

/** Whether this model has a projector the engine already turned down. */
function wasRefused(modelsDir, filename) {
  const candidate = path.join(modelsDir, companionName(filename));
  return fs.existsSync(candidate) && refused.has(stampOf(candidate));
}

module.exports = { companionName, isCompanionFile, findCompanion, markRefused, wasRefused };
