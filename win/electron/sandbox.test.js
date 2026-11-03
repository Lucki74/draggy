import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const sandbox = require("./sandbox.cjs");

let workdir;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-sandbox-"));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("quoteArg", () => {
  it("leaves plain words alone", () => {
    expect(sandbox.quoteArg("abc")).toBe("abc");
  });

  it("quotes spaces, empties and embedded quotes", () => {
    expect(sandbox.quoteArg("a b")).toBe('"a b"');
    expect(sandbox.quoteArg("")).toBe('""');
    expect(sandbox.quoteArg('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("doubles trailing backslashes before the closing quote", () => {
    expect(sandbox.quoteArg("C:\\my dir\\")).toBe('"C:\\my dir\\\\"');
  });
});

describe("commandLine", () => {
  it("quotes each argument unless the line is verbatim", () => {
    expect(sandbox.commandLine("C:\\a b\\x.exe", ["-c", "a b"])).toBe('"C:\\a b\\x.exe" -c "a b"');
    expect(sandbox.commandLine("x.exe", ["/c", "echo  hi"], true)).toBe("x.exe /c echo  hi");
  });
});

describe("identity", () => {
  it("is stable per project and differs by access level", () => {
    expect(sandbox.identity(workdir, true)).toBe(sandbox.identity(workdir, true));
    expect(sandbox.identity(workdir, true)).toMatch(/^p[0-9a-f]{12}-rw$/);
    expect(sandbox.identity(workdir, false)).toMatch(/-ro$/);
  });
});

describe("toolchainFolders", () => {
  it("grants only the program's own folder", () => {
    const tools = path.join(workdir, "tools");
    fs.mkdirSync(tools);
    expect(sandbox.toolchainFolders(path.join(tools, "x.exe"), path.join(workdir, "home"))).toEqual([tools]);
  });

  it("never grants the home folder, a drive root or a credential folder", () => {
    expect(sandbox.toolchainFolders(path.join(workdir, "x.exe"), workdir)).toEqual([]);
    expect(sandbox.toolchainFolders(path.join(path.parse(workdir).root, "x.exe"))).toEqual([]);
    expect(sandbox.toolchainFolders(path.join(workdir, ".ssh", "x.exe"), path.join(workdir, "home"))).toEqual([]);
  });
});

describe("wrap", () => {
  it("refuses a folder outside the project", () => {
    if (!sandbox.available()) return;
    const project = path.join(workdir, "proj");
    fs.mkdirSync(project);
    const result = sandbox.wrap({ file: "cmd.exe", args: [], cwd: workdir, env: {} }, { project, dataDir: workdir });
    expect(result.error).toMatch(/outside the project/);
  });
});
