import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const themes = require("./theme.cjs");
const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("the window colour before the page paints", () => {
  it("reads the saved theme, and follows the system without one", () => {
    expect(themes.themeSetting('{"theme":"light"}')).toBe("light");
    expect(themes.themeSetting('{"theme":"dark"}')).toBe("dark");
    expect(themes.themeSetting('{"theme":"system"}')).toBe("system");
    for (const raw of [null, "", "{", '{"theme":"blue"}', '{"fontSize":"lg"}']) {
      expect(themes.themeSetting(raw), String(raw)).toBe("system");
    }
  });

  it("resolves the system theme from the operating system", () => {
    expect(themes.backgroundFor("system", true)).toBe(themes.BACKGROUNDS.dark);
    expect(themes.backgroundFor("system", false)).toBe(themes.BACKGROUNDS.light);
    expect(themes.backgroundFor("light", true)).toBe(themes.BACKGROUNDS.light);
    expect(themes.backgroundFor("dark", false)).toBe(themes.BACKGROUNDS.dark);
  });

  it("uses the page's own --bg-base, so the first paint does not change colour", () => {
    const css = fs.readFileSync(path.join(HERE, "..", "src", "index.css"), "utf8");
    const light = css.slice(css.indexOf(":root"), css.indexOf("body.dark"));
    const dark = css.slice(css.indexOf("body.dark"));
    expect(light).toMatch(new RegExp(`--bg-base:\\s*${themes.BACKGROUNDS.light};`, "i"));
    expect(dark).toMatch(new RegExp(`--bg-base:\\s*${themes.BACKGROUNDS.dark};`, "i"));
  });

  it("gives both of Draggy's own windows that colour, and keeps it in step with a saved change", () => {
    const main = fs.readFileSync(path.join(HERE, "main.cjs"), "utf8");
    for (const fn of ["function createSplashWindow()", "function createWindow("]) {
      const body = main.slice(main.indexOf(fn));
      expect(body.slice(0, body.indexOf("\n}")), fn).toContain("backgroundColor: windowBackground()");
    }
    const dbSet = main.slice(main.indexOf('ipcMain.handle("db:set"'));
    expect(dbSet.slice(0, dbSet.indexOf("\n}));"))).toContain("applyThemeSetting(value)");
  });
});
