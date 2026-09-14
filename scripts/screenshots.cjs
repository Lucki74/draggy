// Retakes the website screenshots from the real app on a throwaway data folder. Run npm run build,
// then electron scripts/screenshots.cjs with DRAGGY_RENDERER=dist.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { app, BaseWindow, BrowserWindow } = require("electron");

const OUT = path.resolve(
  process.env.DRAGGY_SHOTS_OUT || path.join(__dirname, "..", "..", "draggy-website", "assets", "img"),
);
const ONLY = (process.env.DRAGGY_SHOTS_ONLY || "").split(",").filter(Boolean);
const WIDTH = 1280;
const HEIGHT = 800;

// A fresh appData too, so the one-time 1.x folder adoption cannot reach the real one.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-shots-"));
app.setPath("appData", path.join(scratch, "appdata"));
app.setPath("userData", path.join(scratch, "userdata"));
fs.mkdirSync(app.getPath("userData"), { recursive: true });
// 1.6 fits a 1280 by 800 window on a 2560 by 1440 screen and captures at 2048 by 1280.
app.commandLine.appendSwitch("force-device-scale-factor", process.env.DRAGGY_SHOTS_SCALE || "1.6");

const PROJECT = path.join(scratch, "weather-cli");

// A small real project with history and uncommitted work, for the project scenes.
function writeDemoProject() {
  const files = {
    "package.json": JSON.stringify(
      { name: "weather-cli", version: "0.3.0", type: "module", scripts: { build: "tsc", test: "vitest run" } },
      null,
      2,
    ),
    "AGENTS.md": "# weather-cli\n\nA command line forecast tool.\n\n- Run `npm test` before saying a change works.\n- Keep output under 80 columns.\n",
    "README.md": "# weather-cli\n\nPrints a three day forecast for a city.\n\n```\nweather paris\n```\n",
    "src/cli.ts": [
      'import { forecast } from "./forecast.js";',
      'import { formatDay } from "./format.js";',
      "",
      "const city = process.argv[2];",
      "",
      "if (!city) {",
      '  console.error("usage: weather <city>");',
      "  process.exit(1);",
      "}",
      "",
      "for (const day of await forecast(city)) {",
      "  console.log(formatDay(day));",
      "}",
      "",
    ].join("\n"),
    "src/forecast.ts": [
      "export interface Day {",
      "  date: string;",
      "  high: number;",
      "  low: number;",
      "  summary: string;",
      "}",
      "",
      "export async function forecast(city: string): Promise<Day[]> {",
      "  const response = await fetch(`https://api.example.com/forecast?city=${encodeURIComponent(city)}`);",
      "  if (!response.ok) throw new Error(`No forecast for ${city}`);",
      "  return (await response.json()).days;",
      "}",
      "",
    ].join("\n"),
    "src/format.ts": [
      'import type { Day } from "./forecast.js";',
      "",
      "export function formatTemperature(celsius: number): string {",
      "  return String(celsius);",
      "}",
      "",
      "export function formatDay(day: Day): string {",
      "  return `${day.date}  ${formatTemperature(day.high)} / ${formatTemperature(day.low)}  ${day.summary}`;",
      "}",
      "",
    ].join("\n"),
    "tests/format.test.ts": [
      'import { describe, expect, it } from "vitest";',
      'import { formatTemperature } from "../src/format.js";',
      "",
      'describe("formatTemperature", () => {',
      '  it("prints whole degrees", () => {',
      '    expect(formatTemperature(21)).toBe("21");',
      "  });",
      "});",
      "",
    ].join("\n"),
  };

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(PROJECT, name)), { recursive: true });
    fs.writeFileSync(path.join(PROJECT, name), text);
  }

  const git = (...args) =>
    execFileSync("git", ["-c", "user.email=demo@example.com", "-c", "user.name=Demo", ...args], {
      cwd: PROJECT,
      stdio: "ignore",
    });

  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "First forecast");

  // Work in progress, so the git strip has something to show.
  fs.appendFileSync(path.join(PROJECT, "README.md"), "\nTemperatures are in Celsius.\n");
  fs.writeFileSync(path.join(PROJECT, "src/units.ts"), 'export type Units = "metric" | "imperial";\n');
}

// The project workspace, written before the app opens its database.
function seedDatabase() {
  const storage = require(path.join(__dirname, "..", "electron", "storage.cjs"));
  storage.init(app.getPath("userData"));
  storage.saveWorkspace({
    id: "weather",
    name: "weather-cli",
    kind: "project",
    rootPath: PROJECT,
    permissionMode: "acceptEdits",
    settings: {},
  });
  storage.close();
}

writeDemoProject();
seedDatabase();

// Loaded before ready, since the app registers its URL schemes as it loads.
require(path.join(__dirname, "..", "electron", "main.cjs"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => console.log("[shots]", ...parts);
const wanted = (scene) => ONLY.length === 0 || ONLY.includes(scene);

function appWindow() {
  return BrowserWindow.getAllWindows().find((win) => {
    if (win.isDestroyed()) return false;
    const url = win.webContents.getURL();
    return url.includes("index.html") && !url.includes("splash") && !url.includes("browserbar");
  });
}

async function waitFor(check, { timeout = 120_000, every = 250, label = "condition" } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(every);
  }
}

// Runs a function in the page with JSON arguments and returns its result.
function inPage(win, fn, ...args) {
  return win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
}

// Clicks the first element whose aria-label, title or own text matches.
async function click(win, match, { exact = false } = {}) {
  const clicked = await inPage(
    win,
    (wantedText, exactMatch) => {
      const matches = (value) =>
        typeof value === "string" && (exactMatch ? value.trim() === wantedText : value.includes(wantedText));
      const candidates = [...document.querySelectorAll("button, a, [role=tab], [role=switch], li, span")];
      const element = candidates.find(
        (node) =>
          matches(node.getAttribute("aria-label")) ||
          matches(node.getAttribute("title")) ||
          (node.children.length === 0 || node.tagName === "BUTTON" ? matches(node.textContent) : false),
      );
      if (!element) return false;
      element.scrollIntoView({ block: "center" });
      element.click();
      return true;
    },
    match,
    exact,
  );
  if (!clicked) throw new Error(`nothing to click for "${match}"`);
  await sleep(500);
}

// Types a message and sends it, without waiting for the reply.
async function submit(win, text) {
  await inPage(
    win,
    (message) => {
      const box = document.querySelector("form.composer textarea");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, message);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    },
    text,
  );
  await sleep(300);
  await inPage(win, () => document.querySelector("form.composer").requestSubmit());
}

// Presses Allow once on an approval card, if one is waiting. Returns what it allowed.
function allowPending(win) {
  return inPage(win, () => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Allow once");
    if (!button) return null;
    const card = button.closest("div.rounded-xl");
    const target = card?.querySelector("pre")?.textContent ?? card?.querySelector("p")?.textContent ?? "a tool";
    button.click();
    return target.trim().slice(0, 80);
  });
}

// Sends a message and waits for the whole reply, allowing anything the turn stops to ask about.
async function send(win, text) {
  await submit(win, text);

  // Busy while the composer shows stop, or while the sidebar still lists a running turn.
  const generating = () =>
    inPage(win, () => {
      const stop = document.querySelector("form.composer button[type=submit] .lucide-square");
      const tray = [...document.querySelectorAll("span")].some((node) => node.textContent.trim() === "Working");
      return Boolean(stop) || tray;
    });

  await waitFor(generating, { timeout: 30_000, label: "the reply to start" });
  log("waiting for the reply to", JSON.stringify(text.slice(0, 50)));
  await waitFor(
    async () => {
      const allowed = await allowPending(win);
      if (allowed) log("allowed once:", allowed);
      return !allowed && !(await generating());
    },
    { timeout: 600_000, every: 1000, label: "the reply" },
  );
  await sleep(1500);
}

async function setDark(win, dark) {
  await inPage(win, (on) => document.body.classList.toggle("dark", on), dark);
  await sleep(400);
}

async function capture(win, name) {
  await sleep(700);
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  log(`saved ${name}.png (${size.width}x${size.height})`);
}

// Two captures one above the other. The browser window is two views and cannot be captured whole.
async function stack(top, bottom, name) {
  const helper = new BrowserWindow({ show: false, width: 200, height: 200 });
  try {
    await helper.loadURL("about:blank");
    const png = await helper.webContents.executeJavaScript(`(async () => {
      const load = (src) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = src; });
      const [a, b] = await Promise.all([load(${JSON.stringify(top.toDataURL())}), load(${JSON.stringify(bottom.toDataURL())})]);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(a.width, b.width);
      canvas.height = a.height + b.height;
      const context = canvas.getContext("2d");
      context.drawImage(a, 0, 0);
      context.drawImage(b, 0, a.height);
      return canvas.toDataURL("image/png");
    })()`);
    const buffer = Buffer.from(png.split(",")[1], "base64");
    fs.writeFileSync(path.join(OUT, `${name}.png`), buffer);
    log(`saved ${name}.png (stacked)`);
  } finally {
    helper.destroy();
  }
}

// Both themes of whatever is on screen.
async function shoot(win, name) {
  await setDark(win, false);
  await capture(win, `${name}-light`);
  await setDark(win, true);
  await capture(win, `${name}-dark`);
  await setDark(win, false);
}

// Also sets the mode, since a project only shows on the Code side.
async function openWorkspace(win, id) {
  await inPage(
    win,
    (workspace) => {
      localStorage.setItem("draggy_workspace", workspace);
      localStorage.setItem("draggy_mode", workspace === "default" ? "chat" : "code");
    },
    id,
  );
  win.webContents.reload();
  await sleep(1500);
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("form.composer"))), {
    label: "the chat screen after reload",
  });
  await sleep(2500);
}

// The sidebar opens on hover; an injected pointer reaches the page even with real input ignored.
async function hoverSidebar(win, on) {
  win.webContents.sendInputEvent({ type: "mouseMove", x: on ? 30 : WIDTH - 200, y: on ? 420 : 420 });
  await sleep(900);
}

// Opens a settings page by its group and label, since Chat and Code both have a Preferences page.
async function openSettingsPage(win, group, label) {
  const opened = await inPage(
    win,
    (groupTitle, pageLabel) => {
      const menu = document.querySelector("nav[aria-label]");
      const section = [...(menu?.querySelectorAll(":scope > div") ?? [])].find(
        (one) => one.querySelector("p")?.textContent.trim() === groupTitle,
      );
      const button = [...(section?.querySelectorAll("button") ?? [])].find(
        (one) => one.textContent.trim() === pageLabel,
      );
      button?.click();
      return Boolean(button);
    },
    group,
    label,
  );
  if (!opened) throw new Error(`no settings page ${group} / ${label}`);
  await sleep(900);
}

async function run() {
  log("data folder", scratch);
  fs.mkdirSync(OUT, { recursive: true });

  const win = await waitFor(() => appWindow(), { label: "the app window" });
  await waitFor(() => win.isVisible(), { timeout: 300_000, label: "the app to finish starting" });
  // The real pointer must not hover or click the window while scenes run on the user's desktop.
  win.setIgnoreMouseEvents(true);
  win.setContentSize(WIDTH, HEIGHT);
  win.setPosition(0, 0);
  log("content size", win.getContentSize().join("x"));
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("form.composer"))), {
    label: "the chat screen",
  });
  const placeholder = await inPage(win, () => document.querySelector("form.composer textarea").placeholder);
  log("composer says", JSON.stringify(placeholder));
  await sleep(2000);

  if (wanted("chat") || wanted("context")) {
    await send(
      win,
      "What should I look for in a graphics card for running AI models locally? Three short bullet points.",
    );

    if (wanted("chat")) await shoot(win, "app-chat");

    if (wanted("context")) {
      await click(win, "Context window:");
      await inPage(win, () => {
        const header = document.querySelector("[role=dialog] button[aria-expanded]");
        if (header && header.getAttribute("aria-expanded") === "false") header.click();
      });
      await shoot(win, "app-context");
      await click(win, "Context window:");
    }
  }

  if (wanted("project")) {
    await openWorkspace(win, "weather");
    await send(
      win,
      "In src/format.ts, make formatTemperature round to one decimal place and add a °C suffix. Update the test to match.",
    );
    await click(win, "src", { exact: true });
    await sleep(800);
    await click(win, "format.ts", { exact: true });
    await click(win, "main", { exact: true }).catch(() => undefined);
    // The edit and its diff are the point of the scene, so bring them into view.
    await inPage(win, () => {
      const edits = [...document.querySelectorAll("span")].filter((node) =>
        /^(Wrote|Edited)\b/.test(node.textContent.trim()),
      );
      edits.at(-1)?.scrollIntoView({ block: "start" });
    });
    await sleep(1500);
    await shoot(win, "app-project");
  }

  if (wanted("history")) {
    await openWorkspace(win, "default");
    await click(win, "New Chat");
    await send(win, "Explain what a context window is in two sentences.");
    await click(win, "New Chat");
    await send(win, "Give me three names for a weather app.");
    await click(win, "Chat History");
    await sleep(1200);
    await shoot(win, "app-history");
  }

  if (wanted("stats")) {
    await click(win, "Settings");
    await click(win, "Statistics");
    await click(win, "All time");
    await sleep(1000);
    await shoot(win, "app-stats");
  }

  if (wanted("modes")) {
    await openWorkspace(win, "default");
    await hoverSidebar(win, true);
    await shoot(win, "app-mode-chat");
    await hoverSidebar(win, false);

    await click(win, "Code", { exact: true });
    await sleep(2500);
    await hoverSidebar(win, true);
    await shoot(win, "app-mode-code");
    await hoverSidebar(win, false);
    await capture(win, "app-mode-rail");
    await setDark(win, true);
    await capture(win, "app-mode-rail-dark");
    await setDark(win, false);
    await click(win, "Chat", { exact: true });
    await sleep(1500);
  }

  if (wanted("settings")) {
    await openWorkspace(win, "weather");
    await click(win, "Settings", { exact: true });
    await sleep(800);

    const pages = [
      ["App", "General", "app-settings-general"],
      ["App", "Models", "app-settings-models"],
      ["App", "Extensions", "app-settings-extensions"],
      ["App", "Data", "app-settings-data"],
      ["Chat", "Preferences", "app-settings-chat"],
      ["Chat", "Talk", "app-settings-talk"],
      ["Code", "Preferences", "app-settings-code"],
      ["Code", "Projects", "app-settings-projects"],
    ];

    for (const [group, label, name] of pages) {
      await openSettingsPage(win, group, label);
      await capture(win, name);
    }

    await setDark(win, true);
    await openSettingsPage(win, "Code", "Projects");
    await capture(win, "app-settings-projects-dark");
    await setDark(win, false);
  }

  if (wanted("command")) {
    await openWorkspace(win, "weather");
    await submit(
      win,
      "Use run_command to run git log --oneline in this project, then tell me the latest commit message.",
    );

    await waitFor(
      () => inPage(win, () => Boolean(document.querySelector("form.composer button[type=submit] .lucide-square"))),
      { timeout: 30_000, label: "the turn to start" },
    );
    log("waiting for the command approval");
    // The approval, or a reply that ended without one; either way the screen says what happened.
    const outcome = await waitFor(
      () =>
        inPage(win, () => {
          if (document.body.innerText.includes("Run a command")) return "approval";
          const busy = document.querySelector("form.composer button[type=submit] .lucide-square");
          return busy ? null : "replied";
        }),
      { timeout: 420_000, every: 1000, label: "the command approval card" },
    ).catch(async (error) => {
      await capture(win, "app-command-stuck");
      throw error;
    });
    log("outcome", outcome);
    if (outcome !== "approval") {
      await capture(win, "app-command-no-approval");
      return;
    }
    await sleep(800);
    await inPage(win, () => {
      const cards = [...document.querySelectorAll("pre")];
      cards.at(-1)?.scrollIntoView({ block: "center" });
    });
    await shoot(win, "app-command-approval");

    await click(win, "Allow once", { exact: true });
    log("waiting for the reply after the command");
    await waitFor(
      () =>
        inPage(win, () => {
          const stop = document.querySelector("form.composer button[type=submit] .lucide-square");
          return !stop;
        }),
      { timeout: 600_000, every: 1000, label: "the reply after the command" },
    );
    await sleep(1500);
    await inPage(win, () => {
      const steps = [...document.querySelectorAll("pre")];
      steps.at(-1)?.scrollIntoView({ block: "center" });
    });
    await shoot(win, "app-command-ran");
  }

  if (wanted("browser")) {
    // Draggy's own browser on a page that scores the ad blocker, at the size the site shows it.
    const before = new Set(BaseWindow.getAllWindows());
    await inPage(win, () => window.open("https://superadblocktest.com/", "_blank"));
    const browser = await waitFor(
      () => BaseWindow.getAllWindows().find((one) => !before.has(one) && !(one instanceof BrowserWindow)),
      { label: "the browser window" },
    );
    browser.setContentSize(1000, 660);
    const [page, bar] = browser.contentView.children;

    log("waiting for the ad block test to finish");
    await waitFor(
      () =>
        page.webContents
          .executeJavaScript('Boolean(document.body && document.body.innerText.includes("Completed:"))')
          .catch(() => false),
      { timeout: 180_000, every: 1000, label: "the ad block test" },
    );
    await sleep(2000);

    for (const dark of [false, true]) {
      await bar.webContents.executeJavaScript(`document.body.classList.toggle("dark", ${dark})`);
      await sleep(600);
      const top = await bar.webContents.capturePage({ x: 0, y: 0, width: 1000, height: 48 });
      const body = await page.webContents.capturePage();
      await stack(top, body, `app-browser-${dark ? "dark" : "light"}`);
    }

    browser.close();
    await sleep(800);
  }

  if (wanted("talk")) {
    // Talk is on the Chat side only, and the command scene leaves the app in Code.
    await openWorkspace(win, "default");
    await click(win, "Talk");
    await sleep(2500);
    await shoot(win, "app-talk");
  }
}

// A normal quit runs Draggy's own shutdown, which stops an Ollama it started; then the data goes.
process.on("exit", () => {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // Windows may still hold a file for a moment; the folder is in temp either way.
  }
});

app.whenReady().then(() => {
  run()
    .then(() => {
      log("done");
      app.quit();
    })
    .catch(async (error) => {
      console.error("[shots] failed:", error);
      process.exitCode = 1;
      const win = appWindow();
      if (win) await capture(win, "failure").catch(() => undefined);
      app.quit();
    });
});
