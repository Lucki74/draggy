// Records the website clips from the real app on a throwaway data folder: a drawn pointer moves and
// clicks, real keystrokes are typed, and the frames are cut down to short loops. Run npm run build,
// then electron scripts/clips.cjs with DRAGGY_RENDERER=dist. DRAGGY_SHOTS_MODEL picks the model.
// Waiting on the model is sped up (SPEED) and the clip says so; nothing else is cut.
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { prepare, sleep, waitFor, inPage, setDark } = require("./capture-profile.cjs");
const { execFileSync } = require("node:child_process");
const { BrowserWindow } = require("electron");

// Under the dev renderer the page is a localhost URL, not index.html.
const appWindow = () =>
  BrowserWindow.getAllWindows().find((w) => {
    if (w.isDestroyed()) return false;
    const url = w.webContents.getURL();
    return (url.includes("index.html") || url.includes("5173")) && !/splash|browserbar/.test(url);
  });

const OUT = path.resolve(
  process.env.DRAGGY_CLIPS_OUT || path.join(__dirname, "..", "..", "..", "draggy-website", "assets", "clips"),
);
const ONLY = (process.env.DRAGGY_CLIPS_ONLY || "").split(",").filter(Boolean);
const WIDTH = 1280;
const HEIGHT = 800;
const SPEED = 6; // while the model works, each captured frame is shown for 1/SPEED of its real time
const FPS = 12;
const TONES = (process.env.DRAGGY_CLIPS_TONES || "light,dark").split(",").filter(Boolean);
const DUMP = process.env.DRAGGY_CLIPS_DUMP || "";
const MODEL = path.basename(String(process.env.DRAGGY_SHOTS_MODEL || "Qwen3.5-9B-Q4_K_M.gguf"));
const WEBM_LIMIT = 1_500_000;
const POSTER_LIMIT = 60_000;

const { scratch, project } = prepare({
  prefix: "draggy-clips-",
  scale: "1",
  models: [process.env.DRAGGY_SHOTS_MODEL, "Qwen3.5-9B-Q4_K_M.gguf", "Qwen3.5-4B-Q8_0.gguf"],
});

// Reading web pages needs more room than the automatic context gives this card, or the question drops out.
{
  const storage = require(path.join(__dirname, "..", "electron", "storage.cjs"));
  storage.init(app.getPath("userData"));
  const settings = JSON.parse(storage.getValue("draggy_settings") || "{}");
  storage.setValue("draggy_settings", JSON.stringify({ ...settings, fixedContextSize: Number(process.env.DRAGGY_CLIPS_CTX || 16384) }));
  storage.close();
}

// A window another program covers is not drawn, and a native page view has nothing to capture then.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// The voice clip speaks into the real microphone path: Chromium feeds a recorded question to getUserMedia.
const VOICE_WAV = process.env.DRAGGY_CLIPS_WAV || "C:/clip-voice/question-pad.wav";
if (ONLY.includes("voice") && fs.existsSync(VOICE_WAV)) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
  app.commandLine.appendSwitch("use-file-for-fake-audio-capture", VOICE_WAV);
  // The speech models are already on this machine; link them in rather than download them again.
  const real = path.join(process.env.APPDATA || "", "Draggy", "model-cache");
  const link = path.join(app.getPath("userData"), "model-cache");
  if (fs.existsSync(real) && !fs.existsSync(link)) {
    fs.symlinkSync(real, link, "junction");
    process.on("exit", () => { try { fs.unlinkSync(link); } catch { /* already gone */ } });
  }
}

require(path.join(__dirname, "..", "electron", "main.cjs"));

const log = (...parts) => console.log("[clips]", ...parts);
const wanted = (clip) => ONLY.length === 0 || ONLY.includes(clip);

/* ---------- the drawn pointer ---------- */

const POINTER = `
(() => {
  if (document.getElementById("clip-pointer")) return;
  const style = document.createElement("style");
  style.textContent = \`
    #clip-pointer{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;
      transform:translate(var(--x,640px),var(--y,400px));filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
    #clip-pointer svg{display:block;transform-origin:3px 3px;transition:transform 90ms ease-out}
    #clip-pointer.down svg{transform:scale(.86)}
    .clip-ripple{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;
      border-radius:50%;border:2px solid rgba(249,173,38,.9);animation:clip-ripple 520ms ease-out forwards}
    @keyframes clip-ripple{to{transform:scale(4.2);opacity:0}}
  \`;
  document.head.append(style);
  const el = document.createElement("div");
  el.id = "clip-pointer";
  el.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 2.5v20l5.3-5 3.6 8.2 3.4-1.5-3.6-8H20z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.append(el);
  window.__clipMove = (x, y) => { el.style.setProperty("--x", x + "px"); el.style.setProperty("--y", y + "px"); };
  window.__clipDown = (on) => el.classList.toggle("down", on);
  window.__clipRipple = (x, y) => {
    const r = document.createElement("div");
    r.className = "clip-ripple"; r.style.left = x + "px"; r.style.top = y + "px";
    document.body.append(r); setTimeout(() => r.remove(), 600);
  };
})()`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

class Recorder {
  constructor(win) {
    this.win = win;
    this.x = 640;
    this.y = 420;
    this.frames = [];
    this.fast = false;
    this.speed = SPEED;
    this.running = false;
  }

  async start(name) {
    this.name = name;
    this.dir = path.join(scratch, `frames-${name}`);
    fs.mkdirSync(this.dir, { recursive: true });
    await inPage(this.win, () => 0);
    await this.win.webContents.executeJavaScript(POINTER);
    this.running = true;
    this.loop = (async () => {
      let last = Date.now();
      while (this.running) {
        const image = await this.win.webContents.capturePage({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
        const now = Date.now();
        const index = this.frames.length;
        const id = String(index).padStart(5, "0");
        fs.writeFileSync(path.join(this.dir, `${id}.jpg`), image.toJPEG(92));
        // The Browser pane is a native view laid over the window, so it is captured on its own and put back on later.
        let view = null;
        const pane = this.pane();
        if (pane) {
          try {
            const shot = await pane.webContents.capturePage();
            fs.writeFileSync(path.join(this.dir, `${id}-v.jpg`), shot.toJPEG(92));
            view = pane.getBounds();
          } catch {
            view = null;
          }
        }
        this.frames.push({ index, real: now - last, fast: this.fast, view });
        last = now;
        await sleep(Math.max(0, 1000 / FPS - (Date.now() - now)));
      }
    })();
  }

  pane() {
    if (!this.watchPane) return null;
    return this.win.contentView.children.find((child) => {
      try {
        return child.getVisible() && /^https?:/.test(child.webContents.getURL());
      } catch {
        return false;
      }
    });
  }

  async stop() {
    this.running = false;
    await this.loop;
    return this;
  }

  mouse(type, extra = {}) {
    this.win.webContents.sendInputEvent({ type, x: Math.round(this.x), y: Math.round(this.y), ...extra });
  }

  async moveTo(x, y, ms = 650) {
    const from = { x: this.x, y: this.y };
    // A slight arc, so it reads as a hand and not a ruler.
    const bow = Math.min(60, Math.hypot(x - from.x, y - from.y) / 8);
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i += 1) {
      const t = ease(i / steps);
      this.x = from.x + (x - from.x) * t;
      this.y = from.y + (y - from.y) * t - Math.sin(Math.PI * t) * bow;
      this.mouse("mouseMove");
      await this.win.webContents.executeJavaScript(`window.__clipMove(${this.x},${this.y})`);
      await sleep(16);
    }
  }

  async click() {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    await this.win.webContents.executeJavaScript(`window.__clipDown(true);window.__clipRipple(${x},${y})`);
    this.mouse("mouseDown", { button: "left", clickCount: 1 });
    await sleep(110);
    this.mouse("mouseUp", { button: "left", clickCount: 1 });
    await this.win.webContents.executeJavaScript("window.__clipDown(false)");
    await sleep(200);
  }

  // Finds an element by a function run in the page and returns the centre of its box.
  async centre(finder, ...args) {
    const code = `(() => {
      const element = (${finder.toString()})(...${JSON.stringify(args)});
      if (!element) return null;
      element.scrollIntoView({ block: "nearest" });
      const r = element.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`;
    const box = await this.win.webContents.executeJavaScript(code, true);
    if (!box) throw new Error(`nothing found for ${finder}`);
    return box;
  }

  async clickOn(finder, ...args) {
    const { x, y } = await this.centre(finder, ...args);
    await this.moveTo(x, y, 360 + Math.random() * 100);
    await this.click();
  }

  async type(text, perKey = 38) {
    for (const char of text) {
      this.win.webContents.sendInputEvent({ type: "char", keyCode: char });
      await sleep(perKey + Math.random() * 18);
    }
  }

  // Encodes the frames into mp4 and webm. Fast frames are shown for 1/SPEED of the time they took, and
  // runs of them are merged so that no frame is shown for less than a fifteenth of a second.
  async encode(clip, tone) {
    const ffmpeg = require(path.join(__dirname, "..", "..", "..", "draggy-website", "node_modules", "ffmpeg-static"));
    const kept = [];
    let owed = 0;
    for (const f of this.frames) {
      const real = Math.max(20, f.real) / 1000;
      const seconds = f.fast ? real / this.speed : real;
      owed += seconds;
      if (f.fast && owed < 1 / 15) continue;
      kept.push({ ...f, seconds: owed });
      owed = 0;
    }
    if (kept.length && owed > 0) kept[kept.length - 1].seconds += owed;

    const name = `${clip}-${tone}`;
    const list = [];
    for (const f of kept) {
      const id = String(f.index).padStart(5, "0");
      let file = path.join(this.dir, `${id}.jpg`);
      if (f.view) {
        const out = path.join(this.dir, `${id}-c.jpg`);
        execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", file, "-i", path.join(this.dir, `${id}-v.jpg`),
          "-filter_complex", `overlay=${f.view.x}:${f.view.y}`, "-q:v", "2", out]);
        file = out;
      }
      list.push(`file '${file.split(path.sep).join("/")}'`);
      list.push(`duration ${Math.max(1 / 60, f.seconds).toFixed(4)}`);
    }
    list.push(list[list.length - 2]);
    const total = kept.reduce((sum, f) => sum + f.seconds, 0);
    const listFile = path.join(scratch, `${name}.txt`);
    fs.writeFileSync(listFile, list.join("\n"));
    fs.mkdirSync(OUT, { recursive: true });
    const base = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile];
    // A short fade at both ends, so the loop does not jump from the answer back to the empty chat.
    const bg = tone === "dark" ? "0x0e0e0e" : "0xffffff";
    const fade = `fade=t=in:st=0:d=0.3:color=${bg},fade=t=out:st=${Math.max(0, total - 0.35).toFixed(2)}:d=0.35:color=${bg}`;
    const stem = path.join(OUT, name);
    const size = (file) => fs.statSync(file).size;

    execFileSync(ffmpeg, [...base, "-vf", `fps=30,scale=1280:-2:flags=lanczos,${fade},format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-movflags", "+faststart", "-an", `${stem}.mp4`]);
    let width = 1280;
    for (const crf of [38, 42, 46, 50, 54]) {
      execFileSync(ffmpeg, [...base, "-vf", `fps=24,scale=${width}:-2:flags=lanczos,${fade},format=yuv420p`, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-an", `${stem}.webm`]);
      if (size(`${stem}.webm`) <= WEBM_LIMIT) break;
      if (crf === 46) width = 960;
    }
    // The poster is the last frame, where the answer is on screen.
    const last = kept[kept.length - 1];
    const lastId = String(last.index).padStart(5, "0");
    let still = path.join(this.dir, `${lastId}.jpg`);
    if (last.view) still = path.join(this.dir, `${lastId}-c.jpg`);
    for (const [scale, q] of [[1280, 6], [1280, 9], [1280, 14], [1280, 20], [960, 10], [960, 16]]) {
      execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", still, "-vf", `scale=${scale}:-2:flags=lanczos`, "-q:v", String(q), `${stem}.jpg`]);
      if (size(`${stem}.jpg`) <= POSTER_LIMIT) break;
    }
    log(`wrote ${name} (${this.frames.length} frames, ${kept.length} kept, ${total.toFixed(1)} s, webm ${size(`${stem}.webm`)} B, mp4 ${size(`${stem}.mp4`)} B, jpg ${size(`${stem}.jpg`)} B)`);
    return total;
  }
}

async function openWorkspace(win, id, mode) {
  await inPage(
    win,
    (workspace, appMode) => {
      localStorage.setItem("draggy_workspace", workspace);
      localStorage.setItem("draggy_mode", appMode);
    },
    id,
    mode,
  );
  win.webContents.reload();
  await sleep(1500);
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("[data-region=composer] form"))), { label: "the composer" });
  await sleep(2000);
  // A fresh conversation, whatever the app reopened on.
  await inPage(win, () => {
    const start = [...document.querySelectorAll("button, a, [role=button]")].find((n) => /^New (chat|session)/.test(n.textContent.trim()));
    start?.click();
  });
  await sleep(1200);
}

const generating = (win) =>
  inPage(win, () => Boolean(document.querySelector("[data-stop='true']")) ||
    [...document.querySelectorAll("span")].some((n) => n.textContent.trim() === "Working"));

const approving = (win) =>
  inPage(win, () => [...document.querySelectorAll("button")].some((n) => n.textContent.trim().startsWith("Allow once")));

// Types a question like a person and sends it.
async function ask(rec, text, perKey = 14) {
  await rec.clickOn(() => document.querySelector("[data-region=composer] form textarea"));
  await rec.type(text, perKey);
  await sleep(250);
  await rec.clickOn(() => document.querySelector("[data-region=composer] form button[type=submit]"));
}

// The model works. This is the part that is sped up.
async function work(rec, win, { allow = false } = {}) {
  rec.fast = true;
  await waitFor(() => generating(win), { timeout: 180_000, label: "the reply to start" });
  await waitFor(
    async () => {
      if (await approving(win)) {
        if (!allow) return true;
        rec.fast = false;
        return true;
      }
      return !(await generating(win));
    },
    { timeout: 900_000, every: 400, label: "the reply" },
  );
}

async function dump(win, name) {
  if (!DUMP) return;
  fs.mkdirSync(DUMP, { recursive: true });
  const html = await win.webContents.executeJavaScript("document.body.innerHTML");
  fs.writeFileSync(path.join(DUMP, `${name}.html`), html);
}

/* ---------- the clips ---------- */

const CLIPS = {
  // A question that needs the web: Draggy searches, opens pages, reads, and answers with sources.
  hero: {
    workspace: ["default", "chat"],
    speed: 8,
    async script(rec, win) {
      await ask(rec, "What does the Open-Meteo API return for current weather? Check their docs.");
      await work(rec, win);
      rec.fast = false;
      await sleep(2000);
    },
  },
  research: {
    workspace: ["default", "chat"],
    speed: 24,
    async script(rec, win) {
      await ask(rec, "Does the Open-Meteo API need a key? Cite your sources.");
      await work(rec, win);
      rec.fast = false;
      await sleep(900);
      await dump(win, "research");
      // Open the steps, then the search results, then press one of the sources.
      await rec.clickOn(() => [...document.querySelectorAll("[data-region=transcript] button[aria-expanded=false]")].find((n) => /^(Searched|Read|Opened)/.test(n.textContent.trim())));
      await sleep(500);
      await rec.clickOn(() => document.querySelector("[data-region=transcript] details summary"));
      await sleep(500);
      await rec.clickOn(() => document.querySelector("[data-region=transcript] details a[href^=http]"));
      await sleep(1800);
    },
  },
  code: {
    workspace: ["weather", "code"],
    reset: true,
    async script(rec, win) {
      await ask(rec, "In src/format.ts, make formatTemperature round to one decimal place and add a °C suffix. Update the test to match. Only edit the files; do not run or install anything.", 16);
      await work(rec, win);
      rec.fast = false;
      await sleep(2200);
    },
  },
  approval: {
    workspace: ["weather", "code"],
    reset: true,
    async script(rec, win) {
      await ask(rec, "Use the terminal to run node --version and tell me what it prints.");
      rec.fast = true;
      await waitFor(() => approving(win), { timeout: 150_000, every: 300, label: "the approval card" });
      rec.fast = false;
      await sleep(1400);
      await dump(win, "approval");
      await rec.clickOn(() => [...document.querySelectorAll("button")].find((n) => /^Allow once/.test(n.textContent.trim())));
      rec.fast = true;
      await waitFor(async () => !(await approving(win)) && !(await generating(win)), { timeout: 600_000, every: 400, label: "the reply" });
      rec.fast = false;
      await sleep(1500);
    },
  },
  voice: {
    workspace: ["default", "chat"],
    async script(rec, win) {
      await rec.clickOn(() => document.querySelector("[data-region=composer] form button[aria-label^='Voice input']"));
      await sleep(1500);
      rec.fast = true;
      await sleep(1600);
      rec.fast = false;
      await rec.clickOn(() => document.querySelector("[data-region=composer] form button[aria-label^='Listening']"));
      rec.fast = true;
      await waitFor(
        () => inPage(win, () => (document.querySelector("[data-region=composer] form textarea")?.value || "").trim().length > 3),
        { timeout: 300_000, every: 300, label: "the transcript" },
      );
      rec.fast = false;
      await sleep(700);
      await rec.clickOn(() => document.querySelector("[data-region=composer] form button[type=submit]"));
      await work(rec, win);
      rec.fast = false;
      await sleep(2000);
    },
  },
  browser: {
    workspace: ["default", "chat"],
    watchPane: true,
    speed: 20,
    async script(rec, win) {
      await ask(rec, "Open superadblocktest.com, tell me how many ads it blocked, and link the page.");
      await work(rec, win);
      rec.fast = false;
      await sleep(500);
      await dump(win, "browser");
      // Press the link: Draggy's own browser opens on the page and the block count climbs.
      const find = () => [...document.querySelectorAll("[data-region=transcript] a[href*='superadblocktest']")].pop();
      await rec.clickOn(find);
      await waitFor(() => Boolean(rec.pane()), { timeout: 15_000, every: 200, label: "the browser pane" });
      const inPane = async (code) => {
        try {
          return await rec.pane().webContents.executeJavaScript(code);
        } catch {
          return false;
        }
      };
      rec.fast = true;
      const painted = async () => {
        try {
          const wc = rec.pane().webContents;
          wc.invalidate();
          const bitmap = (await wc.capturePage()).toBitmap();
          const seen = new Set();
          for (let i = 0; i < bitmap.length; i += 4 * 997) seen.add(bitmap[i] + "," + bitmap[i + 1] + "," + bitmap[i + 2]);
          return seen.size > 6;
        } catch {
          return false;
        }
      };
      await waitFor(
        async () => (await inPane("/start test/i.test(document.body ? document.body.innerText : '')")) && (await painted()),
        { timeout: 40_000, every: 300, label: "the page" },
      ).catch(() => log("pane never painted blank-free"));
      rec.fast = false;
      log("pane text", JSON.stringify(await inPane("document.body ? document.body.innerText.slice(0, 160) : 'nobody'")), rec.pane() && JSON.stringify(rec.pane().getBounds()));
      await sleep(700);
      // The test starts on a button inside the page; the count then climbs as the blocker answers.
      await rec.pane().webContents.executeJavaScript(
        "(() => { const b = [...document.querySelectorAll('button, a')].find((n) => /start test/i.test(n.textContent || '')); if (b) b.click(); return Boolean(b); })()",
      );
      rec.fast = true;
      await waitFor(
        async () => {
          const view = rec.pane();
          if (!view) return false;
          try {
            return await view.webContents.executeJavaScript("/Completed:/.test(document.body.innerText)");
          } catch {
            return false;
          }
        },
        { timeout: 45_000, every: 400, label: "the ad block test" },
      ).catch(() => {});
      rec.fast = false;
      await sleep(1500);
    },
  },
};

// The project is a scratch copy; put the demo files back so every take starts from the same state.
function resetProject() {
  if (!project.startsWith(scratch)) return;
  execFileSync("git", ["checkout", "--", "src", "tests"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["clean", "-fdq", "src", "tests"], { cwd: project, stdio: "ignore" });
}

// The first reply loads the model, which can take longer than the app waits. Loaded once, every clip starts warm.
async function warmUp(win) {
  await openWorkspace(win, "default", "chat");
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await inPage(win, () => {
      const box = document.querySelector("[data-region=composer] form textarea");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, "Hi, are you there?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(300);
    await inPage(win, () => document.querySelector("[data-region=composer] form").requestSubmit());
    await sleep(3000);
    await waitFor(async () => !(await generating(win)), { timeout: 600_000, every: 1000, label: "the warm-up reply" });
    await sleep(1000);
    const failed = await inPage(win, () => document.body.innerText.includes("too long to load") || document.body.innerText.includes("Retry"));
    log("warm-up attempt", attempt, failed ? "failed" : "loaded");
    if (!failed) return;
    await inPage(win, () => [...document.querySelectorAll("button")].find((n) => n.textContent.trim() === "Retry")?.click());
    await sleep(3000);
    await waitFor(async () => !(await generating(win)), { timeout: 600_000, every: 1000, label: "the retry" });
    const still = await inPage(win, () => document.body.innerText.includes("too long to load"));
    if (!still) return;
  }
  throw new Error("the model would not load");
}

async function record(win, name) {
  const clip = CLIPS[name];
  let seconds = 0;
  let speed = SPEED;
  for (const tone of TONES) {
    for (let take = 1; take <= 3; take += 1) {
      if (clip.reset) resetProject();
      // A page left open in the Browser pane by the take before would sit over this one.
      for (const child of win.contentView.children) {
        try {
          if (/^https?:/.test(child.webContents.getURL())) await child.webContents.loadURL("about:blank");
        } catch {
          // Not a page view.
        }
      }
      await openWorkspace(win, ...clip.workspace);
      await setDark(win, tone === "dark");
      const rec = new Recorder(win);
      rec.watchPane = true;
      rec.speed = clip.speed || SPEED;
      speed = rec.speed;
      await rec.start(`${name}-${tone}`);
      await sleep(400);
      try {
        await clip.script(rec, win);
      } finally {
        await rec.stop();
      }
      const hasErrors = await inPage(win, () => {
        const warning = Boolean(document.querySelector(".text-danger"));
        const failedBadge = [...document.querySelectorAll("[data-region=transcript] button, [data-region=transcript] span")].some((n) => /\bfailed\b/i.test(n.textContent));
        return warning || failedBadge;
      });
      if (hasErrors && take < 3) {
        log(`${name}-${tone}: take ${take} showed failed steps, retrying...`);
        continue;
      }
      seconds = await rec.encode(name, tone);
      await setDark(win, false);
      break;
    }
  }
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ seconds: Math.round(seconds * 10) / 10, speed, model: MODEL }));
}

async function run() {
  log("data folder", scratch);
  const win = await waitFor(() => appWindow(), { label: "the app window" });
  await waitFor(() => win.isVisible(), { timeout: 300_000, label: "the app to start" });
  win.setContentSize(WIDTH, HEIGHT);
  win.setPosition(0, 0);
  win.setIgnoreMouseEvents(true);
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("[data-region=composer] form"))), { label: "the chat screen" });
  await sleep(2000);

  await warmUp(win);
  for (const name of Object.keys(CLIPS)) {
    if (wanted(name)) await record(win, name);
  }
}

run()
  .then(() => app.quit())
  .catch(async (error) => {
    console.error("[clips] failed:", error);
    const w = appWindow();
    if (w) console.error("[clips] page says:", await w.webContents.executeJavaScript("document.body.innerText.slice(0,2500)").catch(String));
    if (DUMP) {
      try {
        fs.cpSync(path.join(app.getPath("userData"), "logs"), path.join(DUMP, "logs"), { recursive: true });
      } catch {
        // No logs yet.
      }
    }
    if (w && DUMP) fs.writeFileSync(path.join(DUMP, "clips-fail.png"), (await w.webContents.capturePage()).toPNG());
    app.exit(1);
  });

