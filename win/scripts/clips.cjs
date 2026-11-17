// Records the website clips from the real Tauri app on a throwaway data folder: a drawn pointer moves and
// clicks, real keystrokes are typed, and the frames are cut down to short loops. Build or run the app, then:
//   node scripts/clips.cjs [--exe <draggy-win.exe>] [--port 9222]
// Env: DRAGGY_CLIPS_OUT, DRAGGY_CLIPS_ONLY, DRAGGY_CLIPS_TONES, DRAGGY_CLIPS_DUMP, DRAGGY_CLIPS_CTX,
// DRAGGY_CLIPS_WAV (voice question), DRAGGY_SHOTS_MODEL, DRAGGY_FFMPEG. Waiting on the model is sped up and the clip says so.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const app = require("./tauri-app.cjs");

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
if (args.includes("--help")) {
  console.log("node scripts/clips.cjs [--exe path] [--port 9222]  (env: DRAGGY_CLIPS_OUT, DRAGGY_CLIPS_ONLY, DRAGGY_CLIPS_TONES, DRAGGY_CLIPS_DUMP, DRAGGY_CLIPS_WAV, DRAGGY_SHOTS_MODEL, DRAGGY_FFMPEG)");
  process.exit(0);
}

const OUT = path.resolve(process.env.DRAGGY_CLIPS_OUT || path.join(__dirname, "..", "..", "..", "draggy-website", "assets", "clips"));
const ONLY = (process.env.DRAGGY_CLIPS_ONLY || "").split(",").filter(Boolean);
const WIDTH = 1280;
const HEIGHT = 800;
const SPEED = 6; // while the model works, each captured frame is shown for 1/SPEED of its real time
const FPS = 12;
const TONES = (process.env.DRAGGY_CLIPS_TONES || "light,dark").split(",").filter(Boolean);
const DUMP = process.env.DRAGGY_CLIPS_DUMP || "";
const MODEL = path.basename(String(process.env.DRAGGY_SHOTS_MODEL || "Qwen3.6-35B-A3B-Q8_0.gguf"));
const FFMPEG = process.env.DRAGGY_FFMPEG || "ffmpeg";
const WEBM_LIMIT = 1_500_000;
const POSTER_LIMIT = 60_000;
// One spoken question per language, as C:/clip-voice/question-<lang>.wav. A language without one skips the voice clip.
const VOICE_DIR = process.env.DRAGGY_CLIPS_WAV_DIR || "C:/clip-voice";
const LANGS = (process.env.DRAGGY_CLIPS_LANGS || "en,fr,es,ru").split(",").filter(Boolean);
const log = (...parts) => console.log("[clips]", ...parts);
const wanted = (clip) => ONLY.length === 0 || ONLY.includes(clip);
const voiceWav = (lang) => path.join(VOICE_DIR, `question-${lang}.wav`);

// The fake microphone is a Chromium switch, passed to WebView2 with the launch.
const voiceArgs = (lang) => wanted("voice") && fs.existsSync(voiceWav(lang))
  ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${voiceWav(lang).split(path.sep).join("/")}`]
  : [];

// The app's own strings, so the scenes find buttons by the label shown in the language being recorded.
const STRINGS = app.appStrings();
let LANG = "en";
const T = (key) => STRINGS[LANG]?.[key] || STRINGS.en[key];
// English keeps the plain names the site has always used; other languages add their code.
const stemFor = (clip, tone) => (LANG === "en" ? `${clip}-${tone}` : `${clip}-${LANG}-${tone}`);

/* ---------- the drawn pointer ---------- */

const POINTER = `
(() => {
  try {
    localStorage.setItem("draggy_star_notice", "1");
    window.__DRAGGY_NO_STAR__ = true;
  } catch {}
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
  constructor(page, browser) {
    this.page = page;
    this.browser = browser;
    this.x = 640;
    this.y = 420;
    this.frames = [];
    this.fast = false;
    this.speed = SPEED;
    this.running = false;
    this.watchPane = false;
    this.from = 0;
  }

  // Drops every frame so far: the clip opens here.
  cut() {
    this.from = this.frames.length;
  }

  async start(name) {
    this.name = name;
    this.dir = path.join(this.scratch, `frames-${name}`);
    fs.mkdirSync(this.dir, { recursive: true });
    await this.page.evaluate(POINTER);
    this.running = true;
    this.loop = (async () => {
      let last = Date.now();
      while (this.running) {
        let image;
        try {
          image = await this.page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, type: "jpeg", quality: 92 });
        } catch (error) {
          log("frame capture stopped:", error.message.split("\n")[0]);
          this.running = false;
          break;
        }
        const now = Date.now();
        const index = this.frames.length;
        const id = String(index).padStart(5, "0");
        fs.writeFileSync(path.join(this.dir, `${id}.jpg`), image);
        // The Browser pane is a native view, so its page is captured on its own and laid over the frame later.
        let view = null;
        if (this.watchPane) {
          const pane = await app.panePage(this.browser);
          const rect = pane ? await app.paneRect(this.page) : null;
          if (pane && rect && rect.width > 0) {
            try {
              fs.writeFileSync(path.join(this.dir, `${id}-v.jpg`), await pane.screenshot({ type: "jpeg", quality: 92 }));
              view = rect;
            } catch {
              view = null;
            }
          }
        }
        this.frames.push({ index, real: now - last, fast: this.fast, view });
        last = now;
        await app.sleep(Math.max(0, 1000 / FPS - (Date.now() - now)));
      }
    })();
  }

  async stop() {
    this.running = false;
    await this.loop;
    return this;
  }

  mouse(type, extra = {}) {
    return this.page.mouse.move(Math.round(this.x), Math.round(this.y), extra);
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
      await this.mouse("mouseMove");
      await this.page.evaluate(`window.__clipMove(${this.x},${this.y})`);
      await app.sleep(16);
    }
  }

  async click() {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    await this.page.evaluate(`window.__clipDown(true);window.__clipRipple(${x},${y})`);
    await this.page.mouse.down({ button: "left", clickCount: 1 });
    await app.sleep(70 + Math.random() * 70);
    await this.page.mouse.up({ button: "left", clickCount: 1 });
    await this.page.evaluate("window.__clipDown(false)");
    await app.sleep(200);
  }

  // Finds an element by a function run in the page and returns the centre of its box. It waits until the box
  // stops moving, since a section that is still expanding pushes the target down after it is measured.
  async centre(finder, ...args) {
    const measure = () => this.page.evaluate(`(() => {
      const element = (${finder.toString()})(...${JSON.stringify(args)});
      if (!element) return null;
      element.scrollIntoView({ block: "nearest" });
      const r = element.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    let box = await measure();
    for (let i = 0; box && i < 20; i += 1) {
      await app.sleep(100);
      const next = await measure();
      if (next && Math.abs(next.x - box.x) < 1 && Math.abs(next.y - box.y) < 1) break;
      box = next;
    }
    if (!box) throw new Error(`nothing found for ${finder}`);
    return box;
  }

  async clickOn(finder, ...args) {
    const { x, y } = await this.centre(finder, ...args);
    // Aim a little off the centre of the target, as a hand does, then rest a beat before pressing.
    await this.moveTo(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 6);
    // If the target moved during the trip, follow it before pressing.
    const after = await this.centre(finder, ...args);
    if (Math.hypot(after.x - x, after.y - y) > 4) await this.moveTo(after.x, after.y, 220);
    await app.sleep(120 + Math.random() * 180);
    await this.click();
  }

  // Typed the way a person types: a pause to think first, a steady rhythm that quickens inside a word and
  // slows at spaces and punctuation, now and then a wrong key that is noticed and backspaced.
  async type(text, rhythm = 1) {
    const near = "qwertyuiop asdfghjkl zxcvbnm";
    await app.sleep(500 + Math.random() * 500);
    let streak = 0;
    for (const [index, char] of [...text].entries()) {
      const letter = /[a-z]/i.test(char);
      if (letter && streak > 1 && Math.random() < 0.025) {
        const at = near.indexOf(char.toLowerCase());
        const wrong = near[at + (Math.random() < 0.5 ? -1 : 1)];
        if (wrong && wrong !== " ") {
          await this.page.keyboard.insertText(wrong);
          await app.sleep((90 + Math.random() * 90) * rhythm);
          await app.sleep(180 + Math.random() * 220);
          await this.page.keyboard.press("Backspace");
          await app.sleep(110 + Math.random() * 80);
        }
      }
      await this.page.keyboard.insertText(char);
      streak = letter ? streak + 1 : 0;
      let wait = 55 + Math.random() * 75;
      if (streak > 3) wait *= 0.8;
      if (char === " ") wait += Math.random() < 0.3 ? 120 + Math.random() * 220 : 30;
      if (/[,.?!;:]/.test(char)) wait += 160 + Math.random() * 260;
      if (index > 0 && Math.random() < 0.02) wait += 300 + Math.random() * 400;
      await app.sleep(wait * rhythm);
    }
  }

  // Encodes the frames into mp4 and webm. Fast frames are shown for 1/SPEED of the time they took, and
  // runs of them are merged so that no frame is shown for less than a fifteenth of a second.
  async encode(clip, tone) {
    const kept = [];
    let owed = 0;
    for (const f of this.frames.slice(this.from)) {
      const real = Math.max(20, f.real) / 1000;
      const seconds = f.fast ? real / this.speed : real;
      owed += seconds;
      if (f.fast && owed < 1 / 15) continue;
      kept.push({ ...f, seconds: owed });
      owed = 0;
    }
    if (kept.length && owed > 0) kept[kept.length - 1].seconds += owed;

    const name = stemFor(clip, tone);
    const list = [];
    for (const f of kept) {
      const id = String(f.index).padStart(5, "0");
      let file = path.join(this.dir, `${id}.jpg`);
      if (f.view) {
        const out = path.join(this.dir, `${id}-c.jpg`);
        const { x, y, dpr } = f.view;
        execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", file, "-i", path.join(this.dir, `${id}-v.jpg`),
          "-filter_complex", `[1:v]scale=${Math.round(f.view.width * dpr)}:${Math.round(f.view.height * dpr)}[p];[0:v][p]overlay=${Math.round(x * dpr)}:${Math.round(y * dpr)}`,
          "-q:v", "2", out]);
        file = out;
      }
      list.push(`file '${file.split(path.sep).join("/")}'`);
      list.push(`duration ${Math.max(1 / 60, f.seconds).toFixed(4)}`);
    }
    list.push(list[list.length - 2]);
    const total = kept.reduce((sum, f) => sum + f.seconds, 0);
    const listFile = path.join(this.scratch, `${name}.txt`);
    fs.writeFileSync(listFile, list.join("\n"));
    fs.mkdirSync(OUT, { recursive: true });
    const base = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile];
    // A short fade at both ends, so the loop does not jump from the answer back to the empty chat.
    const bg = tone === "dark" ? "0x0e0e0e" : "0xffffff";
    const fade = `fade=t=in:st=0:d=0.3:color=${bg},fade=t=out:st=${Math.max(0, total - 0.35).toFixed(2)}:d=0.35:color=${bg}`;
    const stem = path.join(OUT, name);
    const size = (file) => fs.statSync(file).size;

    execFileSync(FFMPEG, [...base, "-vf", `fps=30,scale=1280:-2:flags=lanczos,${fade},format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-movflags", "+faststart", "-an", `${stem}.mp4`]);
    let width = 1280;
    for (const crf of [38, 42, 46, 50, 54]) {
      execFileSync(FFMPEG, [...base, "-vf", `fps=24,scale=${width}:-2:flags=lanczos,${fade},scale=out_range=tv,format=yuv420p`, "-color_range", "tv", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-an", `${stem}.webm`]);
      if (size(`${stem}.webm`) <= WEBM_LIMIT) break;
      if (crf === 46) width = 960;
    }
    // The poster is the last frame, where the answer is on screen.
    const last = kept[kept.length - 1];
    const lastId = String(last.index).padStart(5, "0");
    const still = last.view ? path.join(this.dir, `${lastId}-c.jpg`) : path.join(this.dir, `${lastId}.jpg`);
    for (const [scale, q] of [[1280, 6], [1280, 9], [1280, 14], [1280, 20], [960, 10], [960, 16]]) {
      execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", still, "-vf", `scale=${scale}:-2:flags=lanczos`, "-q:v", String(q), `${stem}.jpg`]);
      if (size(`${stem}.jpg`) <= POSTER_LIMIT) break;
    }
    if (name === "code-dark") {
      const readmeGif = path.resolve(__dirname, "..", "..", ".github", "media", "demo-code.gif");
      try {
        execFileSync(FFMPEG, [
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

// Opens a workspace in a mode and starts a fresh conversation, whatever the app reopened on.
async function openClip(page, id, mode) {
  await app.openWorkspace(page, id, mode);
  await app.inPage(page, (labels) => {
    const start = [...document.querySelectorAll("button, a, [role=button]")].find((n) => labels.some((label) => n.textContent.trim().startsWith(label)));
    start?.click();
  }, [T("newDiscussion"), T("newSession")]);
  await app.sleep(1200);
}

const generating = (page) => app.generating(page);
const buttonStarting = (label) => [...document.querySelectorAll("button")].find((n) => n.textContent.trim().startsWith(label));
const approving = (page) => app.inPage(page, (label) => [...document.querySelectorAll("button")].some((n) => n.textContent.trim().startsWith(label)), T("allowOnce"));

// Types a question like a person and sends it. The clip opens near the end of the typing: the first nine
// tenths go in at once, out of shot, and the rest is typed on camera.
async function ask(rec, text, { cut = true, rhythm = 1 } = {}) {
  await rec.clickOn(() => document.querySelector("[data-region=composer] form textarea"));
  if (cut) {
    const words = text.split(" ");
    let head = "";
    while (words.length > 1 && (head.length + words[0].length + 1) / text.length < 0.9) head += `${words.shift()} `;
    if (head) await rec.page.keyboard.insertText(head);
    await app.sleep(300);
    rec.cut();
    await rec.type(words.join(" "), rhythm);
  } else {
    await rec.type(text, rhythm);
  }
  await app.sleep(450 + Math.random() * 350);
  await rec.clickOn(() => document.querySelector("[data-region=composer] form button[type=submit]"));
}

// The model works. This is the part that is sped up.
async function work(rec, page, { allow = false } = {}) {
  rec.fast = true;
  await app.waitFor(() => generating(page), { timeout: 180_000, label: "the reply to start" });
  await app.waitFor(async () => {
    if (await approving(page)) {
      if (!allow) return true;
      rec.fast = false;
      return true;
    }
    return !(await generating(page));
  }, { timeout: 900_000, every: 400, label: "the reply" });
}

// Waits out a reply, allowing the agent onto a site for the session each time it asks.
async function workAllowingSites(rec, page) {
  for (;;) {
    await work(rec, page);
    const consent = await app.inPage(page, (label) => [...document.querySelectorAll("button")].some((n) => n.textContent.trim().startsWith(label)), T("browserConsentSession"));
    if (!consent) break;
    rec.fast = false;
    await app.sleep(900);
    await rec.clickOn((label) => [...document.querySelectorAll("button")].find((n) => n.textContent.trim().startsWith(label)), T("browserConsentSession"));
  }
  rec.fast = false;
}

async function dump(page, name) {
  if (!DUMP) return;
  fs.mkdirSync(DUMP, { recursive: true });
  fs.writeFileSync(path.join(DUMP, `${name}-${LANG}.html`), await page.evaluate("document.body.innerHTML"));
}

// Settings: open it from the sidebar, then a section in its menu.
async function openSettings(rec, section) {
  await rec.clickOn((label) => [...document.querySelectorAll("button, a")].find((n) => n.offsetParent && n.textContent.trim().startsWith(label)), T("settings"));
  await app.sleep(900);
  await rec.clickOn((label) => [...document.querySelectorAll("button, a")].filter((n) => n.offsetParent && n.textContent.trim() === label).pop(), section);
  await app.sleep(900);
}

// A month of shop orders, the file dropped on the chat in the attachment clip. One product comes back
// far more than the others, mostly in one week, so there is something to find.
function ordersCsv() {
  const products = [["Linen tea towel", 12], ["Ceramic mug", 18], ["Oak cutting board", 46], ["Wool throw", 89], ["Beeswax candle", 15], ["Enamel teapot", 54]];
  const rows = ["order_id,date,product,qty,unit_price,status"];
  let seed = 7;
  const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 160; i += 1) {
    const day = 1 + Math.floor(next() * 31);
    const [product, price] = products[Math.floor(next() * products.length)];
    const hot = product === "Enamel teapot" && day >= 13 && day <= 19;
    const status = next() < (hot ? 0.55 : 0.06) ? "returned" : "delivered";
    rows.push(`${10400 + i},2026-10-${String(day).padStart(2, "0")},${product},${1 + Math.floor(next() * 3)},${price}.00,${status}`);
  }
  return `${rows.join("\n")}\n`;
}

// Drops a file on the chat the way Explorer does, with a short drag in from the edge first.
async function dropFile(rec, page, name, type, text) {
  await rec.moveTo(1180, 520);
  await app.sleep(300);
  await rec.moveTo(760, 600);
  await app.inPage(page, ({ name, type, text }) => {
    // The form, not the textarea, so the file lands once on builds where both drop handlers ran.
    const target = document.querySelector("[data-region=composer] form");
    const data = new DataTransfer();
    data.items.add(new File([text], name, { type }));
    for (const kind of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: data }));
  }, { name, type, text });
  await app.sleep(1500);
}

/* ---------- what is typed, per language ---------- */

const PROMPTS = {
  en: {
    hero: "what's new in node 24? check the release notes and give me the highlights",
    research: "how long can I keep a sourdough starter in the fridge without feeding it? link where you read it",
    code: "formatTemperature in src/format.ts should round to one decimal and add °C. can you change it and update tests/format.test.ts to match?",
    approval: "run the tests and tell me if anything fails",
    image: "can you paint my cat asleep on the windowsill",
    attach: "these are last month's orders. which product got returned the most, and was there a week where returns jumped?",
    mcp: "how do I add middleware to a next.js 15 app? go by the current docs",
    skills: "/headline-writer our public engineering blog post on moving CI from Jenkins to GitHub Actions. PR builds went from 25 minutes to 8 and we shut down three build servers. give me a few options and pick one",
    browser: "open the mdn page on 401 in the browser, what's the difference with a 403?",
    cloud: "open",
  },
  fr: {
    hero: "quoi de neuf dans node 24 ? regarde les notes de version et résume l'essentiel",
    research: "combien de temps je peux laisser un levain au frigo sans le nourrir ? mets les liens de tes sources",
    code: "formatTemperature dans src/format.ts devrait arrondir à une décimale et ajouter °C. tu peux le changer et mettre tests/format.test.ts à jour ?",
    approval: "lance les tests et dis-moi si quelque chose casse",
    image: "tu peux me peindre mon chat qui dort sur le rebord de la fenêtre",
    attach: "voici les commandes du mois dernier. quel produit a été le plus retourné, et y a-t-il une semaine où les retours ont grimpé ?",
    mcp: "comment ajouter un middleware dans une app next.js 15 ? appuie-toi sur la doc à jour",
    skills: "/headline-writer l'article de notre blog technique public sur le passage de Jenkins à GitHub Actions. les builds de PR sont passés de 25 à 8 minutes et on a éteint trois serveurs de build. propose quelques titres et choisis-en un",
    browser: "ouvre la page mdn sur la 401 dans le navigateur, c'est quoi la différence avec une 403 ?",
    cloud: "open",
  },
  es: {
    hero: "¿qué hay de nuevo en node 24? mira las notas de la versión y dime lo más importante",
    research: "¿cuánto aguanta una masa madre en la nevera sin alimentarla? enlaza dónde lo leíste",
    code: "formatTemperature en src/format.ts debería redondear a un decimal y añadir °C. ¿puedes cambiarlo y actualizar tests/format.test.ts?",
    approval: "pasa los tests y dime si algo falla",
    image: "¿me pintas a mi gato dormido en la ventana?",
    attach: "estos son los pedidos del mes pasado. ¿qué producto se devolvió más y hubo alguna semana con un pico de devoluciones?",
    mcp: "¿cómo añado un middleware a una app de next.js 15? guíate por la documentación actual",
    skills: "/headline-writer el artículo de nuestro blog de ingeniería público sobre pasar de Jenkins a GitHub Actions. los builds de las PR bajaron de 25 a 8 minutos y apagamos tres servidores de build. dame algunas opciones y elige una",
    browser: "abre la página de mdn sobre el 401 en el navegador, ¿qué diferencia hay con un 403?",
    cloud: "open",
  },
  ru: {
    hero: "что нового в node 24? посмотри заметки к релизу и перескажи главное",
    research: "сколько закваска может простоять в холодильнике без подкормки? дай ссылки, где ты это прочитал",
    code: "formatTemperature в src/format.ts должна округлять до одного знака и добавлять °C. поменяешь её и обновишь tests/format.test.ts?",
    approval: "запусти тесты и скажи, если что-то падает",
    image: "нарисуй моего кота, который спит на подоконнике",
    attach: "это заказы за прошлый месяц. какой товар возвращали чаще всего и была ли неделя, когда возвратов стало резко больше?",
    mcp: "как добавить middleware в приложение на next.js 15? опирайся на свежую документацию",
    skills: "/headline-writer статья для нашего открытого инженерного блога о переходе с Jenkins на GitHub Actions. сборки PR ускорились с 25 до 8 минут, и мы отключили три сервера сборки. предложи несколько заголовков и выбери один",
    browser: "открой в браузере страницу mdn про 401, чем он отличается от 403?",
    cloud: "open",
  },
};
const P = (clip) => PROMPTS[LANG]?.[clip] || PROMPTS.en[clip];
const CSV_NAME = { en: "orders-october.csv", fr: "commandes-octobre.csv", es: "pedidos-octubre.csv", ru: "zakazy-oktyabr.csv" };

/* ---------- the clips ---------- */

const CLIPS = {
  // A question that needs the web: Draggy searches, opens pages, reads, and answers with sources.
  hero: {
    workspace: ["default", "chat"],
    speed: 8,
    async script(rec, page) {
      await ask(rec, P("hero"));
      await workAllowingSites(rec, page);
      await app.sleep(2000);
    },
  },
  // Research with sources, then a look at the steps and one of the pages it read.
  research: {
    workspace: ["default", "chat"],
    speed: 24,
    async script(rec, page) {
      await ask(rec, P("research"));
      await workAllowingSites(rec, page);
      await app.sleep(900);
      await dump(page, "research");
      await rec.clickOn(() => document.querySelector("[data-region=transcript] button[aria-expanded=false]"));
      await app.sleep(500);
      await rec.clickOn(() => document.querySelector("[data-region=transcript] a[href^=http]"));
      await app.sleep(1800);
    },
  },
  // A project in Code mode: the agent reads the files, edits two of them and shows the diff.
  code: {
    workspace: ["weather", "code"],
    reset: true,
    async script(rec, page) {
      await ask(rec, P("code"));
      // AGENTS.md in the demo project asks for `npm test`, so the run stops on the approval card.
      for (;;) {
        await work(rec, page);
        if (!(await approving(page))) break;
        rec.fast = false;
        await app.sleep(900);
        await rec.clickOn(buttonStarting, T("allowOnce"));
      }
      rec.fast = false;
      await app.sleep(2200);
    },
  },
  // A command waits for the person: the card, the press, the result.
  approval: {
    workspace: ["weather", "code"],
    reset: true,
    async script(rec, page) {
      await ask(rec, P("approval"));
      rec.fast = true;
      await app.waitFor(() => approving(page), { timeout: 150_000, every: 300, label: "the approval card" });
      rec.fast = false;
      await app.sleep(1400);
      await dump(page, "approval");
      for (;;) {
        await rec.clickOn(buttonStarting, T("allowOnce"));
        rec.fast = true;
        await app.waitFor(async () => (await approving(page)) || !(await generating(page)), { timeout: 600_000, every: 400, label: "the reply" });
        rec.fast = false;
        if (!(await approving(page))) break;
        await app.sleep(900);
      }
      await app.sleep(1500);
    },
  },
  // A picture from the local image model, drawn in the chat.
  image: {
    workspace: ["default", "chat"],
    speed: 10,
    // A model that never called the image tool draws SVG instead; that take does not count.
    check: (page) => app.inPage(page, () => Boolean(document.querySelector("[data-region=transcript] img"))),
    async script(rec, page) {
      await ask(rec, P("image"));
      await work(rec, page);
      rec.fast = false;
      await app.sleep(2500);
    },
  },
  // A file dropped on the chat and a question about it.
  attach: {
    workspace: ["default", "chat"],
    async script(rec, page) {
      await dropFile(rec, page, CSV_NAME[LANG] || CSV_NAME.en, "text/csv", ordersCsv());
      rec.cut();
      await ask(rec, P("attach"), { cut: false, rhythm: 0.6 });
      await work(rec, page);
      rec.fast = false;
      await app.sleep(2200);
    },
  },
  // Voice: the question is spoken, written into the box, and sent.
  voice: {
    workspace: ["default", "chat"],
    // A fresh profile downloads the speech model on first use; one unrecorded dictation loads it before the take.
    async prepare(page) {
      const mic = (label) => app.inPage(page, (l) => document.querySelector(`[data-region=composer] form button[aria-label^="${l}"]`)?.click(), label);
      const typed = () => app.inPage(page, () => document.querySelector("[data-region=composer] form textarea")?.value || "");
      await mic(T("voiceInput"));
      await app.sleep(4000);
      await mic(T("voiceListening"));
      await app.waitFor(async () => (await typed()).trim().length > 3, { timeout: 300_000, every: 500, label: "the speech model" });
      await app.inPage(page, () => {
        const box = document.querySelector("[data-region=composer] form textarea");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, "");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await app.sleep(800);
    },
    async script(rec, page) {
      await rec.clickOn((label) => document.querySelector(`[data-region=composer] form button[aria-label^="${label}"]`), T("voiceInput"));
      await app.sleep(1500);
      rec.fast = true;
      await app.sleep(5600);
      rec.fast = false;
      await rec.clickOn((label) => document.querySelector(`[data-region=composer] form button[aria-label^="${label}"]`), T("voiceListening"));
      await app.sleep(500);
      await app.waitFor(() => app.inPage(page, () => (document.querySelector("[data-region=composer] form textarea")?.value || "").trim().length > 3), { timeout: 30_000, every: 300, label: "the transcript" });
      await app.sleep(700);
      await rec.clickOn(() => document.querySelector("[data-region=composer] form button[type=submit]"));
      await work(rec, page);
      rec.fast = false;
      await app.sleep(2000);
    },
  },
  // An MCP server switched on in Settings, then used in the next question.
  mcp: {
    workspace: ["default", "chat"],
    speed: 12,
    async prepare(page) {
      await app.inPage(page, () => window.draggy?.mcp?.setEnabled?.("context7", false)).catch(() => {});
    },
    async script(rec, page) {
      await openSettings(rec, T("extensions"));
      const toggle = () => document.querySelector("[role=switch][aria-label='Context7 docs']");
      if (await app.inPage(page, () => document.querySelector("[role=switch][aria-label='Context7 docs']")?.getAttribute("aria-checked") === "true")) {
        await app.inPage(page, () => document.querySelector("[role=switch][aria-label='Context7 docs']").click());
        await app.sleep(1500);
      }
      await rec.clickOn(toggle);
      rec.fast = true;
      await app.waitFor(() => app.inPage(page, () => /·\s*\d/.test(document.querySelector("[role=switch][aria-label='Context7 docs']")?.closest("div:has(> div > p), li, [class*=rounded]")?.innerText || "") || /2 tools|2 outils|2 herramientas|2 инструмент/.test(document.body.innerText)), { timeout: 120_000, every: 400, label: "Context7 running" }).catch(() => log("context7 status not seen"));
      rec.fast = false;
      await app.sleep(1200);
      // The window's own Close button shares the label and comes first, so take the one under the title bar.
      await rec.clickOn((label) => [...document.querySelectorAll("button")].find((n) => n.offsetParent && n.getAttribute("aria-label") === label && n.getBoundingClientRect().y > 30), T("closeDialog"));
      await app.sleep(900);
      await ask(rec, P("mcp"), { cut: false, rhythm: 0.6 });
      await work(rec, page);
      rec.fast = false;
      await app.sleep(2200);
    },
  },
  // A skill picked from the slash menu, used on the request after it.
  skills: {
    workspace: ["default", "chat"],
    // Library skills start off, so switch this one on and reopen the chat to load the list again.
    async prepare(page) {
      await app.inPage(page, () => window.draggy.skills.setEnabled("headline-writer", true));
      await openClip(page, "default", "chat");
    },
    async script(rec, page) {
      await ask(rec, P("skills"));
      await work(rec, page);
      rec.fast = false;
      await app.sleep(2200);
    },
  },
  // Cloud models: the model menu leads to the providers, the accounts and the API keys.
  cloud: {
    workspace: ["default", "chat"],
    async script(rec, page) {
      await app.sleep(600);
      await rec.clickOn(() => [...document.querySelectorAll("[data-region=composer] form button")].find((n) => /Qwen|qwen/.test(n.textContent)));
      await app.sleep(1200);
      await rec.clickOn(buttonStarting, T("providers"));
      await app.sleep(2200);
      await rec.clickOn((label) => [...document.querySelectorAll("button")].find((n) => n.offsetParent && n.textContent.trim() === label), T("addProvider"));
      await app.sleep(900);
      await rec.type(P("cloud"));
      await app.sleep(1200);
      await rec.clickOn(() => [...document.querySelectorAll("button, [role=option]")].find((n) => n.offsetParent && n.textContent.trim() === "OpenRouter"));
      await app.sleep(2600);
    },
  },
  // Draggy's own browser: a link in the answer opens beside the chat.
  browser: {
    workspace: ["default", "chat"],
    watchPane: true,
    speed: 20,
    async script(rec, page) {
      await ask(rec, P("browser"));
      await workAllowingSites(rec, page);
      await app.sleep(500);
      await dump(page, "browser");
      const find = () => [...document.querySelectorAll("[data-region=transcript] a[href*='developer.mozilla.org'], [data-region=transcript] a[href^='http']")].pop();
      await rec.clickOn(find);
      await app.inPage(page, () => {
        [...document.querySelectorAll("[data-region=transcript] a[href*='developer.mozilla.org'], [data-region=transcript] a[href^='http']")].pop()?.click();
      });
      await app.waitFor(async () => Boolean(await app.panePage(rec.browser)), { timeout: 30_000, every: 200, label: "the browser pane" });
      const pane = await app.panePage(rec.browser);
      rec.fast = true;
      await app.waitFor(async () => {
        try {
          return (await pane.evaluate("document.body ? document.body.innerText : ''")).match(/40[13]/) && (await pane.screenshot({ type: "jpeg" })).length > 20_000;
        } catch {
          return false;
        }
      }, { timeout: 40_000, every: 300, label: "the page" }).catch(() => log("pane never painted blank-free"));
      rec.fast = false;
      await app.sleep(700);
      for (let i = 0; i < 3; i += 1) {
        await pane.evaluate("window.scrollBy({ top: 260, behavior: 'smooth' })").catch(() => {});
        await app.sleep(900);
      }
      await app.sleep(1200);
    },
  },
};

// The project is a scratch copy; put the demo files back so every take starts from the same state.
function resetProject(project, scratch) {
  if (!project.startsWith(scratch)) return;
  execFileSync("git", ["checkout", "--", "src", "tests"], { cwd: project, stdio: "ignore" });
  execFileSync("git", ["clean", "-fdq", "src", "tests"], { cwd: project, stdio: "ignore" });
}

// The first reply loads the model, which can take longer than the app waits. Loaded once, every clip starts warm.
async function warmUp(page) {
  await openClip(page, "default", "chat");
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await app.submitText(page, "Hi, are you there?");
    await app.sleep(3000);
    await app.waitFor(async () => !(await generating(page)), { timeout: 600_000, every: 1000, label: "the warm-up reply" });
    await app.sleep(1000);
    const failed = await app.inPage(page, (retry) => document.body.innerText.includes("too long to load") || [...document.querySelectorAll("button")].some((n) => n.textContent.trim() === retry), T("retry"));
    log("warm-up attempt", attempt, failed ? "failed" : "loaded");
    if (!failed) return;
    await app.inPage(page, (retry) => [...document.querySelectorAll("button")].find((n) => n.textContent.trim() === retry)?.click(), T("retry"));
    await app.sleep(3000);
    await app.waitFor(async () => !(await generating(page)), { timeout: 600_000, every: 1000, label: "the retry" });
    if (!(await app.inPage(page, () => document.body.innerText.includes("too long to load")))) return;
  }
  throw new Error("the model would not load");
}

const chatIds = (page) => app.inPage(page, async () => (await window.draggy.db.loadChats()).chats.map((c) => c.id));

// Each take leaves its session in the sidebar; drop it so the next take starts from the seeded history.
async function dropNewChats(page, keep) {
  const ids = await chatIds(page);
  await app.inPage(page, async (gone) => { for (const id of gone) await window.draggy.db.deleteChat(id); }, ids.filter((id) => !keep.includes(id)));
  await page.reload();
  await app.waitFor(() => app.inPage(page, () => Boolean(document.querySelector("[data-region=transcript], textarea"))), { timeout: 60_000, every: 500, label: "the window to reload" });
  await app.sleep(1500);
}

async function record(session, name, project) {
  const { page, browser, scratch } = session;
  const clip = CLIPS[name];
  let seconds = 0;
  let speed = SPEED;
  const keep = await chatIds(page);
  for (const tone of TONES) {
    for (let take = 1; take <= 3; take += 1) {
      if (clip.reset) resetProject(project, scratch);
      // A page left open in the Browser pane by the take before would sit over this one.
      await app.inPage(page, () => window.draggy?.browserPane?.setVisible?.(false)).catch(() => {});
      for (const other of browser.contexts().flatMap((context) => context.pages())) {
        if (other !== page && /^https?:/.test(other.url()) && !/5173|tauri\.localhost|index\.html/.test(other.url())) {
          await other.goto("about:blank").catch(() => {});
        }
      }
      await openClip(page, ...clip.workspace);
      if (clip.prepare) await clip.prepare(page);
      await app.setDark(page, tone === "dark");
      await app.hideStarNotice(page);
      const rec = new Recorder(page, browser);
      rec.scratch = scratch;
      rec.watchPane = Boolean(clip.watchPane);
      rec.speed = clip.speed || SPEED;
      speed = rec.speed;
      await rec.start(stemFor(name, tone));
      await app.sleep(400);
      try {
        await clip.script(rec, page);
      } finally {
        await rec.stop();
      }
      const hasErrors = await app.inPage(page, () => {
        const warning = Boolean(document.querySelector("[data-region=transcript] [role=alert]"));
        const failedBadge = [...document.querySelectorAll("[data-region=transcript] button, [data-region=transcript] span")].some((n) => /\bfailed\b/i.test(n.textContent));
        return warning || failedBadge;
      });
      const missed = clip.check ? !(await clip.check(page)) : false;
      if ((hasErrors || missed) && take < 3) {
        log(`${name}-${tone}: take ${take} showed failed steps, retrying...`);
        await dropNewChats(page, keep);
        continue;
      }
      seconds = await rec.encode(name, tone);
      await app.setDark(page, false);
      await dropNewChats(page, keep);
      break;
    }
  }
  if (LANG === "en") fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ seconds: Math.round(seconds * 10) / 10, speed, model: MODEL }));
}

const LOCALE = { en: "en-US", fr: "fr-FR", es: "es-ES", ru: "ru-RU" };

// One app per language: the window language, the seeded sidebar and the fake mic all follow it.
async function recordLanguage(lang) {
  LANG = lang;
  const project = { path: "" };
  const session = await app.launch({
    exe: flag("--exe", undefined),
    port: Number(flag("--port", process.env.DRAGGY_CDP_PORT || 9222)),
    scale: "1",
    lang: LOCALE[lang] || "en-US",
    prefix: "draggy-clips-",
    model: process.env.DRAGGY_SHOTS_MODEL || "Qwen3.6-35B-A3B-Q8_0.gguf",
    extraArgs: [...voiceArgs(lang), "--disable-features=CalculateNativeWinOcclusion"],
  });
  try {
    log("language", lang, "data folder", session.scratch);
    project.path = path.join(session.scratch, "weather-cli");
    app.writeDemoProject(project.path);
    await app.sizeWindow(session.page, WIDTH, HEIGHT, session.child);
    await app.seedProfile(session.page, { project: project.path, model: MODEL, language: lang });
    await app.waitFor(() => app.inPage(session.page, () => Boolean(document.querySelector("[data-region=composer] form"))), { label: "the chat screen" });
    await app.sleep(2000);
    const seeded = await chatIds(session.page);
    await warmUp(session.page);
    await dropNewChats(session.page, seeded);
    for (const name of Object.keys(CLIPS)) {
      if (!wanted(name)) continue;
      if (name === "voice" && !fs.existsSync(voiceWav(lang))) { log("no voice recording for", lang, "- skipped"); continue; }
      try {
        await record(session, name, project.path);
      } catch (error) {
        console.error(`[clips] ${lang} ${name} failed, skipping:`, error.message);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(`[clips] ${lang} failed:`, error.message);
    process.exitCode = 1;
    if (DUMP && session?.page) {
      await session.page.screenshot({ path: path.join(DUMP, `clips-fail-${lang}.png`) }).catch(() => {});
      console.error("[clips] page says:", await session.page.evaluate("document.body.innerText.slice(0,2500)").catch(String));
    }
  } finally {
    if (session) await session.close();
  }
}

(async () => {
  for (const lang of LANGS) await recordLanguage(lang);
})();
