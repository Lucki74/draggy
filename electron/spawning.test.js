import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const platform = require("./platform.cjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A call to one of these, not as a method, starts a process. */
const LAUNCHERS = /(?<![A-Za-z0-9_.])(spawn|spawnSync|execFile|execFileSync)\s*\(/g;

function sourceFiles() {
  return fs
    .readdirSync(HERE)
    .filter((name) => name.endsWith(".cjs"))
    .map((name) => ({ name, text: fs.readFileSync(path.join(HERE, name), "utf8") }));
}

describe("no console window ever appears", () => {
  it("starts every child process through the hidden helpers", () => {
    // A packaged Draggy is a GUI binary with no console, so a console program
    // started without the flag gets a new window and flashes it at the user.
    // taskkill was doing exactly that every time a code run was killed.
    const offenders = [];

    for (const file of sourceFiles()) {
      if (file.name === "platform.cjs") continue;

      const withoutImports = file.text.replace(/require\("child_process"\)/g, "");
      for (const match of withoutImports.matchAll(LAUNCHERS)) {
        offenders.push(`${file.name}: ${match[1]}()`);
      }
    }

    expect(offenders, "use platform.spawnHidden or platform.execFileHidden").toEqual([]);
  });

  it("forces the flag on even when a caller passes options", () => {
    // The caller's options are spread first, so this cannot be turned off by
    // accident, which is the whole reason the helpers exist.
    const source = fs.readFileSync(path.join(HERE, "platform.cjs"), "utf8");
    expect(source).toMatch(/\.\.\.options,\s*windowsHide: true/);
  });

  it("exposes both helpers", () => {
    expect(typeof platform.spawnHidden).toBe("function");
    expect(typeof platform.execFileHidden).toBe("function");
  });

  it("really starts a process rather than only configuring one", async () => {
    const child = platform.spawnHidden(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });

    const code = await new Promise((resolve) => child.on("exit", resolve));
    expect(code).toBe(0);
  });

  it("keeps the flag when the caller sets other options", () => {
    // spawnHidden merges rather than replaces, so cwd and stdio still arrive.
    const child = platform.spawnHidden(process.execPath, ["-e", ""], {
      stdio: "ignore",
      cwd: HERE,
    });
    expect(child.pid).toBeGreaterThan(0);
    child.kill();
  });
});
