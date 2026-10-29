/** Decides which freshly listed models join an instance's menu without the user ticking them. */
const { noisePatterns } = require("./catalog.cjs");

const MAX_AUTO_PINS = 3;
// A date stamped on the end of an id marks a snapshot of the model named before it.
const SNAPSHOT = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/;

function isNoise(entry, id, pinned = new Set()) {
  if (noisePatterns(entry).some((p) => new RegExp(p, "i").test(id))) return true;
  const base = id.replace(SNAPSHOT, "");
  return base !== id && pinned.has(base);
}

/** `seen` undefined means the first look: remember what is listed and pin nothing. */
function planPins({ entry, listed, pinned = [], seen }) {
  const ids = [...new Set(listed.map(String))];
  if (!Array.isArray(seen)) return { seenModels: ids, pinnedModels: pinned, added: [] };
  const known = new Set(seen);
  const fresh = ids.filter((id) => !known.has(id));
  const pins = new Set(pinned);
  const added = [];
  for (const id of fresh) {
    if (added.length >= MAX_AUTO_PINS || isNoise(entry, id, pins)) continue;
    pins.add(id);
    added.push(id);
  }
  return { seenModels: [...seen, ...fresh], pinnedModels: [...pins], added };
}

module.exports = { planPins, isNoise, MAX_AUTO_PINS };
