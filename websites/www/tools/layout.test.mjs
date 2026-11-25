/**
 * The built pages at phone and desktop widths, in a real browser. What is checked:
 *
 *   - the page does not scroll sideways (scrollWidth is no wider than the window);
 *   - every visible link, button, summary, input and tab is at least 24 by 24 CSS pixels, or
 *     has the 24-pixel spacing WCAG 2.5.8 allows instead (inline links in a sentence are
 *     exempt, as the same criterion allows);
 *   - headings never skip a level going down.
 *
 *   npm test
 *
 * Playwright is not a dependency of this repo. It is loaded from the global npm root, or from
 * a local install when there is one. Without it the file is skipped with a message.
 */
import { execSync, execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Playwright, from a local install if there is one, else from the global npm root. */
function loadPlaywright() {
  const bases = [import.meta.url];
  try {
    bases.push(join(execSync("npm root -g", { encoding: "utf8" }).trim(), "noop.js"));
  } catch {
    // no npm on the path; the local resolution still gets a try
  }
  for (const base of bases) {
    try {
      return { playwright: createRequire(base)("playwright") };
    } catch {
      // try the next place
    }
  }
  return { skip: "Playwright is not installed (npm install -g playwright); skipping the layout checks" };
}

const { playwright, skip } = loadPlaywright();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/** Serves `dir` on a random local port. An unknown path gets 404.html, as Vercel serves it. */
function serve(dir) {
  const server = createServer((request, response) => {
    let path;
    try {
      path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    let file = resolve(dir, `.${path}`);
    if (file !== dir && !file.startsWith(dir + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "Content-Type": TYPES[".html"] });
      response.end(readFileSync(join(dir, "404.html")));
      return;
    }
    response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

/**
 * The page's own checks, run inside the page. It has to be self-contained: Playwright sends the
 * function to the browser as text. It returns what is wrong, and nothing when all is well.
 */
function audit() {
  const width = window.innerWidth;
  const MIN = 24;

  const label = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).join(".")
      : "";
    const text = (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
  };

  /** Shown on screen: rendered, not transparent, not a 1px visually-hidden helper, and not off the page. */
  const shown = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
    if (el.getClientRects().length === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    return r.right > 0 && r.bottom > 0 && r.left < width;
  };

  /** A link inside a sentence is exempt from the size rule, as WCAG 2.5.8 allows for inline targets. */
  const inSentence = (el) =>
    getComputedStyle(el).display === "inline" &&
    el.textContent.trim().length > 0 &&
    el.parentElement.textContent.trim().length > el.textContent.trim().length;

  const offenders = [];

  const scrollWidth = document.documentElement.scrollWidth;
  if (scrollWidth > width) offenders.push(`scroll: the page is ${scrollWidth}px wide in a ${width}px window`);

  const targets = [...document.querySelectorAll("a, button, summary, input, [role=tab]")]
    .filter(shown)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const inline = inSentence(el);
      return {
        el,
        inline,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        width: r.width,
        height: r.height,
        undersized: !inline && (r.width < MIN || r.height < MIN),
      };
    });

  for (const a of targets) {
    if (!a.undersized) continue;
    const size = `${a.width.toFixed(1)}x${a.height.toFixed(1)}`;

    // The 24-pixel circle around the target's centre must not touch another target's box, nor the
    // circle of another undersized target. That is the spacing exception in WCAG 2.5.8.
    let crowd = null;
    for (const b of targets) {
      if (b === a || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const nearestX = Math.max(b.left, Math.min(a.cx, b.right));
      const nearestY = Math.max(b.top, Math.min(a.cy, b.bottom));
      if (Math.hypot(nearestX - a.cx, nearestY - a.cy) < MIN / 2) {
        crowd = b;
        break;
      }
      if (b.undersized && Math.hypot(b.cx - a.cx, b.cy - a.cy) < MIN) {
        crowd = b;
        break;
      }
    }

    if (crowd) offenders.push(`target ${label(a.el)} is ${size}px and its 24px circle touches ${label(crowd.el)}`);
    else offenders.push(`target ${label(a.el)} is ${size}px and has no 24px spacing`);
  }

  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((h) => h.getClientRects().length > 0);
  for (let i = 1; i < headings.length; i++) {
    const previous = Number(headings[i - 1].tagName[1]);
    const level = Number(headings[i].tagName[1]);
    if (level > previous + 1) offenders.push(`heading ${label(headings[i])} is h${level} after h${previous}, skipping a level`);
  }

  return offenders;
}

const PAGES = [
  { name: "home", en: "/", ru: "/ru/" },
  { name: "download", en: "/download", ru: "/ru/download" },
  { name: "privacy policy", en: "/privacy-policy", ru: "/ru/privacy-policy" },
  { name: "error index", en: "/error", ru: "/ru/error" },
  { name: "404", en: "/404.html", ru: "/ru/404.html" },
  { name: "open source", en: "/open-source", ru: "/ru/open-source" },
  { name: "compare", en: "/compare", ru: "/ru/compare" },
  { name: "accessibility", en: "/accessibility", ru: "/ru/accessibility" },
];

const WIDTHS = [320, 390, 1440];

describe("the built pages at 320, 390 and 1440 px", { skip: skip ?? false }, () => {
  let browser;
  let server;
  let base;
  let scratch;

  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), "draggy-layout-"));
    const out = join(scratch, "public");
    execFileSync(process.execPath, [join(root, "tools", "build.mjs")], {
      cwd: root,
      env: { ...process.env, DRAGGY_OFFLINE: "1", DRAGGY_OUT: out },
      stdio: "pipe",
    });
    server = await serve(out);
    base = `http://127.0.0.1:${server.address().port}`;
    try {
      browser = await playwright.chromium.launch();
    } catch {
      browser = await playwright.chromium.launch({ channel: "chrome" });
    }
  });

  after(async () => {
    await browser?.close();
    server?.closeAllConnections();
    server?.close();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  for (const width of WIDTHS) {
    describe(`at ${width} px`, () => {
      let page;

      before(async () => {
        page = await browser.newPage({ viewport: { width, height: 800 } });
      });

      after(async () => {
        await page?.close();
      });

      for (const { name, en, ru } of PAGES) {
        for (const [lang, path] of [["en", en], ["ru", ru]]) {
          test(`${name} (${lang}) is laid out without sideways scroll, small targets or skipped headings`, async () => {
            const response = await page.goto(base + path, { waitUntil: "load" });
            assert.equal(response?.status(), 200, `${path} did not load`);
            await page.evaluate(() => document.fonts.ready);
            const offenders = await page.evaluate(audit);
            assert.deepEqual(offenders, [], `${path} at ${width} px:\n  ${offenders.join("\n  ")}`);
          });
        }
      }
    });
  }
});
