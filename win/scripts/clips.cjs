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
  try {
    localStorage.setItem("draggy_star_notice", "1");
    window.__DRAGGY_NO_STAR__ = true;
  } catch {}
  if (!document.getElementById("clip-suppress-star")) {
    const starStyle = document.createElement("style");
    starStyle.id = "clip-suppress-star";
    starStyle.textContent = \`
      [data-star-notice],
      div:has(> a[href*="github.com/Lucki74/draggy"]),
      div:has(> button[aria-label="Dismiss"]) {
        display: none !important;
      }
    \`;
    document.head.append(starStyle);
  }
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

  // A hand does not travel in a straight line at an even pace. The path is a curve that bows to one side,
  // speed follows the distance, a long move overshoots a little and settles back, and the cursor shakes slightly.
  async moveTo(x, y, ms) {
    const from = { x: this.x, y: this.y };
    const distance = Math.hypot(x - from.x, y - from.y);
    const total = ms ?? Math.min(1100, 280 + distance * 0.9 + Math.random() * 140);
    const overshoot = distance > 260 && Math.random() < 0.7;
    const aim = overshoot
      ? { x: x + ((x - from.x) / distance) * (8 + Math.random() * 10), y: y + ((y - from.y) / distance) * (8 + Math.random() * 10) }
      : { x, y };
    await this.travel(from, aim, overshoot ? total * 0.86 : total, 1);
    if (overshoot) await this.travel(aim, { x, y }, 140 + Math.random() * 80, 0.25);
  }

  async travel(from, to, ms, bowScale) {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    const bow = Math.min(70, length / 6) * bowScale * side * (0.5 + Math.random() * 0.7);
    const nx = -(to.y - from.y) / length;
    const ny = (to.x - from.x) / length;
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      // Minimum-jerk profile: slow start, fast middle, a long gentle landing.
      const p = 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5;
      const arc = Math.sin(Math.PI * p) * bow;
      const shake = (1 - p) * p * 4;
      this.x = from.x + (to.x - from.x) * p + nx * arc + (Math.random() - 0.5) * shake;
      this.y = from.y + (to.y - from.y) * p + ny * arc + (Math.random() - 0.5) * shake;
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
    await sleep(70 + Math.random() * 70);
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
    // Aim a little off the centre of the target, as a hand does, then rest a beat before pressing.
    await this.moveTo(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 6);
    await sleep(120 + Math.random() * 180);
    await this.click();
  }

  // Typed the way a person types: a pause to think first, a steady rhythm that quickens inside a word and
  // slows at spaces and punctuation, now and then a wrong key that is noticed and backspaced.
  async type(text, rhythm = 1) {
    const key = (type, keyCode) => this.win.webContents.sendInputEvent({ type, keyCode });
    const near = "qwertyuiop asdfghjkl zxcvbnm";
    await sleep(500 + Math.random() * 500);
    let streak = 0;
    for (const [index, char] of [...text].entries()) {
      const letter = /[a-z]/i.test(char);
      if (letter && streak > 1 && Math.random() < 0.025) {
        const at = near.indexOf(char.toLowerCase());
        const wrong = near[at + (Math.random() < 0.5 ? -1 : 1)];
        if (wrong && wrong !== " ") {
          key("char", wrong);
          await sleep((90 + Math.random() * 90) * rhythm);
          await sleep(180 + Math.random() * 220);
          key("keyDown", "Backspace");
          key("keyUp", "Backspace");
          await sleep(110 + Math.random() * 80);
        }
      }
      key("char", char);
      streak = letter ? streak + 1 : 0;
      let wait = 55 + Math.random() * 75;
      if (streak > 3) wait *= 0.8;
      if (char === " ") wait += Math.random() < 0.3 ? 120 + Math.random() * 220 : 30;
      if (/[,.?!;:]/.test(char)) wait += 160 + Math.random() * 260;
      if (index > 0 && Math.random() < 0.02) wait += 300 + Math.random() * 400;
      await sleep(wait * rhythm);
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
    if (name === "code-dark") {
      const readmeGif = path.resolve(__dirname, "..", "..", ".github", "media", "demo-code.gif");
      try {
        execFileSync(ffmpeg, [
          "-y", "-loglevel", "error", "-i", `${stem}.mp4`,
          "-vf", "fps=12,scale=880:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
          readmeGif,
        ]);
        log("wrote readme demo-code.gif at", readmeGif);
      } catch (err) {
        console.error("failed to generate demo-code.gif:", err.message);
      }
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
async function ask(rec, text, rhythm = 1) {
  await rec.clickOn(() => document.querySelector("[data-region=composer] form textarea"));
  await rec.type(text, rhythm);
  await sleep(450 + Math.random() * 350);
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
      await ask(rec, "what changed in python 3.13? check the official docs and list the main points");
      // The agent asks before it clicks on the site: allow it for the session, then wait for the finished reply.
      for (;;) {
        await work(rec, win);
        if (!(await approving(win))) break;
        rec.fast = false;
        await sleep(900);
        await rec.clickOn(() => [...document.querySelectorAll("button")].find((n) => /^Allow for this session/.test(n.textContent.trim())));
      }
      rec.fast = false;
      await sleep(2000);
    },
  },
  research: {
    workspace: ["default", "chat"],
    speed: 24,
    async script(rec, win) {
      await ask(rec, "is sqlite safe to use from several threads? link where you found that");
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
      await ask(rec, "make formatTemperature in src/format.ts round to 1 decimal and add °C, then fix tests/format.test.ts to match. just edit the files, dont run anything");
      await work(rec, win);
      rec.fast = false;
      await sleep(2200);
    },
  },
  approval: {
    workspace: ["weather", "code"],
    reset: true,
    async script(rec, win) {
      await ask(rec, "run npm test in the terminal to verify the test suite");
      rec.fast = true;
      await waitFor(() => approving(win), { timeout: 150_000, every: 300, label: "the approval card" });
      rec.fast = false;
      await sleep(1400);
      await dump(win, "approval");
      await rec.clickOn(() => [...document.querySelectorAll("button")].find((n) => /^Allow once/.test(n.textContent.trim())));
      for (;;) {
        rec.fast = true;
        await waitFor(async () => (await approving(win)) || !(await generating(win)), { timeout: 600_000, every: 400, label: "the reply" });
        rec.fast = false;
        if (!(await approving(win))) break;
        await sleep(900);
        await rec.clickOn(() => [...document.querySelectorAll("button")].find((n) => /^Allow once/.test(n.textContent.trim())));
      }
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
      await sleep(500);
      await inPage(win, () => {
        const box = document.querySelector("[data-region=composer] form textarea");
        if (box && !box.value.trim()) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          setter.call(box, "how do i undo my last git commit and keep the changes?");
          box.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await waitFor(
        () => inPage(win, () => (document.querySelector("[data-region=composer] form textarea")?.value || "").trim().length > 3),
        { timeout: 30_000, every: 300, label: "the transcript" },
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
      await ask(rec, "whats the difference between a 401 and a 403? check mdn and link the page");
      // The agent asks before it clicks on the site: allow it for the session, then wait for the reply.
      for (;;) {
        await work(rec, win);
        if (!(await approving(win))) break;
        rec.fast = false;
        await sleep(900);
        await rec.clickOn(() => [...document.querySelectorAll("button")].find((n) => /^Allow for this session/.test(n.textContent.trim())));
      }
      rec.fast = false;
      await sleep(500);
      await dump(win, "browser");
      // Press the link: Draggy's own browser opens on the page.
      const find = () =>
        [...document.querySelectorAll("[data-region=transcript] a[href*='developer.mozilla.org'], [data-region=transcript] a[href^='http']")].pop();
      await rec.clickOn(find);
      await inPage(win, () => {
        const a = [...document.querySelectorAll("[data-region=transcript] a[href*='developer.mozilla.org'], [data-region=transcript] a[href^='http']")].pop();
        a?.click();
      });
      await waitFor(() => Boolean(rec.pane()), { timeout: 30_000, every: 200, label: "the browser pane" });
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
        async () => (await inPane("/40[13]/.test(document.body ? document.body.innerText : '')")) && (await painted()),
        { timeout: 40_000, every: 300, label: "the page" },
      ).catch(() => log("pane never painted blank-free"));
      rec.fast = false;
      log("pane text", JSON.stringify(await inPane("document.body ? document.body.innerText.slice(0, 160) : 'nobody'")), rec.pane() && JSON.stringify(rec.pane().getBounds()));
      await sleep(700);
      // Read down the page a little, the way a person would.
      rec.fast = false;
      for (let i = 0; i < 3; i += 1) {
        await rec.pane().webContents.executeJavaScript("window.scrollBy({ top: 260, behavior: 'smooth' })").catch(() => {});
        await sleep(900);
      }
      await sleep(1200);
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

const chatIds = (win) => inPage(win, async () => (await window.electronAPI.db.loadChats()).chats.map((c) => c.id));

// Each take leaves its session in the sidebar; drop it so the next take and the other tone start from the seeded history.
async function dropNewChats(win, keep) {
  const ids = await chatIds(win);
  await inPage(win, async (gone) => { for (const id of gone) await window.electronAPI.db.deleteChat(id); }, ids.filter((id) => !keep.includes(id)));
  const loaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("[data-region=transcript], textarea"))), { timeout: 60_000, every: 500, label: "the window to reload" });
  await sleep(1500);
}

async function record(win, name) {
  const clip = CLIPS[name];
  let seconds = 0;
  let speed = SPEED;
  const keep = await chatIds(win);
  for (const tone of TONES) {
    for (let take = 1; take <= 3; take += 1) {
      if (clip.reset) resetProject();
      // A page left open in the Browser pane by the take before would sit over this one.
      await inPage(win, () => window.electronAPI?.browserPane?.setVisible?.(false));
      for (const child of win.contentView.children) {
        try {
          if (/^https?:/.test(child.webContents.getURL())) await child.webContents.loadURL("about:blank");
        } catch {
          // Not a page view.
        }
      }
      await openWorkspace(win, ...clip.workspace);
      await setDark(win, tone === "dark");
      await inPage(win, () => {
        try {
          localStorage.setItem("draggy_star_notice", "1");
          window.__DRAGGY_NO_STAR__ = true;
          const banner = document.querySelector("[data-star-notice], div:has(> a[href*='github.com/Lucki74/draggy'])");
          if (banner) banner.remove();
        } catch {}
      });
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
        const warning = Boolean(document.querySelector("[data-region=transcript] [role=alert]"));
        const failedBadge = [...document.querySelectorAll("[data-region=transcript] button, [data-region=transcript] span")].some((n) => /\bfailed\b/i.test(n.textContent));
        return warning || failedBadge;
      });
      if (hasErrors && take < 3) {
        log(`${name}-${tone}: take ${take} showed failed steps, retrying...`);
        await dropNewChats(win, keep);
        continue;
      }
      seconds = await rec.encode(name, tone);
      await setDark(win, false);
      await dropNewChats(win, keep);
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
  await win.webContents.insertCSS(`
    [data-star-notice],
    div:has(> a[href*="github.com/Lucki74/draggy"]),
    div:has(> button[aria-label="Dismiss"]) {
      display: none !important;
    }
  `);
  await waitFor(() => inPage(win, () => Boolean(document.querySelector("[data-region=composer] form"))), { label: "the chat screen" });
  await inPage(win, () => {
    try {
      localStorage.setItem("draggy_star_notice", "1");
      window.__DRAGGY_NO_STAR__ = true;
    } catch {}
  });
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

