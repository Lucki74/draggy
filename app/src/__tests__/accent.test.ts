import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENTS, accentVars, contrast } from "../app/accent";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const css = readFileSync(path.join(__dirname, "..", "index.css"), "utf8");

describe("accent colours", () => {
  it("offers the seven colour-blind-safe colours, vermilion first", () => {
    expect(ACCENTS.map((one) => one.color)).toEqual(["#D55E00", "#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#F0E442"]);
  });

  it.each(ACCENTS.flatMap((one) => [[one.id, false] as const, [one.id, true] as const]))(
    "%s keeps its text readable (dark: %s)",
    (id, dark) => {
      const vars = accentVars(id, dark);
      const page = rgb(dark ? "#1e1e1e" : "#f5f5f5");
      expect(contrast(rgb(vars["--accent-ink"]), page)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(vars["--accent-text"]), rgb(vars["--accent"]))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("puts dark text on the light colours and white on the dark ones", () => {
    expect(accentVars("yellow", false)["--accent-text"]).toBe("#000000");
    expect(accentVars("sky", false)["--accent-text"]).toBe("#000000");
    expect(accentVars("blue", false)["--accent-text"]).toBe("#ffffff");
  });

  it("falls back to vermilion for an unknown id", () => {
    expect(accentVars("nope", false)["--accent"]).toBe("#d55e00");
  });

  it("matches the stylesheet defaults, so the first paint has no shift", () => {
    for (const dark of [false, true]) {
      for (const [name, value] of Object.entries(accentVars("vermilion", dark))) {
        if (name === "--accent-hover") continue;
        expect(css, `${name} ${dark ? "dark" : "light"}`).toContain(`${name}: ${value};`);
      }
    }
  });
});
