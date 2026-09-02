const path = require("path");
const fs = require("fs/promises");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");
const { log } = require("./logger.cjs");

/**
 * Ad and tracker blocking on uBlock Origin's engine. A hand-written blocklist
 * cannot express per-site exceptions, so it broke players and layouts.
 */

const GHOSTERY =
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets";
const ADGUARD =
  "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters";

/** Read from `electron/filters/` instead of the network. */
const LOCAL_PREFIX = "draggy-filters:";

/**
 * uBO's default subscriptions, plus AdGuard's and OISD. On a 482-endpoint
 * probe: uBO alone 79%, with AdGuard 90%, the whole set below 96%.
 */
const FILTER_LISTS = [
  `${GHOSTERY}/easylist/easylist.txt`,
  `${GHOSTERY}/peter-lowe/serverlist.txt`,
  `${GHOSTERY}/ublock-origin/badware.txt`,
  `${GHOSTERY}/ublock-origin/filters-2020.txt`,
  `${GHOSTERY}/ublock-origin/filters-2021.txt`,
  `${GHOSTERY}/ublock-origin/filters-2022.txt`,
  `${GHOSTERY}/ublock-origin/filters-2023.txt`,
  `${GHOSTERY}/ublock-origin/filters-2024.txt`,
  `${GHOSTERY}/ublock-origin/filters.txt`,
  `${GHOSTERY}/ublock-origin/quick-fixes.txt`,
  `${GHOSTERY}/ublock-origin/resource-abuse.txt`,
  `${GHOSTERY}/ublock-origin/unbreak.txt`,
  `${GHOSTERY}/easylist/easyprivacy.txt`,
  `${GHOSTERY}/ublock-origin/privacy.txt`,
  `${GHOSTERY}/easylist/easylist-cookie.txt`,
  `${GHOSTERY}/ublock-origin/annoyances-others.txt`,
  `${GHOSTERY}/ublock-origin/annoyances-cookies.txt`,
  `${ADGUARD}/filter_2_Base/filter.txt`,
  `${ADGUARD}/filter_3_Spyware/filter.txt`,
  `${ADGUARD}/filter_11_Mobile/filter.txt`,
  `${ADGUARD}/filter_14_Annoyances/filter.txt`,
  `${ADGUARD}/filter_17_TrackParam/filter.txt`,
  // OISD is domain-level; the small form is curated against breakage. The
  // large form was worth one further block for twice the compile time.
  "https://small.oisd.nl/abp",
  `${LOCAL_PREFIX}draggy-extra.txt`,
];

/**
 * Lets a bundled file sit alongside the remote ones. The engine builder only
 * knows how to fetch, so the local supplement is returned as a response.
 */
async function fetchList(url, init) {
  if (typeof url === "string" && url.startsWith(LOCAL_PREFIX)) {
    const name = path.basename(url.slice(LOCAL_PREFIX.length));
    const text = await fs.readFile(path.join(__dirname, "filters", name), "utf8");
    return new Response(text, { status: 200 });
  }
  return fetch(url, init);
}

/**
 * The name carries a version: a cached engine is a compiled copy of the list
 * set. Changing lists without changing this would serve old rules forever.
 */
const ENGINE_FILE = "adblock-engine-v2.bin";

/**
 * One engine for the whole app, shared by every session that blocks. It is a
 * few megabytes of compiled filters, and parsing it twice would buy nothing.
 */
let enginePromise = null;

/**
 * Compiles the filter lists, or reads back the cache. Failing is not fatal: an
 * offline machine should still get a browser that loads pages.
 */
function loadEngine(userDataPath) {
  if (enginePromise) return enginePromise;

  const cachePath = path.join(userDataPath, ENGINE_FILE);

  enginePromise = ElectronBlocker.fromLists(
    fetchList,
    FILTER_LISTS,
    {},
    { path: cachePath, read: fs.readFile, write: fs.writeFile },
  ).catch((error) => {
    log.warn("adblocker", `could not load filter lists: ${error.message}`);
    return null;
  });

  return enginePromise;
}

/**
 * Starts compiling without waiting, at start-up, so the first window that
 * wants blocking is not the one paying for the download.
 */
function primeAdblocker(userDataPath) {
  void loadEngine(userDataPath);
}

async function enableBlocking(userDataPath, session) {
  const blocker = await loadEngine(userDataPath);
  if (!blocker) return false;

  if (!blocker.isBlockingEnabled(session)) {
    blocker.enableBlockingInSession(session);
  }
  return true;
}

async function disableBlocking(userDataPath, session) {
  const blocker = await loadEngine(userDataPath);
  if (!blocker) return;

  if (blocker.isBlockingEnabled(session)) {
    blocker.disableBlockingInSession(session);
  }
}

module.exports = {
  primeAdblocker,
  enableBlocking,
  disableBlocking,
};
