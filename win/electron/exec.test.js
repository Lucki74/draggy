import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const exec = require("./exec.cjs");

const SLEEP = "setTimeout(() => {}, 60000)";
const MISSING = "draggy-no-such-binary-xyz";

describe("the environment children get", () => {
  it("turns off prompts, pagers and colour, and drops the packaged Node switch", () => {
    const env = exec.buildEnv({ GIT_PAGER: "less" }, { ELECTRON_RUN_AS_NODE: "1", PATH: "/bin" });

    expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GIT_PAGER: "less", PAGER: "cat", NO_COLOR: "1", TERM: "dumb", PATH: "/bin" });
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});

describe("runOnce", () => {
  it("returns the output and the code of a finished program", async () => {
    const result = await exec.runOnce({ file: process.execPath, args: ["-e", "process.stdout.write('hi'); process.exit(4)"] });

    expect(result).toMatchObject({ code: 4, stdout: "hi", missing: false, timedOut: false, truncated: false });
  });

  it("kills a program that runs past its timeout", async () => {
    const started = Date.now();
    const result = await exec.runOnce({ file: process.execPath, args: ["-e", SLEEP], timeoutMs: 800 });

    expect(result.timedOut).toBe(true);
    // A killed tree exits non-zero: taskkill on Windows, a signal elsewhere.
    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it("stops buffering at maxBuffer and says the output was cut", async () => {
    const result = await exec.runOnce({
      file: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(5000))"],
      maxBuffer: 100,
    });

    expect(result.truncated).toBe(true);
    expect(result.stdout).toBe("x".repeat(100));
    expect(result.code).toBe(0);
  });

  it("joins a multi-byte character whose bytes arrive in two writes", async () => {
    // The euro sign is E2 82 AC. The first byte goes out alone, so a decoder per chunk would print U+FFFD.
    const script = [
      "const { Buffer } = require('buffer');",
      "process.stdout.write(Buffer.from([0xe2]), () => {",
      "  setTimeout(() => process.stdout.write(Buffer.from([0x82, 0xac]), () => process.exit(0)), 200);",
      "});",
    ].join("\n");

    const result = await exec.runOnce({ file: process.execPath, args: ["-e", script] });

    expect(result.stdout).toBe("€");
    expect(result.code).toBe(0);
  }, 30_000);

  it("reports a program that is not installed as missing", async () => {
    const result = await exec.runOnce({ file: MISSING, args: [] });

    expect(result.missing).toBe(true);
    expect(result.code).toBeNull();
  });

  it("stops a running program when its signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const running = exec.runOnce({ file: process.execPath, args: ["-e", SLEEP], signal: controller.signal });

    setTimeout(() => controller.abort(), 500);
    const result = await running;

    expect(result.aborted).toBe(true);
    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it("does not start a program whose signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await exec.runOnce({ file: process.execPath, args: ["-e", SLEEP], signal: controller.signal });
    expect(result.aborted).toBe(true);
  });
});

describe("spawnStream", () => {
  it("reports a program that cannot start through onExit, with no code", async () => {
    const exit = await new Promise((resolve) => {
      exec.spawnStream({ file: MISSING, args: [] }, { onExit: resolve });
    });

    expect(exit.code).toBeNull();
    expect(exit.error).toBeInstanceOf(Error);
  });

  it("streams text per line and reports the exit", async () => {
    const chunks = [];
    const exit = await new Promise((resolve) => {
      exec.spawnStream(
        { file: process.execPath, args: ["-e", "console.log('one'); console.log('two')"] },
        { onStdout: (text) => chunks.push(text), onExit: resolve },
      );
    });

    expect(chunks.join("")).toBe("one\ntwo\n");
    expect(exit).toMatchObject({ code: 0, signal: null });
  });
});
