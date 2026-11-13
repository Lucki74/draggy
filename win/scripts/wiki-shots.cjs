// Retakes the wiki screenshots from the real Tauri app on a throwaway data folder (dark first, then light).
// Build or run the app first, then: node scripts/wiki-shots.cjs [--exe <draggy-win.exe>] [--port 9222]
// Env: DRAGGY_SHOTS_OUT, DRAGGY_SHOTS_MODEL, DRAGGY_SHOTS_SCALE.
const fs = require("node:fs");
const path = require("node:path");
const app = require("./tauri-app.cjs");

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
if (args.includes("--help")) {
  console.log("node scripts/wiki-shots.cjs [--exe path] [--port 9222]  (env: DRAGGY_SHOTS_OUT, DRAGGY_SHOTS_MODEL, DRAGGY_SHOTS_SCALE)");
  process.exit(0);
}

const OUT = path.resolve(process.env.DRAGGY_SHOTS_OUT || path.join(__dirname, "..", "..", "..", "draggy-website", "assets", "img"));
const WIDTH = 1280;
const HEIGHT = 800;
const MODEL = process.env.DRAGGY_SHOTS_MODEL || "Qwen3.6-35B-A3B-Q8_0.gguf";
const log = (...parts) => console.log("[wiki-shots]", ...parts);

async function capture(page, name) {
  await app.sleep(700);
  fs.writeFileSync(path.join(OUT, `${name}.png`), await app.capturePng(page, WIDTH, HEIGHT));
  log(`saved ${name}.png`);
}

async function shoot(page, name) {
  await app.setDark(page, true);
  await capture(page, `${name}-dark`);
  await app.setDark(page, false);
  await capture(page, `${name}-light`);
}

async function openSettingsPage(page, group, label) {
  const opened = await app.inPage(page, (groupTitle, pageLabel) => {
    const menu = document.querySelector("nav[aria-label]");
    const section = [...(menu?.querySelectorAll(":scope > div") ?? [])].find((one) => one.querySelector("p")?.textContent.trim() === groupTitle);
    const button = [...(section?.querySelectorAll("button") ?? [])].find((one) => one.textContent.trim() === pageLabel);
    button?.click();
    return Boolean(button);
  }, group, label);
  if (!opened) throw new Error(`no settings page ${group} / ${label}`);
  await app.sleep(900);
}

async function run(page) {
  fs.mkdirSync(OUT, { recursive: true });
  await app.waitFor(() => app.inPage(page, () => Boolean(document.querySelector("[data-region=composer] form"))), { label: "the chat screen" });
  await app.sleep(2000);

  log("Scene 1: Home (Chat conversation)");
  await app.openWorkspace(page, "default");
  await app.sendAndWait(page, "Explain what makes running local AI models with llama.cpp secure and private in two short bullet points.", { log });
  await shoot(page, "app-mode-chat");

  log("Scene 2: Projects (weather-cli in Code mode with diff)");
  await app.openWorkspace(page, "weather");
  await app.sendAndWait(page, "In src/cli.ts, add a --json flag that prints the forecast as JSON. Just edit the file, dont run anything.", { log });
  await app.clickText(page, "src", { exact: true }).catch(() => undefined);
  await app.sleep(600);
  await app.clickText(page, "cli.ts", { exact: true }).catch(() => undefined);
  await app.inPage(page, () => {
    const edits = [...document.querySelectorAll("span")].filter((node) => /^(Wrote|Edited)\b/.test(node.textContent.trim()));
    edits.at(-1)?.scrollIntoView({ block: "start" });
  });
  await app.sleep(1500);
  await shoot(page, "app-settings-projects");

  log("Scene 3: Permissions (command approval card)");
  await app.openWorkspace(page, "weather");
  await app.submitText(page, "Use run_command to run npm test in this project.");
  await app.waitFor(() => app.generating(page), { timeout: 30_000, label: "the turn to start" });
  log("waiting for command approval card");
  await app.waitFor(() => app.inPage(page, () => document.body.innerText.includes("Run a command")), { timeout: 120_000, every: 1000, label: "the command approval card" });
  await app.sleep(800);
  await app.inPage(page, () => [...document.querySelectorAll("pre")].at(-1)?.scrollIntoView({ block: "center" }));
  await shoot(page, "app-settings-code");

  log("Scene 4: Tools (approved command output & tool steps)");
  await app.clickText(page, "Allow once");
  log("waiting for npm test to complete");
  await app.waitFor(async () => {
    if (await app.allowPending(page)) return false;
    return !(await app.generating(page));
  }, { timeout: 300_000, every: 1000, label: "npm test completion" });
  await app.sleep(1500);
  await app.inPage(page, () => [...document.querySelectorAll("pre")].at(-1)?.scrollIntoView({ block: "center" }));
  await shoot(page, "app-settings-library");

  log("Scene 5: Extensions (skills library)");
  await app.openWorkspace(page, "default");
  await app.clickText(page, "Settings", { exact: true });
  await app.sleep(800);
  await openSettingsPage(page, "App", "Extensions");
  await app.sleep(1000);
  await app.clickText(page, "Skills", { exact: true });
  await app.sleep(1500);
  await shoot(page, "app-skills");

  log("Scene 6: Voice (full-screen talk mode)");
  await app.openWorkspace(page, "default");
  await app.clickText(page, "Talk", { exact: true });
  await app.sleep(2500);
  await shoot(page, "app-settings-talk");

  log("Scene 7: Settings (general settings)");
  await app.openWorkspace(page, "default");
  await app.clickText(page, "Settings", { exact: true });
  await app.sleep(800);
  await openSettingsPage(page, "App", "General");
  await app.sleep(1200);
  await shoot(page, "app-settings-general");

  log("All wiki scenes completed successfully.");
}

(async () => {
  const session = await app.launch({
    exe: flag("--exe", undefined),
    port: Number(flag("--port", process.env.DRAGGY_CDP_PORT || 9222)),
    scale: process.env.DRAGGY_SHOTS_SCALE || "1.6",
    prefix: "draggy-wiki-shots-",
    model: MODEL,
  });
  try {
    log("data folder", session.scratch);
    await app.sizeWindow(session.page, WIDTH, HEIGHT);
    const project = path.join(session.scratch, "weather-cli");
    app.writeDemoProject(project);
    await app.seedProfile(session.page, { project, model: MODEL });
    await run(session.page);
  } catch (error) {
    console.error("[wiki-shots] failed:", error.message);
    process.exitCode = 1;
  } finally {
    await session.close();
  }
})();
