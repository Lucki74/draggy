import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.join(__dirname, "..", "index.css"), "utf8");

function tokens(block: string) {
  const body = css.slice(css.indexOf(block), css.indexOf("}", css.indexOf(block)));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The website transcribes these tokens, so its WCAG thresholds are checked where they are defined.
const PAIRS: [string, string, number][] = [
  ["text-main", "bg-base", 7],
  ["text-main", "bg-panel", 7],
  ["text-muted", "bg-base", 4.5],
  ["text-muted", "bg-panel", 4.5],
  ["accent-ink", "bg-base", 4.5],
  ["accent-ink", "bg-panel", 4.5],
  ["accent-text", "accent", 4.5],
  ["text-main", "accent-soft", 4.5],
  ["accent", "bg-base", 3],
  ["accent", "bg-panel", 3],
];

describe("the palette's contrast", () => {
  for (const [name, block] of [["light", ":root"], ["dark", "body.dark"]]) {
    it(`meets its thresholds in ${name}`, () => {
      const theme = { ...tokens(":root"), ...tokens(block) };
      for (const [fg, bg, need] of PAIRS) {
        expect(contrast(theme[fg], theme[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(need);
      }
    });
  }
});
