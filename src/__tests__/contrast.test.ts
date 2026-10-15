import { describe, expect, it } from "vitest";

// Tokens from src/index.css
const TOKENS = {
  light: {
    "surface-canvas": "#f5f7f9",
    "surface-base": "#ffffff",
    "surface-raised": "#eaedf1",
    "surface-tint": "rgba(26, 30, 36, 0.05)",
    "rule-control": "rgba(26, 30, 36, 0.49)",
    "text-primary": "#1a1e24",
    "text-secondary": "#565b62",
    "text-tertiary": "#82878c",
    "action-bg": "#1a1e24",
    "action-fg": "#ffffff",
    "focus": "#1a1e24",
    "ok": "#1a763f",
    "warn": "#8d6310",
    "danger": "#bd1f3d",
    "ember-1": "#f9ad26",
    "ember-2": "#e75c00",
    "ember-3": "#cd3000",
  },
  dark: {
    "surface-canvas": "#0e1012",
    "surface-base": "#15171a",
    "surface-raised": "#1f2225",
    "surface-tint": "rgba(231, 234, 237, 0.06)",
    "rule-control": "rgba(231, 234, 237, 0.37)",
    "text-primary": "#e7eaed",
    "text-secondary": "#a6abb2",
    "text-tertiary": "#767b81",
    "action-bg": "#e7eaed",
    "action-fg": "#0e1012",
    "focus": "#e7eaed",
    "ok": "#78d694",
    "warn": "#e5d183",
    "danger": "#fa7f8e",
    "ember-1": "#ffeeb5",
    "ember-2": "#fd962c",
    "ember-3": "#f15d1f",
  },
};

type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function parseRgba(rgba: string): { r: number; g: number; b: number; a: number } {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) throw new Error(`Invalid rgba: ${rgba}`);
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

function composite(fgRgba: { r: number; g: number; b: number; a: number }, bgRgb: RGB): RGB {
  const a = fgRgba.a;
  return [
    Math.round(fgRgba.r * a + bgRgb[0] * (1 - a)),
    Math.round(fgRgba.g * a + bgRgb[1] * (1 - a)),
    Math.round(fgRgba.b * a + bgRgb[2] * (1 - a)),
  ];
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(rgb1: RGB, rgb2: RGB): number {
  const l1 = luminance(rgb1);
  const l2 = luminance(rgb2);
  const max = Math.max(l1, l2);
  const min = Math.min(l1, l2);
  return (max + 0.05) / (min + 0.05);
}

describe("WCAG 2.2 AA token contrast check", () => {
  const SURFACES = ["surface-canvas", "surface-base", "surface-raised"] as const;
  const TEXT_TOKENS = ["text-primary", "text-secondary", "ok", "warn", "danger"] as const;

  for (const theme of ["light", "dark"] as const) {
    const tokens = TOKENS[theme];

    it(`satisfies 4.5:1 text contrast for all reading tokens on all surfaces (${theme})`, () => {
      for (const surfaceName of SURFACES) {
        const bgRgb = parseHex(tokens[surfaceName]);
        for (const textToken of TEXT_TOKENS) {
          const fgRgb = parseHex(tokens[textToken]);
          const ratio = contrast(fgRgb, bgRgb);
          expect(
            ratio,
            `${theme} ${textToken} (${tokens[textToken]}) on ${surfaceName} (${tokens[surfaceName]}) got ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`satisfies 3:1 contrast for rule-control on all surfaces (${theme})`, () => {
      const fgRgba = parseRgba(tokens["rule-control"]);
      for (const surfaceName of SURFACES) {
        const bgRgb = parseHex(tokens[surfaceName]);
        const blended = composite(fgRgba, bgRgb);
        const ratio = contrast(blended, bgRgb);
        expect(
          ratio,
          `${theme} rule-control on ${surfaceName} got ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3.0);
      }
    });

    it(`satisfies 3:1 contrast for ember-2 graphic on all surfaces (${theme})`, () => {
      const emberRgb = parseHex(tokens["ember-2"]);
      for (const surfaceName of SURFACES) {
        const bgRgb = parseHex(tokens[surfaceName]);
        const ratio = contrast(emberRgb, bgRgb);
        expect(
          ratio,
          `${theme} ember-2 on ${surfaceName} got ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3.0);
      }
    });

    it(`satisfies 4.5:1 contrast for action pill button (${theme})`, () => {
      const bgRgb = parseHex(tokens["action-bg"]);
      const fgRgb = parseHex(tokens["action-fg"]);
      const ratio = contrast(fgRgb, bgRgb);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it(`satisfies 3:1 contrast for focus ring (${theme})`, () => {
      const focusRgb = parseHex(tokens["focus"]);
      for (const surfaceName of SURFACES) {
        const bgRgb = parseHex(tokens[surfaceName]);
        const ratio = contrast(focusRgb, bgRgb);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      }
    });
  }
});
