const {
  app,
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  dialog,
  ipcMain,
  Menu,
  shell,
  protocol,
  session,
} = require("electron");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const fs = require("fs");
const adblocker = require("./adblocker.cjs");
const favicon = require("./favicon.cjs");
const logger = require("./logger.cjs");
const { log } = logger;
const platform = require("./platform.cjs");
const documents = require("./documents.cjs");
const storage = require("./storage.cjs");
const library = require("./library.cjs");
const runner = require("./runner.cjs");
const updater = require("./updater.cjs");
const { runSearch, PROVIDER_IDS, DESKTOP_USER_AGENT } = require("./search.cjs");
const appData = require("./appData.cjs");
const urlPolicy = require("./urlPolicy.cjs");
const mcp = require("./mcp.cjs");
const mcpCatalogue = require("./mcpCatalogue.cjs");
const pdfWriter = require("./pdfWriter.cjs");

const OLLAMA_HOST = "127.0.0.1:11434";
const MODEL_CACHE_ORIGIN = "https://huggingface.co";

/** What the app calls itself: window titles, the taskbar, the data folder. */
const APP_NAME = "Draggy";

/**
 * Names it answered to before. Both spellings are tried because only the
 * case-sensitive platforms care and an extra `existsSync` costs nothing.
 */
const LEGACY_APP_NAMES = ["localai", "LocalAI"];

/**
 * Takes over the old folder once, before the logger and database create files
 * in the new one. Returns what happened, for the log to pick up later.
 */
function adoptLegacyDataFolder() {
  const parent = app.getPath("appData");
  const to = app.getPath("userData");
  const notes = [];

  for (const name of LEGACY_APP_NAMES) {
    const from = path.join(parent, name);
    if (from === to) continue;

    const result = appData.adoptFolder({ from, to });
    if (result.message) notes.push(result.message);
    if (result.plan === "adopt") break;
  }

  return notes;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "draggy",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const modelCacheDir = () => path.join(app.getPath("userData"), "model-cache");

function modelFileHeaders(relative, size) {
  const extension = path.extname(relative).toLowerCase();
  return {
    "Content-Length": String(size),
    "Content-Type":
      extension === ".json"
        ? "application/json"
        : extension === ".txt"
          ? "text/plain"
          : "application/octet-stream",
  };
}

const faviconCacheDir = () => path.join(app.getPath("userData"), "favicon-cache");

async function serveFavicon(hostname) {
  if (!favicon.isValidHostname(hostname)) {
    return new Response("Bad request", { status: 400 });
  }

  const bytes = await favicon.loadFavicon(faviconCacheDir(), hostname);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(bytes, {
    headers: {
      "Content-Type": favicon.sniffImageType(bytes) || "image/x-icon",
      "Cache-Control": "max-age=604800",
    },
  });
}

async function serveCachedModelFile(request) {
  const url = new URL(request.url);

  if (url.host === "favicon") {
    return serveFavicon(decodeURIComponent(url.pathname).replace(/^\/+/, ""));
  }

  if (url.host !== "models") {
    return new Response("Not found", { status: 404 });
  }

  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!relative) return new Response("Bad request", { status: 400 });

  const root = path.resolve(modelCacheDir());
  const target = path.resolve(path.join(root, relative));
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) {
    return new Response("Bad request", { status: 400 });
  }

  if (fs.existsSync(target)) {
    const cached = fs.readFileSync(target);
    return new Response(cached, {
      headers: modelFileHeaders(relative, cached.length),
    });
  }

  const upstream = await fetch(MODEL_CACHE_ORIGIN + "/" + relative);
  if (!upstream.ok) {
    return new Response(upstream.statusText, { status: upstream.status });
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);

  return new Response(body, {
    headers: modelFileHeaders(relative, body.length),
  });
}

const RENDERER_ORIGIN = "app://draggy";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

const rendererRoot = () => path.resolve(path.join(__dirname, "..", "dist"));

async function serveRendererFile(request) {
  const url = new URL(request.url);
  const root = rendererRoot();

  const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  let target = path.resolve(path.join(root, requested));

  const inside = path.relative(root, target);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(root, "index.html");
  }

  try {
    const body = fs.readFileSync(target);
    return new Response(body, {
      headers: {
        "Content-Type": MIME_TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Content-Length": String(body.length),
      },
    });
  } catch (error) {
    log.error("protocol", `could not serve ${target}`, error);
    return new Response("Not found", { status: 404 });
  }
}

const CSP_DIRECTIVES = [
  "default-src 'self' app: draggy:",
  "script-src 'self' app: draggy: 'wasm-unsafe-eval'",
  "style-src 'self' app: draggy: 'unsafe-inline'",
  "font-src 'self' app: draggy: data:",
  "img-src 'self' app: draggy: data: blob:",
  "media-src 'self' app: draggy: data: blob:",
  "connect-src 'self' app: draggy: blob: data: http://127.0.0.1:11434 ws://127.0.0.1:5173 http://127.0.0.1:5173",
  "worker-src 'self' app: draggy: blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const DEV_CSP_DIRECTIVES = CSP_DIRECTIVES.replace(
  "script-src 'self' app: draggy: 'wasm-unsafe-eval'",
  "script-src 'self' app: draggy: 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:5173",
);

function applyContentSecurityPolicy(ses, packaged) {
  const policy = packaged ? CSP_DIRECTIVES : DEV_CSP_DIRECTIVES;

  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame" && details.resourceType !== "subFrame") {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const headers = { ...details.responseHeaders };
    delete headers["content-security-policy"];
    delete headers["Content-Security-Policy"];
    headers["Content-Security-Policy"] = [policy];

    callback({ responseHeaders: headers });
  });
}

const OLLAMA_URL = `http://${OLLAMA_HOST}`;
function cleanUserAgent(webContents) {
  return webContents.userAgent.replace(/Electron\/[0-9.]+ /g, "");
}

/**
 * The session every external page loads in. Off `defaultSession` so our own CSP
 * is not forced onto other people's sites, which left the browser in wreckage.
 */
const WEB_PARTITION = "persist:draggy-web";

let webSessionHooked = false;
function getWebSession() {
  const ses = session.fromPartition(WEB_PARTITION);
  if (webSessionHooked) return ses;
  webSessionHooked = true;

  // Client-hint headers name Electron specifically. Dropping them presents an
  // ordinary Chromium, the same reasoning as `cleanUserAgent`.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    delete details.requestHeaders["sec-ch-ua"];
    delete details.requestHeaders["sec-ch-ua-mobile"];
    delete details.requestHeaders["sec-ch-ua-platform"];
    callback({ requestHeaders: details.requestHeaders });
  });

  return ses;
}

/**
 * Whether the ad blocker is on, for every web session at once. Persisted in the
 * renderer's store so the choice survives a restart.
 */
const ADBLOCK_KEY = "adblockEnabled";

function adblockEnabled() {
  try {
    // Absent means on: blocking is the default, and a database that cannot be
    // read is not a reason to start showing ads.
    return storage.getValue(ADBLOCK_KEY) !== "off";
  } catch {
    return true;
  }
}

async function applyAdblockSetting() {
  const ses = getWebSession();
  const userData = app.getPath("userData");

  if (adblockEnabled()) {
    return adblocker.enableBlocking(userData, ses);
  }

  await adblocker.disableBlocking(userData, ses);
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE_STATE_SCRIPT = `
  (() => {
    const body = document.body ? document.body.innerText : "";
    return {
      title: document.title || "",
      readyState: document.readyState,
      textLength: body.trim().length,
      head: body.substring(0, 2000),
    };
  })();
`;

const BOT_CHALLENGE_MARKERS = [
  "Verify you are human",
  "Checking your browser",
  "I am human",
  "Please verify you are a human",
];

function isBotChallengePage(state) {
  return (
    state.title.includes("Just a moment") ||
    BOT_CHALLENGE_MARKERS.some((m) => state.head.includes(m))
  );
}

/**
 * The browser the user gets on a link. Two views: our toolbar on
 * `defaultSession`, and the page below in the shared web session.
 */
const TOOLBAR_HEIGHT = 48;

/**
 * How far the toolbar grows for an open menu. A view clips to its own bounds,
 * so a menu below a 48px bar is cut off and the page covers what is left.
 */
const TOOLBAR_MENU_HEIGHT = 260;

/** Every open browser window, so the toolbars can be told what changed. */
const browserWindows = new Set();

function openInAppBrowser(url) {
  // Reached from `setWindowOpenHandler` and `will-navigate`, so the string can
  // come from a page rather than from the person using the app.
  if (!urlPolicy.isFetchableUrl(url, { allowPrivate: true })) {
    log.warn("browser", `refused to open ${String(url).slice(0, 120)}`);
    return null;
  }

  const win = new BaseWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#1E1E1E",
    title: APP_NAME,
    icon: path.join(__dirname, "icon.ico"),
  });
  win.setMenuBarVisibility(false);

  const toolbar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const content = new WebContentsView({
    webPreferences: {
      session: getWebSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webgl: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  // The page first, the toolbar second: the last child drawn is the one on
  // top, and a menu that opens under the bar has to be above the page.
  win.contentView.addChildView(content);
  win.contentView.addChildView(toolbar);

  // Everything the toolbar page does not paint lets the page below show
  // through, so the grown bar is invisible except for the menu itself.
  toolbar.setBackgroundColor("#00000000");

  const entry = { win, toolbar, content, menuOpen: false };

  const layout = () => {
    const { width, height } = win.getContentBounds();

    toolbar.setBounds({
      x: 0,
      y: 0,
      width,
      height: entry.menuOpen
        ? Math.min(height, TOOLBAR_HEIGHT + TOOLBAR_MENU_HEIGHT)
        : TOOLBAR_HEIGHT,
    });

    // The page never moves for a menu; only the bar above it grows.
    content.setBounds({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width,
      height: Math.max(0, height - TOOLBAR_HEIGHT),
    });
  };

  entry.layout = layout;

  layout();
  win.on("resize", layout);

  browserWindows.add(entry);

  const sendState = () => {
    if (toolbar.webContents.isDestroyed()) return;
    toolbar.webContents.send("browser-bar-state", {
      url: content.webContents.getURL(),
      title: content.webContents.getTitle(),
      canGoBack: content.webContents.navigationHistory.canGoBack(),
      canGoForward: content.webContents.navigationHistory.canGoForward(),
      loading: content.webContents.isLoading(),
      adblock: adblockEnabled(),
    });
  };

  for (const event of [
    "did-navigate",
    "did-navigate-in-page",
    "did-start-loading",
    "did-stop-loading",
    "page-title-updated",
  ]) {
    content.webContents.on(event, sendState);
  }

  // A link that wants a new window opens another browser window rather than a
  // chromeless popup with no way back.
  content.webContents.setWindowOpenHandler(({ url: target }) => {
    openInAppBrowser(target);
    return { action: "deny" };
  });

  toolbar.webContents.once("did-finish-load", sendState);

  win.on("closed", () => {
    browserWindows.delete(entry);
  });

  const toolbarUrl = isDevelopment()
    ? "http://127.0.0.1:5173/?browserbar=true"
    : `${RENDERER_ORIGIN}/index.html?browserbar=true`;

  toolbar.webContents.loadURL(toolbarUrl);
  content.webContents.loadURL(url, {
    userAgent: cleanUserAgent(content.webContents),
  });

  return entry;
}

/** Shuts every in-app browser window, which is what quitting should mean. */
function closeBrowserWindows() {
  for (const entry of [...browserWindows]) {
    if (!entry.win.isDestroyed()) entry.win.destroy();
  }
  browserWindows.clear();
}

/** The window a toolbar belongs to, found from the message it just sent. */
function browserWindowFor(event) {
  for (const entry of browserWindows) {
    if (entry.toolbar.webContents.id === event.sender.id) return entry;
  }
  return null;
}

function broadcastBrowserState() {
  for (const entry of browserWindows) {
    if (entry.toolbar.webContents.isDestroyed()) continue;
    entry.toolbar.webContents.send("browser-bar-state", {
      url: entry.content.webContents.getURL(),
      title: entry.content.webContents.getTitle(),
      canGoBack: entry.content.webContents.navigationHistory.canGoBack(),
      canGoForward: entry.content.webContents.navigationHistory.canGoForward(),
      loading: entry.content.webContents.isLoading(),
      adblock: adblockEnabled(),
    });
  }
}

ipcMain.handle("browser-bar-menu", (event, open) => {
  const entry = browserWindowFor(event);
  if (!entry) return { success: false };

  entry.menuOpen = Boolean(open);
  entry.layout();
  return { success: true };
});

ipcMain.handle("browser-bar-action", (event, action, value) => {
  const entry = browserWindowFor(event);
  if (!entry) return { success: false };

  const web = entry.content.webContents;

  switch (action) {
    case "back":
      if (web.navigationHistory.canGoBack()) web.navigationHistory.goBack();
      break;
    case "forward":
      if (web.navigationHistory.canGoForward()) web.navigationHistory.goForward();
      break;
    case "reload":
      web.reload();
      break;
    case "stop":
      web.stop();
      break;
    case "navigate": {
      const target = normaliseTypedUrl(String(value || ""));
      if (target) web.loadURL(target, { userAgent: cleanUserAgent(web) });
      break;
    }
    default:
      return { success: false };
  }

  return { success: true };
});

/**
 * What the user typed in the address bar. Anything not obviously a URL is a
 * search: "how tall is everest" should not become a failed DNS lookup.
 */
function normaliseTypedUrl(raw) {
  const value = raw.trim();
  if (!value) return null;
  // A typed `http://localhost:3000` is someone's own dev server and should
  // work; a typed `file://` falls through to a search rather than loading.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return urlPolicy.isFetchableUrl(value, { allowPrivate: true }) ? value : null;
  }
  if (/^[^\s/]+\.[^\s/]{2,}(\/|$|\?)/.test(value)) return `https://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

ipcMain.handle("browser-bar-set-adblock", async (event, enabled) => {
  const on = Boolean(enabled);

  try {
    storage.setValue(ADBLOCK_KEY, on ? "on" : "off");
  } catch (error) {
    log.warn("adblocker", `could not save the setting: ${error.message}`);
  }

  const active = await applyAdblockSetting();

  // Filters are decided as a request is made, so the page in front of the user
  // only changes once it is asked for again.
  const entry = browserWindowFor(event);
  if (entry && !entry.content.webContents.isDestroyed()) {
    entry.content.webContents.reload();
  }

  broadcastBrowserState();
  return { success: true, enabled: active };
});

let mainWindow;
let splashWindow;
let bootCompleted = false;

const isDevelopment = () => {
  if (process.env.DRAGGY_RENDERER === "dist") return false;
  if (process.env.DRAGGY_RENDERER === "vite") return true;
  return process.env.NODE_ENV === "development" || !app.isPackaged;
};

const isRendererUrl = (url) =>
  url.startsWith(RENDERER_ORIGIN) ||
  url.startsWith("http://127.0.0.1:5173") ||
  url.startsWith("file://");

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_NAME);
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    backgroundColor: "#1E1E1E",
    title: APP_NAME,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.on("closed", () => {
    splashWindow = null;
    if (!bootCompleted) app.quit();
  });

  splashWindow.webContents.setWindowOpenHandler(({ url }) => {
    openInAppBrowser(url);
    return { action: "deny" };
  });
  splashWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://") && !url.startsWith("http://127.")) {
      e.preventDefault();
      openInAppBrowser(url);
    }
  });

  logger.attachWindow(splashWindow, "splash");

  if (isDevelopment()) {
    splashWindow.loadURL("http://127.0.0.1:5173/?splash=true");
  } else {
    splashWindow.loadURL(`${RENDERER_ORIGIN}/index.html?splash=true`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: "#1E1E1E",
    title: APP_NAME,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openInAppBrowser(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isRendererUrl(url)) {
      e.preventDefault();
      openInAppBrowser(url);
    }
  });

  const template = [
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  mainWindow.setMenuBarVisibility(false);
  if (!app.isPackaged) {
    mainWindow.webContents.on("console-message", (details) => {
      console.log("[RENDERER]", details.message ?? details);
    });
  }
  mainWindow.setAutoHideMenuBar(true);

  // The browser belongs to the app, not the other way round. A browser window
  // left open kept Draggy running with its own window already gone.
  mainWindow.on("closed", closeBrowserWindows);

  logger.attachWindow(mainWindow, "main");

  if (isDevelopment()) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadURL(`${RENDERER_ORIGIN}/index.html`);
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

app.whenReady().then(() => {
  const adopted = adoptLegacyDataFolder();

  logger.init(app);
  for (const note of adopted) log.info("appData", note);

  try {
    storage.init(app.getPath("userData"));
  } catch (error) {
    log.error("storage", "could not open the chat database", error);
  }

  try {
    library.init(app.getPath("userData"));
  } catch (error) {
    log.error("library", "could not open the document index", error);
  }

  mcp.init(app.getPath("userData"));

  protocol.handle("draggy", serveCachedModelFile);
  protocol.handle("app", serveRendererFile);

  // The renderer's own policy, and deliberately only the renderer's: the web
  // session below is left with whatever policy each site sends for itself.
  applyContentSecurityPolicy(session.defaultSession, !isDevelopment());

  adblocker.primeAdblocker(app.getPath("userData"));
  applyAdblockSetting().catch((error) =>
    log.warn("adblocker", `could not apply the setting: ${error.message}`),
  );

  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback) => {
      const isAppWindow =
        mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents;
      callback(Boolean(isAppWindow) && permission === "media");
    },
  );

  createSplashWindow();
  createWindow();

  updater.init(app, (state) => broadcast("updater-state", state));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * Everything Draggy started, stopped on the way out. One step failing must not
 * skip the rest, so each is on its own.
 */
function shutdown() {
  const steps = [
    ["browsers", closeBrowserWindows],
    ["updater", () => updater.dispose()],
    // Servers and code runs are children of this process and would otherwise
    // be left running after the window is gone.
    ["mcp", () => mcp.stopAll()],
    ["runner", () => runner.stopAll()],
    ["ollama", stopOllama],
    ["storage", () => storage.close()],
    ["library", () => library.close()],
  ];

  for (const [name, step] of steps) {
    try {
      step();
    } catch (error) {
      log.warn("shutdown", `${name}: ${error?.message || error}`);
    }
  }
}

/** Only ever the instance Draggy started, never one that was already running. */
function stopOllama() {
  if (!ollamaStartedHere) return;

  const child = ollamaStartedHere;
  ollamaStartedHere = null;
  platform.killTree(child);
}

app.on("before-quit", shutdown);

ipcMain.on("boot-finished", (event, model) => {
  bootCompleted = true;

  const closeSplash = () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  };

  if (!mainWindow || mainWindow.isDestroyed()) {
    closeSplash();
    return;
  }

  const reveal = () => {
    if (!mainWindow.isDestroyed()) {
      if (model) mainWindow.webContents.send("boot-model", model);
      mainWindow.show();
    }
    closeSplash();
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", reveal);
  } else {
    reveal();
  }
});

ipcMain.on("quit-app", () => app.quit());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let cachedSpecs = null;

ipcMain.handle("get-system-specs", async () => {
  if (cachedSpecs) return cachedSpecs;

  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : "Unknown CPU";
  const totalMemGB = os.totalmem() / 1024 ** 3;
  const unified = platform.hasUnifiedMemory();

  let vram = 0;

  if (!unified) {
    try {
      const gpuInfo = await app.getGPUInfo("complete");
      const videoMemoryMb = gpuInfo?.auxAttributes?.videoMemoryMb;
      if (typeof videoMemoryMb === "number" && videoMemoryMb > 0) {
        vram = videoMemoryMb / 1024;
      }
    } catch {
      vram = 0;
    }
  }

  if (vram <= 0) vram = await platform.detectVideoMemoryGB();

  cachedSpecs = {
    cpu: cpuModel,
    ram: Number(totalMemGB.toFixed(1)),
    vram: Number(vram.toFixed(1)),
    unifiedMemory: unified,
    platform: process.platform,
    arch: os.arch(),
  };

  log.info(
    "specs",
    `${cpuModel} | ${cachedSpecs.ram} GB RAM | ${cachedSpecs.vram} GB VRAM${unified ? " (unified)" : ""}`,
  );

  return cachedSpecs;
});

ipcMain.handle("check-internet", async () => {
  return new Promise((resolve) => {
    const req = https.get("https://www.google.com", (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
});

ipcMain.handle("check-disk-space", async () => {
  try {
    const appPath = app.getPath("userData");
    const stats = fs.statfsSync(appPath);
    const freeGB = (stats.bavail * stats.bsize) / 1024 ** 3;
    return freeGB;
  } catch {
    return 100;
  }
});

function isOllamaRunning(timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_URL}/api/tags`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

ipcMain.handle("check-ollama", () => isOllamaRunning());

async function scrapeInHiddenWindow({ url, userAgent, readyExpression, extract }) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: getWebSession(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    await win.loadURL(url, {
      userAgent: userAgent || DESKTOP_USER_AGENT,
      timeout: 30000,
    });

    for (let i = 0; i < 12; i++) {
      const ready = await win.webContents.executeJavaScript(readyExpression);
      if (ready) break;
      await sleep(250);
    }

    return await win.webContents.executeJavaScript(extract);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

let searchConfig = { searchProvider: "auto", searxngUrl: "", braveApiKey: "" };

ipcMain.handle("set-search-config", (event, config) => {
  searchConfig = {
    searchProvider: PROVIDER_IDS.includes(config?.searchProvider)
      ? config.searchProvider
      : "auto",
    searxngUrl: String(config?.searxngUrl || "").trim(),
    braveApiKey: String(config?.braveApiKey || "").trim(),
  };
  return { success: true };
});

ipcMain.handle("search-web", async (event, query) => {
  const { results } = await runSearch(query, searchConfig, {
    scrape: scrapeInHiddenWindow,
  });
  return results;
});

ipcMain.handle("search-web-detailed", async (event, query) =>
  runSearch(query, searchConfig, { scrape: scrapeInHiddenWindow }),
);

ipcMain.handle("get-page-content", async (event, url) => {
  if (!urlPolicy.isFetchableUrl(url)) {
    log.warn("read-url", `refused ${String(url).slice(0, 120)}`);
    return { title: "", text: "", blocked: "refused", reason: urlPolicy.refusalFor(url), url };
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: getWebSession(),
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
    },
  });

  try {
    await win.loadURL(url, {
      userAgent: cleanUserAgent(win.webContents),
      timeout: 30000,
    });

    for (let i = 0; i < 6; i++) {
      const state = await win.webContents.executeJavaScript(PAGE_STATE_SCRIPT);

      // A challenge is not something to wait out. Saying so at once gives the
      // model something true to say, and saves twelve seconds of retrying.
      if (isBotChallengePage(state)) {
        win.destroy();
        return {
          title: state.title || url,
          text: "",
          blocked: "human-verification",
          url,
        };
      }

      if (
        state.readyState === "complete" &&
        !win.webContents.isLoading() &&
        state.textLength > 200
      ) {
        break;
      }

      await sleep(2000);
    }

    const result = await win.webContents.executeJavaScript(`
      (() => {
        document.querySelectorAll('script, style, nav, footer, header, aside, .ad, .ads, [role="banner"], [role="navigation"]')
          .forEach(el => el.remove());

        const title = document.title || '';
        const mainEl = document.querySelector('main, article, [role="main"]') || document.body;
        const text = mainEl.innerText
          .replace(/[ \\t]+/g, ' ')       
          .replace(/\\n{3,}/g, '\\n\\n')  
          .trim()
          .substring(0, 15000);           

        return JSON.stringify({ title, text });
      })();
    `);

    win.destroy();
    return JSON.parse(result);
  } catch (e) {
    win.destroy();
    console.error("Get Page Content Error:", e);
    throw e;
  }
});

let browserSession = null;

function getBrowserSession() {
  if (browserSession && !browserSession.isDestroyed()) return browserSession;

  browserSession = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      session: getWebSession(),
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
      plugins: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  browserSession.on('closed', () => {
    browserSession = null;
  });

  return browserSession;
}

ipcMain.handle("browser-navigate", async (event, url) => {
  if (!urlPolicy.isFetchableUrl(url)) {
    log.warn("browser", `refused navigation to ${String(url).slice(0, 120)}`);
    return { success: false, refused: true, error: urlPolicy.refusalFor(url) };
  }

  const win = getBrowserSession();

  try {
    await win.loadURL(url, {
      userAgent: cleanUserAgent(win.webContents),
      timeout: 30000,
    });

    for (let i = 0; i < 6; i++) {
      const state = await win.webContents.executeJavaScript(PAGE_STATE_SCRIPT);

      if (isBotChallengePage(state)) {
        return {
          success: false,
          blocked: "human-verification",
          url: win.webContents.getURL(),
          error:
            "This page is behind a human-verification challenge and cannot be read automatically.",
        };
      }

      if (state.readyState === "complete" && state.textLength > 50) break;
      await sleep(2000);
    }

    const title = await win.webContents.executeJavaScript('document.title || ""');
    const currentUrl = win.webContents.getURL();
    return { success: true, title, url: currentUrl };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

const COLLECT_ELEMENTS_FN = `
  function __draggyCollect() {
    const items = [];
    const seen = new Set();
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach((el) => {
      const text = (el.innerText || el.value || el.title || el.getAttribute('aria-label') || '').trim().substring(0, 80);
      if (!text || seen.has(text)) return;
      seen.add(text);
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) items.push({ el, rect, type: 'button', text });
    });
    document.querySelectorAll('a[href]').forEach((el) => {
      const text = (el.innerText || el.title || el.getAttribute('aria-label') || '').trim().substring(0, 80);
      if (!text || seen.has(text)) return;
      seen.add(text);
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) items.push({ el, rect, type: 'link', text, href: el.href });
    });
    document.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || el.tagName;
      items.push({
        el,
        rect,
        type: el.tagName === 'SELECT' ? 'select' : 'input',
        text: String(label).substring(0, 80),
        value: el.value || '',
      });
    });
    return items;
  }
`;


function parseElementIndex(value) {
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

ipcMain.handle("browser-get-elements", async () => {
  const win = getBrowserSession();
  try {
    const currentUrl = win.webContents.getURL();
    if (!currentUrl || currentUrl === "about:blank") {
      return { success: false, error: "Browser has not navigated to a page yet. Please use browser_navigate first." };
    }
    const data = await win.webContents.executeJavaScript(`
      (() => {
        ${COLLECT_ELEMENTS_FN}
        return JSON.stringify(__draggyCollect().slice(0, 50).map((it, index) => ({
          index,
          type: it.type,
          text: it.text,
          href: it.href,
          value: it.value,
          x: Math.round(it.rect.x + it.rect.width / 2),
          y: Math.round(it.rect.y + it.rect.height / 2),
        })));
      })();
    `);
    return { success: true, elements: JSON.parse(data) };
  } catch (e) {
    return { success: false, error: e.message, elements: [] };
  }
});

ipcMain.handle("browser-click", async (event, elementIndex) => {
  const index = parseElementIndex(elementIndex);
  if (index === null) {
    return { success: false, error: "Invalid element index" };
  }

  const win = getBrowserSession();
  try {
    const currentUrl = win.webContents.getURL();
    if (!currentUrl || currentUrl === "about:blank") {
      return { success: false, error: "Browser has not navigated to a page yet. Please use browser_navigate first." };
    }
    const coordData = await win.webContents.executeJavaScript(`
      (() => {
        ${COLLECT_ELEMENTS_FN}
        const target = __draggyCollect()[${index}];
        if (!target) return JSON.stringify({ error: "Element not found" });
        target.el.click();
        target.el.focus();
        return JSON.stringify({
          success: true,
          x: Math.round(target.rect.x + target.rect.width / 2),
          y: Math.round(target.rect.y + target.rect.height / 2),
        });
      })();
    `);
    const result = JSON.parse(coordData);
    if (result.error) return { success: false, error: result.error };
  
    win.webContents.sendInputEvent({ type: 'mouseMove', x: result.x, y: result.y });
    await sleep(50);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: result.x, y: result.y, button: 'left', clickCount: 1 });
    await sleep(50);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: result.x, y: result.y, button: 'left', clickCount: 1 });
    await sleep(500);

    const title = await win.webContents.executeJavaScript('document.title || ""');
    const updatedUrl = win.webContents.getURL();
    return { success: true, title, url: updatedUrl };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("browser-type", async (event, elementIndex, text) => {
  const index = parseElementIndex(elementIndex);
  if (index === null) {
    return { success: false, error: "Invalid element index" };
  }

  const win = getBrowserSession();
  try {
    const currentUrl = win.webContents.getURL();
    if (!currentUrl || currentUrl === "about:blank") {
      return { success: false, error: "Browser has not navigated to a page yet. Please use browser_navigate first." };
    }
    const typed = await win.webContents.executeJavaScript(`
      (() => {
        ${COLLECT_ELEMENTS_FN}
        const target = __draggyCollect()[${index}];
        if (!target) return false;
        target.el.focus();
        const val = ${JSON.stringify(String(text ?? ""))};
        if (target.el.isContentEditable || target.el.getAttribute('contenteditable') === 'true') {
          target.el.innerText = val;
        } else {
          target.el.value = val;
        }
        target.el.dispatchEvent(new Event('input', { bubbles: true }));
        target.el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })();
    `);
    if (!typed) return { success: false, error: "Element not found" };
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("browser-press-key", async (event, key) => {
  const win = getBrowserSession();
  try {
    const currentUrl = win.webContents.getURL();
    if (!currentUrl || currentUrl === "about:blank") {
      return { success: false, error: "Browser has not navigated to a page yet. Please use browser_navigate first." };
    }
    const keyMap = { enter: 'Return', tab: 'Tab', escape: 'Escape', backspace: 'Backspace', space: ' ' };
    const keyCode = keyMap[key.toLowerCase()] || key;
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    await new Promise(r => setTimeout(r, 50));
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await new Promise(r => setTimeout(r, 300));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("browser-get-text", async () => {
  const win = getBrowserSession();
  try {
    const currentUrl = win.webContents.getURL();
    if (!currentUrl || currentUrl === "about:blank") {
      return { success: false, error: "Browser has not navigated to a page yet. Please use browser_navigate first." };
    }
    const result = await win.webContents.executeJavaScript(`
      (() => {
        document.querySelectorAll('script, style, nav, footer, header, aside, .ad, .ads, [role="banner"], [role="navigation"]')
          .forEach(el => el.remove());
        const title = document.title || '';
        const mainEl = document.querySelector('main, article, [role="main"]') || document.body;
        const text = mainEl.innerText
          .replace(/[ \\t]+/g, ' ')
          .replace(/\\n{3,}/g, '\\n\\n')
          .trim()
          .substring(0, 12000);
        const url = window.location.href;
        return JSON.stringify({ title, text, url });
      })();
    `);
    return { success: true, ...JSON.parse(result) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("browser-close", async () => {
  if (browserSession && !browserSession.isDestroyed()) {
    browserSession.destroy();
    browserSession = null;
  }
  return { success: true };
});

const resolveOllamaLauncher = platform.resolveOllamaLauncher;

let isStartingOllama = false;

/**
 * Ollama, only when Draggy was the one that started it. An instance that was
 * already up belongs to whoever started it and is left alone on quit.
 */
let ollamaStartedHere = null;

ipcMain.handle("start-ollama", async () => {
  if (isStartingOllama) return true;
  isStartingOllama = true;

  try {
    const checkRunning = () => isOllamaRunning(1000);

    if (await checkRunning()) {
      isStartingOllama = false;
      return true;
    }

    const launcher = await resolveOllamaLauncher();
    if (!launcher) {
      isStartingOllama = false;
      return false;
    }

    log.info("ollama", `starting ${launcher.file}`);

    const child = platform.spawnHidden(launcher.file, launcher.args, {
      detached: false,
      stdio: "ignore",
      env: { ...platform.defaultShellEnv(), OLLAMA_HOST },
    });
    child.unref();

    ollamaStartedHere = child;
    child.on("exit", () => {
      if (ollamaStartedHere === child) ollamaStartedHere = null;
    });

    let started = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await checkRunning()) {
        started = true;
        break;
      }
    }

    isStartingOllama = false;
    return started;
  } catch {
    isStartingOllama = false;
    return false;
  }
});


function httpsGetFollow(url, onResponse, onError, depth = 0) {
  if (depth > 5) {
    onError(new Error("Too many redirects"));
    return;
  }
  const req = https.get(url, (res) => {
    const status = res.statusCode || 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume(); 
      httpsGetFollow(
        new URL(res.headers.location, url).toString(),
        onResponse,
        onError,
        depth + 1,
      );
      return;
    }
    if (status !== 200) {
      res.resume();
      onError(new Error(`Download failed with status ${status}`));
      return;
    }
    onResponse(res);
  });
  req.on("error", onError);
}

ipcMain.handle("install-ollama", async () => {
  const spec = platform.ollamaInstaller();

  if (spec.mode === "manual") {
    log.info("ollama", "no silent installer for this platform, opening download page");
    await shell.openExternal(spec.url);
    return false;
  }

  const installerPath = path.join(app.getPath("temp"), spec.filename);

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(installerPath);
    let failed = false;
    const cleanup = (err) => {
      if (failed) return;
      failed = true;
      file.destroy();
      fs.unlink(installerPath, () => {});
      reject(err);
    };

    httpsGetFollow(
      spec.url,
      (response) => {
        const totalSize =
          parseInt(response.headers["content-length"], 10) || 0;
        let downloadedSize = 0;
        let lastSent = 0;

        response.on("data", (chunk) => {
          downloadedSize += chunk.length;

          const now = Date.now();
          if (now - lastSent < 100 && downloadedSize !== totalSize) return;
          lastSent = now;

          const progress = {
            percent: totalSize ? (downloadedSize / totalSize) * 100 : 0,
            completed: downloadedSize,
            total: totalSize,
          };
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) {
              win.webContents.send("download-progress", progress);
            }
          });
        });

        response.on("error", cleanup);
        file.on("error", cleanup);

        response.pipe(file);
        file.on("close", async () => {
          if (failed) return;

          if (spec.mode === "dmg") {
            try {
              const installed = await platform.installFromDmg(installerPath);
              fs.unlink(installerPath, () => {});
              resolve(installed);
            } catch (e) {
              fs.unlink(installerPath, () => {});
              reject(e);
            }
            return;
          }

          try {
            const child = platform.spawnHidden(installerPath, spec.args, {
              detached: true,
              stdio: "ignore",
            });
            child.on("exit", () => {
              fs.unlink(installerPath, () => {});
            });
            child.unref();
            resolve(true);
          } catch (e) {
            reject(e);
          }
        });
      },
      cleanup,
    );
  });
});

const OLLAMA_LIBRARY = "https://ollama.com";
const OLLAMA_REGISTRY = "https://registry.ollama.ai";
const MODEL_SIZE_CACHE = new Map();

function decodeHtml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (whole, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .trim();
}

function isCloudTag(tag) {
  const value = String(tag || "").toLowerCase();
  return value === "cloud" || value.endsWith("-cloud");
}

function parseSearchResults(html) {
  const blocks = html.split(/<li[\s>]/).slice(1);
  const models = [];

  for (const block of blocks) {
    const nameMatch = block.match(/href="\/library\/([a-zA-Z0-9._:-]+)"/);
    if (!nameMatch) continue;

    const descMatch = block.match(
      /<p[^>]*class="[^"]*max-w-lg[^"]*"[^>]*>([\s\S]*?)<\/p>/,
    );

    const capabilities = [];
    const sizes = [];
    let cloudOnly = false;
    const tagPattern = /class="([^"]*?)"[^>]*>([^<]{1,24})<\/span>/g;
    let tag;
    while ((tag = tagPattern.exec(block)) !== null) {
      const classes = tag[1];
      const label = decodeHtml(tag[2]);
      if (!label) continue;
      if (classes.includes("bg-cyan-50")) {
        if (label.toLowerCase() === "cloud") cloudOnly = true;
      } else if (classes.includes("bg-indigo-50")) capabilities.push(label);
      else if (classes.includes("ddf4ff") && !isCloudTag(label)) sizes.push(label);
    }

    if (cloudOnly && sizes.length === 0) continue;

    models.push({
      name: nameMatch[1],
      description: descMatch ? decodeHtml(descMatch[1].replace(/<[^>]+>/g, " ")) : "",
      capabilities: [...new Set(capabilities)],
      sizes: [...new Set(sizes)],
    });
  }

  return models;
}

ipcMain.handle("search-models", async (event, query) => {
  const term = String(query || "").trim();
  const url = term
    ? `${OLLAMA_LIBRARY}/search?q=${encodeURIComponent(term)}`
    : `${OLLAMA_LIBRARY}/library?sort=popular`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": APP_NAME },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return { success: false, error: `Library returned ${response.status}` };
    }

    return { success: true, models: parseSearchResults(await response.text()) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("model-size", async (event, name, tag) => {
  if (isCloudTag(tag)) return { success: false, error: "Cloud-only model" };

  const reference = `${name}:${tag || "latest"}`;
  if (MODEL_SIZE_CACHE.has(reference)) {
    return { success: true, bytes: MODEL_SIZE_CACHE.get(reference) };
  }

  const repository = name.includes("/") ? name : `library/${name}`;

  try {
    const response = await fetch(
      `${OLLAMA_REGISTRY}/v2/${repository}/manifests/${tag || "latest"}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) },
    );
    if (!response.ok) {
      return { success: false, error: `Registry returned ${response.status}` };
    }

    const manifest = await response.json();
    const layers = manifest.layers || [];
    const weights = layers.find((layer) =>
      String(layer.mediaType).includes(".model"),
    );
    if (!weights) return { success: false, error: "No weights layer" };

    MODEL_SIZE_CACHE.set(reference, weights.size);
    return { success: true, bytes: weights.size };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

const createdFilesDir = () => path.join(app.getPath("userData"), "created_files");

function isInsideCreatedFilesDir(resolved) {
  const dir = path.resolve(createdFilesDir());
  const relative = path.relative(dir, resolved);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

ipcMain.handle("open-file", async (event, filepath) => {
  const resolved = path.resolve(String(filepath || ""));
  if (!isInsideCreatedFilesDir(resolved)) {
    return `Refused to open a file outside the ${APP_NAME} output folder`;
  }
  return await shell.openPath(resolved);
});

ipcMain.handle("read-document", async (event, filename, data) => {
  try {
    const text = await documents.extractText(String(filename), Buffer.from(data));
    const trimmed = text.slice(0, documents.DOCUMENT_TEXT_LIMIT).trim();
    if (!trimmed) return { success: false, error: "No readable text found" };

    return { success: true, text: trimmed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("create-file", async (event, filename, content) => {
  try {
    const safeFilename = path.basename(String(filename));

    if (!safeFilename || safeFilename === "." || safeFilename === "..") {
      return { success: false, error: "That file name is not usable." };
    }

    if (documents.isExecutableName(safeFilename)) {
      log.warn("create-file", `refused executable name ${safeFilename}`);
      return {
        success: false,
        error: `Refused to write ${safeFilename}: ${APP_NAME} does not create executable or script files that Windows, macOS or Linux would run on a double-click. Use a .txt or .md extension instead.`,
      };
    }

    const dir = createdFilesDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filepath = path.join(dir, safeFilename);
    if (!isInsideCreatedFilesDir(path.resolve(filepath))) {
      return { success: false, error: "Refused to write outside the output folder." };
    }

    // PDFs are laid out by Chromium, so they skip `documents`, which is kept
    // free of Electron so it can be tested in plain Node.
    if (path.extname(safeFilename).toLowerCase() === ".pdf") {
      await pdfWriter.writePdf(filepath, String(content ?? ""));
    } else {
      await documents.writeGeneratedFile(filepath, String(content ?? ""));
    }

    log.info("create-file", `wrote ${safeFilename}`);
    return { success: true, filepath, filename: safeFilename };
  } catch (error) {
    log.error("create-file", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("open-created-files", async () => {
  const dir = createdFilesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

// The folder on disk is the record of what the model made, not a list kept in
// the app: a file deleted outside the app should simply stop being listed.
ipcMain.handle("list-created-files", async () => {
  try {
    const dir = createdFilesDir();
    if (!fs.existsSync(dir)) return { success: true, files: [] };

    const files = [];
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let stats;
      try {
        stats = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;

      files.push({
        name,
        path: full,
        size: stats.size,
        modified: stats.mtimeMs,
        extension: path.extname(name).slice(1).toLowerCase(),
      });
    }

    files.sort((a, b) => b.modified - a.modified);
    return { success: true, files };
  } catch (error) {
    log.error("list-created-files", error);
    return { success: false, error: error.message, files: [] };
  }
});

ipcMain.handle("reveal-created-file", async (event, filepath) => {
  const resolved = path.resolve(String(filepath));
  if (!isInsideCreatedFilesDir(resolved)) {
    return { success: false, error: "That file is outside the output folder." };
  }
  shell.showItemInFolder(resolved);
  return { success: true };
});

ipcMain.handle("delete-created-file", async (event, filepath) => {
  try {
    const resolved = path.resolve(String(filepath));
    if (!isInsideCreatedFilesDir(resolved)) {
      return { success: false, error: "That file is outside the output folder." };
    }
    // Into the recycle bin rather than gone, so a mis-click is recoverable.
    await shell.trashItem(resolved);
    return { success: true };
  } catch (error) {
    log.error("delete-created-file", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("read-created-file", async (event, filepath) => {
  try {
    const resolved = path.resolve(String(filepath));
    if (!isInsideCreatedFilesDir(resolved)) {
      return { success: false, error: "That file is outside the output folder." };
    }

    const stats = fs.statSync(resolved);
    const PREVIEW_LIMIT = 200 * 1024;
    const buffer = fs.readFileSync(resolved);
    const text = buffer.subarray(0, PREVIEW_LIMIT).toString("utf8");

    return {
      success: true,
      text,
      truncated: stats.size > PREVIEW_LIMIT,
      // A NUL byte in the first kilobyte means this is not text to show.
      binary: buffer.subarray(0, 1024).includes(0),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

const wrap = (scope, handler) => async (...args) => {
  try {
    return await handler(...args);
  } catch (error) {
    log.error(scope, error);
    return { success: false, error: error.message };
  }
};

ipcMain.handle("db:load-chats", wrap("db", async () => ({
  success: true,
  chats: storage.loadChats(),
})));

ipcMain.handle("db:save-chat", wrap("db", async (event, session) =>
  storage.saveChat(session),
));

ipcMain.handle("db:delete-chat", wrap("db", async (event, id) =>
  storage.deleteChat(String(id)),
));

ipcMain.handle("db:clear-chats", wrap("db", async () => storage.clearChats()));

ipcMain.handle("db:search-chats", wrap("db", async (event, query) => ({
  success: true,
  results: storage.searchChats(query),
})));

ipcMain.handle("db:get", wrap("db", async (event, key) => ({
  success: true,
  value: storage.getValue(String(key)),
})));

ipcMain.handle("db:set", wrap("db", async (event, key, value) =>
  storage.setValue(String(key), value),
));

ipcMain.handle("db:import", wrap("db", async (event, sessions) =>
  storage.importSessions(sessions),
));

ipcMain.handle("db:stats", wrap("db", async () => ({
  success: true,
  stats: storage.stats(),
})));

ipcMain.handle("library:list", wrap("library", async () => ({
  success: true,
  sources: library.listSources(),
})));

ipcMain.handle("library:stats", wrap("library", async () => ({
  success: true,
  stats: library.stats(),
})));

ipcMain.handle("library:pick-folder", wrap("library", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "Choose a folder to index",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, cancelled: true };
  }

  return { success: true, path: result.filePaths[0] };
}));

let indexingRun = null;

ipcMain.handle("library:index", wrap("library", async (event, sourcePath, model) => {
  if (indexingRun) return { success: false, error: "An index run is already in progress." };

  const embedModel = String(model || library.DEFAULT_EMBED_MODEL);
  library.setMeta("embed_model", embedModel);

  indexingRun = library
    .indexSource(String(sourcePath), embedModel, (progress) =>
      broadcast("library-progress", progress),
    )
    .finally(() => {
      indexingRun = null;
    });

  return indexingRun;
}));

ipcMain.handle("library:remove", wrap("library", async (event, id) =>
  library.removeSource(id),
));

ipcMain.handle("library:clear", wrap("library", async () => library.clear()));

ipcMain.handle("library:search", wrap("library", async (event, query, limit, model, options) =>
  library.search(
    query,
    limit,
    String(model || library.meta("embed_model", library.DEFAULT_EMBED_MODEL)),
    options || {},
  ),
));

ipcMain.handle("runner:probe", wrap("runner", async () => ({
  success: true,
  ...(await runner.probe()),
})));

ipcMain.handle("run-code", wrap("runner", async (event, language, source, timeoutMs) =>
  runner.runCode({
    userDataPath: app.getPath("userData"),
    language,
    source,
    timeoutMs,
  }),
));

ipcMain.handle("updater:state", () => updater.current());
ipcMain.handle("updater:configure", (event, options) =>
  updater.configure(options || {}),
);
ipcMain.handle("updater:check", (event, options) => updater.check(options || {}));
ipcMain.handle("updater:download", () => updater.download());
ipcMain.handle("updater:install", () => updater.install());

ipcMain.handle("app:version", () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  platform: process.platform,
  arch: os.arch(),
  packaged: app.isPackaged,
}));


/**
 * MCP servers, configured per server in the usual store. Credentials go there
 * too: the same local SQLite file, and the same protection the chats get.
 */
const MCP_CONFIG_KEY = "mcpServers";

function mcpConfig() {
  try {
    const raw = storage.getValue(MCP_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveMcpConfig(config) {
  storage.setValue(MCP_CONFIG_KEY, JSON.stringify(config));
}

ipcMain.handle("mcp:catalogue", () => ({
  success: true,
  servers: mcpCatalogue.listCatalogue(),
}));

ipcMain.handle("mcp:config", () => ({ success: true, config: mcpConfig() }));

ipcMain.handle("mcp:save", wrap("mcp", async (event, id, entry) => {
  const config = mcpConfig();

  if (!mcpCatalogue.findEntry(String(id))) {
    return { success: false, error: `There is no server called "${id}".` };
  }

  config[String(id)] = {
    enabled: Boolean(entry?.enabled),
    env: entry?.env && typeof entry.env === "object" ? entry.env : {},
    arguments:
      entry?.arguments && typeof entry.arguments === "object" ? entry.arguments : {},
  };

  saveMcpConfig(config);
  return { success: true };
}));

ipcMain.handle("mcp:forget", wrap("mcp", async (event, id) => {
  const config = mcpConfig();
  delete config[String(id)];
  saveMcpConfig(config);
  mcp.stopServer(String(id));
  return { success: true };
}));

ipcMain.handle("mcp:start", wrap("mcp", async (event, id) => {
  const config = mcpConfig();
  const state = await mcp.startServer(String(id), config[String(id)] || {});
  broadcast("mcp-state", { servers: mcp.listRunning() });
  return { success: state.status === "ready", state };
}));

ipcMain.handle("mcp:stop", wrap("mcp", async (event, id) => {
  const result = mcp.stopServer(String(id));
  broadcast("mcp-state", { servers: mcp.listRunning() });
  return result;
}));

ipcMain.handle("mcp:running", () => ({ success: true, servers: mcp.listRunning() }));

ipcMain.handle("mcp:call", wrap("mcp", async (event, serverId, toolName, args) =>
  mcp.callTool(String(serverId), String(toolName), args || {}),
));

/**
 * Starts what the user switched on, once the window is up. A ten-second npx
 * install should not hold the splash screen, and no tool is needed yet.
 */
ipcMain.handle("mcp:start-enabled", wrap("mcp", async () => {
  const config = mcpConfig();
  const states = [];

  for (const [id, entry] of Object.entries(config)) {
    if (!entry?.enabled) continue;
    states.push(await mcp.startServer(id, entry));
  }

  broadcast("mcp-state", { servers: mcp.listRunning() });
  return { success: true, servers: states };
}));

ipcMain.handle("logs:open", async () => shell.openPath(logger.logFolder()));
ipcMain.handle("logs:tail", () => logger.readTail());
