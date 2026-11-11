import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const sandbox = require("./sandbox.cjs");
const { log } = require("./logger.cjs");

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

  it("passes extra variables to the command and puts extra folders on its PATH", () => {
    if (!sandbox.available()) return;
    const project = path.join(workdir, "proj");
    const python = path.join(workdir, "python");
    fs.mkdirSync(project);
    fs.mkdirSync(python);
    const extras = { readOnly: [python], path: [python], env: { PYTHONHOME: python } };
    const result = sandbox.wrap({ file: "cmd.exe", args: [], cwd: project, env: { PATH: "C:\\Windows" } }, { project, dataDir: workdir, extras });
    const spec = JSON.parse(fs.readFileSync(result.args[0], "utf8"));
    const env = Object.fromEntries(spec.env);
    expect(env.PYTHONHOME).toBe(python);
    expect(env.PATH.startsWith(python)).toBe(true);
    expect(spec.readOnly).toContain(python);
  });
});

describe("ready", () => {
  const launch = (key) => ({ grant: { key, spec: {}, specs: workdir } });

  it("grants each folder set once, however many commands wait on it", async () => {
    let calls = 0;
    let release;
    const slow = () => {
      calls += 1;
      return new Promise((resolve) => (release = resolve));
    };
    const first = sandbox.ready(launch("once"), slow);
    const second = sandbox.ready(launch("once"), slow);
    expect(sandbox.needsGrant(launch("once"))).toBe(true);
    release({});
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(sandbox.needsGrant(launch("once"))).toBe(false);
  });

  it("tries a failed grant again on the next command", async () => {
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.resolve({ error: "denied" });
    };
    expect(await sandbox.ready(launch("retry"), failing)).toEqual({ error: "denied" });
    await sandbox.ready(launch("retry"), failing);
    expect(calls).toBe(2);
  });

  it("lets an unsandboxed launch through at once", async () => {
    expect(sandbox.needsGrant({ file: "cmd.exe" })).toBe(false);
    expect(await sandbox.ready({ file: "cmd.exe" })).toEqual({});
  });
});

describe("listFolders", () => {
  const launch = { file: "draggy-sandbox.exe", grant: { cid: "chat" } };

  it("asks for admin once per app run, even after a decline", async () => {
    sandbox.resetAdminStep();
    const asked = [];
    const declining = (_launch, folders) => {
      asked.push(folders);
      return Promise.resolve({ success: false, declined: true });
    };
    await sandbox.listFolders(launch, ["C:\\Users", "C:\\", "C:\\Users"], declining);
    await sandbox.listFolders(launch, ["C:\\Users"], declining);
    expect(asked).toEqual([["C:\\Users", "C:\\"]]);
    sandbox.resetAdminStep();
  });

  it("checks each shell once per identity and remembers the ones that start", async () => {
    sandbox.resetAdminStep();
    const shellLaunch = (identity) => ({ file: "draggy-sandbox.exe", grant: { key: `shell-${identity}`, cid: "chat", spec: { identity } } });
    const checked = [];
    const check = (target) => {
      checked.push(target.grant.spec.identity);
      return Promise.resolve(target.grant.spec.identity === "ok");
    };
    const grant = () => Promise.resolve({});
    await sandbox.ready(shellLaunch("ok"), grant);
    await sandbox.ready(shellLaunch("bad"), grant);
    expect(await sandbox.shellWorks(shellLaunch("ok"), "pwsh", check)).toBe(true);
    expect(await sandbox.shellWorks(shellLaunch("ok"), "pwsh", check)).toBe(true);
    expect(await sandbox.shellWorks(shellLaunch("bad"), "bash", check)).toBe(false);
    expect(checked).toEqual(["ok", "bad"]);
    expect(sandbox.provenShells()).toEqual(["pwsh"]);
    sandbox.resetAdminStep();
  });

  it("reads the folders the launcher could not open", () => {
    expect(sandbox.NEEDS_ADMIN.exec("sandbox: needs-admin: C:\\Users")[1]).toBe("C:\\Users");
    expect(sandbox.NEEDS_ADMIN.test("sandbox: warning: no access granted to C:\\x (error 5)")).toBe(false);
  });
});

describe("sandbox logging", () => {
  it("logs a refusal at WARN with the chat id", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    try {
      const missing = path.join(workdir, "gone");
      const result = sandbox.wrap({ file: "cmd.exe", args: [], cwd: missing, env: {} }, { project: missing, dataDir: workdir, chatKey: "chat-7" });
      expect(result.error).toBeTruthy();
      expect(warn).toHaveBeenCalledWith("proc.sandbox", expect.any(String), expect.objectContaining({ cid: "chat-7", reason: expect.any(String) }));
    } finally {
      warn.mockRestore();
    }
  });

  it("removes spec files an earlier run left behind", () => {
    const specs = path.join(workdir, "sandbox", "specs");
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(path.join(specs, "old.json"), "{}");
    fs.writeFileSync(path.join(specs, "keep.txt"), "");
    expect(sandbox.sweepSpecs(workdir)).toBe(1);
    expect(fs.readdirSync(specs)).toEqual(["keep.txt"]);
  });
});
