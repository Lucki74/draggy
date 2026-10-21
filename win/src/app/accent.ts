/** The seven accents, from the Okabe-Ito colour-blind-safe palette. The first is the default. */
export const ACCENTS = [
  { id: "vermilion", color: "#D55E00" },
  { id: "blue", color: "#0072B2" },
  { id: "orange", color: "#E69F00" },
  { id: "green", color: "#009E73" },
  { id: "pink", color: "#CC79A7" },
  { id: "sky", color: "#56B4E9" },
  { id: "yellow", color: "#F0E442" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];
export const DEFAULT_ACCENT: AccentId = "vermilion";

/** The lightest-contrast surfaces the accent text sits on: `--bg-panel` in each theme. */
const PAGE = { light: "#f5f5f5", dark: "#1e1e1e" };
const AA = 4.5;

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: Rgb, b: Rgb, amount: number): Rgb => a.map((v, i) => v + (b[i] - v) * amount) as Rgb;

function luminance(rgb: Rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Moves the colour toward `target` until it reads at AA on `page`. */
function readable(color: Rgb, page: Rgb, target: Rgb): Rgb {
  let out = color;
  for (let step = 0; step < 20 && contrast(out, page) < AA; step++) out = mix(out, target, 0.1);
  return out;
}

export function accentColor(id: string | undefined) {
  return (ACCENTS.find((one) => one.id === id) ?? ACCENTS[0]).color;
}

/** Every accent variable for one accent in one theme. Soft, ink and hover come from the colour. */
export function accentVars(id: string | undefined, dark: boolean) {
  const base = toRgb(accentColor(id));
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];
  const page = toRgb(dark ? PAGE.dark : PAGE.light);
  const text = contrast(base, white) >= contrast(base, black) ? white : black;
  return {
    "--accent": toHex(base),
    "--accent-text": toHex(text),
    "--accent-ink": toHex(readable(base, page, dark ? white : black)),
    "--accent-soft": toHex(mix(page, base, dark ? 0.2 : 0.14)),
    "--accent-hover": toHex(mix(base, dark ? white : black, 0.14)),
  };
}

export function applyAccent(id: string | undefined, dark: boolean) {
  for (const [name, value] of Object.entries(accentVars(id, dark))) document.body.style.setProperty(name, value);
}
