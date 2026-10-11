import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");
const platform = require("./platform.cjs");
const { describeArgs, shortenArg } = require("./spawnLog.cjs");

let tempDir;
let files;

const events = () =>
  fs
    .readFileSync(files.eventsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    await logger.flush();
    const found = events().find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("line never logged");
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-spawn-test-"));
  files = logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0" });
});

afterEach(async () => {
  await logger.closeStreams();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("spawn logging", () => {
  it("logs the spawn and a clean exit with pid and duration", async () => {
    platform.spawnHidden(process.execPath, ["-e", "process.exit(0)"], { cwd: tempDir });
    const spawned = await waitFor((e) => e.msg === "spawned");
    const exited = await waitFor((e) => e.msg.endsWith("exited"));

    expect(spawned).toMatchObject({ level: "INFO", scope: "proc.spawn", data: { bin: path.basename(process.execPath), cwd: tempDir } });
    expect(typeof spawned.data.pid).toBe("number");
    expect(exited).toMatchObject({ level: "INFO", data: { code: 0, pid: spawned.data.pid } });
    expect(exited.data.durMs).toBeGreaterThanOrEqual(0);
  });

  it("warns on a non-zero exit with the last 20 stderr lines", async () => {
    const script = "for (let i = 1; i <= 30; i++) console.error('line ' + i); process.exit(3)";
    platform.spawnHidden(process.execPath, ["-e", script]);
    const exited = await waitFor((e) => e.msg.endsWith("exited"));

    expect(exited.level).toBe("WARN");
    expect(exited.data.code).toBe(3);
    expect(exited.data.stderr).toHaveLength(20);
    expect(exited.data.stderr[0]).toBe("line 11");
    expect(exited.data.stderr[19]).toBe("line 30");
  });

  it("records the signal when a child is killed", async () => {
    const child = platform.spawnHidden(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await waitFor((e) => e.msg === "spawned");
    child.kill();
    const exited = await waitFor((e) => e.msg.endsWith("exited"));

    expect(exited.level).toBe("WARN");
    expect(exited.data.signal ?? exited.data.code).toBeTruthy();
  });

  it("names the resolved binary and whether it exists when the spawn fails", async () => {
    const missing = path.join(tempDir, "no-such-engine.exe");
    platform.spawnHidden(missing, []);
    const failed = await waitFor((e) => e.msg.includes("failed to start"));

    expect(failed.level).toBe("ERROR");
    expect(failed.err.code).toBe("ENOENT");
    expect(failed.data).toMatchObject({ resolved: missing, exists: false, bin: "no-such-engine.exe" });
  });

  it("logs a quiet success and a failure for the one-shot calls", async () => {
    await new Promise((resolve) => platform.execFileHidden(process.execPath, ["-e", "1"], {}, resolve));
    await new Promise((resolve) => platform.execFileHidden(process.execPath, ["-e", "console.error('bad'); process.exit(2)"], {}, resolve));
    const done = await waitFor((e) => e.scope === "proc.exec" && e.level === "DEBUG");
    const failed = await waitFor((e) => e.scope === "proc.exec" && e.level === "WARN");

    expect(done.data.bin).toBe(path.basename(process.execPath));
    expect(failed.data).toMatchObject({ code: 2 });
    expect(failed.data.stderr).toEqual(["bad"]);
  });

  it("passes the result of the one-shot call through unchanged", async () => {
    const result = await new Promise((resolve) =>
      platform.execFileHidden(process.execPath, ["-e", "process.stdout.write('hi')"], { encoding: "utf8" }, (error, stdout) => resolve({ error, stdout })),
    );
    expect(result).toEqual({ error: null, stdout: "hi" });
  });
});

describe("argument lists in the log", () => {
  it("shortens long paths, scrubs keys and hides the value after a secret flag", () => {
    const long = path.join(tempDir, "models", "family", "a-very-long-directory-name", "model-q4.gguf");
    const args = describeArgs(["-m", long, "--api-key", "hunter2hunter2", "--token=abc12345", "--url", "http://x/?key=sk-abcdefghijklmnopqrstuv"]);

    expect(args[0]).toBe("-m");
    expect(args[1]).toBe("…/a-very-long-directory-name/model-q4.gguf");
    expect(args.slice(2, 4)).toEqual(["--api-key", "[secret:arg]"]);
    expect(args[4]).toBe("--token=[secret:arg]");
    expect(args[6]).not.toContain("sk-abcdefghijklmnopqrstuv");
    expect(shortenArg("short")).toBe("short");
  });
});
