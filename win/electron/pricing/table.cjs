// The price table the app prices replies from. A copy refreshed from the network (see refresh.cjs) wins over the
// snapshot that ships with the app, but only when it parses and holds enough prices to be believed.
const fs = require("node:fs");
const path = require("node:path");

/** A table with fewer prices than this is a broken download, not a price list. */
const MIN_PRICES = 200;

const LIVE_FILE = "prices.live.json";

/** Where the snapshot lives: beside the app's resources when packaged, in shared/ in a checkout. */
function bundledPath({ resourcesPath = process.resourcesPath, packaged = false } = {}) {
  return packaged ? path.join(resourcesPath, "prices.json") : path.join(__dirname, "..", "..", "..", "shared", "pricing", "prices.json");
}

const isRate = (value) => value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);

/** True for a table whose shape and numbers can be priced from. */
function isUsableTable(table) {
  if (!table || typeof table !== "object" || typeof table.providers !== "object" || table.providers === null) return false;
  let count = 0;
  for (const models of Object.values(table.providers)) {
    if (!models || typeof models !== "object") return false;
    for (const price of Object.values(models)) {
      if (!price || typeof price !== "object") return false;
      if (typeof price.inputPerM !== "number" || typeof price.outputPerM !== "number") return false;
      if (![price.inputPerM, price.outputPerM, price.cacheReadPerM, price.cacheWritePerM, price.reasoningPerM].every(isRate)) return false;
      count += 1;
    }
  }
  return count >= MIN_PRICES;
}

function readTable(file) {
  try {
    const table = JSON.parse(fs.readFileSync(file, "utf8"));
    return isUsableTable(table) ? table : null;
  } catch {
    return null;
  }
}

/**
 * Creates the loader. `userData` is where a refreshed copy is kept; `bundled` is the snapshot's path.
 * The table is read once and again only after `reload()`, so pricing a turn never touches the disk.
 */
function createPriceTable({ userData, bundled, log }) {
  let current = null;
  let origin = "none";

  function reload() {
    const live = userData ? readTable(path.join(userData, LIVE_FILE)) : null;
    const snapshot = live ? null : readTable(bundled);
    current = live ?? snapshot;
    origin = live ? "live" : snapshot ? "bundled" : "none";
    if (!current) log?.warn?.("pricing", "no usable price table; replies will show no cost");
    return current;
  }

  return {
    get: () => current ?? reload(),
    reload,
    origin: () => origin,
    liveFile: () => (userData ? path.join(userData, LIVE_FILE) : null),
  };
}

module.exports = { MIN_PRICES, LIVE_FILE, bundledPath, isUsableTable, readTable, createPriceTable };
