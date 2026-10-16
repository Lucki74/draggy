import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const commands = require("./commands.cjs");

/** Commands in a project: which shell runs them, what comes back, and that a slow or abandoned one
 * does not keep running. */

describe("choosing the shell", () => {
  const found = (names) => (name) => (names.includes(name) ? `/fake/${name}` : null);

  it("runs PowerShell 7 on Windows when it is installed, and Windows PowerShell otherwise", () => {
    const withPwsh = commands.shellInvocation("git status", "default", {
      platform: "win32",
      find: found(["pwsh", "powershell"]),
    });
    const without = commands.shellInvocation("git status", "default", {
      platform: "win32",
      find: found(["powershell"]),
    });

    expect(withPwsh.shell).toBe("pwsh");
    expect(withPwsh.args).toContain("-NonInteractive");
    expect(withPwsh.args.at(-1)).toMatch(/git status$/);
    expect(without.shell).toBe("powershell");
  });

  it("runs the user's own shell as a login shell elsewhere", () => {
    const invocation = commands.shellInvocation("npm test", "default", {
      platform: "darwin",
      env: { SHELL: "/bin/zsh" },
      exists: () => true,
      find: found([]),
    });

    expect(invocation).toMatchObject({ shell: "zsh", file: "/bin/zsh", args: ["-lc", "npm test"] });
  });

  it("gives bash and sh the command with -c", () => {
    const invocation = commands.shellInvocation("ls -la", "bash", {
      platform: "linux",
      find: found(["bash"]),
    });

    expect(invocation).toMatchObject({ shell: "bash", args: ["-c", "ls -la"] });
  });

  it("keeps cmd's quoting as written, and only on Windows", () => {
    const windows = commands.shellInvocation('echo "hi"', "cmd", { platform: "win32", env: {} });
    const mac = commands.shellInvocation("dir", "cmd", { platform: "darwin", find: found([]) });

    expect(windows).toMatchObject({ shell: "cmd", verbatim: true });
    expect(windows.args.at(-1)).toBe('"echo "hi""');
    expect(mac.error).toMatch(/only available on Windows/);
  });

  it("says so when the shell asked for is not installed", () => {
    const invocation = commands.shellInvocation("ls", "bash", { platform: "linux", find: found([]) });
    expect(invocation.error).toMatch(/bash is not installed/);
  });

  it("treats an unknown shell as the default one", () => {
    const invocation = commands.shellInvocation("ls", "fish", { platform: "linux", env: {}, find: found(["bash"]) });
    expect(invocation.shell).toBe("bash");
  });
});

describe("what comes back", () => {
  it("keeps the start and the end of a long output", () => {
    const long = `START${"x".repeat(100_000)}END`;
    const clipped = commands.clip(long);

    expect(clipped.truncated).toBe(true);
    expect(clipped.text.startsWith("START")).toBe(true);
    expect(clipped.text.endsWith("END")).toBe(true);
    expect(clipped.text.length).toBeLessThan(commands.MAX_OUTPUT_CHARS + 100);
  });

  it("keeps a time limit between a second and ten minutes", () => {
    expect(commands.timeoutFor(undefined)).toBe(commands.DEFAULT_TIMEOUT_MS);
    expect(commands.timeoutFor(10)).toBe(1000);
    expect(commands.timeoutFor(10 ** 9)).toBe(commands.MAX_TIMEOUT_MS);
  });
});

describe("running a command", () => {
  let folder;

  afterEach(() => {
    commands.stopAll();
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    folder = null;
  });

  const project = () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-commands-"));
    return folder;
  };

  it("runs in the project folder and returns the output", async () => {
    const cwd = project();
    const result = await commands.run({
      cwd,
      command: 'node -e "console.log(21 * 2, process.cwd())"',
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("42");
    expect(result.output).toContain(path.basename(cwd));
  }, 30_000);

  it("reports a command that failed", async () => {
    const result = await commands.run({ cwd: project(), command: 'node -e "process.exit(3)"' });

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  }, 30_000);

  it("stops a command that runs past its limit", async () => {
    const started = Date.now();
    const result = await commands.run({
      cwd: project(),
      command: 'node -e "setTimeout(() => {}, 60000)"',
      timeoutMs: 1500,
    });

    expect(result.timedOut).toBe(true);
    expect(result.success).toBe(false);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it("stops a command when the turn is stopped", async () => {
    const running = commands.run({
      id: "run-1",
      cwd: project(),
      command: 'node -e "setTimeout(() => {}, 60000)"',
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(commands.cancel("run-1")).toBe(true);

    const result = await running;
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    expect(commands.cancel("run-1")).toBe(false);
  }, 30_000);

  it("refuses to run without a project folder", async () => {
    const result = await commands.run({ cwd: path.join(os.tmpdir(), "no-such-folder-draggy"), command: "ls" });
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/project folder/);
  });

  it("refuses an empty command", async () => {
    expect((await commands.run({ cwd: os.tmpdir(), command: "   " })).success).toBe(false);
  });
});
