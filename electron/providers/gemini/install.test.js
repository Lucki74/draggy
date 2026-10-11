import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { VERSION, LOCK, installDir, installedEntry, ensureGemini } = require("./install.cjs");

let appData;
beforeEach(() => {
  appData = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-gemini-"));
});
afterEach(() => fs.rmSync(appData, { recursive: true, force: true }));

const npm = { file: "electron.exe", prefixArgs: ["C:/npm/bin/npm-cli.js"], asNode: true };
const entry = ["node_modules", "@google", "gemini-cli", "bundle", "gemini.js"];

/** Stands in for `npm ci`: writes the entry point where npm would, unless told to fail. */
function fakeRun({ code = 0 } = {}) {
  return vi.fn(async ({ cwd }) => {
    if (code === 0) {
      fs.mkdirSync(path.join(cwd, ...entry.slice(0, -1)), { recursive: true });
      fs.writeFileSync(path.join(cwd, ...entry), "// cli");
    }
    return { code, stderr: code ? "npm ERR! sha512 integrity checksum failed" : "" };
  });
}

describe("gemini install", () => {
  it("installs the pinned CLI from the lockfile the app ships, with no scripts and no optional packages", async () => {
    const run = fakeRun();
    const file = await ensureGemini(appData, { run, resolveNpm: () => npm });
    expect(file).toBe(path.join(installDir(appData), ...entry));
    expect(installDir(appData)).toBe(path.join(appData, "gemini", "cli", VERSION));
    const { cwd } = run.mock.calls[0][0];
    expect(run.mock.calls[0][0].npm).toBe(npm);
    expect(fs.existsSync(`${installDir(appData)}.part`)).toBe(false);
    expect(cwd).toBe(`${installDir(appData)}.part`);
    const lock = JSON.parse(fs.readFileSync(path.join(installDir(appData), "package-lock.json"), "utf8"));
    const cli = lock.packages["node_modules/@google/gemini-cli"];
    expect(cli.version).toBe(VERSION);
    expect(cli.integrity).toMatch(/^sha512-/);
    expect(JSON.parse(fs.readFileSync(path.join(LOCK, "package.json"), "utf8")).dependencies).toEqual({ "@google/gemini-cli": VERSION });

    expect(await ensureGemini(appData, { run, resolveNpm: () => npm })).toBe(file);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs npm ci through Electron as Node, never npx or a shim", () => {
    const source = fs.readFileSync(require.resolve("./install.cjs"), "utf8");
    expect(source).toContain('"ci", "--omit=optional", "--ignore-scripts"');
    expect(source).toContain("platform.spawnHidden(");
    expect(source).not.toMatch(/npx|\.cmd|"install"/);
  });

  it("keeps nothing from a failed install, and says so when npm is missing", async () => {
    await expect(ensureGemini(appData, { run: fakeRun({ code: 1 }), resolveNpm: () => npm })).rejects.toMatchObject({
      code: "account-runtime-unavailable",
      message: expect.stringContaining("integrity checksum failed"),
    });
    expect(fs.existsSync(`${installDir(appData)}.part`)).toBe(false);
    expect(installedEntry(appData)).toBeNull();

    const run = fakeRun();
    await expect(ensureGemini(appData, { run, resolveNpm: () => null })).rejects.toMatchObject({ code: "account-runtime-unavailable" });
    expect(run).not.toHaveBeenCalled();
  });

  it("installs once when two callers ask at the same time", async () => {
    const run = fakeRun();
    const [a, b] = await Promise.all([ensureGemini(appData, { run, resolveNpm: () => npm }), ensureGemini(appData, { run, resolveNpm: () => npm })]);
    expect(a).toBe(b);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
