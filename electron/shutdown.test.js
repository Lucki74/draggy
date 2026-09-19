import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const runner = require("./runner.cjs");
const platform = require("./platform.cjs");
const { EventEmitter } = require("node:events");
const { FLUSH_CHANNEL, FLUSHED_CHANNEL, flushWindow } = require("./quitFlush.cjs");

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

  it("stops MCP servers, code runs and the local GGUF server on the way out", () => {
    const shutdown = main.slice(main.indexOf("function shutdown()"));
    const body = shutdown.slice(0, shutdown.indexOf("\n}"));

    for (const call of ["mcp.stopAll()", "runner.stopAll()", "llamaProcess.stopServerSync()", "embedServer.stopSync()"]) {
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

  it("lets the window flush its saves before storage closes", () => {
    const handler = main.slice(main.indexOf('app.on("before-quit"'));
    const body = handler.slice(0, handler.indexOf("\n});"));

    expect(body).toContain("event.preventDefault()");
    expect(body.indexOf("flushWindow(mainWindow, ipcMain)")).toBeGreaterThan(-1);
    expect(body.indexOf("flushWindow(")).toBeLessThan(body.indexOf("shutdown();"));
  });

  it("finishes every kill before Draggy exits", () => {
    // A kill left to run in the background is Draggy's child too, and dies
    // with it before it has done anything.
    const mcp = fs.readFileSync(path.join(HERE, "mcp.cjs"), "utf8");
    const runnerSource = fs.readFileSync(path.join(HERE, "runner.cjs"), "utf8");
    const llamaSource = fs.readFileSync(path.join(HERE, "llamaProcess.cjs"), "utf8");
    const stopRuns = runnerSource.slice(runnerSource.indexOf("function stopAll()"));

    expect(llamaSource).toContain("platform.killTreeSync(child)");
    expect(fs.readFileSync(path.join(HERE, "embedServer.cjs"), "utf8")).toContain("platform.killTreeSync(dying)");
    expect(mcp).toContain("stopServer(id, true)");
    expect(stopRuns.slice(0, stopRuns.indexOf("\n}"))).toContain("killTreeSync(child)");
  });

  it("closes in-app browser windows with the main window", () => {
    // window-all-closed only fires once every window has gone, so a browser
    // window left open kept the whole app alive with no main window.
    expect(main).toContain('mainWindow.on("closed", closeBrowserWindows)');
    expect(main).toContain('["browsers", closeBrowserWindows]');
  });

  it("kills process trees rather than lone children", () => {
    // A server or a script that spawned something leaves it behind otherwise.
    const mcp = fs.readFileSync(path.join(HERE, "mcp.cjs"), "utf8");
    expect(mcp).toContain("platform.killTree(entry.child)");
    expect(mcp).not.toContain("entry.child.kill()");
    expect(typeof platform.killTree).toBe("function");
  });
});

describe("waiting for the window to save before quitting", () => {
  function fakeWindow({ answer = true } = {}) {
    const ipcMain = new EventEmitter();
    const contents = new EventEmitter();
    const sent = [];

    Object.assign(contents, {
      isDestroyed: () => false,
      isCrashed: () => false,
      send(channel) {
        sent.push(channel);
        if (answer) setTimeout(() => ipcMain.emit(FLUSHED_CHANNEL, { sender: contents }), 20);
      },
    });

    const win = { isDestroyed: () => false, webContents: contents };
    return { win, ipcMain, contents, sent };
  }

  it("asks the window and resolves once it has saved", async () => {
    const { win, ipcMain, sent } = fakeWindow();

    await expect(flushWindow(win, ipcMain, 2000)).resolves.toBe(true);
    expect(sent).toEqual([FLUSH_CHANNEL]);
    expect(ipcMain.listenerCount(FLUSHED_CHANNEL)).toBe(0);
  });

  it("gives up after the timeout when the window never answers", async () => {
    const { win, ipcMain } = fakeWindow({ answer: false });
    const started = Date.now();

    await expect(flushWindow(win, ipcMain, 100)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(ipcMain.listenerCount(FLUSHED_CHANNEL)).toBe(0);
  });

  it("ignores an answer from another window", async () => {
    const { win, ipcMain } = fakeWindow({ answer: false });

    const flushed = flushWindow(win, ipcMain, 150);
    ipcMain.emit(FLUSHED_CHANNEL, { sender: new EventEmitter() });

    await expect(flushed).resolves.toBe(false);
  });

  it("stops waiting when the window goes away", async () => {
    const { win, ipcMain, contents } = fakeWindow({ answer: false });

    const flushed = flushWindow(win, ipcMain, 5000);
    contents.emit("destroyed");

    await expect(flushed).resolves.toBe(false);
  });

  it("does not wait at all without a window", async () => {
    const ipcMain = new EventEmitter();

    await expect(flushWindow(null, ipcMain)).resolves.toBe(false);
    await expect(flushWindow({ isDestroyed: () => true }, ipcMain)).resolves.toBe(false);
  });
});
