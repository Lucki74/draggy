/**
 * Turns the screenshots of the app into the AVIF and WebP copies the pages
 * actually serve, and writes their sizes to assets/img/shots.json so every
 * <img> can carry a width and a height.
 *
 *   npm run images
 *
 * The PNGs stay where they are: they are the source, the wiki still points at
 * them, and they are the last <source> a <picture> falls back to. Run this by
 * hand after retaking a screenshot, the same way the icon sprite is rebuilt.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "img");

/** Wide enough for the hero at 1140px on a sharp screen, no wider. */
const WIDTH = 1600;

// The wiki draws these screenshots through {{shot:name|alt}}, which build.mjs turns into a <picture>
// with AVIF and WebP sources and the PNG as the fallback. The home page shows clips instead. A new
// wiki screenshot goes here and in a template; the PNG pair must exist in both themes.
const SHOTS = [
  "app-mode-chat",
  "app-settings-general",
  "app-settings-downloads",
  "app-settings-code",
  "app-project",
  "app-browser",
  "app-talk",
  "app-skill-request",
];

const sizes = {};

for (const shot of SHOTS) {
  for (const tone of ["light", "dark"]) {
    const name = `${shot}-${tone}`;
    if (!readdirSync(dir).includes(`${name}.png`)) throw new Error(`${name}.png is missing`);

    const source = sharp(join(dir, `${name}.png`)).resize({ width: WIDTH, withoutEnlargement: true });
    const { info } = await source.clone().webp({ quality: 82 }).toFile(join(dir, `${name}.webp`)).then((info) => ({ info }));
    await source.clone().avif({ quality: 55, effort: 5 }).toFile(join(dir, `${name}.avif`));

    sizes[shot] ??= { width: info.width, height: info.height };
    if (sizes[shot].width !== info.width || sizes[shot].height !== info.height) {
      throw new Error(`${shot}: the light and dark shots are not the same size`);
    }
  }
}

writeFileSync(join(dir, "shots.json"), `${JSON.stringify(sizes, null, 2)}\n`);
console.log(`wrote ${SHOTS.length * 4} images and shots.json`);
