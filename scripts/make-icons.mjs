/**
 * Builds every icon from the drawings in build/, so they cannot drift apart.
 * The silhouette sits on a dark tile, or it vanishes on a light taskbar.
 */
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The white fill, since it sits on a dark tile. build/icon_dark.png is the
 * same drawing filled black, for anywhere a light background is guaranteed.
 */
const SOURCE = path.join(ROOT, "build", "icon_light.png");

/** The app's own dark surface, so the icon belongs to the app it opens. */
const TILE = "#1e1e1e";

/** Corner rounding, as a share of the icon's width. */
const RADIUS = 0.2;

/**
 * How much of the tile the drawing occupies. Small icons need the margin
 * trimmed or the dragon smudges; large ones can afford to breathe.
 */
const artShare = (size) => (size <= 32 ? 0.86 : size <= 64 ? 0.8 : 0.74);

/**
 * Windows draws the icon at every one of these, picking by context: 16 in the
 * title bar, 32 in the taskbar, 256 in large-icon views.
 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Beyond this, an entry goes in as a PNG; below it, as a bitmap. */
const ICO_PNG_FROM = 128;

const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];

/** The chunk name macOS looks for at each size. */
const ICNS_TYPES = [
  { type: "icp4", size: 16 },
  { type: "icp5", size: 32 },
  { type: "icp6", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic11", size: 32 },
  { type: "ic12", size: 64 },
  { type: "ic13", size: 256 },
  { type: "ic14", size: 512 },
];

/**
 * The drawing sits in a wide transparent margin. Scaling the whole canvas would
 * halve the dragon, so the margin is measured and cut away first.
 */
async function readArtwork() {
  const { data, info } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 10) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) throw new Error(`${SOURCE} is empty`);

  return sharp(SOURCE)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
}

/** The finished icon at one size: the drawing centred on its tile. */
async function compose(artwork, size) {
  const radius = (size * RADIUS).toFixed(2);
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${TILE}"/>` +
      `</svg>`,
  );

  const box = Math.max(1, Math.round(size * artShare(size)));
  const art = await sharp(artwork)
    .resize(box, box, {
      fit: "inside",
      kernel: "lanczos3",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer({ resolveWithObject: true });

  return sharp(tile)
    .composite([
      {
        input: art.data,
        top: Math.round((size - art.info.height) / 2),
        left: Math.round((size - art.info.width) / 2),
      },
    ])
    .png({ compressionLevel: 9 });
}

const png = async (artwork, size) => (await compose(artwork, size)).toBuffer();

const raw = async (artwork, size) =>
  (await compose(artwork, size)).ensureAlpha().raw().toBuffer();

/**
 * One image inside an .ico. The header doubles the height because the format
 * expects a one-bit mask; transparency comes from alpha, so it is left empty.
 */
function bitmapEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);

  const maskStride = Math.ceil(size / 32) * 4;
  const pixelBytes = size * size * 4;
  header.writeUInt32LE(pixelBytes + maskStride * size, 20);

  // Rows run bottom to top, and the channels are ordered blue first.
  const pixels = Buffer.alloc(pixelBytes);
  for (let y = 0; y < size; y++) {
    const from = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const source = from + x * 4;
      const target = (y * size + x) * 4;
      pixels[target] = rgba[source + 2];
      pixels[target + 1] = rgba[source + 1];
      pixels[target + 2] = rgba[source];
      pixels[target + 3] = rgba[source + 3];
    }
  }

  return Buffer.concat([header, pixels, Buffer.alloc(maskStride * size, 0)]);
}

async function buildIco(artwork) {
  const images = [];
  for (const size of ICO_SIZES) {
    images.push({
      size,
      data:
        size >= ICO_PNG_FROM
          ? await png(artwork, size)
          : bitmapEntry(await raw(artwork, size), size),
    });
  }

  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  images.forEach((image, index) => {
    const at = 6 + index * 16;
    // 256 does not fit in a byte and is written as nought by convention.
    directory[at] = image.size === 256 ? 0 : image.size;
    directory[at + 1] = image.size === 256 ? 0 : image.size;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });

  return Buffer.concat([directory, ...images.map((image) => image.data)]);
}

async function buildIcns(artwork) {
  const chunks = [];
  let total = 8;

  for (const { type, size } of ICNS_TYPES) {
    const data = await png(artwork, size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "ascii");
    head.writeUInt32BE(data.length + 8, 4);
    chunks.push(head, data);
    total += data.length + 8;
  }

  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

async function main() {
  const meta = await sharp(SOURCE).metadata();
  if (!meta.width || !meta.height) throw new Error(`${SOURCE} is unreadable`);

  const artwork = await readArtwork();

  const ico = await buildIco(artwork);
  await writeFile(path.join(ROOT, "build", "icon.ico"), ico);
  // The running app loads its window icon from beside the main process.
  await writeFile(path.join(ROOT, "electron", "icon.ico"), ico);

  await writeFile(path.join(ROOT, "build", "icon.icns"), await buildIcns(artwork));

  const linux = path.join(ROOT, "build", "icons");
  await mkdir(linux, { recursive: true });
  for (const size of LINUX_SIZES) {
    await writeFile(path.join(linux, `${size}x${size}.png`), await png(artwork, size));
  }

  // The mark the interface draws, without the tile: inside the app it takes
  // its colour from the text around it, so only the shape is needed.
  const inApp = path.join(ROOT, "src", "assets");
  await mkdir(inApp, { recursive: true });
  await writeFile(path.join(inApp, "dragon.png"), artwork);

  console.log(
    `icon.ico (${ICO_SIZES.length} sizes, ${(ico.length / 1024).toFixed(1)} kB), ` +
      `icon.icns, ${LINUX_SIZES.length} PNGs for Linux, and src/assets/dragon.png ` +
      `for the interface — all from ${path.basename(SOURCE)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
