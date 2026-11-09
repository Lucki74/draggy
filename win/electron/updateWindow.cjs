const path = require("node:path");
const { log } = require("./logger.cjs");

const WINDOW_WIDTH = 360;
const WINDOW_HEIGHT = 160;
const DEFAULT_TITLE = "Updating Draggy";

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The page is inline so no file or network is needed; colours come from the saved theme. */
function buildHtml({ background, foreground, accent, title = DEFAULT_TITLE } = {}) {
  const bg = escapeHtml(background);
  const fg = escapeHtml(foreground);
  const ac = escapeHtml(accent);
  const heading = escapeHtml(title);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${heading}</title>
<style>
html,body{margin:0;height:100%;background:${bg};color:${fg};font-family:"Segoe UI",system-ui,sans-serif;}
main{display:flex;flex-direction:column;justify-content:center;gap:14px;height:100%;box-sizing:border-box;padding:0 28px;}
h1{margin:0;font-size:15px;font-weight:600;}
.track{height:6px;border-radius:3px;background:${fg};opacity:0.18;overflow:hidden;}
#bar{height:100%;width:0%;background:${ac};transition:width 0.2s ease;}
#text{margin:0;font-size:12px;opacity:0.8;}
</style></head>
<body><main><h1>${heading}</h1><div class="track"><div id="bar"></div></div><p id="text">0%</p></main></body></html>`;
}

/** Opens the small window that shows an update downloading. It is never the splash: boot waits on it,
 * but nothing else about the splash or boot changes. */
function open({ background, foreground, accent, title = DEFAULT_TITLE } = {}) {
  const { BrowserWindow } = require("electron");
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: false,
    center: true,
    show: false,
    backgroundColor: background,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  // The page never needs to leave itself.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml({ background, foreground, accent, title }))}`);

  const isOpen = () => !win.isDestroyed();

  /** Values go through JSON so state text can never run as script. */
  function update(next) {
    if (!isOpen() || !next) return;
    let percent;
    let text;
    if (next.status === "downloading") {
      percent = Math.min(100, Math.max(0, Math.round(Number(next.percent) || 0)));
      text = `${percent}%`;
    } else if (next.status === "ready") {
      percent = 100;
      text = "Restarting";
    } else {
      return;
    }
    win.webContents
      .executeJavaScript(
        `document.getElementById("bar").style.width = ${JSON.stringify(`${percent}%`)};` +
          `document.getElementById("text").textContent = ${JSON.stringify(text)};`,
      )
      .catch((error) => log.warn("updater", "update window not updated", { reason: error?.message ?? null }));
  }

  function close() {
    if (isOpen()) win.close();
  }

  return { update, close, isOpen };
}

module.exports = { open, buildHtml };
