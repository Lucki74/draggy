import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** electron-builder strips the build block from the package.json inside the asar, so reading it at
 * runtime works in dev and crashes the installed app on launch. */

describe("packaged package.json", () => {
  it("is never read for its build block by the main process", () => {
    const dir = __dirname;
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".cjs"))
      .filter((name) => /package\.json["'`]\)\s*\.build\b/.test(fs.readFileSync(path.join(dir, name), "utf8")));
    expect(offenders).toEqual([]);
  });
});
