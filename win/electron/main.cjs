const {
  app,
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  dialog,
  ipcMain,
  Menu,
  Notification,
  nativeTheme,
  safeStorage,
  crashReporter,
  powerMonitor,
  shell,
  protocol,
  screen,
  session,
} = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const { DOCUMENT_HEADERS } = require("./isolation.cjs");
const adblocker = require("./adblocker.cjs");
const favicon = require("./favicon.cjs");
const logger = require("./logger.cjs");
const { log } = logger;
const { createIpc, sendTo } = require("./ipcLog.cjs");
const ipc = createIpc(ipcMain);
const lifecycle = require("./lifecycleLog.cjs");
const spawnLog = require("./spawnLog.cjs");
const startup = lifecycle.createTimeline("startup", { now: () => process.uptime() * 1000 });
let startupTimer = null;
function finishStartup() {
  clearTimeout(startupTimer);
  startup.finish();
}
const platform = require("./platform.cjs");
const documents = require("./documents.cjs");
const storage = require("./storage.cjs");
const fsGuard = require("./fsGuard.cjs");
const gitTools = require("./git.cjs");
const apiServerTools = require("./apiServer.cjs");
const checkpoints = require("./checkpoints.cjs");
const secrets = require("./secrets.cjs");
const mcpRegistry = require("./mcpRegistry.cjs");
const skills = require("./skills.cjs");
const fileOperations = require("./fileOps.cjs");
const library = require("./library.cjs");
const runner = require("./runner.cjs");
const commands = require("./commands.cjs");
const { flushWindow, closeLogs } = require("./quitFlush.cjs");
const updater = require("./updater.cjs");
const { runSearch, PROVIDER_IDS, DESKTOP_USER_AGENT } = require("./search.cjs");
const appData = require("./appData.cjs");
const onboarding = require("./onboarding.cjs");
const settingsLog = require("./settingsLog.cjs");
const themes = require("./theme.cjs");
const connectivity = require("./connectivity.cjs");
const { createGateway } = require("./providers/gateway.cjs");
const { createRegistry } = require("./providers/registry.cjs");
const { createModels } = require("./providers/models.cjs");
const { createDiscovery } = require("./providers/discovery.cjs");
const { createRemoteCatalog } = require("./providers/remoteCatalog.cjs");
const { createProviderHandlers } = require("./providers/ipc.cjs");
const { createTtsHandlers } = require("./tts/ipc.cjs");
const { createConsent } = require("./tts/consent.cjs");
const { createCodexAdapter } = require("./providers/adapters/codex.cjs");
const { createClaudeAdapter } = require("./providers/adapters/claude.cjs");
const { createAgyAdapter } = require("./providers/adapters/agy.cjs");
const { createSearchKey } = require("./searchKey.cjs");
const urlPolicy = require("./urlPolicy.cjs");
const { classifyPageFailure } = require("./pageFailure.cjs");
const browserControl = require("./browserControl.cjs");
const browserSnapshot = require("./browserSnapshot.cjs");
const browserInput = require("./browserInput.cjs");
const browserDialogs = require("./browserDialogs.cjs");
const browserTrace = require("./browserTrace.cjs");
const browserSafety = require("./browserSafety.cjs");
const { createBrowserPane } = require("./browserPane.cjs");
const mcp = require("./mcp.cjs");
const widgets = require("./widgets.cjs");
const mcpCatalogue = require("./mcpCatalogue.cjs");
const pdfWriter = require("./pdfWriter.cjs");
const llamaProcess = require("./llamaProcess.cjs");
const colibriProcess = require("./colibriProcess.cjs");
const colibriBinary = require("./colibriBinary.cjs");
const { createEngineHost } = require("./engineHost.cjs");
const largeModelStore = require("./largeModelStore.cjs");
const colibriCatalog = require("./colibriCatalog.cjs");
const tierPlanner = require("./tierPlanner.cjs");
const tierStats = require("./tierStats.cjs");
const tierDiagnostics = require("./tierDiagnostics.cjs");
const diagnosticsBundle = require("./diagnosticsBundle.cjs");
const draftPairing = require("./draftPairing.cjs");
const draftStats = require("./draftStats.cjs");
const { createHardwareProbe } = require("./hardwareProbe.cjs");
const embedServer = require("./embedServer.cjs");
const binaryManager = require("./binaryManager.cjs");
const engineUpdater = require("./engineUpdater.cjs");
const modelCache = require("./modelCache.cjs");
const modelStorage = require("./modelStorage.cjs");
const huggingface = require("./huggingface.cjs");
const imageIpc = require("./imageIpc.cjs");

const MODEL_CACHE_ORIGIN = "https://huggingface.co";

/** What the app calls itself: window titles, the taskbar, the data folder. */
const APP_NAME = "Draggy";

/** Names it answered to before. Both spellings are tried because only the case-sensitive platforms
 * care and an extra `existsSync` costs nothing. */
const LEGACY_APP_NAMES = ["localai", "LocalAI"];

/** Takes over the old folder once, before the logger and database create files in the new one.
 * Returns what happened, for the log to pick up later. */
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
      stream: true,
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
  {
    // Every model request, built-in or not. CORS because the app's pages are another origin.
    scheme: "draggy-ai",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    // Extension widgets. Standard so each one gets an origin from its token,
    // and nothing else: no fetch, no CORS, and no way past the app's policy.
    scheme: "widget",
    privileges: { standard: true, secure: true },
  },
]);

const modelCacheDir = () => path.join(app.getPath("userData"), "model-cache");


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

  if (url.host === "images") {
    return imageEngine.serveCreatedImage(decodeURIComponent(url.pathname).replace(/^\/+/, ""));
  }

  if (url.host !== "models") {
    return new Response("Not found", { status: 404 });
  }

  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  return modelCache.serveModelFile(relative, { root: modelCacheDir(), origin: MODEL_CACHE_ORIGIN });
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
        ...DOCUMENT_HEADERS,
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
  "img-src 'self' app: draggy: data: blob: https:",
  "media-src 'self' app: draggy: data: blob:",
  "connect-src 'self' app: draggy: draggy-ai: blob: data: ws://127.0.0.1:5173 http://127.0.0.1:5173",
  "worker-src 'self' app: draggy: blob:",
  "object-src 'none'",
  "frame-src widget:",
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

    // A widget document arrives with a policy of its own, stricter than this
    // one. Overwriting it with the app's would hand it the app's allowances.
    if (String(details.url || "").startsWith("widget://")) {
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

function cleanUserAgent(webContents) {
  return webContents.userAgent.replace(/Electron\/[0-9.]+ /g, "");
}

/** The session every external page loads in. Off `defaultSession` so our own CSP is not forced onto
 * other people's sites, which left the browser in wreckage. */
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

  // While the agent drives, a download is kept in a folder of its own and never opened, and a
  // permission prompt is refused. The user's own browsing keeps Electron's defaults.
  ses.on("will-download", (event, item) => {
    if (!paneDriver.active()) return;
    const folder = path.join(app.getPath("userData"), "agent-downloads");
    const name = browserDialogs.safeDownloadName(item.getFilename());
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (e) {
      log.swallow("window.browser.control", "download folder failed", e);
      item.cancel();
      return;
    }
    const target = path.join(folder, `${Date.now().toString(36)}-${name}`);
    item.setSavePath(target);
    agentDownloads.running += 1;
    item.once("done", (_event, state) => {
      agentDownloads.running -= 1;
      if (state === "completed") agentDownloads.done.push({ name, bytes: item.getReceivedBytes(), path: target });
      log.info("window.browser.control", "download", { state, bytes: item.getReceivedBytes(), ext: path.extname(name).slice(0, 8) });
    });
  });
  ses.setPermissionRequestHandler((contents, permission, callback) => {
    if (!paneDriver.active()) return callback(true);
    agentDownloads.denied.add(String(permission));
    log.info("window.browser.control", "permission refused", { permission });
    callback(false);
  });

  return ses;
}

/** What the page did on its own while the agent drove: downloads it saved, prompts it was refused. */
const agentDownloads = { running: 0, done: [], denied: new Set() };

/** Hands over, once, whatever the last step left behind. */
function takeSideEffects() {
  const out = {};
  if (agentDownloads.done.length) {
    out.downloads = agentDownloads.done.splice(0).map(({ name, bytes, path: saved }) => ({ name, bytes, saved }));
  }
  if (agentDownloads.running) out.downloading = agentDownloads.running;
  if (agentDownloads.denied.size) {
    out.permissionsRefused = [...agentDownloads.denied];
    agentDownloads.denied.clear();
  }
  return out;
}

/** Whether the ad blocker is on, for every web session at once. Persisted in the renderer's store
 * so the choice survives a restart. */
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

let adblockerStarted = false;

/** The filter lists come from GitHub and two list hosts, so a new install fetches them only once
 * its setup is over: before a choice, the only request is the connectivity check. */
function startAdblocker() {
  if (adblockerStarted) return;
  adblockerStarted = true;
  adblocker.primeAdblocker(app.getPath("userData"));
  applyAdblockSetting().catch((error) =>
    log.warn("adblocker", `could not apply the setting: ${error.message}`),
  );
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

/** The browser the user gets on a link. Two views: our toolbar on `defaultSession`, and the page
 * below in the shared web session. */
const TOOLBAR_HEIGHT = 48;

/** How far the toolbar grows for an open menu. A view clips to its own bounds, so a menu below a
 * 48px bar is cut off and the page covers what is left. */
const TOOLBAR_MENU_HEIGHT = 260;

/** Every open browser window, so the toolbars can be told what changed. */
const browserWindows = new Set();

function openInAppBrowser(url) {
  // Reached from `setWindowOpenHandler` and `will-navigate`, so the string can
  // come from a page rather than from the person using the app.
  if (!urlPolicy.isFetchableUrl(url, { allowPrivate: true })) {
    log.warn("window.browser.control", "refused to open", { host: browserSafety.hostOf(url) });
    return null;
  }

  const win = new BaseWindow({
    width: 1200,
    height: 820,
    backgroundColor: windowBackground(),
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

  const sendState = () => sendBrowserState(toolbar.webContents, content.webContents);

  for (const event of PAGE_EVENTS) content.webContents.on(event, sendState);

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

/** Page events after which the toolbar is told what the page looks like now. */
const PAGE_EVENTS = [
  "did-navigate",
  "did-navigate-in-page",
  "did-start-loading",
  "did-stop-loading",
  "page-title-updated",
];

function sendBrowserState(toolbar, page) {
  if (toolbar.isDestroyed() || page.isDestroyed()) return;
  toolbar.send("browser-bar-state", {
    url: page.getURL(),
    title: page.getTitle(),
    canGoBack: page.navigationHistory.canGoBack(),
    canGoForward: page.navigationHistory.canGoForward(),
    loading: page.isLoading(),
    adblock: adblockEnabled(),
  });
}

/** The Browser pane in the main window. Created with the window; its page view only on first use. */
let browserPane = null;
const paneGuards = new WeakMap();
const activeGuard = () => paneGuards.get(browserPane?.view?.webContents);

/** The agent's hold on the pane: opens it when needed, and ends a step the moment the user takes over. */
const paneDriver = browserControl.createDriver({
  pane: {
    ensure: () => browserPane?.ensure(),
    isShown: () => Boolean(browserPane?.isShown()),
    whenShown: (ms) => (browserPane ? browserPane.whenShown(ms) : Promise.resolve(false)),
  },
  requestOpen: () => {
    if (mainWindow && !mainWindow.isDestroyed()) sendTo(mainWindow, "browser-pane-open");
  },
  onStatus: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) sendTo(mainWindow, "browser-agent-state", status);
  },
});

function sendPaneState() {
  if (!browserPane?.view || !mainWindow || mainWindow.isDestroyed()) return;
  sendBrowserState(mainWindow.webContents, browserPane.view.webContents);
}

function preparePaneView(view) {
  for (const event of PAGE_EVENTS) view.webContents.on(event, sendPaneState);
  // While the agent drives, a clicked link or a redirect is held to the same policy as the address the
  // model typed. The user's own browsing is left to the user.
  paneGuards.set(
    view.webContents,
    browserControl.guardNavigation(view.webContents, {
      isFetchableUrl: urlPolicy.isFetchableUrl,
      scope: "window.browser.control",
      enabled: () => paneDriver.active(),
    }),
  );
  // A new page has lost the overlay, so it is painted again while the frame is held.
  view.webContents.on("dom-ready", () => {
    if (overlayHeld) void showAgentOverlay(view.webContents, lastOverlayPoint ? { ...lastOverlayPoint, rest: true } : undefined);
  });
  // A link asking for a new window replaces the page for the user, so no windows stack up. While the
  // agent drives it opens a tab instead, which the agent can see and switch to.
  view.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!urlPolicy.isFetchableUrl(target, { allowPrivate: !paneDriver.active() })) return { action: "deny" };
    const tab = paneDriver.active() ? browserPane.openTab() : null;
    const contents = tab ? tab.webContents : view.webContents;
    contents.loadURL(target, { userAgent: cleanUserAgent(contents) }).catch((e) => log.swallow("window.browser.control", "new tab load failed", e));
    return { action: "deny" };
  });
}

/** A link clicked in the app. It opens in the Browser pane and the renderer is asked to show the
 * pane; with no main window to hold it, the separate browser window takes it instead. */
function openLink(url) {
  if (!browserPane || !mainWindow || mainWindow.isDestroyed()) return openInAppBrowser(url);
  if (!urlPolicy.isFetchableUrl(url, { allowPrivate: true })) {
    log.warn("window.browser.control", "refused to open", { host: browserSafety.hostOf(url) });
    return null;
  }
  const view = browserPane.ensure();
  view.webContents.loadURL(url, { userAgent: cleanUserAgent(view.webContents) });
  sendTo(mainWindow, "browser-pane-open");
  return view;
}

const fromMainWindow = (event) =>
  Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);

ipc.handle("browser-pane:bounds", (event, rect) => {
  if (!fromMainWindow(event) || !browserPane) return { success: false };
  return { success: browserPane.setBounds(rect) };
});

ipc.handle("browser-pane:visible", (event, visible) => {
  if (!fromMainWindow(event) || !browserPane) return { success: false };
  browserPane.setVisible(visible);
  // A pane that mounts again starts with an empty bar, so it hears where the page is either way.
  sendPaneState();
  return { success: true };
});

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
  // The pane's bar lives in the main window itself. It may ask for a page before there is one.
  if (fromMainWindow(event) && browserPane) {
    return {
      content: browserPane.ensure(),
      toolbar: mainWindow,
      layout: () => {},
      isPane: true,
    };
  }
  return null;
}

function broadcastBrowserState() {
  for (const entry of browserWindows) {
    sendBrowserState(entry.toolbar.webContents, entry.content.webContents);
  }
  sendPaneState();
}

ipc.handle("browser-bar-menu", (event, open) => {
  const entry = browserWindowFor(event);
  if (!entry) return { success: false };

  entry.menuOpen = Boolean(open);
  entry.layout();
  return { success: true };
});

ipc.handle("browser-bar-action", (event, action, value) => {
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
    case "external": {
      // Only the page's own web address leaves for the system browser, never a file or a scheme
      // some other program would handle.
      const current = web.getURL();
      if (/^https?:\/\//i.test(current)) shell.openExternal(current);
      break;
    }
    case "popout": {
      if (!entry.isPane) return { success: false };
      const current = web.getURL();
      if (current && current !== "about:blank") openInAppBrowser(current);
      break;
    }
    default:
      return { success: false };
  }

  return { success: true };
});

/** What the user typed in the address bar. Anything not obviously a URL is a search: "how tall is
 * everest" should not become a failed DNS lookup. */
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

ipc.handle("browser-bar-set-adblock", async (event, enabled) => {
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
/** The model the splash handed over, sent again to a main window that reloads. */
let bootModel = null;

/** The saved theme, kept so native pieces and new windows follow it. Read from the database before
 * any window exists, because localStorage cannot be read from here. */
let themeSetting = "system";
/** The saved accent, which colours the frame the agent puts round the Browser pane. */
let overlayColor = themes.ACCENT_COLORS.vermilion;

function syncTitleBarTheme() {
  const bg = windowBackground();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(bg);
    if (typeof mainWindow.setTitleBarOverlay === "function") {
      mainWindow.setTitleBarOverlay(themes.overlayColors(themeSetting, nativeTheme.shouldUseDarkColors));
    }
  }
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.setBackgroundColor(bg);
  }
}

function applyThemeSetting(rawSettings) {
  overlayColor = themes.accentColor(rawSettings);
  const setting = themes.themeSetting(rawSettings);
  if (setting === themeSetting && nativeTheme.themeSource === setting) return;
  themeSetting = setting;
  nativeTheme.themeSource = setting;
  syncTitleBarTheme();
}

nativeTheme.on("updated", syncTitleBarTheme);

const windowBackground = () => themes.backgroundFor(themeSetting, nativeTheme.shouldUseDarkColors);

/** Decided once at boot, before any window. The renderer asks for it rather than deciding again. */
let onboardingPlan = "done";
let providers = null;
let codexAccounts = null;
let claudeAccounts = null;
let agyAccounts = null;
let searchKey = null;

/** An existing install is recorded as done on the spot, so later launches need one read to know. */
function decideOnboarding() {
  const inputs = onboarding.collectInputs({
    readRaw: () => storage.getValue(onboarding.RECORD_KEY),
    readSettings: () => storage.getValue("draggy_settings"),
    countModels: () => modelStorage.listGgufModels(ggufModelsDir()).length,
    countChats: () => storage.stats().chats,
    forced: process.env.DRAGGY_ONBOARDING === "1",
  });
  const plan = onboarding.planOnboarding(inputs);
  if (plan !== "adopt") return plan;

  try {
    storage.setValue(onboarding.RECORD_KEY, JSON.stringify(onboarding.doneRecord("adopted")));
    log.info("onboarding", "existing install, setup recorded as done");
  } catch (error) {
    log.warn("onboarding", `could not record the setup as done: ${error.message}`);
  }
  return "done";
}

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

// A second copy shares the engine port, the database and the downloads folder with the first, and
// adopted whatever model the first had loaded. Opening Draggy again brings back the one running.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) {
  app.exit(0);
} else {
  app.on("second-instance", (_event, argv) => {
    log.info("window", "second instance opened", { argc: Array.isArray(argv) ? argv.length : 0 });
    const win = bootCompleted ? mainWindow : splashWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    backgroundColor: windowBackground(),
    title: APP_NAME,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      // A first download takes minutes; it must not slow down because another window has focus.
      backgroundThrottling: false,
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

  // Falls back to the built bundle when no dev server was started.
  splashWindow.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, validatedURL) => {
    if (errorCode === -102 && String(validatedURL).startsWith("http://127.0.0.1:5173")) {
      const distTarget = path.join(rendererRoot(), "index.html");
      if (fs.existsSync(distTarget)) {
        log.info("splash", "dev server unreachable, falling back to dist");
        splashWindow.loadURL(`${RENDERER_ORIGIN}/index.html?splash=true`);
      }
    }
  });

  if (isDevelopment()) {
    splashWindow.loadURL("http://127.0.0.1:5173/?splash=true");
  } else {
    splashWindow.loadURL(`${RENDERER_ORIGIN}/index.html?splash=true`);
  }
}

/** The smallest the window goes. Below it the rail, the chat and the composer crush each other
 * into something unusable. A screen smaller than this still gets a window that fits. */
const MIN_WINDOW_WIDTH = 760;
const MIN_WINDOW_HEIGHT = 480;

/** With `onboarding`, the window opens straight away on the first-run setup instead of waiting behind
 * the splash for the boot to finish. */
function createWindow({ onboarding: showSetup = false } = {}) {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const overlay = themes.overlayColors(themeSetting, nativeTheme.shouldUseDarkColors);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: Math.min(MIN_WINDOW_WIDTH, screenWidth),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, screenHeight),
    show: showSetup,
    backgroundColor: windowBackground(),
    title: APP_NAME,
    icon: path.join(__dirname, "icon.ico"),
    titleBarStyle: "hidden",
    titleBarOverlay: overlay,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      // Downloads, replies and voice setup keep their pace while Draggy is behind another window or
      // minimized. Animations still stop on their own when nothing is visible.
      backgroundThrottling: false,
    },
  });

  browserPane = createBrowserPane({
    WebContentsView,
    host: mainWindow,
    webSession: getWebSession(),
    prepare: preparePaneView,
    onTabsChange: sendPaneState,
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isRendererUrl(url)) {
      e.preventDefault();
      openLink(url);
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
        // F12, so Ctrl+Shift+I stays free for the composer's model menu as in Claude Code.
        { role: "toggleDevTools", accelerator: "F12" },
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
  mainWindow.on("closed", () => {
    browserPane = null;
  });
  // Hidden scraping windows count too, so window-all-closed never came and Draggy lived on unseen.
  mainWindow.on("closed", () => {
    app.quit();
  });

  // Closing the window saves first as well, or its last writes race the quit that follows.
  const win = mainWindow;
  let flushedForClose = false;
  win.on("close", (event) => {
    if (quitting || flushedForClose) return;
    flushedForClose = true;
    event.preventDefault();
    flushWindow(win, ipc).then(() => {
      if (!win.isDestroyed()) win.close();
    });
  });

  logger.attachWindow(mainWindow, "main");
  startup.mark("window");
  mainWindow.once("ready-to-show", () => startup.mark("paint"));
  // A reload (Vite does one when it re-optimizes) starts a page that never heard the boot model.
  mainWindow.webContents.on("did-finish-load", () => {
    startup.mark("loaded");
    if (!startupTimer) {
      startupTimer = setTimeout(finishStartup, 30000);
      startupTimer.unref?.();
    }
    if (bootModel && !mainWindow.isDestroyed()) sendTo(mainWindow, "boot-model", bootModel);
  });

  // A crashed page reloads on its own; saved chats come back and the cut reply shows Resume.
  const crashes = [];
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit" || mainWindow.isDestroyed()) return;
    const now = Date.now();
    while (crashes.length && now - crashes[0] > 60000) crashes.shift();
    crashes.push(now);
    if (crashes.length > 3) {
      log.error("window", "renderer keeps crashing, not reloading", details);
      return;
    }
    log.error("window", `renderer gone (${details.reason}), reloading`, details);
    mainWindow.webContents.reload();
  });

  const query = showSetup ? "?onboarding=true" : "";
  // Falls back to the built bundle when no dev server was started.
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, validatedURL) => {
    if (errorCode === -102 && String(validatedURL).startsWith("http://127.0.0.1:5173")) {
      const distTarget = path.join(rendererRoot(), "index.html");
      if (fs.existsSync(distTarget)) {
        log.info("window", "dev server unreachable, falling back to dist");
        mainWindow.loadURL(`${RENDERER_ORIGIN}/index.html${query}`);
      }
    }
  });

  if (isDevelopment()) {
    mainWindow.loadURL(`http://127.0.0.1:5173/${query}`);
  } else {
    mainWindow.loadURL(`${RENDERER_ORIGIN}/index.html${query}`);
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) sendTo(win, channel, payload);
  }
}

app.whenReady().then(() => {
  if (!ownsInstance) return;
  llamaProcess.onEngineStage((stage) => broadcast("gguf:stage", stage));
  startup.mark("ready");
  const adopted = adoptLegacyDataFolder();

  const boot = logger.init(app);
  lifecycle.startCrashReporter(crashReporter, app);
  lifecycle.reportPreviousDumps(app, boot.previousStartedAt);
  lifecycle.watchApp(app);
  lifecycle.watchPower(powerMonitor);
  previousSessionCrashed = boot.previousCrashed;
  machineSnapshot = lifecycle.logMachineSnapshot({ app, screen, platform, modelsDir: ggufModelsDir() });
  lifecycle.startMemorySampler({
    app,
    getChildren: spawnLog.liveChildren,
    sampleChild: (pid) => lifecycle.childRssMB(platform.runCommand, pid),
  });
  for (const note of adopted) log.info("appData", note);

  // Before anything can start llama-server: a build staged last session takes over now.
  try {
    engineUpdater.applyPendingEngine(app.getPath("userData"), { log });
  } catch (error) {
    log.warn("engineUpdate", `could not apply the staged engine: ${error.message}`);
  }

  try {
    storage.init(app.getPath("userData"));
  } catch (error) {
    log.error("storage", "could not open the chat database", error);
  }

  onboardingPlan = decideOnboarding();
  try {
    applyThemeSetting(storage.getValue("draggy_settings"));
  } catch (error) {
    log.warn("theme", `could not read the saved theme: ${error.message}`);
  }
  log.info("onboarding", `plan: ${onboardingPlan}`);
  startup.mark("settings");

  try {
    library.init(app.getPath("userData"));
  } catch (error) {
    log.error("library", "could not open the document index", error);
  }

  mcp.init(app.getPath("userData"));

  // Credentials into the operating system's keystore, and out of the database
  // where earlier versions kept them in the clear.
  mcpRegistry.init(app.getPath("userData"));
  skills.init(app.getPath("userData"));
  secrets.init(app.getPath("userData"), safeStorage);
  adoptStoredCredentials();
  searchKey = createSearchKey({ secrets, storage });
  try {
    searchKey.adopt();
  } catch (error) {
    log.warn("search", `could not move the Brave key into the store: ${error.message}`);
  }
  providers = createRegistry({ storage, secrets });
  const remoteCatalog = createRemoteCatalog({ storage, instances: () => providers.list(), log: (line) => log.warn("providers", line) });
  remoteCatalog.load();
  // Hourly only to notice a provider switched on; the file itself is fetched at most once a day.
  void remoteCatalog.refresh();
  setInterval(() => void remoteCatalog.refresh(), 60 * 60 * 1000).unref();
  codexAccounts = createCodexAdapter({
    appData: app.getPath("userData"),
    version: app.getVersion(),
    log: (line) => log.debug("codex", line),
  });
  claudeAccounts = createClaudeAdapter({
    appData: app.getPath("userData"),
    version: app.getVersion(),
    log: (line) => log.debug("claude", line),
  });
  agyAccounts = createAgyAdapter({
    appData: app.getPath("userData"),
    log: (line) => log.debug("agy", line),
    // Google's FAQ calls third-party use a terms breach, so nothing runs until this is accepted.
    confirm: async () => {
      const { response } = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
        type: "warning",
        buttons: ["Use Antigravity CLI", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        title: "Antigravity CLI",
        message: "Use your Google account through the Antigravity CLI?",
        detail:
          "Google says headless mode is for direct scripting and CI, and that third-party software reaching Antigravity breaks its terms and can get the account suspended. A Gemini API key under Providers avoids this risk.",
      });
      return response === 0;
    },
  });
  const accounts = { codex: codexAccounts, claude: claudeAccounts, agy: agyAccounts };
  const providerHandlers = createProviderHandlers({
    registry: providers,
    keystore: () => secrets.available(),
    models: createModels({ registry: providers, accounts }),
    accounts,
    openExternal: (url) => shell.openExternal(url),
    notify: (channel, payload) => mainWindow && !mainWindow.isDestroyed() && sendTo(mainWindow, channel, payload),
    discovery: createDiscovery({
      excludedPorts: () => [llamaProcess.getServerStatus().port || 11435, apiServer?.port() ?? readApiServerConfig().port],
      isDev: isDevelopment,
    }),
  });
  for (const [channel, handler] of Object.entries(providerHandlers)) ipc.handle(channel, (event, ...args) => handler(...args));

  const ttsHandlers = createTtsHandlers({
    registry: providers,
    consent: createConsent(storage),
    send: (channel, payload) => mainWindow && !mainWindow.isDestroyed() && sendTo(mainWindow, channel, payload),
  });
  for (const [channel, handler] of Object.entries(ttsHandlers)) ipc.handle(channel, (event, ...args) => handler(...args));

  // Draggy's own storage is out of bounds to the file tools, whatever folder
  // the user has opened. The database is not a document.
  fsGuard.setProtectedPaths([app.getPath("userData")]);
  checkpoints.init(app.getPath("userData"));

  protocol.handle("draggy", serveCachedModelFile);
  protocol.handle("app", serveRendererFile);
  protocol.handle("widget", widgets.serve);
  // On the app's own session only: the web partition never gets a handler that reaches the engine.
  protocol.handle(
    "draggy-ai",
    createGateway({
      enginePort: () => llamaProcess.getServerStatus().port,
      isAllowedOrigin: (origin) => origin === RENDERER_ORIGIN || (isDevelopment() && origin === "http://127.0.0.1:5173"),
      onRefused: (origin, url) => log.warn("gateway", `refused ${url} from origin ${origin}`),
      registry: providers,
      accounts,
    }),
  );

  // The renderer's own policy, and deliberately only the renderer's: the web
  // session below is left with whatever policy each site sends for itself.
  applyContentSecurityPolicy(session.defaultSession, !isDevelopment());

  if (onboardingPlan !== "show") startAdblocker();

  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      const isAppWindow =
        mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents;
      callback(
        urlPolicy.permissionGranted(permission, {
          fromAppWindow: Boolean(isAppWindow),
          fromAppPage: isRendererUrl(String(details?.requestingUrl || "")),
        }),
      );
    },
  );

  if (onboardingPlan === "show") {
    // No splash to close later: without this, a second launch would look for one that never existed.
    bootCompleted = true;
    createWindow({ onboarding: true });
  } else {
    createSplashWindow();
    createWindow();
  }

  updater.init(app, (state) => broadcast("updater-state", state));

  // Only if the user turned it on, and never before they did.
  applyApiServerConfig(readApiServerConfig()).catch((error) =>
    log.warn("api", `could not start the local API: ${error.message}`),
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/** Everything Draggy started, stopped on the way out. One step failing must not skip the rest, so
 * each is on its own. */
function shutdown() {
  const steps = [
    ["browsers", closeBrowserWindows],
    ["updater", () => updater.dispose()],
    ["engine-updater", () => engineUpdater.dispose()],
    // Servers and code runs are children of this process and would otherwise
    // be left running after the window is gone.
    ["api", () => void apiServer?.stop()],
    ["mcp", () => mcp.stopAll()],
    ["runner", () => runner.stopAll()],
    ["commands", () => commands.stopAll()],
    ["llama", () => llamaProcess.stopServerSync()],
    ["colibri", () => {
      saveColibriUsage();
      engineHost.stop();
    }],
    ["large-download", () => largeDownload?.abort()],
    ["embeddings", () => embedServer.stopSync()],
    ["images", () => imageEngine.stopSync()],
    ["watchers", () => {
      for (const watcher of workspaceWatchers.values()) {
        try {
          watcher.close();
        } catch (error) {
          log.debug("fs", `Error closing watcher: ${error.message}`);
        }
      }
      workspaceWatchers.clear();
    }],
    ["session counts", () => {
      adblocker.sessionCounts();
      urlPolicy.sessionCounts();
    }],
    ["storage", () => storage.close()],
    ["library", () => library.close()],
  ];

  for (const [name, step] of steps) {
    const began = performance.now();
    try {
      step();
      const durMs = Math.round(performance.now() - began);
      if (durMs > 500) log.warn("quit", `${name} stop was slow`, { durMs });
      else log.debug("quit", `${name} stopped`, { durMs });
    } catch (error) {
      log.warn("shutdown", `${name}: ${error?.message || error}`);
    }
  }
}

let quitting = false;

app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  const quit = lifecycle.createTimeline("quit", { now: () => performance.now(), startedAt: performance.now(), scope: "quit" });
  const timed = (label, work) => Promise.resolve(work).finally(() => quit.mark(label));

  // The window writes its pending saves before storage closes under them.
  Promise.allSettled([timed("window-flush", flushWindow(mainWindow, ipc)), timed("codex", codexAccounts?.stopAll()), timed("claude", claudeAccounts?.stopAll()), timed("agy", agyAccounts?.stopAll())]).then(() => {
    shutdown();
    quit.mark("shutdown");
    quit.finish();
    closeLogs(logger).finally(() => app.quit());
  });
});

ipc.on("boot-finished", (event, model, open) => {
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
      if (model) {
        bootModel = model;
        sendTo(mainWindow, "boot-model", model);
      }
      if (open === "providers") sendTo(mainWindow, "boot-open", "providers");
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

ipc.on("quit-app", () => app.quit());

function readOnboardingRecord() {
  return onboarding.readRecord(storage.getValue(onboarding.RECORD_KEY));
}

function writeOnboardingRecord(record) {
  return storage.setValue(onboarding.RECORD_KEY, JSON.stringify(record));
}

ipc.handle("onboarding:state", () => ({
  plan: onboardingPlan === "show" ? "show" : "done",
  record: readOnboardingRecord(),
}));

ipc.handle("onboarding:start", () => {
  const record = onboarding.recordOnStart(readOnboardingRecord());
  if (record) writeOnboardingRecord(record);
  return { success: true, record: record ?? readOnboardingRecord() };
});

ipc.handle("onboarding:complete", (event, setupPath) => {
  // "adopted" is main's own verdict on an existing install; the setup itself never ends that way.
  if (!onboarding.isValidPath(setupPath) || setupPath === "adopted") {
    return { success: false, error: "Unknown setup path." };
  }
  const record = onboarding.doneRecord(setupPath, new Date(), readOnboardingRecord()?.startedAt);
  writeOnboardingRecord(record);
  onboardingPlan = "done";
  startAdblocker();
  return { success: true, record };
});

// Navigates in place so the dev server survives and no restart races the lock.
ipc.handle("onboarding:reset", () => {
  writeOnboardingRecord(onboarding.inProgressRecord());
  log.info("onboarding", "setup requested again");
  onboardingPlan = "show";
  setImmediate(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const query = "?onboarding=true";
      if (!mainWindow.isVisible()) mainWindow.show();
      if (isDevelopment()) {
        mainWindow.loadURL(`http://127.0.0.1:5173/${query}`);
      } else {
        mainWindow.loadURL(`${RENDERER_ORIGIN}/index.html${query}`);
      }
    }
  });
  return { success: true };
});

app.on("window-all-closed", () => {
  app.quit();
});

let cachedSpecs = null;

async function getSystemSpecs() {
  if (cachedSpecs) return cachedSpecs;

  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : "Unknown CPU";
  const totalMemGB = os.totalmem() / 1024 ** 3;

  let vram = 0;
  const gpuInfo = await app.getGPUInfo("complete").catch(log.swallowed("ipc", "no GPU details, the probe falls back", null));

  const videoMemoryMb = gpuInfo?.auxAttributes?.videoMemoryMb;
  if (typeof videoMemoryMb === "number" && videoMemoryMb > 0) {
    vram = videoMemoryMb / 1024;
  }

  if (vram <= 0) vram = await platform.detectVideoMemoryGB();

  cachedSpecs = {
    cpu: cpuModel,
    ram: Number(totalMemGB.toFixed(1)),
    vram: Number(vram.toFixed(1)),
    gpu: platform.gpuNameFrom(gpuInfo),
    platform: process.platform,
    arch: os.arch(),
  };

  // Several callers probe at once on a cold start; the same line once is enough.
  const specLine = `${cpuModel} | ${cachedSpecs.gpu || "no GPU name"} | ${cachedSpecs.ram} GB RAM | ${cachedSpecs.vram} GB VRAM`;
  log.once(`specs:${specLine}`, "specs", specLine, undefined, "INFO");

  return cachedSpecs;
}

ipc.handle("get-system-specs", getSystemSpecs);

let hardwareProbe = null;
function getHardwareProbe() {
  hardwareProbe ||= createHardwareProbe({ userDataDir: app.getPath("userData"), getSpecs: getSystemSpecs });
  return hardwareProbe;
}
ipc.handle("hardware:probe", () => getHardwareProbe().probe());
ipc.handle("hardware:benchmark", (_event, volume, options) =>
  getHardwareProbe().runBenchmark(volume, {
    ...options,
    onProgress: (progress) => mainWindow && !mainWindow.isDestroyed() && sendTo(mainWindow, "hardware-benchmark-progress", progress),
  }),
);
/** The colibri catalog, each model planned against this machine's memory and the measured drives. */
/** A system notification for a long answer that finished while the window was in the background. */
ipc.handle("notify:done", (_event, title, body) => {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return { shown: false };
  if (!Notification.isSupported()) return { shown: false };
  new Notification({ title: String(title || "").slice(0, 120), body: String(body || "").slice(0, 240), silent: true }).show();
  return { shown: true };
});

async function buildTierCatalog(contextTokens) {
  const hardware = await getHardwareProbe().probe();
  const llamaBinary = binaryManager.findLlamaBinary(app.getPath("userData"));
  const engines = {
    llamacpp: true,
    llamacppStream: llamaBinary ? await llamaProcess.supportsMoeStream(llamaBinary, app.getPath("userData")) : false,
    colibri: Boolean(colibriBinary.runtime(app.getPath("userData"))),
  };
  const tokens = Number(contextTokens) > 0 ? Number(contextTokens) : 8192;
  return {
    hardware,
    models: colibriCatalog.CATALOG.map((entry) => ({
      ...entry,
      downloaded: largeModelStore.locate(entry.repo, hardware.drives.map((drive) => drive.volume)),
      plan: tierStats.applyObserved(
        tierPlanner.planModel({ model: tierPlanner.describeColibri(entry), hardware, contextTokens: tokens, engines }),
        tierStats.observed(app.getPath("userData"), entry.id),
      ),
    })),
  };
}
ipc.handle("tier:catalog", (_event, contextTokens) => buildTierCatalog(contextTokens));
let previousSessionCrashed = false;
let machineSnapshot = null;

async function buildLargeModelReport() {
  const { hardware, models } = await buildTierCatalog();
  const userData = app.getPath("userData");
  return tierDiagnostics.buildReport({
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    hardware,
    catalog: models,
    engine: { ...engineHost.status(), slow: colibriSlow },
    runtime: colibriBinary.runtime(userData),
    stats: tierStats.summary(userData),
    logText: logger.readTail("app", 512 * 1024),
  });
}
// A file the person can attach to a bug report: plans, probe results, engine version, engine log. No prompts.
ipc.handle("tier:report", async () => {
  const report = await buildLargeModelReport();
  const file = path.join(logger.logFolder(), "large-models-report.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  shell.showItemInFolder(file);
  return { file };
});
ipc.handle("hardware:cancel-benchmark", () => getHardwareProbe().cancelBenchmark());

const colibri = colibriProcess.createColibriProcess();
const engineHost = createEngineHost({
  llamacpp: { stopSync: () => llamaProcess.stopServerSync(), status: () => llamaProcess.getServerStatus() },
  colibri: { stopSync: () => colibri.stopSync(), status: () => colibri.status() },
});

// Whether the model Draggy started is slow enough for the slow-model behaviour in chat.
let colibriSlow = false;
// The catalog id and folder of the model colibri is serving, for the speed history and the hot-set backup.
let colibriServing = null;

/** Keeps the learned hot set outside the model folder; called when a model stops. */
function saveColibriUsage() {
  if (colibriServing) tierStats.backupUsage(app.getPath("userData"), colibriServing.id, colibriServing.dir);
}

ipc.handle("colibri:status", () => {
  const engine = engineHost.status();
  return {
    installed: Boolean(colibriBinary.runtime(app.getPath("userData"))),
    state: colibriBinary.readState(app.getPath("userData")),
    engine: { ...engine, slow: Boolean(engine.running && engine.kind === "colibri" && colibriSlow) },
  };
});
/** Installs the colibri engine and the Python it needs. Safe to call when it is already there. */
async function installColibriEngine() {
  try {
    const userDataDir = app.getPath("userData");
    const onProgress = (progress) => broadcast("colibri-install-progress", progress);
    const result = await colibriBinary.installColibri(userDataDir, { cudaCapable: await colibriBinary.detectCudaCapable(), onProgress });
    if (platform.IS_WINDOWS) await colibriBinary.ensurePython(userDataDir, { onProgress });
    return { success: true, tag: result.tag, variant: result.variant };
  } catch (error) {
    log.error("colibri", `install failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
ipc.handle("colibri:install", () => installColibriEngine());
ipc.handle("colibri:health", () => colibri.health());
ipc.handle("colibri:rollback", () => ({ tag: colibriBinary.rollback(app.getPath("userData")) }));
ipc.handle("colibri:start", async (_event, options = {}) => {
  saveColibriUsage();
  // The engine installs itself the first time a large model needs it.
  if (!colibriBinary.runtime(app.getPath("userData"))) {
    const installed = await installColibriEngine();
    if (!installed.success) return { success: false, error: installed.error, kind: "engine-missing", params: { model: options.modelName } };
  }
  const known = colibriCatalog.find(String(options.modelId || ""));
  if (known && options.modelDir) tierStats.restoreUsage(app.getPath("userData"), known.id, options.modelDir);
  const result = await engineHost.start("colibri", () =>
    colibri.start({
      userDataDir: app.getPath("userData"),
      modelDir: options.modelDir,
      plan: options.plan,
      modelName: options.modelName,
      lossy: options.lossy === true,
      onPhase: (phase) => broadcast("colibri-load-phase", phase),
    }),
  );
  colibriSlow = Boolean(result?.success) && tierPlanner.isSlowPlan(options.plan);
  colibriServing = result?.success && known && options.modelDir ? { id: known.id, dir: options.modelDir } : null;
  return result;
});
// One finished reply: tokens per second from the renderer's own timing, the hit rate from the gateway.
ipc.handle("tier:record", async (_event, sample = {}) => {
  if (!colibriServing) return { recorded: false };
  const hitRate = tierStats.hitRateFrom(await colibri.experts());
  tierStats.record(app.getPath("userData"), colibriServing.id, { tokPerSec: Number(sample.tokPerSec), tokens: Number(sample.tokens), hitRate });
  return { recorded: true };
});
ipc.handle("colibri:stop", () => {
  saveColibriUsage();
  colibriServing = null;
  engineHost.stop();
  colibriSlow = false;
  return { success: true };
});

let largeDownload = null;
const largeMirrors = () => largeModelStore.createMirrorStore(app.getPath("userData"));

/** What a repository needs and where it would go, before anything is downloaded. */
ipc.handle("largemodel:plan", async (_event, repo) => {
  try {
    const files = await largeModelStore.fetchManifest(String(repo));
    const report = await getHardwareProbe().probe();
    return { success: true, files: files.length, totalBytes: largeModelStore.totalBytes(files), target: largeModelStore.planTarget(String(repo), files, report.drives) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipc.handle("largemodel:download", async (_event, options = {}) => {
  if (largeDownload) return { ok: false, error: "busy" };
  const controller = new AbortController();
  largeDownload = controller;
  try {
    const repo = String(options.repo);
    const files = await largeModelStore.fetchManifest(repo);
    const report = await getHardwareProbe().probe();
    const target = largeModelStore.planTarget(repo, files, report.drives);
    if (!target.ok) return { ok: false, error: target.reason, needBytes: target.needBytes };
    const destDir = options.destDir || largeModelStore.defaultDir(target.volume, repo);
    return await largeModelStore.downloadRepo({
      repo,
      files,
      destDir,
      resolveUrl: (file) => largeModelStore.hfUrl(repo, file),
      bandwidthBps: Number(options.bandwidthBps) || 0,
      signal: controller.signal,
      onProgress: (progress) => broadcast("largemodel-progress", progress),
    });
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    largeDownload = null;
  }
});
ipc.handle("largemodel:cancel", () => {
  largeDownload?.abort();
  return { success: true };
});
ipc.handle("largemodel:mirrors-get", (_event, modelId) => largeMirrors().get(String(modelId)));
ipc.handle("largemodel:mirrors-set", (_event, modelId, paths) => largeMirrors().set(String(modelId), paths));

ipc.handle("check-internet", () => connectivity.checkConnectivity());

ipc.handle("check-disk-space", async () => {
  try {
    const appPath = app.getPath("userData");
    const stats = fs.statfsSync(appPath);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // Unknown never refuses a download; a made-up 100 GB would also let a 200 GB one start.
    return 0;
  }
});

async function scrapeInHiddenWindow({ url, userAgent, readyExpression, extract }) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: getWebSession(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  // A hidden page never opens windows of its own, so a link cannot reach an address the URL check refused.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

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

let searchConfig = { searchProvider: "auto", searxngUrl: "" };

ipc.handle("set-search-config", (event, config) => {
  searchConfig = {
    searchProvider: PROVIDER_IDS.includes(config?.searchProvider)
      ? config.searchProvider
      : "auto",
    searxngUrl: String(config?.searxngUrl || "").trim(),
  };
  return { success: true };
});

// The key is read from the keystore per search, so it never sits in the settings the renderer holds.
const searchSettings = () => ({ ...searchConfig, braveApiKey: searchKey?.get() || "" });
ipc.handle("search:set-brave-key", (event, key) => searchKey.set(key));
ipc.handle("search:brave-key-status", () => searchKey.status());

ipc.handle("search-web", async (event, query) => {
  const { results } = await runSearch(query, searchSettings(), {
    scrape: scrapeInHiddenWindow,
  });
  return results;
});

ipc.handle("search-web-detailed", async (event, query) =>
  runSearch(query, searchSettings(), { scrape: scrapeInHiddenWindow }),
);

ipc.handle("get-page-content", async (event, url) => {
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
  // A hidden page never opens windows of its own, so a link cannot reach an address the URL check refused.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Each hop is checked as it arrives, server redirects and navigations the page starts itself. Refusing one cancels it.
  let refusedHop = null;
  win.webContents.on("will-redirect", (hopEvent, hop) => {
    if (urlPolicy.isFetchableUrl(hop)) return;
    hopEvent.preventDefault();
    refusedHop = hop;
    log.warn("read-url", "redirect refused");
  });
  win.webContents.on("will-navigate", (hopEvent, hop) => {
    if (urlPolicy.isFetchableUrl(hop)) return;
    hopEvent.preventDefault();
    refusedHop = hop;
    log.warn("read-url", "navigation refused");
  });
  // A subframe's about: or blob: page has no address to check, so only web addresses are held to the policy.
  win.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame || !/^https?:/i.test(details.url)) return;
    if (urlPolicy.isFetchableUrl(details.url)) return;
    details.preventDefault();
    refusedHop = details.url;
    log.warn("read-url", "frame navigation refused");
  });

  try {
    await win
      .loadURL(url, {
        userAgent: cleanUserAgent(win.webContents),
        timeout: 30000,
      })
      .catch((e) => {
        if (!refusedHop) throw e;
      });

    for (let i = 0; i < 6 && !refusedHop; i++) {
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

    if (refusedHop) {
      win.destroy();
      return { title: "", text: "", blocked: "refused", reason: urlPolicy.refusalFor(refusedHop), url };
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
    const failure = classifyPageFailure(e);
    log.warn("read-url", `page read failed: ${failure.code}`);
    return { title: "", text: "", blocked: "unreachable", reason: failure.reason, url };
  }
});

const AGENT_WORLD = 1000;

/** The frame stays on between steps and until the run ends, with the cursor resting where it last was. */
let overlayHeld = false;
let lastOverlayPoint = null;

/** Paints the "agent is controlling this page" border, and moves the cursor when given a point.
 * Runs in an isolated world, so the page cannot see or reach it. */
async function showAgentOverlay(contents, point) {
  if (contents.isDestroyed()) return;
  overlayHeld = true;
  if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) lastOverlayPoint = { x: point.x, y: point.y };
  try {
    await contents.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [
      { code: browserControl.overlayScript({ ...point, color: overlayColor }) },
    ]);
  } catch (e) {
    log.swallow("window.browser.control", "agent overlay failed", e);
  }
}

async function hideAgentOverlay() {
  overlayHeld = false;
  lastOverlayPoint = null;
  const contents = browserPane?.view?.webContents;
  if (!contents || contents.isDestroyed()) return;
  try {
    await contents.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: browserControl.hideOverlayScript() }]);
  } catch (e) {
    log.swallow("window.browser.control", "agent overlay clear failed", e);
  }
}

/** One dialog tracker per page, fed by the debugger. A dialog freezes its page, so every step asks
 * first. */
const paneDialogs = new WeakMap();
const paneTraces = new WeakMap();
async function dialogsFor(contents) {
  let dialogs = paneDialogs.get(contents);
  if (dialogs) return dialogs;
  const send = debuggerSend(contents);
  dialogs = browserDialogs.createDialogs({ send, onError: (e) => log.swallow("window.browser.control", "dialog answer failed", e) });
  paneDialogs.set(contents, dialogs);
  const trace = browserTrace.createTrace();
  paneTraces.set(contents, trace);
  try {
    await send("Page.enable", {});
    await send("Runtime.enable", {});
    await send("Network.enable", {});
    contents.debugger.on("message", (_event, method, params) => {
      dialogs.handle(method, params);
      trace.handle(method, params);
    });
  } catch (e) {
    log.swallow("window.browser.control", "dialog watch failed", e);
  }
  return dialogs;
}

const dialogFailure = (dialog) =>
  browserControl.failure("dialog_open", `A ${dialog.type} dialog is open: "${dialog.message}". Call browser_dialog to answer it.`);

/** Runs one agent browser step on the visible pane, or returns the failure to hand the model. */
async function inPane(label, fn, { prepare, needsPage = true } = {}) {
  return paneDriver.run(label, async (step) => {
    const { view, failed } = await paneDriver.ensureTab({ prepare });
    if (failed) return failed;
    const contents = view.webContents;
    const url = contents.getURL();
    if (needsPage && (!url || url === "about:blank")) return browserControl.failure("not_navigated");
    const open = (await dialogsFor(contents)).pending();
    if (open) return dialogFailure(open);
    await showAgentOverlay(contents);
    return fn(contents, step);
  });
}

/** A hop the guard cancelled while a step ran, as the failure the model should hear about. */
function refusedByGuard() {
  const hop = activeGuard()?.refusedHop();
  return hop ? browserControl.failure("refused_url", urlPolicy.refusalFor(hop)) : null;
}

ipc.handle("browser-navigate", async (event, url) => {
  if (!urlPolicy.isFetchableUrl(url)) {
    log.warn("window.browser.control", "refused navigation", { host: browserSafety.hostOf(url) });
    return browserControl.failure("refused_url", urlPolicy.refusalFor(url));
  }

  let loading = null;
  const load = (contents) => {
    activeGuard()?.reset();
    loading = contents.loadURL(url, { userAgent: cleanUserAgent(contents), timeout: 30000 });
    // The wait below reports a failed load; this keeps an early rejection from going unhandled.
    loading.catch((e) => log.swallow("window.browser.control", "pane load failed", e));
  };

  return inPane("navigating", async (contents, step) => {
    try {
      if (!loading) load(contents);
      await loading.catch((e) => {
        if (!activeGuard()?.refusedHop()) throw e;
      });

      for (let i = 0; i < 6 && !activeGuard()?.refusedHop() && !step.stopped(); i++) {
        const state = await contents.executeJavaScript(PAGE_STATE_SCRIPT);

        if (isBotChallengePage(state)) return browserControl.failure("human_verification");

        if (state.readyState === "complete" && state.textLength > 50) break;
        await sleep(2000);
      }

      const refused = refusedByGuard();
      if (refused) return refused;

      const title = await contents.executeJavaScript('document.title || ""');
      return { ok: true, title, url: contents.getURL() };
    } catch (e) {
      return browserControl.failure("navigation_failed", e.message);
    }
  }, { prepare: (view) => load(view.webContents), needsPage: false });
});

/** One observer per pane page. It talks to the page over the debugger and forgets its refs when the
 * main frame navigates. */
const paneObservers = new WeakMap();
const paneInputs = new WeakMap();
const debuggerSend = (contents) => async (method, params) => {
  const dbg = contents.debugger;
  if (!dbg.isAttached()) dbg.attach("1.3");
  return dbg.sendCommand(method, params);
};

/** Real input for the pane. Shares the observer's refs so a ref means the same thing to both. */
function inputFor(contents) {
  let input = paneInputs.get(contents);
  if (!input) {
    input = browserInput.createInput({ send: debuggerSend(contents), observer: observerFor(contents), contents, pause: sleep });
    paneInputs.set(contents, input);
  }
  return input;
}

function observerFor(contents) {
  let observer = paneObservers.get(contents);
  if (observer) return observer;
  observer = browserSnapshot.createObserver({ send: debuggerSend(contents) });
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) observer.forget();
  });
  paneObservers.set(contents, observer);
  return observer;
}

/** A ref problem keeps its own code; anything else is the page not answering. */
const observationFailure = (e) =>
  e instanceof browserSnapshot.RefError ? browserControl.failure(e.code, e.message) : browserControl.failure("script_failed", e.message);

ipc.handle("browser-snapshot", async (event, options) => {
  const { scope, maxItems } = options && typeof options === "object" ? options : {};
  return inPane("reading", async (contents) => {
    try {
      const result = await observerFor(contents).snapshot({
        scope: typeof scope === "string" ? scope : undefined,
        maxItems,
      });
      const title = await contents.executeJavaScript('document.title || ""');
      const text = browserSnapshot.formatSnapshot({ ...result, title, url: contents.getURL() });
      log.info("window.browser.control", "snapshot", { items: result.items.length, omitted: result.omitted, frames: result.skippedFrames });
      return { ok: true, title, url: contents.getURL(), text, total: result.total, omitted: result.omitted };
    } catch (e) {
      return observationFailure(e);
    }
  });
});

ipc.handle("browser-screenshot", async (event, options) => {
  const { mode, ref, marks } = options && typeof options === "object" ? options : {};
  return inPane("reading", async (contents) => {
    const observer = observerFor(contents);
    let marked = false;
    try {
      if (marks && (mode === undefined || mode === "viewport")) {
        const boxes = await observer.marks();
        await contents.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: browserSnapshot.marksScript(boxes) }]);
        marked = true;
      }
      const shot = await observer.screenshot({
        mode: ["viewport", "full", "element"].includes(mode) ? mode : "viewport",
        ref: typeof ref === "string" ? ref : undefined,
      });
      log.info("window.browser.control", "screenshot", { width: shot.width, height: shot.height, bytes: shot.data.length });
      return { ok: true, ...shot, url: contents.getURL() };
    } catch (e) {
      return e instanceof browserSnapshot.RefError ? observationFailure(e) : browserControl.failure("screenshot_failed", e.message);
    } finally {
      if (marked && !contents.isDestroyed()) {
        await contents
          .executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: browserSnapshot.hideMarksScript() }])
          .catch((e) => log.swallow("window.browser.control", "marks clear failed", e));
      }
    }
  });
});

ipc.handle("browser-get-elements", async () => {
  const result = await inPane("reading", async (contents) => {
    try {
      const data = await contents.executeJavaScript(browserControl.listElementsScript());
      return { ok: true, elements: JSON.parse(data) };
    } catch (e) {
      return browserControl.failure("script_failed", e.message);
    }
  });
  return result.ok ? result : { ...result, elements: [] };
});

/** What an action did to the page, from a before and after look. A page that navigated mid-look is
 * reported by its address alone. */
async function changeNote(input, contents, before) {
  const after = await input.signature().catch((e) => {
    log.swallow("window.browser.control", "page look failed", e);
    return null;
  });
  if (before && after) return browserInput.summarizeChange(before, after);
  return before && contents.getURL() !== before.url ? `The page navigated to ${contents.getURL()}.` : "";
}

/** What the user let the agent do on which sites. "Always" is saved; "this session" is not. */
const TRUSTED_SITES_KEY = "browserTrustedSites";
const browserGrants = browserSafety.createGrants({
  trusted: (() => {
    try {
      const saved = JSON.parse(storage.getValue(TRUSTED_SITES_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((origin) => typeof origin === "string") : [];
    } catch (e) {
      log.swallow("window.browser.control", "trusted sites unreadable", e);
      return [];
    }
  })(),
  onChange: (origins) => storage.setValue(TRUSTED_SITES_KEY, JSON.stringify(origins)),
});
const actionLimit = browserSafety.createRateLimit({ max: 60, windowMs: 60000 });

const consents = new Map();
let consentSeq = 0;
const CONSENT_WAIT_MS = 120000;

/** Asks the user in the chat. No answer in two minutes is a no. */
function askConsent(kind, host, detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve("deny");
  const id = `consent-${++consentSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      consents.delete(id);
      sendTo(mainWindow, "browser-consent", null);
      resolve("deny");
    }, CONSENT_WAIT_MS);
    consents.set(id, (choice) => {
      clearTimeout(timer);
      resolve(choice);
    });
    sendTo(mainWindow, "browser-consent", { id, kind, host, detail });
  });
}

ipc.handle("browser-consent:answer", (event, id, choice) => {
  if (!fromMainWindow(event)) return { success: false };
  const answer = consents.get(id);
  if (!answer) return { success: false };
  consents.delete(id);
  answer(["session", "once", "always"].includes(choice) ? choice : "deny");
  sendTo(mainWindow, "browser-consent", null);
  return { success: true };
});

ipc.handle("browser-grants:list", (event) => (fromMainWindow(event) ? browserGrants.list() : []));
ipc.handle("browser-grants:revoke", (event, origin) => {
  if (!fromMainWindow(event) || typeof origin !== "string") return { success: false };
  browserGrants.revoke(origin);
  return { success: true };
});

/** The first thing the agent does on a site needs the user's word. */
async function siteAllowed(contents) {
  const origin = browserSafety.originOf(contents.getURL());
  if (!origin || browserGrants.status(origin) !== "unknown") return true;
  const choice = await askConsent("site", browserSafety.hostOf(origin), "");
  if (choice === "always") browserGrants.trust(origin);
  else if (choice === "session") browserGrants.allowSession(origin);
  else if (choice !== "once") return false;
  return true;
}

/** Origins where the user said risky clicks are fine for the rest of this run of the app. */
const actionSessionOrigins = new Set();

/** A click that pays, deletes or sends needs the user's word unless they trust the site. */
async function actionAllowed(contents, why) {
  const origin = browserSafety.originOf(contents.getURL());
  if (origin && (browserGrants.status(origin) === "trusted" || actionSessionOrigins.has(origin))) return true;
  const choice = await askConsent("action", browserSafety.hostOf(origin || ""), why);
  if (choice === "always" && origin) browserGrants.trust(origin);
  if (choice === "session" && origin) actionSessionOrigins.add(origin);
  return choice === "once" || choice === "always" || choice === "session";
}

/** Runs one real-input step: marks agent input as the agent's own, honors a takeover, and turns
 * a ref problem into the failure the model should hear. `work` returns extra fields for the result. */
function acting(label, work, { report = false } = {}) {
  return inPane(label, async (contents, step) => {
    try {
      if (!actionLimit.take()) return browserControl.failure("rate_limited");
      if (!(await siteAllowed(contents))) return browserControl.failure("site_denied");
      activeGuard()?.reset();
      const input = inputFor(contents);
      const before = report ? await input.signature().catch((e) => {
        log.swallow("window.browser.control", "page look failed", e);
        return null;
      }) : null;
      if (step.stopped()) return browserControl.failure("user_took_over");
      let extra = {};
      let failed = null;
      const dialogs = await dialogsFor(contents);
      await paneDriver.sending(async () => {
        // A click that raises an alert never returns until the alert is answered.
        const out = await Promise.race([work(input, contents, step), dialogs.opened().then(() => ({}))]);
        if (out && out.ok === false) failed = out;
        else extra = out || {};
        // The input events reach the listeners a beat after they are sent.
        await sleep(60);
      });
      if (failed) return failed;
      if (step.stopped()) return browserControl.failure("user_took_over");
      if (report) await sleep(500);
      const refused = refusedByGuard();
      if (refused) return refused;
      const open = dialogs.pending();
      if (open) return { ok: true, url: contents.getURL(), dialog: open, ...takeSideEffects(), ...extra };
      if (report && (await challengeShown(contents))) return browserControl.failure("human_verification");
      const title = await contents.executeJavaScript('document.title || ""');
      const changed = report ? await changeNote(input, contents, before) : undefined;
      return { ok: true, title, url: contents.getURL(), ...(changed ? { changed } : {}), ...takeSideEffects(), ...extra };
    } catch (e) {
      return observationFailure(e);
    }
  });
}

/** Whether the page in front is a bot check the user has to pass. */
async function challengeShown(contents) {
  try {
    return isBotChallengePage(await contents.executeJavaScript(PAGE_STATE_SCRIPT));
  } catch (e) {
    log.swallow("window.browser.control", "challenge look failed", e);
    return false;
  }
}

ipc.handle("browser-trace", (event, kind, options) => {
  if (!["console", "network"].includes(kind)) {
    return browserControl.failure("invalid_input", "The trace kind is console or network.");
  }
  const { limit, onlyFailed } = options && typeof options === "object" ? options : {};
  return inPane("reading", async (contents) => {
    await dialogsFor(contents);
    const trace = paneTraces.get(contents);
    const count = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return kind === "console"
      ? { ok: true, entries: trace.console(count) }
      : { ok: true, entries: trace.network(count, onlyFailed === true) };
  });
});

ipc.handle("browser-dialog", (event, action, text) => {
  if (!["accept", "dismiss"].includes(action)) {
    return browserControl.failure("invalid_input", "The dialog action is accept or dismiss.");
  }
  // Not through inPane: a page with a dialog open cannot run the overlay script.
  return paneDriver.run("answering", async () => {
    const { view, failed } = await paneDriver.ensureTab({});
    if (failed) return failed;
    const dialogs = await dialogsFor(view.webContents);
    try {
      const closed = await dialogs.answer({ accept: action === "accept", text: typeof text === "string" ? text : undefined });
      await sleep(300);
      return { ok: true, answered: closed.type, url: view.webContents.getURL(), ...takeSideEffects() };
    } catch (e) {
      return e.code === "no_dialog" ? browserControl.failure("no_dialog") : browserControl.failure("script_failed", e.message);
    }
  });
});

const tabList = () =>
  browserPane.tabs().map(({ index, active, view }) => ({
    index,
    active,
    title: view.webContents.getTitle(),
    url: view.webContents.getURL(),
  }));

ipc.handle("browser-tabs", async (event, action, options) => {
  if (!["list", "new", "select", "close"].includes(action)) {
    return browserControl.failure("invalid_input", "The tabs action is list, new, select or close.");
  }
  const { index, url } = options && typeof options === "object" ? options : {};
  return inPane("tabs", async () => {
    if (action === "new") {
      if (url !== undefined && !urlPolicy.isFetchableUrl(url)) {
        return browserControl.failure("refused_url", urlPolicy.refusalFor(url));
      }
      const tab = browserPane.openTab();
      if (!tab) return browserControl.failure("tab_limit");
      if (url) {
        activeGuard()?.reset();
        await tab.webContents
          .loadURL(url, { userAgent: cleanUserAgent(tab.webContents), timeout: 30000 })
          .catch((e) => log.swallow("window.browser.control", "new tab load failed", e));
      }
    } else if (action === "select") {
      if (!browserPane.selectTab(Number(index))) return browserControl.failure("invalid_tab");
    } else if (action === "close") {
      if (!browserPane.closeTab(Number(index))) return browserControl.failure("invalid_tab");
    }
    return { ok: true, tabs: tabList() };
  }, { needsPage: false });
});

const isRef = (value) => typeof value === "string" && /^e\d+$/.test(value);

ipc.handle("browser-click", async (event, target, options) => {
  const opts = options && typeof options === "object" ? options : {};
  const byPoint = Number.isFinite(opts.x) && Number.isFinite(opts.y);
  const ref = isRef(target) ? target : null;
  const index = ref || byPoint ? null : browserControl.parseElementIndex(target);
  if (!ref && !byPoint && index === null) return browserControl.failure("invalid_index");

  return acting("clicking", async (input, contents, step) => {
    const point = byPoint
      ? await input.where({ x: opts.x, y: opts.y })
      : ref
        ? await observerFor(contents).pointOf(ref)
        : JSON.parse(await contents.executeJavaScript(browserControl.clickTargetScript(index)));
    if (point.missing) return browserControl.failure("element_not_found");
    if (index !== null) {
      const item = JSON.parse(await contents.executeJavaScript(browserControl.indexInfoScript(index)));
      const why = !item.missing && browserSafety.riskyAction(item);
      if (why && !(await actionAllowed(contents, why))) return browserControl.failure("needs_confirmation");
    }
    if (ref) {
      const entry = await observerFor(contents).resolve(ref);
      const why = browserSafety.riskyAction({ role: entry.role, name: entry.name });
      if (why && !(await actionAllowed(contents, why))) return browserControl.failure("needs_confirmation");
      const blocker = await input.blockedBy(ref, point.x, point.y);
      if (blocker) return browserControl.failure("click_blocked", blocker);
    }
    // The cursor glides to the point first, so the user sees where the click will land.
    await showAgentOverlay(contents, point);
    await sleep(400);
    if (step.stopped()) return browserControl.failure("user_took_over");
    void showAgentOverlay(contents, { ...point, click: true });
    if (ref || byPoint) await input.clickAt(point.x, point.y, opts, step.stopped);
    else await browserControl.clickAt(contents, point.x, point.y, sleep, step.stopped);
    return {};
  }, { report: true });
});

ipc.handle("browser-type", async (event, target, text, options) => {
  const opts = options && typeof options === "object" ? options : {};
  if (isRef(target)) {
    return acting("typing", async (input, contents, step) => {
      if (opts.submit && !(await actionAllowed(contents, "submits a form"))) return browserControl.failure("needs_confirmation");
      const result = await input.typeInto(target, text, opts, step.stopped);
      log.info("window.browser.control", "typed", { chars: String(text ?? "").length, landed: result.landed });
      return { value: result.value, landed: result.landed };
    });
  }
  const index = browserControl.parseElementIndex(target);
  if (index === null) return browserControl.failure("invalid_index");

  return inPane("typing", async (contents) => {
    try {
      if (!(await siteAllowed(contents))) return browserControl.failure("site_denied");
      const item = JSON.parse(await contents.executeJavaScript(browserControl.indexInfoScript(index)));
      const sensitive = !item.missing && browserSafety.sensitiveField(item.attrs);
      if (sensitive) {
        return browserControl.failure("needs_user", `That is ${sensitive}. Ask the user to fill it in themselves in the browser pane.`);
      }
      const typed = await contents.executeJavaScript(`
        (() => {
          ${browserControl.COLLECT_ELEMENTS_FN}
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
      if (!typed) return browserControl.failure("element_not_found");
      return { ok: true };
    } catch (e) {
      return browserControl.failure("script_failed", e.message);
    }
  });
});

ipc.handle("browser-press-key", async (event, key, options) => {
  const { repeat } = options && typeof options === "object" ? options : {};
  return acting("pressing", async (input, contents, step) => {
    await input.pressKey(key, repeat, step.stopped);
    await sleep(300);
    return {};
  }, { report: true });
});

ipc.handle("browser-hover", (event, target) =>
  acting("hovering", async (input, contents) => {
    const point = await input.hover(isRef(target) ? target : target && typeof target === "object" ? target : null);
    await showAgentOverlay(contents, point);
    return {};
  }, { report: true }),
);

ipc.handle("browser-drag", (event, from, to) =>
  acting("dragging", async (input, contents, step) => {
    await input.drag(from, to, step.stopped);
    return {};
  }, { report: true }),
);

ipc.handle("browser-scroll", (event, options) =>
  acting("scrolling", async (input) => {
    const position = await input.scroll(options && typeof options === "object" ? options : {});
    return { scroll: position };
  }),
);

ipc.handle("browser-select-option", (event, ref, choice) =>
  acting("choosing", async (input) => {
    if (!isRef(ref)) return browserControl.failure("invalid_input", "Give the ref of a dropdown from browser_snapshot.");
    return input.selectOption(ref, choice && typeof choice === "object" ? choice : {});
  }, { report: true }),
);

ipc.handle("browser-wait", (event, options) =>
  acting("waiting", async (input) => {
    const out = await input.wait(options && typeof options === "object" ? options : {});
    return { waited: out.ms };
  }),
);

ipc.handle("browser-history", async (event, action) => {
  if (!["back", "forward", "reload"].includes(action)) {
    return browserControl.failure("invalid_input", 'The history action is back, forward or reload.');
  }
  return inPane("navigating", async (contents, step) => {
    try {
      activeGuard()?.reset();
      const history = contents.navigationHistory;
      if (action === "back" && !history.canGoBack()) return browserControl.failure("navigation_failed", "There is no earlier page.");
      if (action === "forward" && !history.canGoForward()) return browserControl.failure("navigation_failed", "There is no later page.");
      if (action === "back") history.goBack();
      else if (action === "forward") history.goForward();
      else contents.reload();
      await sleep(300);
      for (let waited = 0; contents.isLoading() && waited < 15000 && !step.stopped(); waited += 250) await sleep(250);
      const refused = refusedByGuard();
      if (refused) return refused;
      const title = await contents.executeJavaScript('document.title || ""');
      return { ok: true, title, url: contents.getURL() };
    } catch (e) {
      return browserControl.failure("navigation_failed", e.message);
    }
  });
});

ipc.handle("browser-get-text", async (event, options) => {
  const { ref, selector } = options && typeof options === "object" ? options : {};
  return inPane("reading", async (contents) => {
    try {
      if (typeof ref === "string" && ref) {
        const text = (await observerFor(contents).textOf(ref)).slice(0, 12000);
        const title = await contents.executeJavaScript('document.title || ""');
        return { ok: true, title, url: contents.getURL(), text };
      }
      const result = JSON.parse(
        await contents.executeJavaScript(
          browserControl.readTextScript(12000, typeof selector === "string" ? selector : ""),
        ),
      );
      if (result.missing) return browserControl.failure("element_not_found", "Nothing on the page matches that selector.");
      return { ok: true, ...result };
    } catch (e) {
      return observationFailure(e);
    }
  });
});

// The agent no longer owns a window of its own, so closing only lets go of the pane.
ipc.handle("browser-close", async () => {
  paneDriver.end();
  return { ok: true };
});

ipc.handle("browser-agent:stop", (event) => {
  if (!fromMainWindow(event)) return { success: false };
  paneDriver.takeOver();
  void hideAgentOverlay();
  return { success: true };
});

// The run that was driving the pane is over, so the frame comes off.
ipc.handle("browser-agent:release", (event) => {
  if (!fromMainWindow(event)) return { success: false };
  void hideAgentOverlay();
  return { success: true };
});

function ggufModelsDir() {
  return path.join(app.getPath("userData"), "models");
}

embedServer.configure(async () => {
  const specs = await getSystemSpecs();
  return {
    binaryPath: binaryManager.findLlamaBinary(app.getPath("userData")),
    userDataDir: app.getPath("userData"),
    vramGB: specs?.vram || 0,
    modelsDir: ggufModelsDir(),
    log,
  };
});

ipc.handle("gguf:status", async () => {
  log.debug("ipc", "gguf:status requested");
  const specs = await getSystemSpecs();
  const engine = binaryManager.getEngineEnvironment(app.getPath("userData"), specs?.vram || 0);
  const status = llamaProcess.getServerStatus();
  const wantsGpu = (specs?.vram || 0) > 0;
  return {
    ...status,
    hasBinary: Boolean(engine.binaryPath),
    ready: Boolean(engine.binaryPath) && (engine.runnerType !== "cpu" || !wantsGpu),
    runnerType: engine.runnerType,
    engineBuild: binaryManager.readEngineMeta(binaryManager.engineDir(app.getPath("userData"))).tag || null,
    // Where a download lands, so the first-run setup can say so before it starts one.
    modelsDir: ggufModelsDir(),
  };
});

ipc.handle("gguf:setup-engine", async () => {
  log.info("ipc", "gguf:setup-engine requested");
  const specs = await getSystemSpecs();
  const result = await binaryManager.ensureEngineReady(app.getPath("userData"), specs?.vram || 0, (progress) => {
    broadcast("gguf:progress", progress);
    broadcast("download-progress", progress);
  });
  log.info("ipc", `gguf:setup-engine result: ready=${result.ready} runner=${result.runnerType}`);
  return { success: Boolean(result.ready), runnerType: result.runnerType, error: result.error };
});

/** Sizes from the renderer's plan, clamped to numbers the flags can take; anything else means no streaming. */
function sanitizeMoeStream(value) {
  if (!value || typeof value !== "object") return null;
  const number = (n, max) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.min(Number(n), max) : 0);
  const cacheGB = number(value.cacheGB, 4096);
  if (!cacheGB) return null;
  return { cacheGB, ioThreads: Math.floor(number(value.ioThreads, 64)), vramSlots: number(value.vramSlots, 100000), direct: value.direct === true };
}

ipc.handle("gguf:start", async (_event, options = {}) => {
  log.info("ipc", `gguf:start model=${options.modelPath} context=${options.contextSize}`);
  // On a card too small for both, the chat model waits for a running picture and then gets the GPU back.
  if (await imageEngine.yieldToChat()) log.info("ipc", "gguf:start stopped the image engine to give the chat model its memory back");
  const binary = binaryManager.findLlamaBinary(app.getPath("userData"));
  if (!binary) {
    log.error("ipc", "gguf:start failed: llama-server binary not found");
    return { success: false, error: "llama-server binary not found", kind: "engine-missing" };
  }
  const targetPath = path.isAbsolute(options.modelPath || "")
    ? options.modelPath
    : path.join(ggufModelsDir(), options.modelPath || "");
  const specs = await getSystemSpecs();
  const userDataDir = app.getPath("userData");
  const start = (binaryPath) =>
    llamaProcess.startServer({
      binaryPath,
      userDataDir,
      vramGB: specs?.vram || 0,
      modelPath: targetPath,
      // Left unset when the caller does not say, so the running window is kept rather than reloaded.
      contextSize: options.contextSize || undefined,
      gpuLayers: options.gpuLayers,
      exactContext: Boolean(options.exactContext),
      moeStream: sanitizeMoeStream(options.moeStream),
      port: options.port || 11435,
      log,
    });
  let result = await engineHost.start("llamacpp", () => start(binary));
  if (result.success) {
    engineUpdater.confirmEngine(userDataDir);
  } else if (result.kind === "stopped-loading" && engineUpdater.isUnconfirmed(userDataDir)) {
    // The first load on a freshly updated engine crashed: go back to the build that worked.
    const { rolledBack } = engineUpdater.rollbackEngine(userDataDir, { log });
    const restored = rolledBack && binaryManager.findLlamaBinary(userDataDir);
    if (restored) {
      result = await start(restored);
      if (result.success) engineUpdater.confirmEngine(userDataDir);
    }
  }
  log.info("ipc", `gguf:start result: success=${result.success}`);
  if (result.success) {
    startup.mark("engine");
    if (startup.has("loaded")) finishStartup();
  }
  return result;
});

ipc.handle("gguf:stop", async () => {
  log.info("ipc", "gguf:stop requested");
  llamaProcess.stopServerSync();
  return { success: true };
});

ipc.handle("gguf:models", async () => {
  log.debug("ipc", "gguf:models listing requested");
  return modelStorage.listGgufModels(ggufModelsDir());
});

ipc.handle("gguf:delete", async (_event, filename) => {
  log.info("ipc", `gguf:delete requested: ${filename}`);
  return modelStorage.deleteGgufModel(ggufModelsDir(), filename);
});

ipc.handle("gguf:download", async (event, { url, filename, cid } = {}) => {
  log.info("ipc", "gguf download requested", { file: filename, cid });
  const result = await modelStorage.downloadGgufModelForIpc({
    url,
    modelsDir: ggufModelsDir(),
    filename,
    cid,
    onProgress: (progress) => {
      const payload = { ...progress, label: filename };
      broadcast("gguf:progress", payload);
      broadcast("download-progress", payload);
    },
  });
  // A model the user just fetched gets a small draft from its family alongside, for faster replies.
  // Only on a download the user started, so nothing else ever reaches the network unasked.
  if (result?.success && result.path) {
    const userDataDir = app.getPath("userData");
    draftPairing
      .ensureFamilyDraft(result.path, {
        download: modelStorage.downloadGgufModel,
        isRefused: (modelPath) => draftStats.isRefused(userDataDir, modelPath),
        log,
      })
      .catch(log.swallowed("ipc", "best effort, the screen works without it"));
  }
  return result;
});

ipc.handle("gguf:cancel-download", async (_event, filename) => {
  log.info("ipc", `gguf:cancel-download requested: ${filename}`);
  return modelStorage.cancelDownloadGgufModel(ggufModelsDir(), filename);
});

ipc.handle("search-models", async (event, query) => {
  try {
    const models = await huggingface.searchHuggingFace(query);
    return { success: true, models };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipc.handle("model-size", async (event, name, tag) => {
  return huggingface.fetchModelSize(name, tag, { live: true });
});

ipc.handle("resolve-model-url", async (_event, reference, options) => {
  return huggingface.resolveModelDownload(reference, { ...options, live: true });
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

ipc.handle("open-file", async (event, filepath) => {
  const resolved = path.resolve(String(filepath || ""));
  if (!isInsideCreatedFilesDir(resolved)) {
    return `Refused to open a file outside the ${APP_NAME} output folder`;
  }
  return await shell.openPath(resolved);
});

ipc.handle("read-document", async (event, filename, data) => {
  try {
    const text = await documents.extractText(String(filename), Buffer.from(data));
    const trimmed = text.slice(0, documents.DOCUMENT_TEXT_LIMIT).trim();
    if (!trimmed) return { success: false, error: "No readable text found" };

    return { success: true, text: trimmed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipc.handle("create-file", async (event, filename, content) => {
  try {
    const safeFilename = path.basename(String(filename));

    if (!safeFilename || safeFilename === "." || safeFilename === "..") {
      return { success: false, error: "That file name is not usable." };
    }

    if (documents.isExecutableName(safeFilename)) {
      log.warn("create-file", `refused executable name ${safeFilename}`);
      return {
        success: false,
        error: `Refused to write ${safeFilename}: ${APP_NAME} does not create executable or script files that Windows would run on a double-click. Use a .txt or .md extension instead.`,
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

ipc.handle("open-created-files", async () => {
  const dir = createdFilesDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

// The folder on disk is the record of what the model made, not a list kept in
// the app: a file deleted outside the app should simply stop being listed.
ipc.handle("list-created-files", async () => {
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

ipc.handle("reveal-created-file", async (event, filepath) => {
  const resolved = path.resolve(String(filepath));
  if (!isInsideCreatedFilesDir(resolved)) {
    return { success: false, error: "That file is outside the output folder." };
  }
  shell.showItemInFolder(resolved);
  return { success: true };
});

ipc.handle("delete-created-file", async (event, filepath) => {
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

ipc.handle("read-created-file", async (event, filepath) => {
  try {
    const resolved = path.resolve(String(filepath));
    if (!isInsideCreatedFilesDir(resolved)) {
      return { success: false, error: "That file is outside the output folder." };
    }

    const stats = fs.statSync(resolved);
    const PREVIEW_LIMIT = 200 * 1024;
    const buffer = fs.readFileSync(resolved);
    const text = buffer.subarray(0, PREVIEW_LIMIT).toString("utf8");

    // A Word file is drawn from its bytes, so the renderer gets them whole when they are not huge.
    const wordBytes = path.extname(resolved).toLowerCase() === ".docx" && stats.size <= 20 * 1024 * 1024;
    return {
      success: true,
      text,
      ...(wordBytes ? { data: buffer.toString("base64") } : {}),
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

/** The folders a conversation may reach: its workspace's and nothing else. The renderer names a
 * workspace, so it cannot ask for a folder it was never given. */
function rootsFor(workspaceId) {
  const workspace = storage.getWorkspace(workspaceId);
  return workspace && workspace.rootPath ? [workspace.rootPath] : [];
}

const fileOps = fileOperations.create({
  roots: rootsFor,
  storage,
  checkpoints,
  trash: (target) => shell.trashItem(target),
});

const workspaceWatchers = new Map();

/** Watches project roots for changes made by external tools or git. */
function ensureWorkspaceWatcher(workspaceId, rootPath) {
  if (!rootPath || !fs.existsSync(rootPath) || workspaceWatchers.has(workspaceId)) return;

  try {
    let timer = null;
    let pendingPath = rootPath;

    const watcher = fs.watch(rootPath, { recursive: true }, (_eventType, filename) => {
      const rel = String(filename || "").replace(/\\/g, "/");
      if (
        rel.includes("/.git/") || rel.startsWith(".git") ||
        rel.includes("/node_modules/") || rel.startsWith("node_modules") ||
        rel.includes("/dist/") || rel.startsWith("dist") ||
        rel.includes("/dist-electron/") || rel.startsWith("dist-electron") ||
        rel.includes("/.draggy/") || rel.startsWith(".draggy") ||
        rel.endsWith(".swp") || rel.endsWith("~")
      ) {
        return;
      }

      pendingPath = filename ? path.join(rootPath, filename) : rootPath;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        broadcast("file-changed", {
          workspaceId: String(workspaceId || ""),
          path: pendingPath,
        });
      }, 150);
    });

    watcher.on("error", (err) => {
      log.debug("fs", `Workspace watcher error: ${err.message}`);
    });

    workspaceWatchers.set(workspaceId, watcher);
  } catch (err) {
    log.debug("fs", `Could not watch workspace ${workspaceId}: ${err.message}`);
  }
}

ipc.handle("fs:list", wrap("fs", async (event, workspaceId, target) => {
  const roots = rootsFor(workspaceId);
  if (roots[0]) ensureWorkspaceWatcher(workspaceId, roots[0]);
  return fileOps.list(workspaceId, target);
}));

ipc.handle("fs:read", wrap("fs", async (event, workspaceId, target) =>
  fileOps.read(workspaceId, target),
));

// A project file opens in its default app. Something that would run instead (a script, an
// installer) is shown in the file manager, so a click never executes it.
ipc.handle("fs:open", wrap("fs", async (event, workspaceId, target) => {
  const found = fileOps.locate(workspaceId, target);
  if (!found.success) return found;
  if (documents.isExecutableName(found.path)) {
    shell.showItemInFolder(found.path);
    return { success: true, revealed: true };
  }
  const error = await shell.openPath(found.path);
  return error ? { success: false, error } : { success: true };
}));

ipc.handle("fs:reveal", wrap("fs", async (event, workspaceId, target) => {
  const found = fileOps.locate(workspaceId, target);
  if (!found.success) return found;
  shell.showItemInFolder(found.path);
  return { success: true };
}));

/** Announces a changed file, so the canvas shows the model's edit as it lands instead of on the
 * next reopen. */
function announceChange(workspaceId, result) {
  if (!result?.success || !result.path) return result;

  broadcast("file-changed", {
    workspaceId: String(workspaceId || ""),
    path: String(result.path),
    ...(result.from ? { from: String(result.from) } : {}),
  });

  return result;
}

ipc.handle("fs:write", wrap("fs", async (event, workspaceId, target, contents, chatId) =>
  announceChange(workspaceId, await fileOps.write(workspaceId, target, contents, chatId)),
));

ipc.handle("fs:edit", wrap("fs", async (event, workspaceId, target, find, replace, expected, chatId) =>
  announceChange(
    workspaceId,
    await fileOps.edit(workspaceId, target, find, replace, expected, chatId),
  ),
));

ipc.handle("fs:move", wrap("fs", async (event, workspaceId, from, to, chatId) =>
  announceChange(workspaceId, await fileOps.move(workspaceId, from, to, chatId)),
));

ipc.handle("fs:delete", wrap("fs", async (event, workspaceId, target, chatId) =>
  announceChange(workspaceId, await fileOps.remove(workspaceId, target, chatId)),
));

const imageEngine = imageIpc.register(ipc, {
  app,
  log,
  broadcast,
  wrap,
  platform,
  llamaProcess,
  modelStorage,
  huggingface,
  fileOps,
  fsGuard,
  rootsFor,
  announceChange,
  createdFilesDir,
  isInsideCreatedFilesDir,
  getSystemSpecs,
});

/* -------------------------------------------------------------------------- */
/* The local OpenAI-compatible API                                            */
/* -------------------------------------------------------------------------- */

/** Where the key lives in the encrypted store. No server id can look like this. */
const API_SECRET_OWNER = "__draggy_api_server";
const API_CONFIG_KEY = "apiServer";

/** How long a request may wait on the window before it is given up on. */
const API_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

let apiServer = null;
let apiServerError = null;
/** The key for this run, when the keystore cannot hold one across runs. */
let apiKeyInMemory = null;
/** Set once the window has said it can answer requests. */
let apiBridgeReady = false;
const pendingApiRequests = new Map();

function readApiServerConfig() {
  const saved = safeParse(storage.getValue(API_CONFIG_KEY));
  const port = Number(saved?.port);

  return {
    enabled: saved?.enabled === true,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : apiServerTools.DEFAULT_PORT,
  };
}

function safeParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function currentApiKey() {
  const stored = secrets.get(API_SECRET_OWNER).key;
  if (stored) return stored;
  if (apiKeyInMemory) return apiKeyInMemory;

  const key = apiServerTools.generateKey();
  // The keystore can refuse (no safeStorage); the key then lasts for this run.
  if (!secrets.set(API_SECRET_OWNER, { key })) apiKeyInMemory = key;
  return key;
}

function isMainWindowSender(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

/** Hands a request to the window, where the same loop as the chat runs it. */
function generateInWindow(request, { signal, onText, onModel } = {}) {
  return new Promise((resolve, reject) => {
    if (!apiBridgeReady || !mainWindow || mainWindow.isDestroyed()) {
      reject(new Error("Draggy is still starting. Try again in a moment."));
      return;
    }

    const id = crypto.randomUUID();

    const finish = (callback) => (value) => {
      const pending = pendingApiRequests.get(id);
      if (!pending) return;
      pendingApiRequests.delete(id);
      clearTimeout(pending.timer);
      callback(value);
    };

    const timer = setTimeout(() => {
      sendTo(mainWindow, "api-server:abort", id);
      finish(reject)(new Error("The reply took too long."));
    }, API_REQUEST_TIMEOUT_MS);

    pendingApiRequests.set(id, {
      onText,
      onModel,
      timer,
      resolve: finish(resolve),
      reject: finish(reject),
    });

    signal?.addEventListener("abort", () => {
      if (!mainWindow?.isDestroyed()) sendTo(mainWindow, "api-server:abort", id);
      finish(reject)(new Error("The client went away."));
    });

    sendTo(mainWindow, "api-server:request", { id, request });
  });
}

async function listApiModels() {
  try {
    return modelStorage
      .listGgufModels(ggufModelsDir())
      .map((model) => model.filename)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function apiServerStatus() {
  const config = readApiServerConfig();
  return {
    success: true,
    enabled: config.enabled,
    port: config.port,
    running: Boolean(apiServer?.isRunning()),
    baseUrl: `http://${apiServerTools.HOST}:${config.port}/v1`,
    key: config.enabled ? currentApiKey() : null,
    error: apiServerError,
  };
}

async function applyApiServerConfig(config) {
  apiServerError = null;

  if (apiServer && (!config.enabled || apiServer.port() !== config.port)) {
    await apiServer.stop();
    apiServer = null;
  }

  if (!config.enabled) return apiServerStatus();

  if (!apiServer) {
    apiServer = apiServerTools.createApiServer({
      port: config.port,
      getKey: currentApiKey,
      generate: generateInWindow,
      listModels: listApiModels,
      log,
    });
  }

  const started = await apiServer.start();
  if (!started.success) {
    apiServerError = started.error;
    apiServer = null;
  }

  return apiServerStatus();
}

ipc.handle("api-server:status", wrap("api", async () => apiServerStatus()));

ipc.handle("api-server:configure", wrap("api", async (event, next) => {
  const current = readApiServerConfig();
  const port = Number(next?.port);

  const config = {
    enabled: typeof next?.enabled === "boolean" ? next.enabled : current.enabled,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : current.port,
  };

  storage.setValue(API_CONFIG_KEY, JSON.stringify(config));
  return applyApiServerConfig(config);
}));

ipc.handle("api-server:regenerate-key", wrap("api", async () => {
  apiKeyInMemory = null;
  const key = apiServerTools.generateKey();
  if (!secrets.set(API_SECRET_OWNER, { key })) apiKeyInMemory = key;
  return apiServerStatus();
}));

ipc.on("api-server:ready", (event) => {
  if (isMainWindowSender(event)) apiBridgeReady = true;
});

ipc.on("api-server:text", (event, id, text) => {
  if (!isMainWindowSender(event)) return;
  pendingApiRequests.get(String(id))?.onText?.(String(text ?? ""));
});

ipc.on("api-server:model", (event, id, model) => {
  if (!isMainWindowSender(event)) return;
  pendingApiRequests.get(String(id))?.onModel?.(String(model ?? ""));
});

ipc.on("api-server:done", (event, id, result) => {
  if (!isMainWindowSender(event)) return;
  pendingApiRequests.get(String(id))?.resolve(result ?? {});
});

ipc.on("api-server:failed", (event, id, message) => {
  if (!isMainWindowSender(event)) return;
  pendingApiRequests.get(String(id))?.reject(new Error(String(message || "The reply failed.")));
});

const git = gitTools.createGit();

/** Git for a workspace's folder, read-only. The renderer names a workspace, not a folder, for the
 * same reason the file handlers do. */
ipc.handle("git:status", wrap("git", async (event, workspaceId) => {
  const root = rootsFor(String(workspaceId || ""))[0];
  if (!root) return { success: true, available: false, isRepo: false };
  return git.status(root);
}));

ipc.handle("git:diff", wrap("git", async (event, workspaceId, target, staged) => {
  const roots = rootsFor(String(workspaceId || ""));
  const root = roots[0];
  if (!root) return { success: false, error: "This conversation has no project folder." };

  // One file goes through the same guard as reading it would, which is also
  // what keeps a credentials file out of a diff asked for by name.
  let relative = ".";
  if (target && String(target).trim() && String(target).trim() !== ".") {
    const resolved = fsGuard.resolveWithin(roots, String(target), { mustExist: false });
    if (!resolved.ok) return { success: false, error: resolved.error };

    let realRoot = root;
    try {
      realRoot = fs.realpathSync.native(root);
    } catch (error) {
      log.swallow("ipc", error, "a root that cannot be resolved has already failed the guard above");
    }

    relative = gitTools.toPathspec(realRoot, resolved.path);
    if (!relative) return { success: false, error: "That path is outside the project." };
  }

  return git.diff(root, {
    relative,
    staged: Boolean(staged),
    allow: (absolute) => fsGuard.isReadable(absolute),
  });
}));

ipc.handle("fs:search", wrap("fs", async (event, workspaceId, query) =>
  fileOps.search(workspaceId, query),
));

ipc.handle("metrics:record", wrap("metrics", async (event, row) =>
  storage.recordMetric(row),
));

ipc.handle("metrics:list", wrap("metrics", async (event, since) => ({
  success: true,
  rows: storage.listMetrics(Number(since) || 0),
})));

ipc.handle("metrics:clear", wrap("metrics", async () => storage.clearMetrics()));

ipc.handle("checkpoint:list", wrap("fs", async (event, workspaceId) => ({
  success: true,
  checkpoints: storage.listCheckpoints(String(workspaceId || "")),
})));

ipc.handle("checkpoint:revert", wrap("fs", async (event, id) => {
  const result = await fileOps.revert(id);

  return announceChange(result?.workspaceId, result);
}));

ipc.handle("db:load-chats", wrap("db", async () => ({
  success: true,
  chats: storage.loadChats(),
})));

ipc.handle("db:save-chat", wrap("db", async (event, session) =>
  storage.saveChat(session),
));

ipc.handle("db:delete-chat", wrap("db", async (event, id) =>
  storage.deleteChat(String(id)),
));

ipc.handle("db:clear-chats", wrap("db", async () => storage.clearChats()));

ipc.handle("db:search-chats", wrap("db", async (event, query) => ({
  success: true,
  results: storage.searchChats(query),
})));

ipc.handle("workspace:list", wrap("workspace", async () => ({
  success: true,
  workspaces: storage.listWorkspaces(),
})));

ipc.handle("workspace:save", wrap("workspace", async (event, workspace) =>
  storage.saveWorkspace(workspace),
));

ipc.handle("workspace:delete", wrap("workspace", async (event, id) => {
  const watcher = workspaceWatchers.get(String(id));
  if (watcher) {
    try {
      watcher.close();
    } catch (error) {
      log.debug("fs", `Error closing watcher: ${error.message}`);
    }
    workspaceWatchers.delete(String(id));
  }
  return storage.deleteWorkspace(String(id));
}));

ipc.handle("workspace:pick-folder", wrap("workspace", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Choose a project folder",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, cancelled: true };
  }

  return { success: true, path: result.filePaths[0] };
}));

ipc.handle("db:get", wrap("db", async (event, key) => ({
  success: true,
  value: storage.getValue(String(key)),
})));

ipc.handle("db:set", wrap("db", async (event, key, value) => {
  const before = key === "draggy_settings" ? storage.getValue("draggy_settings") : null;
  const result = storage.setValue(String(key), value);
  if (key === "draggy_settings") {
    const changed = settingsLog.describeChange(before, value);
    if (Object.keys(changed).length > 0) log.info("settings", "settings saved", { changed });
    applyThemeSetting(value);
  } else if (result.success) {
    log.info("settings", "setting saved", settingsLog.describeKeySave(key));
  }
  return result;
}));

ipc.handle("db:import", wrap("db", async (event, sessions) =>
  storage.importSessions(sessions),
));

ipc.handle("db:stats", wrap("db", async () => ({
  success: true,
  stats: storage.stats(),
})));

ipc.handle("library:list", wrap("library", async (event, workspaceId) => ({
  success: true,
  sources: library.listSources(workspaceId ? String(workspaceId) : undefined),
})));

ipc.handle("library:stats", wrap("library", async () => ({
  success: true,
  stats: library.stats(),
})));

ipc.handle("library:pick-folder", wrap("library", async () => {
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

ipc.handle(
  "library:index",
  wrap("library", async (event, sourcePath, model, workspaceId) => {
  if (indexingRun) return { success: false, error: "An index run is already in progress." };

  const embedModel = String(model || library.DEFAULT_EMBED_MODEL);
  library.setMeta("embed_model", embedModel);

  indexingRun = library
    .indexSource(
      String(sourcePath),
      embedModel,
      (progress) => broadcast("library-progress", progress),
      workspaceId ? String(workspaceId) : undefined,
    )
    .finally(() => {
      indexingRun = null;
    });

  return indexingRun;
}));

ipc.handle("library:remove", wrap("library", async (event, id) =>
  library.removeSource(id),
));

ipc.handle("library:clear", wrap("library", async () => library.clear()));

ipc.handle("library:search", wrap("library", async (event, query, limit, model, options) =>
  library.search(
    query,
    limit,
    String(model || library.meta("embed_model", library.DEFAULT_EMBED_MODEL)),
    options || {},
  ),
));

// A command runs in the conversation's own project folder, which the main process looks up; the
// renderer names a workspace and cannot pick a folder.
ipc.handle(
  "commands:run",
  wrap("commands", async (event, workspaceId, runId, command, options) => {
    const root = rootsFor(workspaceId)[0];
    if (!root) {
      return { success: false, error: "Commands run inside a project, and this conversation has none." };
    }
    return commands.run({
      id: runId,
      cwd: root,
      command,
      shell: options?.shell,
      timeoutMs: options?.timeoutMs,
    });
  }),
);

ipc.handle("commands:cancel", wrap("commands", async (event, runId) => ({
  success: commands.cancel(String(runId || "")),
})));

ipc.handle("runner:probe", wrap("runner", async () => ({
  success: true,
  ...(await runner.probe()),
})));

ipc.handle("run-code", wrap("runner", async (event, language, source, timeoutMs) =>
  runner.runCode({
    userDataPath: app.getPath("userData"),
    language,
    source,
    timeoutMs,
  }),
));

ipc.handle("updater:state", () => updater.current());
ipc.handle("updater:configure", (event, options) => {
  // The engine follows the same setting as the app: automatic, or not at all.
  engineUpdater.configure({
    automatic: Boolean(options?.automatic),
    userDataDir: app.getPath("userData"),
    getVramGB: async () => (await getSystemSpecs())?.vram || 0,
    log,
  });
  return updater.configure(options || {});
});
ipc.handle("updater:check", (event, options) => updater.check(options || {}));
ipc.handle("updater:download", () => updater.download());
ipc.handle("updater:install", () => updater.install());

ipc.handle("app:version", () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  platform: process.platform,
  arch: os.arch(),
  packaged: app.isPackaged,
}));


/** MCP servers, configured per server in the usual store. Credentials go there too: the same local
 * SQLite file, and the same protection the chats get. */
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

ipc.handle("mcp:catalogue", () => {
  const shipped = mcpCatalogue.listCatalogue();
  const config = mcpConfig();
  const custom = Object.entries(config)
    .filter(([id, entry]) => Boolean(entry?.package) && !shipped.some((s) => s.id === id))
    .map(([id, entry]) => ({
      id,
      name: entry.name || id,
      description: entry.description || "",
      package: entry.package,
      docs: entry.docs || `https://www.npmjs.com/package/${entry.package}`,
      args: Array.isArray(entry.args) ? entry.args : [],
      arguments: Array.isArray(entry.argumentsList) ? entry.argumentsList : [],
      env: Array.isArray(entry.envDeclarations) ? entry.envDeclarations : [],
      source: "registry",
    }));

  return {
    success: true,
    servers: [...shipped, ...custom],
  };
});

/** Credentials saved before the encrypted store existed. Moved there on first launch, since the
 * database is a file backups and support bundles copy. */
function adoptStoredCredentials() {
  try {
    const config = mcpConfig();
    const { moved, records } = secrets.adopt(config, (field, id) =>
      mcpCatalogue.isSecretField(id, field),
    );

    if (moved > 0) saveMcpConfig(records);
  } catch (error) {
    log.warn("mcp", `could not move credentials into the store: ${error.message}`);
  }
}

ipc.handle("mcp:sign-in", wrap("mcp", async (event, id) => {
  const config = mcpConfig();
  const entry = config[String(id)];

  if (!entry?.url) {
    return { success: false, error: "That server is not a remote one." };
  }

  return mcp.signIn(String(id), entry.url, (target) => shell.openExternal(target));
}));

ipc.handle("mcp:sign-out", wrap("mcp", async (event, id) => {
  const result = mcp.signOut(String(id));
  broadcast("mcp-state", { servers: mcp.listRunning() });
  return result;
}));

const MCP_ENABLED_KEY = "mcpEnabledByWorkspace";

function enabledByWorkspace() {
  try {
    const raw = storage.getValue(MCP_ENABLED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveEnabledByWorkspace(record) {
  storage.setValue(MCP_ENABLED_KEY, JSON.stringify(record));
}

/** What is switched on. Extensions are global: Chat and every project get the same servers. Kept
 * under the default workspace's entry, where earlier 2.0 builds wrote Chat's list. */
function enabledServers() {
  const record = enabledByWorkspace();
  const ids = record[storage.DEFAULT_WORKSPACE_ID];

  if (Array.isArray(ids)) return ids;

  // Nothing recorded yet: what the app-wide switches of 1.x said.
  return Object.entries(mcpConfig())
    .filter(([, entry]) => entry?.enabled)
    .map(([id]) => id);
}

function setServerEnabled(id, enabled) {
  const current = new Set(enabledServers());

  if (enabled) current.add(String(id));
  else current.delete(String(id));

  // Lists earlier builds kept per project are dropped, so nothing reads them by mistake.
  saveEnabledByWorkspace({ [storage.DEFAULT_WORKSPACE_ID]: [...current] });

  return [...current];
}

ipc.handle("mcp:enabled", wrap("mcp", async () => ({
  success: true,
  ids: enabledServers(),
})));

ipc.handle(
  "mcp:set-enabled",
  wrap("mcp", async (event, id, enabled) => {
    const ids = setServerEnabled(id, Boolean(enabled));

    const config = mcpConfig();
    const entry = config[String(id)] || {};

    if (enabled) {
      // A remote server still waits to be asked: switching it on says the user
      // wants it, not that Draggy should reach the network right now.
      if (!entry.url) await mcp.startServer(String(id), entry);
    } else {
      mcp.stopServer(String(id));
    }

    broadcast("mcp-state", { servers: mcp.listRunning() });
    return { success: true, ids };
  }),
);

ipc.handle("registry:search", wrap("mcp", async (event, query) =>
  mcpRegistry.search(String(query || "")),
));

const SKILLS_ENABLED_KEY = "skillsEnabled";

/** The switches the user has flipped, by skill id. Anything missing keeps its default. */
function skillOverrides() {
  try {
    const parsed = JSON.parse(storage.getValue(SKILLS_ENABLED_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

ipc.handle("skills:list", wrap("skills", async (event, workspaceId) => ({
  success: true,
  skills: skills.listSkills(rootsFor(workspaceId)[0], skillOverrides()),
})));

ipc.handle("skills:read", wrap("skills", async (event, workspaceId, id, options) =>
  skills.readSkill(String(id), rootsFor(workspaceId)[0], {
    overrides: skillOverrides(),
    enabledOnly: Boolean(options?.enabledOnly),
    file: typeof options?.file === "string" && options.file ? options.file : null,
  }),
));

ipc.handle("skills:set-enabled", wrap("skills", async (event, id, enabled) => {
  const overrides = { ...skillOverrides(), [String(id)]: Boolean(enabled) };
  storage.setValue(SKILLS_ENABLED_KEY, JSON.stringify(overrides));
  return { success: true };
}));

ipc.handle("skills:open", wrap("skills", async () => {
  const folder = skills.init(app.getPath("userData"));
  fs.mkdirSync(folder, { recursive: true });
  return shell.openPath(folder);
}));

ipc.handle("mcp:config", () => {
  const config = mcpConfig();
  // Credentials stay encrypted on disk; the interface needs them to show what is configured.
  const enriched = {};
  for (const [id, entry] of Object.entries(config)) {
    enriched[id] = { ...entry, env: secrets.withSecrets(id, entry?.env) };
  }
  return { success: true, config: enriched };
});

ipc.handle("mcp:save", wrap("mcp", async (event, id, entry) => {
  const config = mcpConfig();

  const url = typeof entry?.url === "string" ? entry.url.trim() : "";
  const pkg =
    typeof entry?.package === "string"
      ? entry.package.trim()
      : typeof config[String(id)]?.package === "string"
        ? config[String(id)].package.trim()
        : "";

  if (!mcpCatalogue.findEntry(String(id)) && !url && !pkg) {
    return { success: false, error: `There is no server called "${id}".` };
  }

  // A remote server is the one thing here that leaves the machine, so the address has to be one
  // that cannot be read on the way: https, or this computer itself.
  if (url && !/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(url)) {
    return {
      success: false,
      error: "A remote server has to be an https address, or a local one.",
    };
  }

  if (pkg && !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(pkg)) {
    return {
      success: false,
      error: "That is not a valid npm package name.",
    };
  }

  const secretFields = url
    ? {}
    : Object.fromEntries(
        Object.entries(entry?.env || {}).filter(([field]) =>
          mcpCatalogue.isSecretField(String(id), field),
        ),
      );

  if (Object.keys(secretFields).length > 0) secrets.set(String(id), secretFields);

  const isCustomPackage = !mcpCatalogue.findEntry(String(id)) && Boolean(pkg);

  config[String(id)] = {
    enabled: Boolean(entry?.enabled),
    env: Object.fromEntries(
      Object.entries(entry?.env && typeof entry.env === "object" ? entry.env : {}).filter(
        ([field]) => !(field in secretFields),
      ),
    ),
    arguments:
      entry?.arguments && typeof entry.arguments === "object" ? entry.arguments : {},
    ...(url ? { url, name: String(entry?.name || id) } : {}),
    ...(isCustomPackage
      ? {
          package: pkg,
          name: String(entry?.name || config[String(id)]?.name || id),
          description: String(entry?.description || config[String(id)]?.description || ""),
          docs: String(entry?.docs || config[String(id)]?.docs || ""),
          source: "registry",
        }
      : {}),
  };

  saveMcpConfig(config);
  return { success: true };
}));

ipc.handle("mcp:forget", wrap("mcp", async (event, id) => {
  const config = mcpConfig();
  delete config[String(id)];
  saveMcpConfig(config);
  secrets.remove(String(id));
  mcp.stopServer(String(id));
  return { success: true };
}));

ipc.handle("mcp:start", wrap("mcp", async (event, id) => {
  const config = mcpConfig();
  const state = await mcp.startServer(String(id), config[String(id)] || {});
  broadcast("mcp-state", { servers: mcp.listRunning() });
  return { success: state.status === "ready", state };
}));

ipc.handle("mcp:stop", wrap("mcp", async (event, id) => {
  const result = mcp.stopServer(String(id));
  broadcast("mcp-state", { servers: mcp.listRunning() });
  return result;
}));

ipc.handle("mcp:running", () => ({ success: true, servers: mcp.listRunning() }));

ipc.handle("widget:stage", wrap("widget", async (event, html) => {
  const staged = widgets.stage(String(html || ""));

  if (!staged) return { success: false };

  return { success: true, token: staged.token, url: staged.url };
}));

ipc.handle("widget:release", wrap("widget", async (event, token) => ({
  success: widgets.release(String(token || "")),
})));

ipc.handle("mcp:call", wrap("mcp", async (event, serverId, toolName, args, correlationId) => {
  return mcp.callTool(String(serverId), String(toolName), args || {}, {
    widgets: true,
    cid: typeof correlationId === "string" ? correlationId : undefined,
  });
}));

/** Starts what the user switched on, once the window is up. A ten-second npx install should not
 * hold the splash screen, and no tool is needed yet. */
ipc.handle("mcp:start-enabled", wrap("mcp", async () => {
  const config = mcpConfig();
  const states = [];

  for (const id of enabledServers()) {
    const entry = config[id] || {};

    // A remote server reaches the network, so it waits to be asked rather than
    // connecting itself every time Draggy opens.
    if (entry.url) continue;

    states.push(await mcp.startServer(id, entry));
  }

  const servers = mcp.listRunning();
  broadcast("mcp-state", { servers });
  return { success: true, servers };
}));

ipc.handle("logs:open", async () => shell.openPath(logger.logFolder()));
ipc.handle("logs:tail", (_event, target, bytes) => logger.readTail(target, bytes));
ipc.handle("logs:get-level", () => logger.getLevelState());
ipc.handle("logs:set-level", (_event, options) => {
  const safe = options && typeof options === "object" ? options : {};
  return logger.setLevel({
    level: typeof safe.level === "string" ? safe.level : undefined,
    scopes: typeof safe.scopes === "string" || Array.isArray(safe.scopes) ? safe.scopes : undefined,
    keep: safe.keep === true,
    durationMs: Number.isFinite(safe.durationMs) ? safe.durationMs : undefined,
  });
});
/** What the diagnostics bundle needs from this process. The bundle itself never touches chats or keys. */
async function diagnosticsOptions(choices) {
  const safe = choices && typeof choices === "object" ? choices : {};
  let settings = {};
  try {
    settings = JSON.parse(storage.getValue("draggy_settings") || "{}");
  } catch (error) {
    log.swallow("settings", error, "unreadable settings are left out of the bundle");
  }
  const dumps = lifecycle.findDumps(app).map((dump) => dump.file);
  const largeModelReport = await buildLargeModelReport().catch(log.swallowed("engine", "the large-model report is optional", null));
  return {
    logDir: logger.logFolder(),
    crashDumps: dumps,
    homeDir: os.homedir(),
    userName: os.userInfo().username,
    appVersion: app.getVersion(),
    includeDebug: safe.includeDebug === true,
    includeDumps: safe.includeDumps === true,
    system: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: os.arch(),
      osRelease: os.release(),
      packaged: app.isPackaged,
      machine: machineSnapshot ? await machineSnapshot : null,
      engine: engineHost.status(),
      colibri: colibriBinary.runtime(app.getPath("userData")) ?? null,
      level: logger.getLevelState(),
    },
    settings,
    providers: (providers?.list() ?? []).map((entry) => ({ type: entry.type, kind: entry.kind, protocol: entry.protocol, enabled: entry.enabled !== false, hasKey: entry.hasKey })),
    mcpServers: mcp.listRunning().map((server) => ({ id: server.id, status: server.status, tools: server.tools.length })),
    largeModelReport,
  };
}
ipc.handle("diagnostics:preview", async (_event, choices) => diagnosticsBundle.previewBundle(await diagnosticsOptions(choices)));
ipc.handle("diagnostics:export", async (_event, choices) => {
  const options = await diagnosticsOptions(choices);
  const picked = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath("documents"), diagnosticsBundle.defaultName()),
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });
  if (picked.canceled || !picked.filePath) return { saved: false };
  const result = diagnosticsBundle.saveBundle(options, picked.filePath);
  log.info("files", "diagnostics bundle saved", { bytes: result.bytes, files: result.files });
  shell.showItemInFolder(picked.filePath);
  return { saved: true, ...result };
});
/* The renderer builds the file; main only asks where to put it, so nothing reaches disk unpicked. */
ipc.handle("chat:export", async (_event, request) => {
  const ext = request?.ext === "html" ? "html" : "md";
  const content = typeof request?.content === "string" ? request.content : "";
  // Control characters are exactly what a file name cannot hold.
  // eslint-disable-next-line no-control-regex
  const name = String(request?.defaultName || "Conversation").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim();
  const filters = ext === "html" ? [{ name: "HTML", extensions: ["html"] }] : [{ name: "Markdown", extensions: ["md"] }];
  const picked = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath("documents"), name || `Conversation.${ext}`), filters });
  if (picked.canceled || !picked.filePath) return { saved: false };
  const target = picked.filePath.toLowerCase().endsWith(`.${ext}`) ? picked.filePath : `${picked.filePath}.${ext}`;
  await fs.promises.writeFile(target, content, "utf8");
  log.info("files", "chat exported", { format: ext, bytes: Buffer.byteLength(content, "utf8") });
  shell.showItemInFolder(target);
  return { saved: true, file: target, bytes: Buffer.byteLength(content, "utf8") };
});
ipc.handle("diagnostics:crash-notice", () => {
  const show = previousSessionCrashed;
  previousSessionCrashed = false;
  return { show };
});
ipc.on("logs:write", (_event, entry) => logger.ingestRendererEntries(entry));
ipc.on("logs:batch", (_event, entries) => logger.ingestRendererEntries(entries));


