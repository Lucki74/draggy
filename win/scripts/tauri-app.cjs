// Shared launcher for the capture scripts: starts Draggy's Tauri exe with WebView2 remote debugging on
// 127.0.0.1, attaches over CDP and seeds a scratch profile through window.draggy. No runtime deps.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { chromium } = require("playwright");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeout = 120_000, every = 250, label = "condition" } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(every);
  }
}

// Runs a function in the page with JSON arguments; CDP evaluation ignores the page's CSP.
function inPage(page, fn, ...args) {
  return page.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
}

// An explicit path, then DRAGGY_EXE, then the release and debug builds under src-tauri/target.
function resolveExe(explicit) {
  const root = path.join(__dirname, "..", "src-tauri", "target");
  const found = [explicit, process.env.DRAGGY_EXE, path.join(root, "release", "draggy-win.exe"), path.join(root, "debug", "draggy-win.exe")]
    .find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error("no Draggy exe: build with npm run tauri:build or pass --exe");
  return path.resolve(found);
}

const isMainUrl = (url) => /index\.html|5173|tauri\.localhost/.test(url) && !/splash|browserbar/.test(url);

async function mainPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) if (isMainUrl(page.url())) return page;
  }
  return null;
}

// A scratch APPDATA with the installed engine linked in, and only the capture model: the app falls back to the first model it lists.
function prepareScratch(prefix, { model = "", realAppData = process.env.APPDATA || "" } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const appData = path.join(scratch, "appdata");
  const dataDir = path.join(appData, "Draggy");
  fs.mkdirSync(dataDir, { recursive: true });
  const realDir = path.join(realAppData, "Draggy");
  if (fs.existsSync(path.join(realDir, "bin"))) fs.symlinkSync(path.join(realDir, "bin"), path.join(dataDir, "bin"), "junction");
  const realModel = path.join(realDir, "models", path.basename(model));
  if (model && fs.existsSync(realModel)) {
    fs.mkdirSync(path.join(dataDir, "models"));
    fs.linkSync(realModel, path.join(dataDir, "models", path.basename(model)));
  }
  return { scratch, appData, dataDir };
}

// Removes the links first so deleting the scratch folder never follows a junction into the real data.
function removeScratch(scratch, dataDir) {
  for (const name of ["bin", "models"]) {
    try {
      fs.unlinkSync(path.join(dataDir, name));
    } catch {
      // Never linked.
    }
  }
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Windows may still hold a file for a moment; the folder is in temp either way.
  }
}

/** Starts the exe and attaches. Returns { browser, page, child, scratch, appData, dataDir, close }. */
async function launch({ exe, port = 9222, scale = "1", lang = "en-US", extraArgs = [], env = {}, prefix = "draggy-tauri-", model = "" } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("port must be 1024-65535");
  const target = resolveExe(exe);
  const { scratch, appData, dataDir } = prepareScratch(prefix, { model });
  const switches = [
    `--remote-debugging-port=${port}`,
    `--force-device-scale-factor=${scale}`,
    `--lang=${lang}`,
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    ...extraArgs,
  ];
  const child = spawn(target, [], {
    env: { ...process.env, ...env, APPDATA: appData, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: switches.join(" ") },
    stdio: "ignore",
  });
  const endpoint = `http://127.0.0.1:${port}`;
  await waitFor(() => fetch(`${endpoint}/json/version`).then((r) => r.ok).catch(() => false), { label: "the WebView2 debugger" });
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 60_000 });
  const page = await waitFor(() => mainPage(browser), { timeout: 300_000, label: "the app window" });

  const close = async () => {
    // Quits through the app's own shutdown first, then force-stops the tree if it is still up.
    await page.evaluate(() => window.draggy?.quitApp?.()).catch(() => {});
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, { timeout: 10_000, label: "the app to quit" })
      .catch(() => {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          // Already gone.
        }
      });
    await browser.close().catch(() => {});
    removeScratch(scratch, dataDir);
  };
  return { browser, page, child, scratch, appData, dataDir, close };
}

/** Sizes the app window in DIPs, falling back to viewport emulation where the window cannot be sized. */
async function sizeWindow(page, width, height) {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 0, width, height, windowState: "normal" } });
    return "window";
  } catch {
    await page.setViewportSize({ width, height });
    return "viewport";
  }
}

// The Browser pane is a native view; its page is another target, and its box is the [data-browser-body] element.
async function panePage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) if (/^https?:/.test(page.url()) && !isMainUrl(page.url())) return page;
  }
  return null;
}

function paneRect(page) {
  return inPage(page, () => {
    const body = document.querySelector("[data-browser-body]");
    if (!body) return null;
    const r = body.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height, dpr: window.devicePixelRatio };
  });
}

/** Draws the pane's PNG over the window's PNG at the pane's rectangle, with ffmpeg. */
function overlayPane(basePng, panePng, rect, outPng) {
  const ffmpeg = process.env.DRAGGY_FFMPEG || "ffmpeg";
  const scale = rect.dpr;
  const filter = `[1:v]scale=${Math.round(rect.width * scale)}:${Math.round(rect.height * scale)}[p];[0:v][p]overlay=${Math.round(rect.x * scale)}:${Math.round(rect.y * scale)}`;
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", basePng, "-i", panePng, "-filter_complex", filter, outPng]);
}

/** Writes a small demo project with history and uncommitted work, for the project scenes. */
function writeDemoProject(project) {
  const files = {
    "package.json": JSON.stringify({ name: "weather-cli", version: "0.3.0", type: "module", scripts: { build: "tsc", test: "vitest run" } }, null, 2),
    "AGENTS.md": "# weather-cli\n\nA command line forecast tool.\n\n- Run `npm test` before saying a change works.\n- Keep output under 80 columns.\n",
    "README.md": "# weather-cli\n\nPrints a three day forecast for a city.\n\n```\nweather paris\n```\n",
    "src/cli.ts": 'import { forecast } from "./forecast.js";\nimport { formatDay } from "./format.js";\n\nconst city = process.argv[2];\n\nif (!city) {\n  console.error("usage: weather <city>");\n  process.exit(1);\n}\n\nfor (const day of await forecast(city)) {\n  console.log(formatDay(day));\n}\n',
    "src/forecast.ts": "export interface Day {\n  date: string;\n  high: number;\n  low: number;\n  summary: string;\n}\n\nexport async function forecast(city: string): Promise<Day[]> {\n  const response = await fetch(`https://api.example.com/forecast?city=${encodeURIComponent(city)}`);\n  if (!response.ok) throw new Error(`No forecast for ${city}`);\n  return (await response.json()).days;\n}\n",
    "src/format.ts": 'import type { Day } from "./forecast.js";\n\nexport function formatTemperature(celsius: number): string {\n  return String(celsius);\n}\n\nexport function formatDay(day: Day): string {\n  return `${day.date}  ${formatTemperature(day.high)} / ${formatTemperature(day.low)}  ${day.summary}`;\n}\n',
    "tests/format.test.ts": 'import { describe, expect, it } from "vitest";\nimport { formatTemperature } from "../src/format.js";\n\ndescribe("formatTemperature", () => {\n  it("prints whole degrees", () => {\n    expect(formatTemperature(21)).toBe("21");\n  });\n});\n',
  };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(project, name)), { recursive: true });
    fs.writeFileSync(path.join(project, name), text);
  }
  // Windows may hold a file the moment after it is written, so git gets a few tries.
  const git = (...args) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return execFileSync("git", ["-c", "user.email=demo@example.com", "-c", "user.name=Demo", ...args], { cwd: project, stdio: "ignore" });
      } catch (error) {
        if (attempt >= 4) throw new Error(`git ${args.join(" ")} failed: ${error.message}`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
      }
    }
  };
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "First forecast");
  fs.appendFileSync(path.join(project, "README.md"), "\nTemperatures are in Celsius.\n");
  fs.writeFileSync(path.join(project, "src/units.ts"), 'export type Units = "metric" | "imperial";\n');
}

/** Seeds the workspace, chats, settings and a finished setup, then reloads so the app reads them. */
async function seedProfile(page, { project, model }) {
  const hour = 3600 * 1000;
  const chats = [
    ["default", "optimize sqlite wal checkpointing", 20, "how do i tune sqlite wal mode for concurrent writes without locking?", "Set PRAGMA journal_mode=WAL and PRAGMA synchronous=NORMAL, then run PRAGMA wal_checkpoint(TRUNCATE) on an idle connection."],
    ["default", "diagnose memory leak in websocket server", 30, "heap snapshot shows detached EventEmitters accumulating on disconnect", "Remove the data and drain listeners in the close handler, or use once() when piping streams."],
    ["default", "implement retry with exponential backoff and jitter", 52, "what is the recommended jitter algorithm for rate-limited apis?", "Full jitter: delay = random_between(0, min(cap, base * 2 ** attempt)). It spreads spikes better than equal jitter."],
    ["default", "tune tokio runtime worker threads", 75, "should worker threads match physical or logical cores for io-heavy workloads?", "Match logical cores for async IO. Route blocking tasks to spawn_blocking rather than adding workers."],
    ["default", "why does my pandas merge duplicate rows", 130, "left merge gives me 12k rows from 10k", "The right table has repeated keys. Check right.duplicated(subset=['id']).sum() and drop duplicates first."],
    ["default", "parse sarif report from codeql", 200, "how do i extract medium and high severity rule ids with jq?", "jq -r '.runs[].results[] | select(.level == \"error\" or .level == \"warning\") | .ruleId' results.sarif | sort -u"],
    ["default", "docker compose healthcheck for redis and postgres", 340, "containers start before database is ready to accept connections", "Use depends_on with condition: service_healthy and a pg_isready or redis-cli ping healthcheck."],
    ["weather", "fix the flaky forecast test", 26, "the forecast test fails every few runs", "The test compares against the current time. Passing a fixed clock into the formatter makes it stable."],
    ["weather", "add a --units flag", 100, "can the cli take --units metric or imperial", "Yes. Parse the flag in the entry point and pass it to formatTemperature, with metric as the default."],
  ];
  const now = Date.now();
  const workspace = { id: "weather", name: "weather-cli", kind: "project", rootPath: project, permissionMode: process.env.DRAGGY_CAPTURE_MODE || "acceptEdits", settings: {} };
  const sessions = chats.map(([workspaceId, title, ago, ask, answer], index) => ({
    id: `history-${index}`,
    title,
    updatedAt: now - ago * hour,
    isOutOfContext: false,
    workspaceId,
    messages: [
      { id: `h${index}-1`, role: "user", content: ask },
      { id: `h${index}-2`, role: "assistant", content: answer, textContent: answer },
    ],
  }));
  await inPage(page, async (data) => {
    await window.draggy.onboarding.complete("local");
    await window.draggy.workspaces.save(data.workspace);
    for (const session of data.sessions) await window.draggy.db.saveChat(session);
    // The renderer reads settings from localStorage at boot, so a model saved only in the db leaves the page blank.
    const saved = JSON.parse(localStorage.getItem("draggy_settings") || "{}");
    localStorage.setItem("draggy_settings", JSON.stringify({ ...saved, modelName: data.model }));
  }, { workspace, sessions, model });
  await page.reload();
}

// Keeps the first-run star notice and its banner out of every capture.
async function hideStarNotice(page) {
  await page.addStyleTag({ content: '[data-star-notice], div:has(> a[href*="github.com/Lucki74/draggy"]), div:has(> button[aria-label="Dismiss"]) { display: none !important; }' }).catch(() => {});
  await inPage(page, () => {
    try {
      localStorage.setItem("draggy_star_notice", "1");
      window.__DRAGGY_NO_STAR__ = true;
    } catch {
      // Storage refused; the notice may show in this capture.
    }
  });
}

// Opens a workspace in the given mode, reloads, and waits for the composer.
async function openWorkspace(page, id, mode = id === "default" ? "chat" : "code") {
  await inPage(page, (workspace, appMode) => {
    localStorage.setItem("draggy_workspace", workspace);
    localStorage.setItem("draggy_mode", appMode);
  }, id, mode);
  await page.reload();
  await waitFor(() => inPage(page, () => Boolean(document.querySelector("[data-region=composer] form"))), { label: "the chat screen after reload" });
  await sleep(2500);
  await hideStarNotice(page);
}

async function setDark(page, dark) {
  await inPage(page, (on) => {
    document.body.classList.toggle("dark", on);
    for (const name of [...document.body.style].filter((one) => one.startsWith("--"))) document.body.style.removeProperty(name);
  }, dark);
  await sleep(400);
}

// Clicks the first element whose aria-label, title or own text matches.
async function clickText(page, match, { exact = false } = {}) {
  const clicked = await inPage(page, (wanted, exactMatch) => {
    const matches = (value) => typeof value === "string" && (exactMatch ? value.trim() === wanted : value.includes(wanted));
    const candidates = [...document.querySelectorAll("button, a, [role=tab], [role=switch], li, span")];
    const element = candidates.find((node) =>
      matches(node.getAttribute("aria-label")) ||
      matches(node.getAttribute("title")) ||
      (node.children.length === 0 || node.tagName === "BUTTON" ? matches(node.textContent) : false));
    if (!element) return false;
    element.scrollIntoView({ block: "center" });
    element.click();
    return true;
  }, match, exact);
  if (!clicked) throw new Error(`nothing to click for "${match}"`);
  await sleep(500);
}

// Types a message into the composer and submits it, without waiting for the reply.
// The composer can re-mount on input, so the form is looked up again at submit time and found by its textarea.
async function submitText(page, text) {
  await waitFor(() => inPage(page, () => Boolean(document.querySelector("[data-region=composer] form textarea"))), { label: "the composer" });
  await inPage(page, (message) => {
    const box = document.querySelector("[data-region=composer] form textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, message);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await sleep(300);
  await waitFor(() => inPage(page, () => {
    const form = document.querySelector("[data-region=composer] form textarea")?.closest("form");
    if (!form) return false;
    form.requestSubmit();
    return true;
  }), { label: "the composer form to submit", every: 300 });
}

// Presses Allow once on a waiting approval card. Returns what it allowed, or null.
function allowPending(page) {
  return inPage(page, () => {
    const button = [...document.querySelectorAll("button")].find((node) => /^Allow once/.test(node.textContent.trim()));
    if (!button) return null;
    const card = button.closest("div.rounded-xl");
    const target = card?.querySelector("pre")?.textContent ?? card?.querySelector("p")?.textContent ?? "a tool";
    button.click();
    return target.trim().slice(0, 80);
  });
}

const generating = (page) => inPage(page, () =>
  Boolean(document.querySelector("[data-stop='true']")) ||
  [...document.querySelectorAll("span")].some((node) => node.textContent.trim() === "Working"));

// Sends a message and waits for the whole reply, allowing anything the turn stops to ask about.
async function sendAndWait(page, text, { log = () => {} } = {}) {
  await submitText(page, text);
  await waitFor(() => generating(page), { timeout: 120_000, label: "the reply to start" });
  log("waiting for the reply to", JSON.stringify(text.slice(0, 50)));
  await waitFor(async () => {
    const allowed = await allowPending(page);
    if (allowed) log("allowed once:", allowed);
    return !allowed && !(await generating(page));
  }, { timeout: 600_000, every: 1000, label: "the reply" });
  await sleep(1500);
}

// A PNG of the first width by height CSS pixels of the app window.
function capturePng(page, width, height) {
  return page.screenshot({ clip: { x: 0, y: 0, width, height }, type: "png" });
}

module.exports = { launch, sizeWindow, sleep, waitFor, inPage, panePage, paneRect, overlayPane, writeDemoProject, seedProfile, resolveExe, removeScratch, prepareScratch, hideStarNotice, openWorkspace, setDark, clickText, submitText, allowPending, generating, sendAndWait, capturePng };
