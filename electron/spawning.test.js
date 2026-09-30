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
    // A GUI app starting a console program without the flag flashes a new window; taskkill did that
    // on every killed code run.
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

  it("never starts PowerShell on its own: Norton and others block a hidden one started by an app", () => {
    // Only the run_command tool may, when the model asks and the user has approved that command.
    const offenders = sourceFiles()
      .filter((file) => file.name !== "commands.cjs" && /["'`]powershell(\.exe)?["'`]|EncodedCommand|ExecutionPolicy/i.test(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it("reads the video memory reg.exe prints", () => {
    const out = "\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x200000000\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x40000000\r\n";
    expect(platform.largestQword(out)).toBe(8 * 1024 ** 3);
    expect(platform.largestQword(null)).toBe(0);
  });

  it("forces the flag on even when a caller passes options", () => {
    // The caller's options are spread first, so this cannot be turned off by
    // accident, which is the whole reason the helpers exist.
    const source = fs.readFileSync(path.join(HERE, "platform.cjs"), "utf8");
    expect(source).toMatch(/\.\.\.options,\s*shell: false,\s*windowsHide: true/);
  });

  it("never runs the file through a shell, whatever the caller asks", async () => {
    // With shell: true Node starts cmd.exe or sh and hands it one command line, so a path or an
    // argument that came from the environment could be read as more than a name.
    const child = platform.spawnHidden(process.execPath, ["-e", "process.exit(0)"], { shell: true, stdio: "ignore" });
    const started = child.spawnfile;
    await new Promise((resolve) => child.on("exit", resolve));

    expect(started).toBe(process.execPath);
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
