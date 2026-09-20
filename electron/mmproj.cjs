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

/** The projector that sits beside this model, or null when it cannot read images. */
function findCompanion(modelsDir, filename) {
  const candidate = path.join(modelsDir, companionName(filename));
  return fs.existsSync(candidate) ? candidate : null;
}

module.exports = { companionName, isCompanionFile, findCompanion };
