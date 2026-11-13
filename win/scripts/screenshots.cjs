// Retakes the website screenshots from the real Tauri app on a throwaway data folder.
// Build or run the app first, then: node scripts/screenshots.cjs [--exe <draggy-win.exe>] [--port 9222]
// Env: DRAGGY_SHOTS_OUT, DRAGGY_SHOTS_ONLY (comma list), DRAGGY_SHOTS_LANG, DRAGGY_SHOTS_MODEL, DRAGGY_SHOTS_SCALE.
const fs = require("node:fs");
const path = require("node:path");
const app = require("./tauri-app.cjs");

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
if (args.includes("--help")) {
  console.log("node scripts/screenshots.cjs [--exe path] [--port 9222]  (env: DRAGGY_SHOTS_OUT, DRAGGY_SHOTS_ONLY, DRAGGY_SHOTS_LANG, DRAGGY_SHOTS_MODEL, DRAGGY_SHOTS_SCALE)");
  process.exit(0);
}

const OUT = path.resolve(process.env.DRAGGY_SHOTS_OUT || path.join(__dirname, "..", "..", "..", "draggy-website", "assets", "img"));
const ONLY = (process.env.DRAGGY_SHOTS_ONLY || "").split(",").filter(Boolean);
const WIDTH = 1280;
const HEIGHT = 800;
const ONBOARDING = ONLY.includes("onboarding");
const LANGUAGE = process.env.DRAGGY_SHOTS_LANG || "";
const SHOTS_MODEL = process.env.DRAGGY_SHOTS_MODEL || "Qwen3.8-27B-Uncensored-Q4_K_M.gguf";
const wanted = (scene) => ONLY.length === 0 || ONLY.includes(scene);
const log = (...parts) => console.log("[shots]", ...parts);

// Downloads need a fake transfer stub, which only the Electron build could install; that scene is skipped.
if (ONLY.includes("downloads")) log("downloads: skipped, the Tauri app has no transfer stub to drive it with");

async function capture(page, name) {
  await app.sleep(700);
  const png = await app.capturePng(page, WIDTH, HEIGHT);
  fs.writeFileSync(path.join(OUT, `${name}.png`), png);
  log(`saved ${name}.png`);
}

// Both themes of whatever is on screen.
async function shoot(page, name) {
  await app.setDark(page, false);
  await capture(page, `${name}-light`);
  await app.setDark(page, true);
  await capture(page, `${name}-dark`);
  await app.setDark(page, false);
}

// Hover reveals the sidebar; a pointer move is enough in the page.
async function hoverSidebar(page, on) {
  await page.mouse.move(on ? 30 : WIDTH - 200, 420);
  await app.sleep(900);
}

// Opens a settings page by its group and label, since Chat and Code both have a Preferences page.
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

// The setup's own screens, from a first launch: each step, then Ready with the download under way.
async function runOnboarding(page) {
  fs.mkdirSync(OUT, { recursive: true });
  await app.waitFor(() => page.isVisible("main h1").catch(() => false), { label: "the welcome step" });
  await app.sleep(1500);
  const heading = () => app.inPage(page, () => document.querySelector("main h1")?.textContent ?? "");
  const footerButton = (which) => app.inPage(page, (last) => {
    const buttons = [...document.querySelectorAll("footer > div button")];
    const button = last ? buttons[buttons.length - 1] : buttons[0];
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, which === "next");
  const shootStep = async (name) => {
    await app.inPage(page, () => document.activeElement?.blur());
    await shoot(page, name);
  };
  const move = async (which) => {
    const before = await heading();
    await app.waitFor(() => footerButton(which), { label: `the ${which} button` });
    await app.waitFor(async () => (await heading()) !== before, { label: "the next step" });
    await app.sleep(1200);
  };
  const pickSource = (index) => app.inPage(page, (at) => {
    const cards = document.querySelectorAll('main [role="radio"]');
    cards[at]?.click();
    return cards.length === 3;
  }, index);

  await shootStep("app-onboarding-welcome");
  await move("next");
  await shootStep("app-onboarding-appearance");
  await move("next");
  await app.waitFor(() => pickSource(0), { label: "the source cards" });
  await app.sleep(2500);
  await shootStep("app-onboarding-source");
  await pickSource(1);
  await move("next");
  await app.sleep(1500);
  await shootStep("app-onboarding-provider");
  await move("back");
  await pickSource(0);
  await app.sleep(500);
  await move("next");
  await app.waitFor(() => app.inPage(page, () => document.querySelectorAll('main [role="radio"]').length > 0), { label: "the model options" });
  await move("next");
  await shootStep("app-onboarding-preferences");
  await move("next");
  await app.sleep(2500);
  await shootStep("app-onboarding-ready");
  await move("back");
  await move("back");
  await app.sleep(1000);
  await shootStep("app-onboarding-model");
  await move("next");
  await move("next");
  await app.waitFor(() => app.inPage(page, () => Boolean(document.querySelector("main button:not(:disabled)"))), { label: "Start" });
  await app.inPage(page, () => document.querySelector("main button:not(:disabled)").click());
  await app.waitFor(() => app.inPage(page, () => Boolean(document.querySelector("[data-region=composer] form textarea"))), { label: "the app" });
  await app.sleep(2000);
  await shootStep("app-onboarding-banner");
}

// A scene that fails is logged and skipped, so the other scenes still capture.
async function scene(name, body) {
  try {
    await body();
  } catch (error) {
    log(`scene ${name} failed:`, error.message);
  }
}

async function run(page) {
  fs.mkdirSync(OUT, { recursive: true });
  await app.hideStarNotice(page);
  await app.waitFor(() => app.inPage(page, () => Boolean(document.querySelector("[data-region=composer] form"))), { label: "the chat screen" });
  if (LANGUAGE) {
    await app.inPage(page, (language) => {
      const saved = JSON.parse(localStorage.getItem("draggy_settings") || "{}");
      localStorage.setItem("draggy_settings", JSON.stringify({ ...saved, language }));
    }, LANGUAGE);
    await page.reload();
    await app.hideStarNotice(page);
  }
  log("composer says", JSON.stringify(await app.inPage(page, () => document.querySelector("[data-region=composer] form textarea").placeholder)));
  await app.sleep(2000);

  if (wanted("chat")) await scene("chat", async () => {
    await app.sendAndWait(page, "the wal file still keeps growing even after a checkpoint runs, what can hold it open?", { log });
    await shoot(page, "app-chat");
  });

  if (wanted("extensions")) await scene("extensions", async () => {
    await app.openWorkspace(page, "default");
    await app.clickText(page, "Settings", { exact: true });
    await app.sleep(800);
    await openSettingsPage(page, "App", "Extensions");
    await app.sleep(2500);
    await shoot(page, "app-extensions");
    await app.clickText(page, "Skills", { exact: true });
    await app.sleep(1200);
    await shoot(page, "app-skills");
  });

  if (wanted("project")) await scene("project", async () => {
    await app.openWorkspace(page, "weather");
    await app.sendAndWait(page, "in src/format.ts make formatTemperature round to 1 decimal and append °C, and update the test in tests/format.test.ts to expect 21.0°C. just edit the files, dont run anything", { log });
    // Each edit shows as a diff in the reply; bring the last one into view.
    await app.inPage(page, () => {
      const edits = [...document.querySelectorAll("span")].filter((node) => /^(Wrote|Edited)\b/.test(node.textContent.trim()));
      edits.at(-1)?.scrollIntoView({ block: "start" });
    });
    await app.sleep(1500);
    await shoot(page, "app-project");
  });

  if (wanted("skills")) await scene("skills", async () => {
    await app.openWorkspace(page, "default");
    await app.clickText(page, "New chat");
    await app.inPage(page, () => {
      const box = document.querySelector("[data-region=composer] form textarea");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, "/");
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.focus();
    });
    await app.sleep(900);
    await app.inPage(page, () => {
      const menu = document.querySelector("[data-region=composer] form")?.parentElement?.querySelector(".overflow-y-auto");
      if (menu) menu.scrollTop = menu.scrollHeight;
    });
    await app.sleep(500);
    await capture(page, "app-skill-menu");
    await app.sendAndWait(page, "/proofreader Their going too the park tomorow, weather permiting, and they has invited Sam.", { log });
    await shoot(page, "app-skill-request");
    await app.openWorkspace(page, "weather");
    await app.sendAndWait(page, "/proofreader The weather-cli prints the forcast for any city, and it round every temperature to one decimal with a °C sign.", { log });
    await app.clickText(page, "Context window:")
      .then(async () => {
        await app.inPage(page, () => {
          const header = document.querySelector("[role=dialog] button[aria-expanded]");
          if (header && header.getAttribute("aria-expanded") === "false") header.click();
        });
        await shoot(page, "app-skill-context");
        await app.clickText(page, "Context window:");
      })
      .catch((error) => log("skipped app-skill-context:", error.message));
  });

  if (wanted("history")) await scene("history", async () => {
    await app.openWorkspace(page, "default");
    await app.clickText(page, "New chat");
    await app.sendAndWait(page, "how do i handle backpressure in nodejs readable streams with highWaterMark?", { log });
    await app.clickText(page, "New chat");
    await app.sendAndWait(page, "write a type guard in typescript for a discriminated union with status error", { log });
    await app.sleep(1200);
    await shoot(page, "app-history");
  });

  if (wanted("stats")) await scene("stats", async () => {
    await app.clickText(page, "Settings");
    await app.clickText(page, "Statistics");
    await app.clickText(page, "All time");
    await app.sleep(1000);
    await shoot(page, "app-stats");
  });

  if (wanted("modes")) await scene("modes", async () => {
    await app.openWorkspace(page, "default");
    await hoverSidebar(page, true);
    await shoot(page, "app-mode-chat");
    await hoverSidebar(page, false);
    await app.clickText(page, "Code", { exact: true });
    await app.sleep(2500);
    await hoverSidebar(page, true);
    await shoot(page, "app-mode-code");
    await hoverSidebar(page, false);
    await capture(page, "app-mode-rail");
    await app.setDark(page, true);
    await capture(page, "app-mode-rail-dark");
    await app.setDark(page, false);
    await app.clickText(page, "Chat", { exact: true });
    await app.sleep(1500);
  });

  if (wanted("settings")) await scene("settings", async () => {
    await app.openWorkspace(page, "weather");
    await app.clickText(page, "Settings", { exact: true });
    await app.sleep(800);
    const pages = [
      ["App", "General", "app-settings-general"],
      ["App", "Models", "app-settings-models"],
      ["App", "Extensions", "app-settings-extensions"],
      ["App", "Data", "app-settings-data"],
      ["Chat", "Preferences", "app-settings-chat"],
      ["Chat", "Talk", "app-settings-talk"],
      ["Chat", "Library", "app-settings-library"],
      ["Code", "Preferences", "app-settings-code"],
      ["Code", "Projects", "app-settings-projects"],
    ];
    for (const [group, label, name] of pages) {
      await openSettingsPage(page, group, label);
      await shoot(page, name);
    }
  });

  if (wanted("command")) await scene("command", async () => {
    await app.openWorkspace(page, "weather");
    await app.submitText(page, "whats the latest commit message here? use git log --oneline");
    const outcome = await app.waitFor(() => app.inPage(page, () => {
      if (document.body.innerText.includes("Run a command")) return "approval";
      return document.querySelector("[data-stop='true']") ? null : "replied";
    }), { timeout: 420_000, every: 1000, label: "the command approval card" });
    log("outcome", outcome);
    if (outcome !== "approval") {
      await capture(page, "app-command-no-approval");
      return;
    }
    await app.sleep(800);
    await app.inPage(page, () => [...document.querySelectorAll("pre")].at(-1)?.scrollIntoView({ block: "center" }));
    await shoot(page, "app-command-approval");
    await app.clickText(page, "Allow once");
    await app.waitFor(async () => {
      const allowed = await app.allowPending(page);
      if (allowed) log("allowed once:", allowed);
      return !allowed && !(await app.generating(page));
    }, { timeout: 600_000, every: 1000, label: "the reply after the command" });
    await app.sleep(1500);
    await app.inPage(page, () => [...document.querySelectorAll("pre")].at(-1)?.scrollIntoView({ block: "center" }));
    await shoot(page, "app-command-ran");
  });

  if (wanted("browser")) await scene("browser", async () => {
    // Links open in the Browser pane, a native view: its page is captured on its own and laid over the window's capture.
    await app.inPage(page, () => window.open("https://en.wikipedia.org/wiki/SQLite", "_blank"));
    const pane = await app.waitFor(() => app.panePage(page.context().browser()), { timeout: 60_000, label: "the browser pane" });
    await pane.waitForLoadState("load").catch(() => {});
    await pane.addStyleTag({ content: "#frbanner, #centralNotice, .frb, [id^=frb], .cn-fundraising { display: none !important; }" }).catch(() => {});
    await app.sleep(2000);
    for (const dark of [false, true]) {
      await app.setDark(page, dark);
      await app.sleep(600);
      const shell = path.join(OUT, `.shell-${dark ? "dark" : "light"}.png`);
      const paneShot = path.join(OUT, `.pane-${dark ? "dark" : "light"}.png`);
      fs.writeFileSync(shell, await app.capturePng(page, WIDTH, HEIGHT));
      fs.writeFileSync(paneShot, await pane.screenshot({ type: "png" }));
      app.overlayPane(shell, paneShot, await app.paneRect(page), path.join(OUT, `app-browser-${dark ? "dark" : "light"}.png`));
      fs.rmSync(shell, { force: true });
      fs.rmSync(paneShot, { force: true });
      log(`saved app-browser-${dark ? "dark" : "light"}.png (pane over the window)`);
    }
    await app.setDark(page, false);
    await page.keyboard.press("Escape");
    await app.sleep(800);
  });

  if (wanted("talk")) await scene("talk", async () => {
    // Pin Talk to the model already on disk, or it plans a size that starts a download.
    await app.inPage(page, (model) => {
      const saved = JSON.parse(localStorage.getItem("draggy_settings") || "{}");
      localStorage.setItem("draggy_settings", JSON.stringify({ ...saved, voiceModel: model }));
    }, SHOTS_MODEL);
    await app.openWorkspace(page, "default");
    await app.clickText(page, "Talk");
    await app.sleep(2500);
    await app.waitFor(() => app.inPage(page, () => {
      const body = document.body.innerText;
      const loading = /Loading voice model|Downloading|Preparing/.test(body);
      const hasError = /Failed to fetch|Download failed|Could not start/.test(body);
      return !loading && !hasError && /Listening|Speaking|Thinking/.test(body) && /Show chat/.test(body);
    }), { timeout: 240_000, every: 1000, label: "Talk to finish loading and become live" });
    await app.sleep(2500);
    await shoot(page, "app-talk");
  });
}

(async () => {
  const exe = flag("--exe", undefined);
  const port = Number(flag("--port", process.env.DRAGGY_CDP_PORT || 9222));
  const scratchProfile = {
    prefix: "draggy-shots-",
    model: process.env.DRAGGY_SHOTS_MODEL || "Qwen3.8-27B-Uncensored-Q4_K_M.gguf",
  };
  const session = await app.launch({
    exe,
    port,
    scale: process.env.DRAGGY_SHOTS_SCALE || "1.6",
    lang: LANGUAGE || "en-US",
    prefix: scratchProfile.prefix,
    model: ONBOARDING ? "" : scratchProfile.model,
    env: ONBOARDING ? { DRAGGY_ONBOARDING: "1" } : {},
  });
  try {
    log("data folder", session.scratch);
    await app.sizeWindow(session.page, WIDTH, HEIGHT);
    if (ONBOARDING) {
      await runOnboarding(session.page);
    } else {
      const project = path.join(session.scratch, "weather-cli");
      app.writeDemoProject(project);
      await app.seedProfile(session.page, { project, model: scratchProfile.model });
      await run(session.page);
    }
    log("done");
  } catch (error) {
    console.error("[shots] failed:", error.message);
    process.exitCode = 1;
    await app.capturePng(session.page, WIDTH, HEIGHT).then((png) => fs.writeFileSync(path.join(OUT, "failure.png"), png)).catch(() => {});
  } finally {
    await session.close();
  }
})();
