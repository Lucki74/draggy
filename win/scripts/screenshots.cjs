// Retakes the website screenshots from the real app on a throwaway data folder. Run npm run build,
// then electron scripts/screenshots.cjs with DRAGGY_RENDERER=dist.
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { prepare, sleep, appWindow, waitFor, inPage, setDark } = require("./capture-profile.cjs");

const OUT = path.resolve(
  process.env.DRAGGY_SHOTS_OUT || path.join(__dirname, "..", "..", "draggy-website", "assets", "img"),
);
const ONLY = (process.env.DRAGGY_SHOTS_ONLY || "").split(",").filter(Boolean);
const WIDTH = 1280;
const HEIGHT = 800;
// The first-run setup is its own run: forced on, on an install with no model, in one language.
const ONBOARDING = ONLY.includes("onboarding");
const LANGUAGE = process.env.DRAGGY_SHOTS_LANG || "";
const SHOTS_MODEL = process.env.DRAGGY_SHOTS_MODEL || "Qwen3.5-9B-Q4_K_M.gguf";
if (ONBOARDING) process.env.DRAGGY_ONBOARDING = "1";

const { scratch } = prepare({
  prefix: "draggy-shots-",
  // 1.6 fits a 1280 by 800 window on a 2560 by 1440 screen and captures at 2048 by 1280.
  scale: process.env.DRAGGY_SHOTS_SCALE || "1.6",
  models: [
    process.env.DRAGGY_SHOTS_MODEL,
    "Qwen3.5-4B-Q8_0.gguf",
    "Ornith-1.5-35B-A3B-Q4_K_M.gguf",
    "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
  ],
  onboarding: ONBOARDING,
  language: LANGUAGE,
});


// Loaded before ready, since the app registers its URL schemes as it loads.
// Stands in for the network so the downloads panel can be captured mid-flight: each model at its own
// point and speed, and none that ever finishes. Only the transfer is faked; the rest is the real app.
function fakeDownloads() {
  const modelStorage = require(path.join(__dirname, "..", "electron", "modelStorage.cjs"));
  const plans = [
    { total: 4.6 * 1024 ** 3, speed: 42 * 1024 ** 2, start: 0.38 },
    { total: 9.4 * 1024 ** 3, speed: 31 * 1024 ** 2, start: 0.12 },
    { total: 2.1 * 1024 ** 3, speed: 40 * 1024 ** 2, start: 0.02 },
  ];
  const running = new Map();
  let started = 0;

  modelStorage.downloadGgufModel = ({ filename, onProgress }) =>
    new Promise((resolve, reject) => {
      const plan = plans[started++ % plans.length];
      let completed = plan.total * plan.start;
      const timer = setInterval(() => {
        completed = Math.min(plan.total - 1, completed + plan.speed / 5);
        onProgress?.({
          phase: "downloading",
          completed,
          total: plan.total,
          percent: Number(((completed / plan.total) * 100).toFixed(1)),
          remainingSeconds: Math.round((plan.total - completed) / plan.speed),
        });
      }, 200);
      running.set(filename, () => {
        clearInterval(timer);
        const error = new Error("Download cancelled");
        error.name = "AbortError";
        reject(error);
      });
    });

  // The IPC handlers call the wrapper, which bound the real function before this stub existed.
  modelStorage.downloadGgufModelForIpc = async (options) => {
    try {
      return await modelStorage.downloadGgufModel(options);
    } catch (error) {
      if (error?.name === "AbortError") return { success: false, cancelled: true };
      throw error;
    }
  };

  modelStorage.cancelDownloadGgufModel = async (_modelsDir, filename) => {
    running.get(filename)?.();
    running.delete(filename);
    return { success: true };
  };
}

require(path.join(__dirname, "..", "electron", "main.cjs"));
if (ONLY.length === 0 || ONLY.includes("downloads") || ONBOARDING) fakeDownloads();

const log = (...parts) => console.log("[shots]", ...parts);
const wanted = (scene) => ONLY.length === 0 || ONLY.includes(scene);


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
      const box = document.querySelector("[data-region=composer] form textarea");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, message);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    },
    text,
  );
  await sleep(300);
  await inPage(win, () => document.querySelector("[data-region=composer] form").requestSubmit());
}

// Presses Allow once on an approval card, if one is waiting. Returns what it allowed.
function allowPending(win) {
  return inPage(win, () => {
    const button = [...document.querySelectorAll("button")].find((node) => /^Allow once/.test(node.textContent.trim()));
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
      const stop = document.querySelector('[data-stop=\'true\']');
      const tray = [...document.querySelectorAll("span")].some((node) => node.textContent.trim() === "Working");
      return Boolean(stop) || tray;
    });

  // A large model can take over a minute to process the first token after loading weights.
  await waitFor(generating, { timeout: 120_000, label: "the reply to start" });
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


async function capture(win, name) {
  await sleep(700);
  // A capture right after a reload or a hover can fail with a transient viz error; retry it.
  let image;
  for (let attempt = 1; ; attempt++) {
    try {
      image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(1500);
    }
  }
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  log(`saved ${name}.png (${size.width}x${size.height})`);
}

// The pane's page drawn into the window's capture at the pane's own rectangle.
async function overlay(base, top, bounds, name) {
  const helper = new BrowserWindow({ show: false, width: 200, height: 200 });
  try {
    await helper.loadURL("about:blank");
    const scale = base.getSize().width / WIDTH;
    const png = await helper.webContents.executeJavaScript(`(async () => {
      const load = (src) => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = src; });
      const [a, b] = await Promise.all([load(${JSON.stringify(base.toDataURL())}), load(${JSON.stringify(top.toDataURL())})]);
      const canvas = document.createElement("canvas");
      canvas.width = a.width;
      canvas.height = a.height;
      const context = canvas.getContext("2d");
      context.drawImage(a, 0, 0);
      context.drawImage(b, ${bounds.x * scale}, ${bounds.y * scale}, ${bounds.width * scale}, ${bounds.height * scale});
      return canvas.toDataURL("image/png");
    })()`);
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png.split(",")[1], "base64"));
    log(`saved ${name}.png (pane over the window)`);
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
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("[data-region=composer] form"))), {
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

// The setup's own screens, from a first launch: each step, then Ready with the download under way.
async function runOnboarding() {
  log("data folder", scratch);
  fs.mkdirSync(OUT, { recursive: true });
  const win = await waitFor(() => appWindow(), { label: "the setup window" });
  await waitFor(() => win.isVisible(), { label: "the setup to open" });
  // A covered window stops animating, and each step waits for the last one's fade to end.
  win.webContents.setBackgroundThrottling(false);
  win.setAlwaysOnTop(true);
  win.setIgnoreMouseEvents(true);
  win.setContentSize(WIDTH, HEIGHT);
  win.setPosition(0, 0);

  const heading = () => inPage(win, () => document.querySelector("main h1")?.textContent ?? "");
  const footerButton = (which) =>
    inPage(win, (last) => {
      const buttons = [...document.querySelectorAll("footer > div button")];
      const button = last ? buttons[buttons.length - 1] : buttons[0];
      if (!button || button.disabled) return false;
      button.click();
      return true;
    }, which === "next");
  // Moving between steps focuses the next one's first control; a mouse user never sees that ring.
  const shootStep = async (name) => {
    await inPage(win, () => document.activeElement?.blur());
    await shoot(win, name);
  };
  const move = async (which) => {
    const before = await heading();
    await waitFor(() => footerButton(which), { label: `the ${which} button` });
    await waitFor(async () => (await heading()) !== before, { label: "the next step" });
    await sleep(1200);
  };

  await waitFor(async () => (await heading()).length > 0, { label: "the welcome step" });
  await sleep(1500);
  await shootStep("app-onboarding-welcome");
  await move("next");
  await shootStep("app-onboarding-appearance");
  await move("next");
  // Where the AI runs: shot on local, then a look at the provider step before going back to it.
  const pickSource = (index) =>
    inPage(win, (at) => {
      const cards = document.querySelectorAll('main [role="radio"]');
      cards[at]?.click();
      return cards.length === 3;
    }, index);
  await waitFor(() => pickSource(0), { label: "the source cards" });
  await sleep(2500);
  await shootStep("app-onboarding-source");
  await pickSource(1);
  await move("next");
  await sleep(1500);
  await shootStep("app-onboarding-provider");
  await move("back");
  await pickSource(0);
  await sleep(500);
  await move("next");
  await waitFor(() => inPage(win, () => document.querySelectorAll('main [role="radio"]').length > 0), {
    label: "the model options",
  });
  await move("next");
  await shootStep("app-onboarding-preferences");
  await move("next");
  await sleep(2500);
  await shootStep("app-onboarding-ready");
  // Back on the model step, the download stays pinned under it.
  await move("back");
  await move("back");
  await sleep(1000);
  await shootStep("app-onboarding-model");

  // Start with the download under way: the app opens with it as a banner, the composer waiting.
  await move("next");
  await move("next");
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("main button:not(:disabled)"))), { label: "Start" });
  await inPage(win, () => document.querySelector("main button:not(:disabled)").click());
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("[data-region=composer] form textarea"))), { label: "the app" });
  await sleep(2000);
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
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("[data-region=composer] form"))), {
    label: "the chat screen",
  });
  if (LANGUAGE) {
    await inPage(win, (language) => {
      const saved = JSON.parse(localStorage.getItem("draggy_settings") || "{}");
      localStorage.setItem("draggy_settings", JSON.stringify({ ...saved, language }));
    }, LANGUAGE);
    win.webContents.reload();
    await waitFor(() => inPage(win, () => Boolean(document.querySelector("[data-region=composer] form"))), {
      label: "the chat screen in the chosen language",
    });
  }
  const placeholder = await inPage(win, () => document.querySelector("[data-region=composer] form textarea").placeholder);
  log("composer says", JSON.stringify(placeholder));
  await sleep(2000);

  if (wanted("chat")) await scene("chat", async () => {
    await send(
      win,
      "my sourdough starter smells like nail polish remover. is it dead or just hungry?",
    );
    await shoot(win, "app-chat");
  });

  if (wanted("extensions")) await scene("extensions", async () => {
    // The catalogue of servers, then the library of skills, as the Extensions page shows them.
    await openWorkspace(win, "default");
    await click(win, "Settings", { exact: true });
    await sleep(800);
    await openSettingsPage(win, "App", "Extensions");
    await sleep(2500);
    await shoot(win, "app-extensions");

    await click(win, "Skills", { exact: true });
    await sleep(1200);
    await shoot(win, "app-skills");
  });

  if (wanted("skills")) await scene("skills", async () => {
    await openWorkspace(win, "default");
    await click(win, "New chat");

    // The slash menu lists skills after the built-in commands.
    await inPage(win, () => {
      const box = document.querySelector("[data-region=composer] form textarea");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, "/");
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.focus();
    });
    await sleep(900);
    await inPage(win, () => {
      const menu = document.querySelector("[data-region=composer] form")?.parentElement?.querySelector(".overflow-y-auto");
      if (menu) menu.scrollTop = menu.scrollHeight;
    });
    await sleep(500);
    await capture(win, "app-skill-menu");

    // A skill started by its command, then the context popover naming it as loaded.
    await send(win, "/proofreader Their going too the park tomorow, weather permiting, and they has invited Sam.");
    await shoot(win, "app-skill-request");
    // The context meter lives in the Code composer, so the loaded-skill popover is shot from a project.
    await openWorkspace(win, "weather");
    await send(win, "/proofreader Their going too the park tomorow, weather permiting, and they has invited Sam.");
    await click(win, "Context window:")
      .then(async () => {
        await inPage(win, () => {
          const header = document.querySelector("[role=dialog] button[aria-expanded]");
          if (header && header.getAttribute("aria-expanded") === "false") header.click();
        });
        await shoot(win, "app-skill-context");
        await click(win, "Context window:");
      })
      .catch((error) => log("skipped app-skill-context:", error.message));
  });

  if (wanted("project")) await scene("project", async () => {
    await openWorkspace(win, "weather");
    await send(
      win,
      "make formatTemperature round to 1 decimal and add °C, then fix the test. just edit the files, dont run anything",
    );
    // The redesigned app shows each edit as a diff in the reply, so there is no file tree to open.
    // The edit and its diff are the point of the scene, so bring them into view.
    await inPage(win, () => {
      const edits = [...document.querySelectorAll("span")].filter((node) =>
        /^(Wrote|Edited)\b/.test(node.textContent.trim()),
      );
      edits.at(-1)?.scrollIntoView({ block: "start" });
    });
    await sleep(1500);
    await shoot(win, "app-project");
  });

  if (wanted("history")) await scene("history", async () => {
    await openWorkspace(win, "default");
    await click(win, "New chat");
    await send(win, "is \"per my last email\" rude? writing to my landlord about the deposit");
    await click(win, "New chat");
    await send(win, "name for a tiny weather app, my brother wants it to sound friendly");
    // The sidebar lists the chats and stays open, so there is no history button to press any more.
    await sleep(1200);
    await shoot(win, "app-history");
  });

  if (wanted("stats")) await scene("stats", async () => {
    await click(win, "Settings");
    await click(win, "Statistics");
    await click(win, "All time");
    await sleep(1000);
    await shoot(win, "app-stats");
  });

  if (wanted("modes")) await scene("modes", async () => {
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
  });

  if (wanted("settings")) await scene("settings", async () => {
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
      ["Chat", "Library", "app-settings-library"],
      ["Code", "Preferences", "app-settings-code"],
      ["Code", "Projects", "app-settings-projects"],
    ];

    for (const [group, label, name] of pages) {
      await openSettingsPage(win, group, label);
      await shoot(win, name);
    }
  });

  if (wanted("downloads")) await scene("downloads", async () => {
    await openWorkspace(win, "weather");
    await click(win, "Settings", { exact: true });
    await sleep(800);
    await openSettingsPage(win, "App", "Models");

    // A result row is the full-width expandable button in the model list; dropdowns and the downloads
    // button also carry aria-expanded.
    const ROW = "button[aria-expanded].w-full.text-start";
    await waitFor(() => inPage(win, (row) => [...document.querySelectorAll(row)].filter((n) => !/^Automatic/.test(n.textContent.trim())).length >= 3, ROW), {
      timeout: 180_000,
      label: "the model results",
    });

    // Three downloads against a limit of two, so one shows as queued.
    for (let position = 0; position < 3; position += 1) {
      await inPage(
        win,
        (index, row) => {
          const heads = [...document.querySelectorAll(row)].filter(
            (n) => !/^Automatic/.test(n.textContent.trim()) && !/Image generation|Video generation/.test(n.textContent),
          );
          // Every row opened so far has had its download started, so the next one is the first still closed.
          heads.find((n) => n.getAttribute("aria-expanded") !== "true")?.click();
        },
        position,
        ROW,
      );
      const started = await waitFor(
        () =>
          inPage(win, () => {
            const download = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Download");
            download?.click();
            return Boolean(download);
          }),
        { timeout: 15_000, every: 300, label: "a Download button" },
      ).catch(async (error) => {
        const seen = await inPage(win, (row) => ({
          rows: document.querySelectorAll(row).length,
          buttons: [...document.querySelectorAll("button")].map((node) => node.textContent.trim().slice(0, 24)).filter(Boolean),
        }), ROW);
        log("no Download button; page shows", JSON.stringify(seen));
        throw error;
      });
      if (!started) throw new Error("no Download button in the expanded model");
      log("started download", position + 1);
      await sleep(500);
    }

    // Tidy the list behind the panel: no model left open, and the section starts at the top of the page.
    await inPage(
      win,
      (row) => {
        [...document.querySelectorAll(`${row}[aria-expanded="true"]`)]
          .find((n) => !/^Automatic/.test(n.textContent.trim()))
          ?.click();
        const heading = [...document.querySelectorAll("*")].find(
          (node) => node.children.length === 0 && node.textContent.trim().toLowerCase() === "download a model",
        );
        heading?.scrollIntoView({ block: "start" });
        const button = [...document.querySelectorAll("button")].find((node) =>
          (node.getAttribute("aria-label") || "").startsWith("Downloads"),
        );
        button?.click();
      },
      ROW,
    );
    await sleep(3000);
    await shoot(win, "app-settings-downloads");

    // Leave nothing running for the scenes after this one.
    for (let index = 0; index < 4; index += 1) {
      await inPage(win, () => document.querySelector('[role=dialog] button[aria-label="Cancel"]')?.click());
      await sleep(400);
    }
    await inPage(win, () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  });

  if (wanted("command")) await scene("command", async () => {
    await openWorkspace(win, "weather");
    await submit(
      win,
      "whats the latest commit message here? use git log --oneline",
    );

    await waitFor(
      () => inPage(win, () => Boolean(document.querySelector('[data-stop=\'true\']'))),
      { timeout: 30_000, label: "the turn to start" },
    );
    log("waiting for the command approval");
    // The approval, or a reply that ended without one; either way the screen says what happened.
    const outcome = await waitFor(
      () =>
        inPage(win, () => {
          if (document.body.innerText.includes("Run a command")) return "approval";
          const busy = document.querySelector('[data-stop=\'true\']');
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

    await click(win, "Allow once");
    log("waiting for the reply after the command");
    // A model may ask to run the command again once it has the output, so keep allowing until the turn ends.
    await waitFor(
      async () => {
        const allowed = await allowPending(win);
        if (allowed) log("allowed once:", allowed);
        return (
          !allowed &&
          (await inPage(win, () => !document.querySelector('[data-stop=\'true\']')))
        );
      },
      { timeout: 600_000, every: 1000, label: "the reply after the command" },
    );
    await sleep(1500);
    await inPage(win, () => {
      const steps = [...document.querySelectorAll("pre")];
      steps.at(-1)?.scrollIntoView({ block: "center" });
    });
    await shoot(win, "app-command-ran");
  });

  if (wanted("browser")) await scene("browser", async () => {
    // Links open in the Browser pane, a native view laid over the main window, so the window's own
    // capture leaves it blank: the pane's page is captured on its own and drawn into that gap.
    const paneView = () =>
      win.contentView.children.find(
        (one) => one.webContents && one.webContents !== win.webContents && /^https?:/.test(one.webContents.getURL()),
      );
    await inPage(win, () => window.open("https://en.wikipedia.org/wiki/Electron_(software)", "_blank"));
    const pane = await waitFor(() => paneView(), { timeout: 60_000, label: "the browser pane" });
    await waitFor(
      () => pane.webContents.executeJavaScript('document.readyState === "complete"').catch(() => false),
      { timeout: 60_000, every: 500, label: "the page" },
    );
    await sleep(2000);

    for (const dark of [false, true]) {
      await setDark(win, dark);
      await sleep(600);
      const shell = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
      const page = await pane.webContents.capturePage();
      const bounds = pane.getBounds();
      await overlay(shell, page, bounds, `app-browser-${dark ? "dark" : "light"}`);
    }
    await setDark(win, false);
    await inPage(win, () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    await sleep(800);
  });

  if (wanted("talk")) await scene("talk", async () => {
    // Talk is on the Chat side only, and the command scene leaves the app in Code.
    // Pin Talk to the model already on disk, or it plans a rung sized to the GPU and starts a download.
    await inPage(win, (model) => {
      const saved = JSON.parse(localStorage.getItem("draggy_settings") || "{}");
      localStorage.setItem("draggy_settings", JSON.stringify({ ...saved, voiceModel: model }));
    }, SHOTS_MODEL);
    await openWorkspace(win, "default");
    await click(win, "Talk");
    await sleep(2500);
    // The first visit loads the voice model; the screen worth shooting is the one after it.
    await waitFor(
      () =>
        inPage(win, () => {
          const body = document.body.innerText;
          const loading = /Loading voice model|Downloading|Preparing/.test(body);
          const hasError = /Failed to fetch|failed|Retry/i.test(body);
          const hasControls = Boolean(document.querySelector("footer button"));
          return !loading && !hasError && hasControls;
        }),
      { timeout: 180_000, every: 1000, label: "Talk to finish loading and become live" },
    );
    await sleep(2500);
    await shoot(win, "app-talk");
  });
}


app.whenReady().then(() => {
  (ONBOARDING ? runOnboarding : run)()
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
