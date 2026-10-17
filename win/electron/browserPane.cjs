const { log } = require("./logger.cjs");
/** The Browser pane: one page view attached to the main window and laid over the rectangle the
 * renderer's pane leaves for it. The page stays in the web session and sandboxed, exactly like the
 * separate browser window; only where it is drawn changes. A native view draws above every bit of
 * HTML, so the renderer hides it whenever a menu or dialog would land on top. */

/** Rejects anything but a plain rectangle of finite numbers, and keeps it inside the window. */
function sanitiseBounds(raw, limit) {
  if (!raw || typeof raw !== "object") return null;
  const values = ["x", "y", "width", "height"].map((key) => Number(raw[key]));
  if (!values.every(Number.isFinite)) return null;

  const [x, y, width, height] = values.map((value) => Math.max(0, Math.round(value)));
  const left = Math.min(x, limit.width);
  const top = Math.min(y, limit.height);

  return {
    x: left,
    y: top,
    width: Math.min(width, limit.width - left),
    height: Math.min(height, limit.height - top),
  };
}

/** Host only: a path or query can carry a session token or a search term. */
function hostOf(value) {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {Function} deps.WebContentsView Electron's view class.
 * @param {object} deps.host The main window.
 * @param {object} deps.webSession The `persist:draggy-web` session. Never `defaultSession`.
 * @param {(view: object) => void} [deps.prepare] Wires page events once the view exists.
 */
const MAX_TABS = 8;

function createBrowserPane({ WebContentsView, host, webSession, prepare, onTabsChange = () => {} }) {
  /** Every open tab. One is in front; the rest are kept hidden and keep running. */
  const views = [];
  let front = 0;
  let visible = false;
  let bounds = null;
  /** Callers waiting for the page to be on screen, woken by `apply`. */
  const waiters = new Set();

  const current = () => views[front] || null;

  const shown = () => Boolean(current() && visible && bounds && bounds.width > 0 && bounds.height > 0);

  const apply = () => {
    if (!current()) return;
    const show = shown();
    views.forEach((tab, at) => {
      const inFront = at === front;
      if (inFront && show) tab.setBounds(bounds);
      tab.setVisible(inFront && show);
    });
    if (show) for (const wake of [...waiters]) wake(true);
  };

  /** Navigation host, load failures and crashes. Paths and queries never reach the log. */
  const watch = (contents) => {
    contents.on("did-navigate", (_event, url) => {
      log.info("window.browser", "navigated", { host: hostOf(url) });
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, url, isMainFrame) => {
      if (!isMainFrame) return;
      // -3 is an aborted load, which is what the user or a redirect causes on purpose.
      const data = { host: hostOf(url), code: errorCode, description: errorDescription };
      if (errorCode === -3) log.debug("window.browser", "load aborted", data);
      else log.warn("window.browser", "load failed", data);
    });
    contents.on("render-process-gone", (_event, details) => {
      log.error("window.browser", "page process gone", { reason: details?.reason, exitCode: details?.exitCode });
    });
  };

  const create = () => {
    const view = new WebContentsView({
      webPreferences: {
        session: webSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webgl: true,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    view.setVisible(false);
    host.contentView.addChildView(view);
    watch(view.webContents);
    prepare?.(view);
    return view;
  };

  const ensure = () => {
    if (!views.length) views.push(create());
    return current();
  };

  const closeView = (view) => {
    try {
      host.contentView.removeChildView(view);
    } catch (error) {
      log.swallow("window", error, "the window is already gone, and its views with it");
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
  };

  return {
    get view() {
      return current();
    },

    /** Opens another tab and brings it to the front. Null at the cap. */
    openTab() {
      ensure();
      if (views.length >= MAX_TABS) return null;
      const view = create();
      views.push(view);
      front = views.length - 1;
      apply();
      onTabsChange();
      return view;
    },

    selectTab(at) {
      if (!Number.isInteger(at) || at < 0 || at >= views.length) return false;
      front = at;
      apply();
      onTabsChange();
      return true;
    },

    /** The last tab stays: the pane always has a page to show. */
    closeTab(at) {
      if (!Number.isInteger(at) || at < 0 || at >= views.length || views.length === 1) return false;
      const [gone] = views.splice(at, 1);
      if (front >= at && front > 0) front -= 1;
      closeView(gone);
      apply();
      onTabsChange();
      return true;
    },

    tabs() {
      return views.map((tab, at) => ({ index: at, active: at === front, view: tab }));
    },

    /** Creates the view on first use. Loading is left to the caller, which owns URL policy. */
    ensure,

    /** Whether the page is on screen with a size, which is when input and screenshots mean something. */
    isShown: shown,

    /** Resolves true once the page is on screen, or false after `timeoutMs`. */
    whenShown(timeoutMs) {
      if (shown()) return Promise.resolve(true);
      return new Promise((resolve) => {
        const finish = (value) => {
          clearTimeout(timer);
          waiters.delete(finish);
          resolve(value);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        waiters.add(finish);
      });
    },

    /** The renderer measures in CSS pixels; views are placed in window units, which differ by the
     * page zoom. */
    setBounds(raw) {
      const zoom = host.webContents.getZoomFactor?.() || 1;
      const content = host.getContentBounds();
      const scaled =
        raw && typeof raw === "object"
          ? { x: raw.x * zoom, y: raw.y * zoom, width: raw.width * zoom, height: raw.height * zoom }
          : null;
      const next = sanitiseBounds(scaled, content);
      if (!next) return false;
      bounds = next;
      apply();
      return true;
    },

    setVisible(on) {
      visible = Boolean(on);
      apply();
      return true;
    },

    destroy() {
      for (const view of views.splice(0)) closeView(view);
      front = 0;
    },
  };
}

module.exports = { createBrowserPane, sanitiseBounds };
