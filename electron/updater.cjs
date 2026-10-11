const semver = require("semver");
const { log } = require("./logger.cjs");

/** electron-builder strips the build block from the packaged package.json, so these are literal. */
const REPO_OWNER = "Lucki74";
const REPO_NAME = "draggy";

/** Checks after launch and every few hours, downloads in the background, installs on quit. The
 * first check is late: launch already competes for the network. */

/** How long after launch the first check runs. */
const FIRST_CHECK_MS = 20_000;

/** How often to look again while the app stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let updater = null;
let appInstance = null;
let state = { status: "idle", version: null, percent: 0, notes: null, error: null };
let broadcast = () => {};

let automatic = false;
/** True while a check or download the user started is running, so only those surface errors. */
let userStarted = false;
let firstCheckTimer = null;
let intervalTimer = null;

/** The signature check is a builder option, but electron-builder strips the build block from the packaged
 * package.json, so the value is repeated here. A test keeps it equal to `build.win.verifyUpdateCodeSignature`.
 * electron-updater fails the download before update-downloaded fires when a check that is on does not
 * pass, so reaching here with it on means it passed. */
const VERIFY_UPDATE_SIGNATURE = false;

function signatureCheck(configured = VERIFY_UPDATE_SIGNATURE) {
  if (configured === true) return { verified: true, reason: "publisher signature checked by electron-updater" };
  return { verified: "skipped", reason: "verifyUpdateCodeSignature is false in package.json" };
}

function getCurrentVersion() {
  return appInstance?.getVersion?.() || require("../package.json").version;
}

function isNewer(candidate, current) {
  if (!candidate || !current) return false;
  try {
    return semver.gt(candidate, current);
  } catch {
    return false;
  }
}

/** The build to update to: the highest `b-N` among published releases. Compared as numbers, so
 * b-10 beats b-9. Anything else (drafts, prereleases, stray v* tags) is ignored. */
function pickBuildTag(releases) {
  let best = null;
  let bestNumber = -1;
  for (const entry of Array.isArray(releases) ? releases : []) {
    if (!entry || entry.draft || entry.prerelease) continue;
    const match = /^b-(\d+)$/.exec(String(entry.tag_name ?? ""));
    if (!match) continue;
    const number = Number(match[1]);
    if (number > bestNumber) {
      bestNumber = number;
      best = entry.tag_name;
    }
  }
  return best;
}

async function latestBuildTag() {
  const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Draggy-updater" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return pickBuildTag(await response.json());
}

/** The feed to read `latest.yml` from. DRAGGY_UPDATE_FEED points at a local server for testing an
 * update end to end; otherwise the newest build tag, falling back to GitHub's own latest release. */
async function resolveFeed() {
  const override = process.env.DRAGGY_UPDATE_FEED;
  if (override) return { feed: { provider: "generic", url: override }, tag: null };

  let tag = null;
  try {
    tag = await latestBuildTag();
  } catch (error) {
    log.warn("updater", "release list unavailable, using github latest", { reason: error.message });
  }
  return {
    feed: tag
      ? { provider: "generic", url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}` }
      : { provider: "github", owner: REPO_OWNER, repo: REPO_NAME },
    tag,
  };
}

/** latest.yml carries notes as one string, GitHub's own provider as a list of {version, note}. */
function notesText(raw) {
  if (typeof raw === "string") return raw.trim() || null;
  if (Array.isArray(raw)) {
    const joined = raw.map((entry) => (typeof entry?.note === "string" ? entry.note : "")).filter(Boolean).join("\n\n");
    return joined.trim() || null;
  }
  return null;
}

function publish(next) {
  state = { ...state, ...next };
  broadcast(state);
}

function init(app, sendToWindows) {
  appInstance = app;
  broadcast = sendToWindows;

  if (!app.isPackaged) {
    publish({ status: "disabled", error: "Updates are disabled in development." });
    return null;
  }

  try {
    ({ autoUpdater: updater } = require("electron-updater"));
  } catch (error) {
    publish({ status: "disabled", error: "Update support is unavailable." });
    log.warn("updater", "electron-updater unavailable", { code: error?.code ?? null });
    return null;
  }

  // Downloading is only ever automatic when the user has asked for it; the
  // setting arrives from the renderer a moment after this.
  updater.autoDownload = automatic;
  updater.autoInstallOnAppQuit = true;

  // Every build is a full release, so there is no prerelease channel to follow.
  updater.allowPrerelease = false;
  updater.channel = null;
  // electron-updater silently enables allowDowngrade whenever channel is assigned.
  updater.allowDowngrade = false;
  updater.logger = {
    info: (message) => log.info("updater", message),
    warn: (message) => log.warn("updater", message),
    error: (message) => log.error("updater", message),
    debug: () => {},
  };

  updater.on("checking-for-update", () => publish({ status: "checking", error: null }));

  updater.on("update-available", (info) => {
    if (!isNewer(info?.version, getCurrentVersion())) {
      log.info("updater", "update ignored, not newer", { version: info?.version, current: getCurrentVersion() });
      publish({ status: "current", percent: 0 });
      return;
    }
    log.info("updater", "update available", { version: info.version });
    publish({ status: "available", version: info.version, notes: notesText(info.releaseNotes) });
  });

  updater.on("update-not-available", () => publish({ status: "current", percent: 0 }));

  updater.on("download-progress", (progress) =>
    publish({ status: "downloading", percent: Math.round(progress.percent) }),
  );

  updater.on("update-downloaded", (info) => {
    if (!isNewer(info?.version, getCurrentVersion())) {
      publish({ status: "current", percent: 0 });
      return;
    }
    log.info("updater", "update downloaded", { version: info.version });
    log.info("updater", "signature check", signatureCheck());
    publish({ status: "ready", version: info.version, percent: 100 });
  });

  updater.on("error", (error) => {
    if (error?.code === "ERR_UPDATER_INVALID_VERSION") {
      log.warn("updater", "latest.yml has an invalid version", { reason: error.message });
    } else if (userStarted) {
      log.fail("updater", "update error", error);
    } else {
      log.warn("updater", "silent check failed", { reason: error?.message ?? null });
    }
    if (userStarted) publish({ status: "error", error: error?.message || "Update check failed." });
  });

  return updater;
}

function unschedule() {
  if (firstCheckTimer) clearTimeout(firstCheckTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  firstCheckTimer = null;
  intervalTimer = null;
}

function schedule() {
  if (!updater || firstCheckTimer || intervalTimer) return;

  firstCheckTimer = setTimeout(() => {
    firstCheckTimer = null;
    void check({ silent: true });
  }, FIRST_CHECK_MS);

  intervalTimer = setInterval(() => void check({ silent: true }), CHECK_INTERVAL_MS);

  // A pending check is never a reason to keep the process alive.
  firstCheckTimer.unref?.();
  intervalTimer.unref?.();
}

/** Turns automatic updating on or off. Called by the renderer whenever the setting changes, and
 * once at startup with whatever it was left on. */
function configure({ automatic: wanted } = {}) {
  automatic = Boolean(wanted);

  if (updater) {
    updater.autoDownload = automatic;
    updater.channel = null;
    // electron-updater silently enables allowDowngrade whenever channel is assigned.
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
  }
  log.info("updater", "configured", { automatic });

  if (automatic) schedule();
  else unschedule();

  return { ...state };
}

async function check({ silent } = {}) {
  if (!updater) return { ...state };

  userStarted = !silent;
  const timer = log.time("updater", "check", { silent: Boolean(silent) });
  try {
    const { feed, tag } = await resolveFeed();
    updater.setFeedURL(feed);
    await updater.checkForUpdates();
    timer.end({ tag, status: state.status, version: state.version });
  } catch (error) {
    timer.fail(error);
    if (!silent) publish({ status: "error", error: error.message });
  } finally {
    userStarted = false;
  }

  return { ...state };
}

async function download() {
  if (!updater) return { ...state };
  if (!isNewer(state.version, getCurrentVersion())) return { ...state };

  const timer = log.time("updater", "download", { version: state.version });
  userStarted = true;
  try {
    publish({ status: "downloading", percent: 0 });
    await updater.downloadUpdate();
    timer.end({ status: state.status });
  } catch (error) {
    timer.fail(error);
    publish({ status: "error", error: error.message });
  } finally {
    userStarted = false;
  }

  return { ...state };
}

function install() {
  if (!updater || state.status !== "ready") return { ...state };
  if (!isNewer(state.version, getCurrentVersion())) return { ...state };

  // Silent, and relaunch afterwards. The wizard asked where to install and
  // whether to continue, for a version of an app the user already has.
  log.info("updater", "install scheduled", { version: state.version, silent: true, relaunch: true });
  setImmediate(() => updater.quitAndInstall(true, true));
  return { ...state, status: "installing" };
}

function current() {
  return { ...state };
}

function dispose() {
  unschedule();
}

module.exports = {
  signatureCheck,
  init,
  configure,
  check,
  download,
  install,
  current,
  dispose,
  isNewer,
  pickBuildTag,
};
