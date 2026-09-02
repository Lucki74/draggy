const { log } = require("./logger.cjs");

/**
 * Checks after launch and every few hours, downloads in the background, installs
 * on quit. The first check is late: launch already competes for the network.
 */

/** How long after launch the first check runs. */
const FIRST_CHECK_MS = 20_000;

/** How often to look again while the app stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let updater = null;
let state = { status: "idle", version: null, percent: 0, notes: null, error: null };
let broadcast = () => {};

let automatic = false;
let firstCheckTimer = null;
let intervalTimer = null;

function publish(next) {
  state = { ...state, ...next };
  broadcast(state);
}

function init(app, sendToWindows) {
  broadcast = sendToWindows;

  if (!app.isPackaged) {
    publish({ status: "disabled", error: "Updates are disabled in development." });
    return null;
  }

  try {
    ({ autoUpdater: updater } = require("electron-updater"));
  } catch (error) {
    publish({ status: "disabled", error: "Update support is unavailable." });
    log.warn("updater", `electron-updater unavailable: ${error.message}`);
    return null;
  }

  // Downloading is only ever automatic when the user has asked for it; the
  // setting arrives from the renderer a moment after this.
  updater.autoDownload = automatic;
  updater.autoInstallOnAppQuit = true;
  updater.logger = {
    info: (message) => log.info("updater", message),
    warn: (message) => log.warn("updater", message),
    error: (message) => log.error("updater", message),
    debug: () => {},
  };

  updater.on("checking-for-update", () => publish({ status: "checking", error: null }));

  updater.on("update-available", (info) =>
    publish({ status: "available", version: info.version, notes: info.releaseNotes || null }),
  );

  updater.on("update-not-available", () => publish({ status: "current", percent: 0 }));

  updater.on("download-progress", (progress) =>
    publish({ status: "downloading", percent: Math.round(progress.percent) }),
  );

  updater.on("update-downloaded", (info) =>
    publish({ status: "ready", version: info.version, percent: 100 }),
  );

  updater.on("error", (error) => {
    log.warn("updater", error?.message || String(error));
    publish({ status: "error", error: error?.message || "Update check failed." });
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

/**
 * Turns automatic updating on or off. Called by the renderer whenever the
 * setting changes, and once at startup with whatever it was left on.
 */
function configure({ automatic: wanted } = {}) {
  automatic = Boolean(wanted);

  if (updater) updater.autoDownload = automatic;

  if (automatic) schedule();
  else unschedule();

  return { ...state };
}

async function check({ silent } = {}) {
  if (!updater) return { ...state };

  try {
    await updater.checkForUpdates();
  } catch (error) {
    if (!silent) publish({ status: "error", error: error.message });
  }

  return { ...state };
}

async function download() {
  if (!updater) return { ...state };

  try {
    publish({ status: "downloading", percent: 0 });
    await updater.downloadUpdate();
  } catch (error) {
    publish({ status: "error", error: error.message });
  }

  return { ...state };
}

function install() {
  if (!updater || state.status !== "ready") return { ...state };
  setImmediate(() => updater.quitAndInstall(false, true));
  return { ...state, status: "installing" };
}

function current() {
  return { ...state };
}

function dispose() {
  unschedule();
}

module.exports = {
  init,
  configure,
  check,
  download,
  install,
  current,
  dispose,
};
