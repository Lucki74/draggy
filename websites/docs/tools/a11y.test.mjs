/**
 * The built pages, run through axe-core in a real browser, with the WCAG 2.0 A and AA rules,
 * 2.1 AA and 2.2 AA. Any violation fails the test and is printed with its rule, its target and
 * what the rule asks for. Each page is checked in both colour schemes.
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
const require = createRequire(import.meta.url);

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
  return { skip: "Playwright is not installed (npm install -g playwright); skipping the axe checks" };
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

/** The WCAG levels the site is held to: 2.0 A and AA, 2.1 AA and 2.2 AA. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

const DOCS_PAGES = [
  { name: "home", en: "/", ru: "/ru/" },
  { name: "installation", en: "/installation", ru: "/ru/installation" },
  { name: "shortcuts", en: "/shortcuts", ru: "/ru/shortcuts" },
  { name: "development", en: "/development", ru: "/ru/development" },
  { name: "404", en: "/404.html", ru: "/ru/404.html" },
];

describe("axe-core on the docs pages, WCAG 2.2 AA", { skip: skip ?? false }, () => {
  let browser;
  let server;
  let base;
  let scratch;
  let axeSource;

  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), "draggy-docs-a11y-"));
    const out = join(scratch, "public");
    execFileSync(process.execPath, [join(root, "build.mjs")], {
      cwd: root,
      env: { ...process.env, DOCS_OUT: out },
      stdio: "pipe",
    });
    server = await serve(out);
    base = `http://127.0.0.1:${server.address().port}`;
    axeSource = require.resolve("axe-core");
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

  for (const colorScheme of ["light", "dark"]) {
    describe(`${colorScheme} colour scheme`, () => {
      let context;
      let page;

      before(async () => {
        context = await browser.newContext({ colorScheme, viewport: { width: 1440, height: 900 } });
        page = await context.newPage();
      });

      after(async () => {
        await context?.close();
      });

      const check = async (label) => {
        await page.evaluate(() => document.fonts.ready);
        await page.addScriptTag({ path: axeSource });
        const results = await page.evaluate(
          (tags) => axe.run(document, { runOnly: { type: "tag", values: tags } }),
          TAGS,
        );
        const failures = results.violations.flatMap((violation) =>
          violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}\n    ${violation.help}`),
        );
        assert.deepEqual(failures, [], `${label} (${colorScheme}):\n  ${failures.join("\n  ")}`);
      };

      for (const { name, en, ru } of DOCS_PAGES) {
        for (const [lang, path] of [["en", en], ["ru", ru]]) {
          test(`${name} (${lang}) has no violation`, async () => {
            const response = await page.goto(base + path, { waitUntil: "load" });
            assert.equal(response?.status(), 200, `${path} did not load`);
            await check(path);
          });
        }
      }

      test("the search dialog with results has no violation", async () => {
        await page.goto(`${base}/installation`, { waitUntil: "load" });
        await page.locator(".search-btn").click();
        await page.locator(".search-input").fill("model");
        await page.locator(".search-results a").first().waitFor();
        await check("search dialog");
      });

      test("the platform picker on another system has no violation", async () => {
        await page.goto(`${base}/installation`, { waitUntil: "load" });
        await page.locator('[role="tab"]').nth(1).click();
        await check("platform picker");
      });
    });
  }
});
