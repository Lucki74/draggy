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
    expect(withPwsh.args).toEqual(expect.arrayContaining(["-ExecutionPolicy", "Bypass"]));
    expect(withPwsh.args.at(-1)).toMatch(/git status\nif \(\$\?\) \{ exit 0 \}.*exit \$LASTEXITCODE/);
    expect(without.shell).toBe("powershell");
  });

  it("prefers bash from Git for Windows, then the Default shell setting, then PowerShell", () => {
    const auto = commands.shellInvocation("ls", "default", { platform: "win32", find: found(["bash", "pwsh"]) });
    const chosen = commands.shellInvocation("ls", "default", {
      platform: "win32",
      defaultShell: "pwsh",
      find: found(["bash", "pwsh"]),
    });
    const missing = commands.shellInvocation("ls", "default", {
      platform: "win32",
      defaultShell: "bash",
      find: found(["pwsh"]),
    });

    expect(auto.shell).toBe("bash");
    expect(chosen.shell).toBe("pwsh");
    expect(missing.shell).toBe("pwsh");
    expect(missing.notice).toMatch(/bash is not installed/);
    expect(auto.notice).toBeUndefined();
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
      platform: "win32",
      find: found(["bash"]),
    });

    expect(invocation).toMatchObject({
      shell: "bash",
      args: ["--noprofile", "--norc", "-c", "ls -la"],
      env: { MSYS_NO_PATHCONV: "1" },
    });
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
    // A command handed to the task manager can hold its folder for a moment after it is killed.
    if (folder) fs.rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    folder = null;
  });

  // Git Bash may print a warning of its own before the answer, so read the last line only.
  const lastLine = (output) => output.trim().split(/\r?\n/).pop().trim();

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

  it("refuses a second command under an id that is still running, and keeps the first", async () => {
    const cwd = project();
    const first = commands.run({ id: "run-dup", cwd, command: 'node -e "setTimeout(() => {}, 60000)"' });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const second = await commands.run({ id: "run-dup", cwd, command: "node -e \"\"" });

    expect(second).toMatchObject({ success: false });
    expect(second.error).toMatch(/already running/);
    expect(commands.cancel("run-dup")).toBe(true);
    expect((await first).cancelled).toBe(true);
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

describe("carrying state to the next command", () => {
  let folder;
  const chat = () => `chat-${Math.random().toString(36).slice(2)}`;

  afterEach(() => {
    commands.stopAll();
    // A command handed to the task manager can hold its folder for a moment after it is killed.
    if (folder) fs.rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    folder = null;
  });

  // Git Bash may print a warning of its own before the answer, so read the last line only.
  const lastLine = (output) => output.trim().split(/\r?\n/).pop().trim();

  const project = () => {
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "draggy-state-")));
    fs.mkdirSync(path.join(folder, "sub"));
    return folder;
  };

  const shell = commands.findOnPath("bash") ? "bash" : "pwsh";
  const setVar = (value) => (shell === "bash" ? `export DG_TEST_VAR=${value}` : `$env:DG_TEST_VAR='${value}'`);
  const readVar = shell === "bash" ? "echo value=$DG_TEST_VAR" : "Write-Output \"value=$env:DG_TEST_VAR\"";
  const where = shell === "bash" ? "pwd -W 2>/dev/null || pwd" : "(Get-Location).Path";

  it("starts the next command where the last one ended", async () => {
    const cwd = project();
    const stateKey = chat();
    const first = await commands.run({ cwd, command: "cd sub", shell, stateKey });
    const second = await commands.run({ cwd, command: where, shell, stateKey });

    expect(first.success).toBe(true);
    expect(first.output).not.toMatch(/DG[0-9a-f]{12}/);
    expect(commands.fromShellPath(lastLine(second.output)).toLowerCase()).toContain(path.join(cwd, "sub").toLowerCase());
  }, 60_000);

  it("keeps an exported variable, and forgets it after a reset", async () => {
    const cwd = project();
    const stateKey = chat();
    await commands.run({ cwd, command: setVar("kept"), shell, stateKey });
    const kept = await commands.run({ cwd, command: readVar, shell, stateKey });
    commands.resetState(stateKey);
    const gone = await commands.run({ cwd, command: readVar, shell, stateKey });

    expect(kept.output).toContain("value=kept");
    expect(gone.output).toMatch(/value=\s*$/);
  }, 90_000);

  it("keeps chats apart", async () => {
    const cwd = project();
    await commands.run({ cwd, command: setVar("mine"), shell, stateKey: chat() });
    const other = await commands.run({ cwd, command: readVar, shell, stateKey: chat() });
    expect(other.output).not.toContain("mine");
  }, 60_000);

  it("keeps the exit code of the command, not of the report", async () => {
    const result = await commands.run({ cwd: project(), command: 'node -e "process.exit(4)"', shell, stateKey: chat() });
    expect(result.exitCode).toBe(4);
    expect(result.output).not.toMatch(/DG[0-9a-f]{12}/);
  }, 30_000);

  it("starts in the project folder again when a command left it", async () => {
    const cwd = project();
    const outside = fs.realpathSync(os.tmpdir());
    const stateKey = chat();
    const left = await commands.run({ cwd, command: `cd "${outside}"`, shell, stateKey });
    const next = await commands.run({ cwd, command: where, shell, stateKey });

    expect(left.outside).toBeTruthy();
    expect(commands.fromShellPath(lastLine(next.output)).toLowerCase()).toBe(cwd.toLowerCase());
  }, 60_000);

  it("hands a running command to the task manager at its time limit", async () => {
    const cwd = project();
    const adopted = { output: "", exit: null };
    const tasks = {
      adopt: ({ output }) => {
        adopted.output = output;
        return {
          task: { id: "t1" },
          push: (chunk) => (adopted.output += chunk),
          exit: (result) => (adopted.exit = result),
        };
      },
    };
    const result = await commands.run({
      cwd,
      command: 'node -e "console.log(111); setTimeout(() => console.log(222), 2500)"',
      shell,
      stateKey: chat(),
      timeoutMs: 1000,
      tasks,
      autoDetach: true,
    });

    expect(result).toMatchObject({ success: true, detached: true, taskId: "t1" });
    expect(result.output).toContain("111");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(adopted.output).toContain("222");
    expect(adopted.output).not.toMatch(/DG[0-9a-f]{12}/);
    expect(adopted.exit).toMatchObject({ code: 0 });
  }, 30_000);

  it("hands a command over when the user sends it away", async () => {
    const cwd = project();
    let kill = () => {};
    const tasks = {
      adopt: (taken) => {
        kill = taken.kill;
        return { task: { id: "t7" }, push: () => {}, exit: () => {} };
      },
    };
    const running = commands.run({
      id: "run-away",
      cwd,
      command: 'node -e "setTimeout(() => {}, 60000)"',
      shell,
      stateKey: chat(),
      tasks,
    });
    let sent = commands.detach("run-away");
    for (let tries = 0; !sent.success && tries < 40; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      sent = commands.detach("run-away");
    }

    expect(sent).toMatchObject({ success: true, taskId: "t7" });
    expect(await running).toMatchObject({ detached: true, taskId: "t7" });
    expect(commands.detach("run-away").success).toBe(false);
    kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 30_000);

  it("still stops a command at its limit when nothing can take it", async () => {
    const result = await commands.run({
      cwd: project(),
      command: 'node -e "setTimeout(() => {}, 60000)"',
      shell,
      stateKey: chat(),
      timeoutMs: 1000,
      autoDetach: true,
    });
    expect(result.timedOut).toBe(true);
  }, 30_000);
});
