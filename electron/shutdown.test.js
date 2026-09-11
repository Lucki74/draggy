import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const runner = require("./runner.cjs");
const platform = require("./platform.cjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("nothing Draggy started outlives it", () => {
  it("kills a code run that is still going", async () => {
    // A twenty-second budget outlives a quit, and the timer that would have
    // killed it dies with the process, so shutdown has to do it.
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-run-"));

    const run = runner.runCode({
      userDataPath,
      language: "javascript",
      source: "setInterval(() => {}, 1000);",
      timeoutMs: 120000,
    });

    await new Promise((resolve) => setTimeout(resolve, 700));
    runner.stopAll();

    const result = await run;
    expect(result.success).toBe(false);

    fs.rmSync(userDataPath, { recursive: true, force: true });
  }, 20000);

  it("leaves nothing running once stopAll has returned", async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-run-"));
    const pidFile = path.join(userDataPath, "pid");

    const run = runner.runCode({
      userDataPath,
      language: "javascript",
      source: `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);`,
      timeoutMs: 120000,
    });

    // The run only reports its pid once it is properly up.
    for (let i = 0; i < 40 && !fs.existsSync(pidFile); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    expect(alive(pid)).toBe(true);

    runner.stopAll();
    await run;

    for (let i = 0; i < 40 && alive(pid); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(alive(pid)).toBe(false);

    fs.rmSync(userDataPath, { recursive: true, force: true });
  }, 20000);

  it("takes the whole tree even when Draggy exits straight after", async () => {
    // What left every llama-server running: Ollama went, its runners did not,
    // because the taskkill that was to take them died with Draggy.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-tree-"));
    const pidFile = path.join(dir, "grandchild");
    const quitter = path.join(dir, "quitter.cjs");

    // Detached on Windows, as the runners effectively are: outside the job
    // that would otherwise take them down with their parent regardless.
    const grandchild = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const parent = `require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore", detached: process.platform === "win32" }); setInterval(() => {}, 1000);`;

    fs.writeFileSync(
      quitter,
      `const fs = require("fs");
const platform = require(${JSON.stringify(path.join(HERE, "platform.cjs"))});
const child = platform.spawnHidden(process.execPath, ["-e", ${JSON.stringify(parent)}], {
  stdio: "ignore",
  detached: !platform.IS_WINDOWS,
});
const wait = setInterval(() => {
  if (!fs.existsSync(${JSON.stringify(pidFile)})) return;
  clearInterval(wait);
  platform.killTreeSync(child);
  process.exit(0);
}, 50);
`,
    );

    const quit = platform.spawnHidden(process.execPath, [quitter], { stdio: "ignore" });
    await new Promise((resolve) => quit.on("exit", resolve));

    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    for (let i = 0; i < 20 && alive(pid); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const survived = alive(pid);
    if (survived) process.kill(pid);

    expect(survived).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);

  it("stops tracking a run that finished on its own", async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-run-"));

    const result = await runner.runCode({
      userDataPath,
      language: "javascript",
      source: "console.log('done');",
      timeoutMs: 10000,
    });
    expect(result.success).toBe(true);

    // Nothing is left to kill, so this is a no-op rather than a throw.
    expect(() => runner.stopAll()).not.toThrow();

    fs.rmSync(userDataPath, { recursive: true, force: true });
  }, 20000);
});

describe("shutdown covers every module that starts a process", () => {
  const main = fs.readFileSync(path.join(HERE, "main.cjs"), "utf8");

  it("stops MCP servers, code runs and its own Ollama on the way out", () => {
    const shutdown = main.slice(main.indexOf("function shutdown()"));
    const body = shutdown.slice(0, shutdown.indexOf("\n}"));

    for (const call of ["mcp.stopAll()", "runner.stopAll()", "stopOllama"]) {
      expect(body).toContain(call);
    }
  });

  it("runs every step even when one throws", () => {
    const shutdown = main.slice(main.indexOf("function shutdown()"));
    expect(shutdown.slice(0, shutdown.indexOf("\n}"))).toContain("catch");
  });

  it("is wired to before-quit", () => {
    const handler = main.slice(main.indexOf('app.on("before-quit"'));
    expect(handler.slice(0, handler.indexOf("\n});"))).toContain("shutdown();");
  });

  it("unloads its models from an Ollama it leaves running", () => {
    // Kept warm for half an hour otherwise, each one a llama-server.
    expect(main).toContain('ipcMain.on("model-in-use"');
    expect(main).toContain("keep_alive: 0");
  });

  it("finishes every kill before Draggy exits", () => {
    // A kill left to run in the background is Draggy's child too, and dies
    // with it before it has done anything.
    const mcp = fs.readFileSync(path.join(HERE, "mcp.cjs"), "utf8");
    const runnerSource = fs.readFileSync(path.join(HERE, "runner.cjs"), "utf8");
    const stopRuns = runnerSource.slice(runnerSource.indexOf("function stopAll()"));

    expect(main).toContain("platform.killTreeSync(child)");
    expect(mcp).toContain("stopServer(id, true)");
    expect(stopRuns.slice(0, stopRuns.indexOf("\n}"))).toContain("killTreeSync(child)");
  });

  it("closes in-app browser windows with the main window", () => {
    // window-all-closed only fires once every window has gone, so a browser
    // window left open kept the whole app alive with no main window.
    expect(main).toContain('mainWindow.on("closed", closeBrowserWindows)');
    expect(main).toContain('["browsers", closeBrowserWindows]');
  });

  it("never stops an Ollama it did not start", () => {
    // Killing a shared service out from under another client would be worse
    // than leaving it, so only the child Draggy spawned is touched.
    expect(main).toContain("if (!ollamaStartedHere) return;");
  });

  it("kills process trees rather than lone children", () => {
    // A server or a script that spawned something leaves it behind otherwise.
    const mcp = fs.readFileSync(path.join(HERE, "mcp.cjs"), "utf8");
    expect(mcp).toContain("platform.killTree(entry.child)");
    expect(mcp).not.toContain("entry.child.kill()");
    expect(typeof platform.killTree).toBe("function");
  });
});
