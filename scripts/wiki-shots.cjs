// Retakes the website wiki screenshots from the real app on a throwaway data folder.
// Run with node_modules/electron/dist/electron.exe scripts/wiki-shots.cjs with DRAGGY_RENDERER=dist.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { app, BrowserWindow } = require("electron");

const OUT = path.resolve(
  process.env.DRAGGY_SHOTS_OUT || path.join(__dirname, "..", "..", "draggy-website", "assets", "img"),
);
const WIDTH = 1280;
const HEIGHT = 800;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-wiki-shots-"));
app.setPath("appData", path.join(scratch, "appdata"));
app.setPath("userData", path.join(scratch, "userdata"));
fs.mkdirSync(app.getPath("userData"), { recursive: true });
app.commandLine.appendSwitch("force-device-scale-factor", process.env.DRAGGY_SHOTS_SCALE || "1.6");

const PROJECT = path.join(scratch, "weather-cli");

function writeDemoProject() {
  const files = {
    "package.json": JSON.stringify(
      { name: "weather-cli", version: "0.3.0", type: "module", scripts: { test: "vitest run" } },
      null,
      2,
    ),
    "AGENTS.md": "# weather-cli\n\nA command line forecast tool.\n\n- Run `npm test` before saying a change works.\n",
    "README.md": "# weather-cli\n\nPrints a three day forecast for a city.\n",
    "src/cli.ts": [
      'import { forecast } from "./forecast.js";',
      "",
      "const city = process.argv[2];",
      'if (!city) { console.error("usage: weather city"); process.exit(1); }',
      "for (const day of await forecast(city)) { console.log(day); }",
    ].join("\n"),
    "src/forecast.ts": [
      "export interface Day { date: string; high: number; low: number; summary: string; }",
      "export async function forecast(city: string): Promise<Day[]> {",
      "  return [{ date: '2026-09-18', high: 22, low: 14, summary: 'Sunny' }];",
      "}",
    ].join("\n"),
    "tests/forecast.test.ts": [
      'import { describe, expect, it } from "vitest";',
      'import { forecast } from "../src/forecast.js";',
      'describe("forecast", () => {',
      '  it("returns mock data", async () => {',
      '    const res = await forecast("Paris");',
      '    expect(res.length).toBe(1);',
      '  });',
      "});",
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
  git("commit", "-q", "-m", "Initial forecast tool");
}

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

require(path.join(__dirname, "..", "electron", "main.cjs"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => console.log("[wiki-shots]", ...parts);

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

function inPage(win, fn, ...args) {
  return win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
}

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

async function send(win, text) {
  await submit(win, text);
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

async function shoot(win, name) {
  await setDark(win, true);
  await capture(win, `${name}-dark`);
  await setDark(win, false);
  await capture(win, `${name}-light`);
  await setDark(win, true);
}

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
  log("output folder", OUT);
  fs.mkdirSync(OUT, { recursive: true });

  const win = await waitFor(() => appWindow(), { label: "the app window" });
  await waitFor(() => win.isVisible(), { timeout: 300_000, label: "the app to finish starting" });
  win.setIgnoreMouseEvents(true);
  win.setContentSize(WIDTH, HEIGHT);
  win.setPosition(0, 0);
  log("content size", win.getContentSize().join("x"));
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("form.composer"))), {
    label: "the chat screen",
  });
  await sleep(2000);

  // The wiki front door introduces the assistant in Chat mode.
  log("Scene 1: Home (Chat conversation)");
  await openWorkspace(win, "default");
  await send(
    win,
    "Explain what makes running local AI models with Ollama secure and private in two short bullet points.",
  );
  await shoot(win, "app-mode-chat");

  // Project documentation shows the tree, open file and git diff.
  log("Scene 2: Projects (weather-cli in Code mode with diff)");
  await openWorkspace(win, "weather");
  await send(
    win,
    "In src/cli.ts, check if the city argument is empty and print an error message. Update the file.",
  );
  await click(win, "src", { exact: true }).catch(() => undefined);
  await sleep(600);
  await click(win, "cli.ts", { exact: true }).catch(() => undefined);
  await inPage(win, () => {
    const edits = [...document.querySelectorAll("span")].filter((node) =>
      /^(Wrote|Edited)\b/.test(node.textContent.trim()),
    );
    edits.at(-1)?.scrollIntoView({ block: "start" });
  });
  await sleep(1500);
  await shoot(win, "app-settings-projects");

  // Permission documentation walks through the approval dialog.
  log("Scene 3: Permissions (command approval card)");
  await openWorkspace(win, "weather");
  await submit(
    win,
    "Use run_command to run npm test in this project.",
  );
  await waitFor(
    () => inPage(win, () => Boolean(document.querySelector("form.composer button[type=submit] .lucide-square"))),
    { timeout: 30_000, label: "the turn to start" },
  );
  log("waiting for command approval card");
  await waitFor(
    () => inPage(win, () => document.body.innerText.includes("Run a command")),
    { timeout: 120_000, every: 1000, label: "the command approval card" },
  );
  await sleep(800);
  await inPage(win, () => {
    const cards = [...document.querySelectorAll("pre")];
    cards.at(-1)?.scrollIntoView({ block: "center" });
  });
  await shoot(win, "app-settings-code");

  // Tool documentation shows the command output and result card.
  log("Scene 4: Tools (approved command output & tool steps)");
  await click(win, "Allow once", { exact: true });
  log("waiting for npm test to complete");
  await waitFor(
    () => inPage(win, () => {
      const stop = document.querySelector("form.composer button[type=submit] .lucide-square");
      return !stop;
    }),
    { timeout: 180_000, every: 1000, label: "npm test completion" },
  );
  await sleep(1500);
  await inPage(win, () => {
    const steps = [...document.querySelectorAll("pre")];
    steps.at(-1)?.scrollIntoView({ block: "center" });
  });
  await shoot(win, "app-settings-library");

  // Extension documentation shows installed skills with their toggles.
  log("Scene 5: Extensions (skills library)");
  await openWorkspace(win, "default");
  await click(win, "Settings", { exact: true });
  await sleep(800);
  await openSettingsPage(win, "App", "Extensions");
  await sleep(1000);
  await click(win, "Skills", { exact: true });
  await sleep(1500);
  await shoot(win, "app-skills");

  // Voice documentation covers full-screen speech mode.
  log("Scene 6: Voice (full-screen talk mode)");
  await openWorkspace(win, "default");
  await click(win, "Talk", { exact: true });
  await sleep(2500);
  await shoot(win, "app-settings-talk");

  // Settings documentation shows the preferences panel with dark default.
  log("Scene 7: Settings (general settings)");
  await openWorkspace(win, "default");
  await click(win, "Settings", { exact: true });
  await sleep(800);
  await openSettingsPage(win, "App", "General");
  await sleep(1200);
  await shoot(win, "app-settings-general");

  log("All wiki scenes completed successfully.");
}

process.on("exit", () => {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {}
});

app.whenReady().then(() => {
  run()
    .then(() => {
      log("done");
      app.quit();
    })
    .catch(async (error) => {
      console.error("[wiki-shots] failed:", error);
      process.exitCode = 1;
      const win = appWindow();
      if (win) await capture(win, "failure").catch(() => undefined);
      app.quit();
    });
});
