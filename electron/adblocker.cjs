const path = require("path");
const fs = require("fs/promises");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");
const { log } = require("./logger.cjs");

/**
 * Ad and tracker blocking, using uBlock Origin's own engine.
 *
 * The hand-written domain and substring blocklist this replaced could not
 * express the one thing that matters on a real site: an exception. Blocking
 * every URL containing "/ads?" or hiding every element whose class starts
 * with "ad-" takes the page's own scripts and layout with it, which is why
 * video players and half-rendered articles were the normal result rather
 * than the exception.
 *
 * The filter lists encode those exceptions, per site, maintained by people
 * who watch the sites break. Matching them is what this engine does.
 */

const GHOSTERY =
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets";
const ADGUARD =
  "https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters";

/** Read from `electron/filters/` instead of the network. */
const LOCAL_PREFIX = "draggy-filters:";

/**
 * What the engine is built from.
 *
 * uBlock Origin's own default subscriptions, the same ones a fresh uBO
 * install enables, plus AdGuard's equivalents and OISD. The projects write
 * rules against different sites, and a host one of them has not got around to
 * is usually covered by another.
 *
 * Measured against a 482-endpoint probe: uBO's set alone blocked 79%, adding
 * AdGuard's reached 90%, and the whole set below reaches 96%. What is left is
 * video-player infrastructure, which is covered in `draggy-extra.txt`.
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
  // OISD is a domain-level list in the DNS-blocker tradition. The small form
  // is the one its author curates against breakage rather than for maximum
  // coverage, and it catches the endpoints the site-by-site lists never had a
  // reason to name. Measured against the 482-endpoint probe the larger form
  // was worth one further block for twice the compile time.
  "https://small.oisd.nl/abp",
  `${LOCAL_PREFIX}draggy-extra.txt`,
];

/**
 * Lets a bundled file be listed alongside the remote ones.
 *
 * The engine builder only knows how to fetch, so the local supplement is
 * handed back as a response rather than given a separate code path.
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
 * The name carries a version, because a cached engine is a compiled copy of
 * whatever the list set was when it was written. Changing the lists without
 * changing this would keep serving the old rules forever.
 */
const ENGINE_FILE = "adblock-engine-v2.bin";

/**
 * One engine for the whole app, shared by every session that blocks. It is a
 * few megabytes of compiled filters, and parsing it twice would buy nothing.
 */
let enginePromise = null;

/**
 * Compiles the filter lists, or reads them back from the last run.
 *
 * The lists are fetched once and cached on disk, so this reaches the network
 * on a first run and after the cache expires, not on every launch. A failure
 * here is not fatal: blocking is a convenience, and a machine that is offline
 * or behind a proxy should still get a browser that loads pages.
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
 * Starts compiling the engine without waiting for it.
 *
 * Called at start-up so the first window that wants blocking is not the one
 * paying for the download.
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
