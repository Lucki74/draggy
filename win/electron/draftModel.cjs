const fs = require("node:fs");
const path = require("node:path");
const { parseShard } = require("./shards.cjs");
const { log } = require("./logger.cjs");

const SUFFIX = "-draft.gguf";

/** Where a model's companion draft lives: beside it, named after it, so two repositories that both
 * ship a draft model never overwrite each other. A split model's part counter is left out. */
function draftCompanionName(filename) {
  const base = path.basename(String(filename));
  const shard = parseShard(base);
  return `${shard ? shard.stem : base.replace(/\.gguf$/i, "")}${SUFFIX}`;
}

/** Draft files are read through their parent model, so they are never listed as models of their own. */
function isCompanionDraft(name) {
  return /-draft\.gguf$/i.test(String(name));
}

/** Draft models the engine has refused this session. Keyed by size and modification time as well as path,
 * so downloading the file again gets it another try. */
const refused = new Set();

/** Model path to the draft it is running with now, so a log line marks the change and not every lookup. */
const chosen = new Map();

function stampOf(file) {
  try {
    const stat = fs.statSync(file);
    return `${file}|${stat.size}|${stat.mtimeMs}`;
  } catch {
    return file;
  }
}

/** Remembers that the engine could not load this draft model, so the model falls back without it. */
function markRefused(file) {
  refused.add(stampOf(file));
  for (const [key, draft] of chosen) {
    if (draft !== file) continue;
    chosen.delete(key);
    log.info("engine.draft", "draft marked refused", { model: path.basename(key) });
    return;
  }
  log.info("engine.draft", "draft marked refused", { draft: path.basename(file) });
}

/** The companion draft that sits beside this model, or null when absent or refused. Logs only when the choice changes. */
function findCompanionDraft(modelsDir, filename) {
  const candidate = path.join(modelsDir, draftCompanionName(filename));
  const draft = fs.existsSync(candidate) && !refused.has(stampOf(candidate)) ? candidate : null;
  const key = path.join(modelsDir, String(filename));
  const previous = chosen.get(key) ?? null;
  if (draft !== previous) {
    if (draft) chosen.set(key, draft);
    else chosen.delete(key);
    log.info("engine.draft", draft ? "draft chosen" : "draft cleared", { model: path.basename(key) });
  }
  return draft;
}

/** Whether this model has a companion draft the engine already turned down. */
function wasRefused(modelsDir, filename) {
  const candidate = path.join(modelsDir, draftCompanionName(filename));
  return fs.existsSync(candidate) && refused.has(stampOf(candidate));
}

function resetForTests() {
  refused.clear();
  chosen.clear();
}

module.exports = {
  draftCompanionName,
  isCompanionDraft,
  findCompanionDraft,
  markRefused,
  wasRefused,
  resetForTests,
};
