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
function createBrowserPane({ WebContentsView, host, webSession, prepare }) {
  let view = null;
  let visible = false;
  let bounds = null;

  const apply = () => {
    if (!view) return;
    const show = visible && bounds && bounds.width > 0 && bounds.height > 0;
    if (show) view.setBounds(bounds);
    view.setVisible(Boolean(show));
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

  const ensure = () => {
    if (view) return view;
    view = new WebContentsView({
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

  return {
    get view() {
      return view;
    },

    /** Creates the view on first use. Loading is left to the caller, which owns URL policy. */
    ensure,

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
      if (!view) return;
      try {
        host.contentView.removeChildView(view);
      } catch (error) {
        log.swallow("window", error, "the window is already gone, and its views with it");
      }
      if (!view.webContents.isDestroyed()) view.webContents.close();
      view = null;
    },
  };
}

module.exports = { createBrowserPane, sanitiseBounds };
