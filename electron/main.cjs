const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  protocol,
  session,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const http = require("http");
const https = require("https");
const fs = require("fs");
const { setupAdblocker, injectCosmeticFilters } = require("./adblocker.cjs");
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

const OLLAMA_HOST = "127.0.0.1:11434";
const MODEL_CACHE_ORIGIN = "https://huggingface.co";

/** What the app calls itself: window titles, the taskbar, the data folder. */
const APP_NAME = "Draggy";

const runCommand = platform.runCommand;

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

async function serveCachedModelFile(request) {
  const url = new URL(request.url);
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

let headlessHooksInstalled = false;
function installHeadlessSessionHooks(ses) {
  if (headlessHooksInstalled) return;
  headlessHooksInstalled = true;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    delete details.requestHeaders["sec-ch-ua"];
    delete details.requestHeaders["sec-ch-ua-mobile"];
    delete details.requestHeaders["sec-ch-ua-platform"];
    callback({ requestHeaders: details.requestHeaders });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE_STATE_SCRIPT = `
  (() => {
    const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], #cf-turnstile iframe, iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], iframe[src*="datadome.co"], iframe[src*="perimeterx"]');
    let challengeBox = null;
    if (iframe) {
      const r = iframe.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        challengeBox = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    }
    const body = document.body ? document.body.innerText : "";
    return {
      challengeBox,
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

function openInAppBrowser(url) {
  const browserWin = new BrowserWindow({
    width: 1024,
    height: 768,
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  browserWin.setMenuBarVisibility(false);
  
  browserWin.webContents.on("dom-ready", () => {
    injectCosmeticFilters(browserWin.webContents);
  });

  browserWin.loadURL(url);
}

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

  setupAdblocker(mainWindow.webContents.session);
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
  logger.init(app);

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

  protocol.handle("draggy", serveCachedModelFile);
  protocol.handle("app", serveRendererFile);

  applyContentSecurityPolicy(session.defaultSession, !isDevelopment());

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

app.on("before-quit", () => {
  storage.close();
  library.close();
});

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
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true, 
      preload: path.join(__dirname, 'stealth-preload.cjs'),
    },
  });

  installHeadlessSessionHooks(win.webContents.session);

  win.webContents.on('did-finish-load', () => {
    injectCosmeticFilters(win.webContents);
  });

  try {
    await win.loadURL(url, {
      userAgent: cleanUserAgent(win.webContents),
      timeout: 30000,
    });

    for (let i = 0; i < 6; i++) {
      const state = await win.webContents.executeJavaScript(PAGE_STATE_SCRIPT);

      if (state.challengeBox) {
        const box = state.challengeBox;
        for (let offset = 20; offset < box.w; offset += 40) {
          const clickX = Math.round(box.x + offset);
          const clickY = Math.round(box.y + box.h / 2);

          win.webContents.sendInputEvent({ type: 'mouseMove', x: clickX - 10, y: clickY - 10 });
          await sleep(50);
          win.webContents.sendInputEvent({ type: 'mouseMove', x: clickX, y: clickY });
          await sleep(50);

          win.webContents.sendInputEvent({ type: 'mouseDown', x: clickX, y: clickY, button: 'left', clickCount: 1 });
          await sleep(50);
          win.webContents.sendInputEvent({ type: 'mouseUp', x: clickX, y: clickY, button: 'left', clickCount: 1 });
        }
      } else if (
        !isBotChallengePage(state) &&
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
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
      plugins: true,
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(__dirname, 'stealth-preload.cjs'),
    },
  });

  installHeadlessSessionHooks(browserSession.webContents.session);

  browserSession.webContents.on('did-finish-load', () => {
    injectCosmeticFilters(browserSession.webContents);
  });

  browserSession.on('closed', () => {
    browserSession = null;
  });

  return browserSession;
}

ipcMain.handle("browser-navigate", async (event, url) => {
  const win = getBrowserSession();

  try {
    await win.loadURL(url, {
      userAgent: cleanUserAgent(win.webContents),
      timeout: 30000,
    });

    for (let i = 0; i < 6; i++) {
      const state = await win.webContents.executeJavaScript(PAGE_STATE_SCRIPT);
      if (
        state.readyState === "complete" &&
        !isBotChallengePage(state) &&
        state.textLength > 50
      ) {
        break;
      }
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

    const child = spawn(launcher.file, launcher.args, {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
      env: { ...platform.defaultShellEnv(), OLLAMA_HOST },
    });
    child.unref();

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
            const child = spawn(installerPath, spec.args, {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
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

    await documents.writeGeneratedFile(filepath, String(content ?? ""));

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

ipcMain.handle("library:search", wrap("library", async (event, query, limit, model) =>
  library.search(query, limit, String(model || library.meta("embed_model", library.DEFAULT_EMBED_MODEL))),
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

ipcMain.handle("logs:open", async () => shell.openPath(logger.logFolder()));
ipcMain.handle("logs:tail", () => logger.readTail());
