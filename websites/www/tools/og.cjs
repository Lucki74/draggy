/**
 * Renders tools/og-card.html to assets/img/og.png (English) and og-<code>.png
 * (fr, es, ru): the pictures that Discord, Slack and the rest show when somebody
 * pastes a link. The tagline and the line under it come from each language's
 * locale files, base file first and then its parts, the way tools/locales.mjs reads them.
 *
 * Run by hand with the global Playwright and its Chromium. The `playwright`
 * package must resolve from this folder (for example with NODE_PATH set):
 *
 *   node tools/og.cjs
 *
 * This used to run inside the old Electron app. The Tauri app has no Electron,
 * so the card is captured in Chromium at 1200 by 630 CSS pixels and 1x scale.
 */
const { readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const WIDTH = 1200;
const HEIGHT = 630;
const LANGUAGES = ["en", "fr", "es", "ru"];

const here = __dirname;
const card = join(here, "og-card.html");
const locales = join(here, "locales");

function strings(code) {
  const base = JSON.parse(readFileSync(join(locales, `${code}.json`), "utf8"));
  const parts = readdirSync(locales)
    .filter((file) => file.startsWith(`${code}.`) && file !== `${code}.json` && file.endsWith(".json"))
    .sort();
  for (const part of parts) {
    for (const [key, value] of Object.entries(JSON.parse(readFileSync(join(locales, part), "utf8")))) {
      if (value === null) delete base[key];
      else base[key] = value;
    }
  }
  return base;
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    for (const code of LANGUAGES) {
      const lookup = strings(code);
      await page.goto(pathToFileURL(card).href, { waitUntil: "load" });

      // The text is set after load, then the fonts and the screenshot are waited for,
      // so the card is not captured before its fonts and images are drawn.
      await page.evaluate(
        async ({ lookup, code }) => {
          document.documentElement.lang = code;
          for (const el of document.querySelectorAll("[data-t]")) el.textContent = lookup[el.dataset.t];
          await Promise.all([
            document.fonts.ready,
            ...[...document.images].map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {}))),
          ]);
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 200)));
        },
        { lookup, code },
      );

      const out = join(here, "..", "assets", "img", code === "en" ? "og.png" : `og-${code}.png`);
      writeFileSync(out, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }));
      console.log(`wrote ${out} at ${WIDTH}x${HEIGHT}`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
