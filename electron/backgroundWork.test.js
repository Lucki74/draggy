import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const main = fs.readFileSync(path.join(HERE, "main.cjs"), "utf8");

/** Long work keeps its pace when Draggy loses focus or is minimized: Chromium would otherwise
 * throttle the renderer's timers, and downloads and replies driven from it would crawl. */
function windowOptions(name) {
  const start = main.indexOf(`${name} = new BrowserWindow({`);
  expect(start).toBeGreaterThan(-1);
  return main.slice(start, main.indexOf("\n  });", start));
}

describe("background work", () => {
  it.each(["splashWindow", "mainWindow"])("%s is not throttled in the background", (name) => {
    expect(windowOptions(name)).toMatch(/backgroundThrottling:\s*false/);
  });
});
