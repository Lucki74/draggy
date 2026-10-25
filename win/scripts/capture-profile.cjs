// The throwaway profile the website captures run on: a scratch data folder, the installed engine and one
// model linked in, a small demo project, and a database seeded as already set up. Shared by
// screenshots.cjs and clips.cjs, and required before main.cjs so the paths are set before the app reads them.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { app, BrowserWindow } = require("electron");

// A small real project with history and uncommitted work, for the project scenes.
function writeDemoProject(project) {
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
    fs.mkdirSync(path.dirname(path.join(project, name)), { recursive: true });
    fs.writeFileSync(path.join(project, name), text);
  }

  // Windows may hold a file the moment after it is written, and git then fails to index it. A second
  // try a moment later succeeds, and a real failure says what git said instead of a bare exit code.
  const git = (...args) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return execFileSync("git", ["-c", "user.email=demo@example.com", "-c", "user.name=Demo", ...args], {
          cwd: project,
          stdio: ["ignore", "ignore", "pipe"],
        });
      } catch (error) {
        if (attempt >= 4) throw new Error(`git ${args.join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
      }
    }
  };

  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "First forecast");

  // Work in progress, so the git strip has something to show.
  fs.appendFileSync(path.join(project, "README.md"), "\nTemperatures are in Celsius.\n");
  fs.writeFileSync(path.join(project, "src/units.ts"), 'export type Units = "metric" | "imperial";\n');
}

// Chats from the past few weeks, so the sidebar looks lived in. Titles are what a person would type.
function seedHistory(storage) {
  const hour = 3600 * 1000;
  const chats = [
    ["default", "sourdough starter stuck at day 3", 20, "my starter hasnt risen in 2 days, is it dead?", "Probably not. At day 3 it is common for a starter to go quiet. Keep feeding it equal weights of flour and water at the same time each day and keep it somewhere warm, around 24 C."],
    ["default", "cover letter for the junior designer role", 30, "can you tighten this? it feels too long", "Cut the second paragraph down to one sentence about the portfolio project, and lead with why you want this team. That brings it under 250 words."],
    ["default", "rename 200 photos by date", 52, "how do i rename a folder of jpgs to their date taken", "On Windows the quickest way is PowerShell: read each file's DateTaken from its metadata and rename it to yyyy-MM-dd_hhmm. I can write that script if you tell me the folder."],
    ["default", "4 days in lisbon, not too touristy", 75, "we land thursday morning and leave sunday night", "Thursday: Alfama on foot, then dinner in Graca. Friday: Belem early before the queues, LX Factory in the afternoon. Saturday: a day trip to Sintra by train."],
    ["default", "why does my pandas merge duplicate rows", 130, "left merge gives me 12k rows from 10k", "That happens when the right table has repeated keys. Check right.duplicated(subset=['id']).sum(), then drop duplicates before the merge."],
    ["default", "birthday toast for my sister", 200, "she turns 30 and hates fuss. keep it short", "Here is a version that takes about twenty seconds: a story about the time she drove two hours for a cake, then one line that is only about her."],
    ["default", "lease says no subletting, what does it mean", 340, "paste of clause 14", "It says you cannot rent the space to someone else without the landlord's written consent. A friend staying a few weeks is usually not subletting, but check whether the clause limits guests."],
    ["weather", "fix the flaky forecast test", 26, "the forecast test fails every few runs", "The test compares against the current time. Passing a fixed clock into the formatter makes it stable."],
    ["weather", "add a --units flag", 100, "can the cli take --units metric or imperial", "Yes. Parse the flag in the entry point and pass it to formatTemperature, with metric as the default."],
  ];
  const now = Date.now();
  chats.forEach(([workspaceId, title, ago, ask, answer], index) => {
    const at = now - ago * hour;
    storage.saveChat({
      id: `history-${index}`,
      title,
      updatedAt: at,
      isOutOfContext: false,
      workspaceId,
      messages: [
        { id: `h${index}-1`, role: "user", content: ask },
        { id: `h${index}-2`, role: "assistant", content: answer, textContent: answer },
      ],
    });
  });
}

// The project workspace, written before the app opens its database.
function seedDatabase(project, captureModel) {
  const storage = require(path.join(__dirname, "..", "electron", "storage.cjs"));
  storage.init(app.getPath("userData"));
  storage.saveWorkspace({
    id: "weather",
    name: "weather-cli",
    kind: "project",
    rootPath: project,
    permissionMode: process.env.DRAGGY_CAPTURE_MODE || "acceptEdits",
    settings: {},
  });
  seedHistory(storage);
  storage.setValue("draggy_settings", JSON.stringify({ modelName: captureModel }));
  // Recorded as set up, or every capture would open on the first-run setup instead of the app.
  const onboarding = require(path.join(__dirname, "..", "electron", "onboarding.cjs"));
  storage.setValue(onboarding.RECORD_KEY, JSON.stringify(onboarding.doneRecord("adopted")));
  storage.close();
}

/** Sets up the profile and removes it on exit. `models` lists the capture models to try, first found wins. */
function prepare({ prefix, scale, models, onboarding = false, language = "" }) {
  // A fresh appData too, so the one-time 1.x folder adoption cannot reach the real one.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  app.setPath("appData", path.join(scratch, "appdata"));
  app.setPath("userData", path.join(scratch, "userdata"));
  fs.mkdirSync(app.getPath("userData"), { recursive: true });

  // Junctions to the installed engine and models, so a capture run never downloads gigabytes again.
  const realUserData = path.join(process.env.APPDATA || "", "Draggy");
  const realBin = path.join(realUserData, "bin");
  const realModels = path.join(realUserData, "models");
  const targetBin = path.join(app.getPath("userData"), "bin");
  const targetModels = path.join(app.getPath("userData"), "models");
  if (fs.existsSync(realBin) && !fs.existsSync(targetBin)) fs.symlinkSync(realBin, targetBin, "junction");
  // The app falls back to the first model it lists, so the scratch app sees only the capture model: a
  // quick one that still handles tools. A hard link costs no disk and no copy.
  const captureModel = models.find((name) => name && fs.existsSync(path.join(realModels, name)));
  if (!onboarding && fs.existsSync(realModels) && !fs.existsSync(targetModels)) {
    if (captureModel) {
      fs.mkdirSync(targetModels);
      fs.linkSync(path.join(realModels, captureModel), path.join(targetModels, captureModel));
    } else {
      fs.symlinkSync(realModels, targetModels, "junction");
    }
  }
  app.commandLine.appendSwitch("force-device-scale-factor", String(scale));
  // The setup guesses its language from the system's, so the capture names it rather than inherit this machine's.
  if (onboarding) app.commandLine.appendSwitch("lang", language || "en-US");

  const project = path.join(scratch, "weather-cli");
  writeDemoProject(project);
  seedDatabase(project, captureModel);

  // A normal quit runs Draggy's own shutdown, which stops the engine it started; then the data goes.
  process.on("exit", () => {
    // Unlinked first, so removing the scratch folder can never follow a junction into the real models.
    for (const target of [targetBin, targetModels]) {
      try {
        fs.unlinkSync(target);
      } catch {
        // Never linked, or a real folder the scratch removal below deals with.
      }
    }
    try {
      fs.rmSync(scratch, { recursive: true, force: true });
    } catch {
      // Windows may still hold a file for a moment; the folder is in temp either way.
    }
  });

  return { scratch, project, captureModel };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function setDark(win, dark) {
  await inPage(win, (on) => document.body.classList.toggle("dark", on), dark);
  await sleep(400);
}

module.exports = { prepare, sleep, appWindow, waitFor, inPage, setDark };
