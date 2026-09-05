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
    expect(main).toContain('app.on("before-quit", shutdown)');
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
