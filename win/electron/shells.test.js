import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const shells = require("./shells.cjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Lookups answer from a fixed set of paths, so Git's location is tested on any machine. */
const existing = (...paths) => {
  const known = new Set(paths);
  return (candidate) => known.has(candidate);
};

describe("the shell list", () => {
  it("matches the list the renderer type is built from", () => {
    const source = fs.readFileSync(path.join(HERE, "..", "src", "terminal", "shells.ts"), "utf8");
    const block = /export const SHELL_IDS = \[([^\]]*)\]/.exec(source);
    const fromTypeScript = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(fromTypeScript).toEqual(shells.SHELL_IDS);
  });
});

describe("finding Git for Windows", () => {
  it("uses a standard install before anything on PATH", () => {
    const env = { ProgramFiles: "/pf", PATH: "/opt/Git/cmd" };
    const exists = existing(path.join("/pf", "Git", "cmd", "git.exe"), path.join("/opt", "Git", "cmd", "git.exe"));

    expect(shells.findGitRoot(env, exists)).toBe(path.join("/pf", "Git"));
  });

  it("derives the root from git.exe on PATH: ...\\Git\\cmd\\git.exe gives ...\\Git", () => {
    const env = { PATH: path.join("/opt", "Git", "cmd") };
    const exists = existing(path.join("/opt", "Git", "cmd", "git.exe"));

    expect(shells.findGitRoot(env, exists)).toBe(path.join("/opt", "Git"));
    expect(shells.findGitExe(env, exists)).toBe(path.join("/opt", "Git", "cmd", "git.exe"));
  });

  it("ignores a git.exe on PATH that is not in a Git for Windows folder", () => {
    const env = { PATH: path.join("/usr", "local", "bin") };
    expect(shells.findGitRoot(env, existing(path.join("/usr", "local", "bin", "git.exe")))).toBeNull();
  });

  it("finds nothing when Git is not installed", () => {
    expect(shells.findGitRoot({ ProgramFiles: "/pf", PATH: "/nowhere" }, () => false)).toBeNull();
    expect(shells.findGitExe({ PATH: "/nowhere" }, () => false)).toBeNull();
  });

  it("looks for bash in the Git root it derived, not in System32", () => {
    const env = { PATH: path.join("/opt", "Git", "cmd") };
    const exists = existing(path.join("/opt", "Git", "cmd", "git.exe"), path.join("/opt", "Git", "bin", "bash.exe"));

    expect(shells.findWindowsPosixShell("bash", env, exists)).toBe(path.join("/opt", "Git", "bin", "bash.exe"));
  });
});
