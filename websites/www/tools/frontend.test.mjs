/**
 * The client script, checked without a browser.
 *
 *   node --test tools/frontend.test.mjs
 *
 * site.js runs in a sandbox with just enough of a page to load. Its top-level functions are then
 * called from here, so the tests exercise the code as it ships. The static checks read public/,
 * so run `npm run build` first.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "assets", "js", "site.js"), "utf8");
const built = (file) => join(root, "public", file);

/**
 * Runs site.js with a stubbed page. Returns the sandbox, whose top-level functions and bindings are reachable.
 * A test that needs elements passes its own `page` in place of the empty one.
 */
function loadSite({ navigator = {}, paused = false, errors = [], page = null, storage = null } = {}) {
  const context = {
    console: { error: (error) => errors.push(error) },
    navigator: { userAgent: "", platform: "", maxTouchPoints: 0, ...navigator },
    document: page ?? {
      readyState: "loading",
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      body: { append() {} },
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    localStorage: storage ?? {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    addEventListener() {},
    innerHeight: 800,
    scrollY: 0,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "site.js" });
  return context;
}

const binding = (site, name) => vm.runInContext(name, site);

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  ipadOld: "Mozilla/5.0 (iPad; CPU OS 13_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};

/* ---------- which system is this ---------- */

test("an iPhone is not a Mac", () => {
  const site = loadSite({ navigator: { userAgent: UA.iphone, platform: "iPhone", maxTouchPoints: 5 } });
  assert.equal(site.detectOs(), null);
});

test("an iPad asking for the desktop site is not a Mac", () => {
  const site = loadSite({ navigator: { userAgent: UA.ipadDesktop, platform: "MacIntel", maxTouchPoints: 5 } });
  assert.equal(site.detectOs(), null);
});

test("an older iPad, which names itself, is not a Mac", () => {
  const site = loadSite({ navigator: { userAgent: UA.ipadOld, platform: "iPad", maxTouchPoints: 5 } });
  assert.equal(site.detectOs(), null);
});

test("a Mac with no touch screen is macOS, Intel or Apple silicon", () => {
  const site = loadSite({ navigator: { userAgent: UA.mac, platform: "MacIntel", maxTouchPoints: 0 } });
  assert.equal(site.detectOs(), "macos");
});

test("Client Hints name macOS when the platform is given there", () => {
  const site = loadSite({ navigator: { userAgent: UA.mac, platform: "", userAgentData: { platform: "macOS" } } });
  assert.equal(site.detectOs(), "macos");
});

test("Windows, Linux and Android are told apart", () => {
  assert.equal(loadSite({ navigator: { userAgent: UA.windows, platform: "Win32" } }).detectOs(), "windows");
  assert.equal(loadSite({ navigator: { userAgent: UA.linux, platform: "Linux x86_64" } }).detectOs(), "linux");
  assert.equal(loadSite({ navigator: { userAgent: UA.android, platform: "Linux armv8l", maxTouchPoints: 5 } }).detectOs(), null);
});

/* ---------- the most visible clip ---------- */

test("the most visible candidate wins, whatever the order", () => {
  const site = loadSite();
  const mostVisible = site.mostVisible;
  const a = { clip: "a", ratio: 0.72, gap: 10 };
  const b = { clip: "b", ratio: 1, gap: 300 };
  assert.equal(mostVisible([a, b]), b);
  assert.equal(mostVisible([b, a]), b);
});

test("a tie goes to the clip nearest the middle of the screen", () => {
  const { mostVisible } = loadSite();
  const far = { clip: "far", ratio: 1, gap: 200 };
  const near = { clip: "near", ratio: 1, gap: 20 };
  assert.equal(mostVisible([far, near]), near);
});

test("a clip under half visible is never picked, and nothing picked means null", () => {
  const { mostVisible } = loadSite();
  assert.equal(mostVisible([{ clip: "a", ratio: 0.49, gap: 0 }]), null);
  assert.equal(mostVisible([]), null);
  assert.equal(mostVisible([{ clip: "a", ratio: 0.5, gap: 0 }]).clip, "a");
});

/* ---------- which clip plays ---------- */

/** A clip with one take. The ratio is how much of it is in view; gap is its distance from the middle of the screen. */
function clipOn(site, { name, ratio, gap = 100, wanted = true, currentTime = 0, readyState = 4 }) {
  const video = {
    paused: true,
    currentTime,
    readyState,
    loads: 0,
    offsetParent: {},
    poster: "",
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
    load() {
      this.loads += 1;
      this.readyState = 0;
      this.currentTime = 0;
      this.paused = true;
    },
  };
  const clip = {
    name,
    frame: { getBoundingClientRect: () => ({ top: 250 + gap, height: 300 }) },
    videos: [video],
    toggle: null,
    expand: null,
    wanted,
  };
  binding(site, "clips").push(clip);
  binding(site, "ratios").set(clip, ratio);
  return clip;
}

function readySite(options) {
  const site = loadSite(options);
  vm.runInContext("loaded = true", site);
  return site;
}

test("two clips half in view: only the more visible one plays", () => {
  const site = readySite();
  const voice = clipOn(site, { name: "voice", ratio: 1, gap: 200 });
  const browser = clipOn(site, { name: "browser", ratio: 0.83, gap: 150 });
  site.settle();
  assert.equal(voice.videos[0].paused, false);
  assert.equal(browser.videos[0].paused, true);
});

test("as the page moves, the play moves to the clip now most in view", () => {
  const site = readySite();
  const voice = clipOn(site, { name: "voice", ratio: 1, gap: 200 });
  const browser = clipOn(site, { name: "browser", ratio: 0.83, gap: 150 });
  site.settle();
  binding(site, "ratios").set(voice, 0.4);
  binding(site, "ratios").set(browser, 0.9);
  site.settle();
  assert.equal(voice.videos[0].paused, true);
  assert.equal(browser.videos[0].paused, false);
});

test("a clip the visitor paused stays paused, and the next most visible one plays", () => {
  const site = readySite();
  const voice = clipOn(site, { name: "voice", ratio: 1, gap: 0, wanted: false });
  const browser = clipOn(site, { name: "browser", ratio: 0.9, gap: 150 });
  site.settle();
  assert.equal(voice.videos[0].paused, true);
  assert.equal(browser.videos[0].paused, false);
});

test("nothing plays before the page has loaded", () => {
  const site = loadSite();
  const voice = clipOn(site, { name: "voice", ratio: 1 });
  site.settle();
  assert.equal(voice.videos[0].paused, true);
});

/* ---------- the poster after a stop ---------- */

test("a clip stopped inside its fade-in reloads, so the poster comes back", () => {
  const site = readySite();
  const early = clipOn(site, { name: "early", ratio: 0, currentTime: 0.2, readyState: 4 });
  binding(site, "stop")(early);
  assert.equal(early.videos[0].loads, 1);
});

test("a clip stopped after its fade-in keeps the frame it is on", () => {
  const site = readySite();
  const late = clipOn(site, { name: "late", ratio: 0, currentTime: 2, readyState: 4 });
  binding(site, "stop")(late);
  assert.equal(late.videos[0].loads, 0);
});

test("a clip that never played is not reloaded", () => {
  const site = readySite();
  const fresh = clipOn(site, { name: "fresh", ratio: 0, currentTime: 0, readyState: 0 });
  binding(site, "stop")(fresh);
  assert.equal(fresh.videos[0].loads, 0);
});

/* ---------- the setups and the old Safari fallback ---------- */

test("a setup that throws does not stop the ones after it", () => {
  const errors = [];
  const site = loadSite({ errors });
  let ran = false;
  site.attempt(() => {
    throw new Error("broken setup");
  });
  site.attempt(() => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.equal(errors.length, 1);
});

test("the copy status is hidden by the script, since no stylesheet defines sr-only", () => {
  assert.match(source, /clip: "rect\(0 0 0 0\)"/);
});

test("a MediaQueryList without addEventListener gets its listener through addListener", () => {
  const site = loadSite();
  const seen = [];
  const old = { addListener: (listener) => seen.push(listener) };
  const listener = () => {};
  site.onChange(old, listener);
  assert.deepEqual(seen, [listener]);

  const modern = { added: [], addEventListener(type, fn) { this.added.push([type, fn]); } };
  site.onChange(modern, listener);
  assert.deepEqual(modern.added, [["change", listener]]);
});

/* ---------- the built page and the sources ---------- */

test("site.js never writes markup from a string", () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test("site.js uses no logical assignment, which Safari before 14 cannot parse", () => {
  assert.doesNotMatch(source, /\?\?=|\|\|=|&&=/);
});

test("site.js stays under 25 KB gzipped", () => {
  assert.ok(gzipSync(source, { level: 9 }).length < 25 * 1024);
});

test("the share text is a locale string, not written into the script", () => {
  assert.doesNotMatch(source, /Web research/);
  assert.match(source, /shareText/);
});

test("every locale has the share text and a menu name with a {name} slot", () => {
  for (const code of ["en", "fr", "es", "ru"]) {
    const strings = JSON.parse(readFileSync(join(root, "tools", "locales", `${code}.json`), "utf8"));
    assert.equal(typeof strings["js.shareText"], "string", `${code}: js.shareText`);
    assert.ok(strings["lang.named"].includes("{name}"), `${code}: lang.named has no {name}`);
  }
});

test("the strings block carries exactly the strings site.js reads", () => {
  for (const code of ["", "fr/", "es/", "ru/"]) {
    const page = built(`${code}index.html`);
    if (!existsSync(page)) throw new Error(`${page} is missing: run npm run build first`);
    const block = readFileSync(page, "utf8").match(/<script type="application\/json" id="draggy-strings">([^<]*)<\/script>/);
    assert.ok(block, `${code || "en/"}: no strings block`);
    const keys = Object.keys(JSON.parse(block[1])).sort();
    assert.deepEqual(keys, ["copied", "copy", "languageName", "shareText"], code || "en");
    for (const key of keys) assert.ok(source.includes(key), `site.js does not read ${key}`);
  }
});

test("the home page offers the Windows build while macOS and Linux are coming back soon", () => {
  const page = built("index.html");
  if (!existsSync(page)) throw new Error(`${page} is missing: run npm run build first`);
  const html = readFileSync(page, "utf8");
  const release = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));
  const win = release.assets["windows-exe"].url;
  const groups = html.match(/<div class="os-btn-group" data-os-match="windows">[\s\S]*?<\/div>/g) ?? [];
  assert.equal(groups.length, 1, "the hero has a Windows group");
  for (const group of groups) {
    assert.ok(group.includes(`href="${win}"`), "the primary button is the Windows build");
  }
});

/* ---------- the theme ---------- */

test("the theme follows the system alone: no switch, no stored key, no data-theme", () => {
  const home = readFileSync(built("index.html"), "utf8");
  assert.ok(!home.includes("data-theme-switch"), "no theme switch in the footer");
  assert.ok(!home.includes("draggy-theme"), "the head script stores and reads nothing");
  assert.ok(!readFileSync(join(root, "assets", "js", "site.js"), "utf8").includes("draggy-theme"));
  assert.ok(!readFileSync(join(root, "assets", "css", "site.css"), "utf8").includes("data-theme"));
});

test("no locale keeps the words of the removed theme switch", () => {
  for (const code of ["en", "fr", "es", "ru"]) {
    const strings = JSON.parse(readFileSync(join(root, "tools", "locales", `${code}.json`), "utf8"));
    for (const key of ["footer.theme", "footer.themeSystem", "footer.themeLight", "footer.themeDark"]) {
      assert.equal(strings[key], undefined, `${code}: ${key}`);
    }
  }
});
