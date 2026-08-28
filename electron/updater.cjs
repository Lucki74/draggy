const { log } = require("./logger.cjs");

let updater = null;
let state = { status: "idle", version: null, percent: 0, notes: null, error: null };
let broadcast = () => {};

function publish(next) {
  state = { ...state, ...next };
  broadcast(state);
}

function isConfigured(app) {
  if (!app.isPackaged) return false;

  try {
    const { autoUpdater } = require("electron-updater");
    return Boolean(autoUpdater.isUpdaterActive());
  } catch {
    return false;
  }
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

  updater.autoDownload = false;
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

module.exports = { init, check, download, install, current, isConfigured };
