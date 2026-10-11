import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");

let tempDir;

const sha8 = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-log-test-"));
});

afterEach(async () => {
  await logger.closeStreams?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("dual-target logging architecture", () => {
  it("initializes both debug.log and app.log", async () => {
    const fakeApp = {
      getPath: () => tempDir,
      getName: () => "Draggy",
      getVersion: () => "1.2.7",
    };

    const { debugFile, appFile } = logger.init(fakeApp);
    await logger.flush?.();

    expect(fs.existsSync(debugFile)).toBe(true);
    expect(fs.existsSync(appFile)).toBe(true);
  });

  it("filters debug messages out of app.log while keeping them in debug.log", async () => {
    process.env.APP_LOG_LEVEL = "INFO";
    process.env.DEBUG_LOG_LEVEL = "DEBUG";

    const fakeApp = {
      getPath: () => tempDir,
      getName: () => "Draggy",
      getVersion: () => "1.2.7",
    };

    const { debugFile, appFile } = logger.init(fakeApp);

    logger.log.debug("test-scope", "this is a verbose debug trace");
    logger.log.info("test-scope", "this is an operational info event");
    await logger.flush?.();

    const debugContent = fs.readFileSync(debugFile, "utf8");
    const appContent = fs.readFileSync(appFile, "utf8");

    expect(debugContent).toContain("this is a verbose debug trace");
    expect(debugContent).toContain("this is an operational info event");
    expect(appContent).not.toContain("this is a verbose debug trace");
    expect(appContent).toContain("this is an operational info event");
  });

  it("hashes sensitive payloads of any length in both debug.log and app.log", async () => {
    const fakeApp = {
      getPath: () => tempDir,
      getName: () => "Draggy",
      getVersion: () => "1.2.7",
    };

    const { debugFile, appFile } = logger.init(fakeApp);

    const longSecretPrompt = "Super confidential secret user prompt that contains very sensitive personal data!";
    const shortSecret = "my pin is 4821";
    logger.logEntry({
      level: "INFO",
      correlationId: "req-12345",
      context: "agentLoop.ts:execute",
      message: "Turn prompt received",
      data: { prompt: longSecretPrompt, text: shortSecret },
    });
    await logger.flush?.();

    const debugContent = fs.readFileSync(debugFile, "utf8");
    const appContent = fs.readFileSync(appFile, "utf8");

    for (const content of [debugContent, appContent]) {
      expect(content).toContain("[req-12345]");
      expect(content).not.toContain("Super confidential");
      expect(content).not.toContain("4821");
      expect(content).toContain(`[${longSecretPrompt.length} chars, sha256:${sha8(longSecretPrompt)}]`);
      expect(content).toContain(`[${shortSecret.length} chars, sha256:${sha8(shortSecret)}]`);
    }
  });

  it("hashes strings nested under a sensitive key, such as message content parts", async () => {
    const fakeApp = {
      getPath: () => tempDir,
      getName: () => "Draggy",
      getVersion: () => "1.2.7",
    };

    const { debugFile, appFile } = logger.init(fakeApp);

    logger.logEntry({
      level: "INFO",
      context: "agent",
      message: "step:turn_start",
      data: { input: { query: "where is my passport scan" }, content: [{ type: "text", value: "tax return 2025" }] },
    });
    await logger.flush?.();

    for (const content of [fs.readFileSync(debugFile, "utf8"), fs.readFileSync(appFile, "utf8")]) {
      expect(content).not.toContain("passport");
      expect(content).not.toContain("tax return");
      expect(content).toContain(`sha256:${sha8("where is my passport scan")}`);
    }
  });

  it("hashes a write tool's content in debug.log while keeping its path readable", async () => {
    const fakeApp = {
      getPath: () => tempDir,
      getName: () => "Draggy",
      getVersion: () => "1.2.7",
    };

    const { debugFile } = logger.init(fakeApp);

    const fileBody = "Dear landlord, I am writing about the deposit for flat 3B.";
    logger.logEntries([
      {
        level: "INFO",
        context: "tools",
        message: "writeFile:start",
        data: { path: "C:/Users/me/Documents/letters/landlord-deposit-letter.txt", content: fileBody },
      },
    ]);
    await logger.flush?.();

    const debugContent = fs.readFileSync(debugFile, "utf8");
    expect(debugContent).not.toContain("Dear landlord");
    expect(debugContent).toContain(`sha256:${sha8(fileBody)}`);
    expect(debugContent).toContain("C:/Users/me/Documents/letters/landlord-deposit-letter.txt");
  });

  it("truncates long non-sensitive strings in app.log only", async () => {
    const fakeApp = {
      getPath: () => tempDir,
      getName: () => "Draggy",
      getVersion: () => "1.2.7",
    };

    const { debugFile, appFile } = logger.init(fakeApp);

    const longPath = `C:/${"nested/".repeat(10)}file.txt`;
    logger.logEntry({ level: "INFO", context: "tools", message: "readFile:start", data: { path: longPath } });
    await logger.flush?.();

    expect(fs.readFileSync(debugFile, "utf8")).toContain(longPath);
    const appContent = fs.readFileSync(appFile, "utf8");
    expect(appContent).not.toContain(longPath);
    expect(appContent).toContain(`${longPath.slice(0, 50)}... [${longPath.length} chars, sha256:${sha8(longPath)}]`);
  });

  it("captures execution context and stack traces for errors", async () => {
    const fakeApp = {
      getPath: () => tempDir,
      getName: () => "Draggy",
      getVersion: () => "1.2.7",
    };

    const { debugFile, appFile } = logger.init(fakeApp);

    const testError = new Error("Simulated failure in test");
    logger.log.error("test-context", testError);
    await logger.flush?.();

    const debugContent = fs.readFileSync(debugFile, "utf8");
    const appContent = fs.readFileSync(appFile, "utf8");

    expect(debugContent).toContain("Simulated failure in test");
    expect(debugContent).toContain("Error: Simulated failure in test");
    expect(appContent).toContain("Simulated failure in test");
  });
});

const fakeApp = () => ({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "1.2.7" });

describe("rotation and counters", () => {
  afterEach(() => logger.setMaxBytes(0));

  it("keeps every file under the cap across two rotations and keeps writing to the live file", async () => {
    logger.setMaxBytes(4000);
    const { debugFile } = logger.init(fakeApp());
    for (let i = 0; i < 400; i++) logger.log.info("rotate", `line ${i} ${"x".repeat(40)}`);
    await logger.flush();

    const dir = path.dirname(debugFile);
    const sizes = fs.readdirSync(dir).filter((f) => f.startsWith("debug.log")).map((f) => fs.statSync(path.join(dir, f)).size);
    expect(sizes.length).toBeGreaterThan(2);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(4000);
    expect(fs.readFileSync(debugFile, "utf8")).toContain("line 399");
    expect(fs.existsSync(`${debugFile}.4`)).toBe(false);
  });

  it("seeds the byte counter from the file size when the stream opens", async () => {
    logger.setMaxBytes(4000);
    const dir = path.join(tempDir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "debug.log"), "y".repeat(3900));

    const { debugFile } = logger.init(fakeApp());
    for (let i = 0; i < 5; i++) logger.log.info("seed", `entry ${i} ${"z".repeat(60)}`);
    await logger.flush();

    expect(fs.statSync(debugFile).size).toBeLessThanOrEqual(4000);
    expect(fs.readFileSync(`${debugFile}.1`, "utf8").startsWith("yyyy")).toBe(true);
  });
});

describe("app.log error sanitizing", () => {
  it("cuts the error message and drops it from the stack header, but keeps it whole in debug.log", async () => {
    const { debugFile, appFile } = logger.init(fakeApp());
    const echoed = `provider said: ${"private request body ".repeat(20)}END`;
    logger.log.error("providers", new Error(echoed));
    await logger.flush();

    expect(fs.readFileSync(appFile, "utf8")).not.toContain("END");
    expect(fs.readFileSync(appFile, "utf8")).toContain("chars, sha256:");
    expect(fs.readFileSync(debugFile, "utf8")).toContain("END");
  });
});

describe("renderer entries", () => {
  it("forces the renderer namespace, clamps fields and drops malformed entries", async () => {
    const { appFile } = logger.init(fakeApp());
    logger.ingestRendererEntries([
      { level: "bogus", context: "main", message: "m".repeat(5000) },
      "not an object",
      null,
      { level: "WARN", context: "renderer.chat", message: "ok" },
    ]);
    await logger.flush();
    const text = fs.readFileSync(appFile, "utf8");

    expect(text).toContain("[renderer.main]");
    expect(text).toContain("[renderer.chat] ok");
    expect(text).not.toContain("m".repeat(2001));
    expect(text).toContain("renderer entries dropped");
  });

  it("caps a batch at 200 entries and a window at 1,000 entries per second, exactly", async () => {
    const { appFile } = logger.init(fakeApp());
    // Pin the clock: the window opens at the first call and closes one full second later.
    const start = Date.now() + 10_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    const batch = Array.from({ length: 500 }, (_, i) => ({ level: "INFO", context: "flood", message: `f${i}` }));
    const flooded = () => fs.readFileSync(appFile, "utf8").split("\n").filter((l) => l.includes("[renderer.flood]")).length;

    logger.ingestRendererEntries(batch);
    await logger.flush();
    expect(flooded()).toBe(200);
    for (let i = 0; i < 6; i++) logger.ingestRendererEntries(batch);
    await logger.flush();
    expect(flooded()).toBe(1000);

    clock.mockReturnValue(start + 1000);
    logger.ingestRendererEntries(batch);
    await logger.flush();
    expect(flooded()).toBe(1200);
    clock.mockRestore();
  });
});

describe("tail reads", () => {
  it("clamps the byte count to 2 MB and survives bad input", async () => {
    logger.init(fakeApp());
    logger.log.info("tail", "one line");
    await logger.flush();

    expect(logger.readTail("app", Number.MAX_SAFE_INTEGER)).toContain("one line");
    expect(logger.readTail("app", -5)).toBe("");
    expect(logger.readTail("app", "nope")).toContain("one line");
  });
});

describe("previous session check", () => {
  it("warns on the next boot when session-end is missing", async () => {
    const first = logger.init(fakeApp());
    await logger.closeStreams();
    const second = logger.init(fakeApp());
    await logger.flush();

    expect(second.previousCrashed).toBe(true);
    expect(fs.readFileSync(second.appFile, "utf8")).toContain(`previous session ${first.sessionId} ended without session-end`);
  });

  it("stays quiet after a clean end", async () => {
    logger.init(fakeApp());
    logger.endSession(true);
    await logger.closeStreams();
    const second = logger.init(fakeApp());
    await logger.flush();

    expect(second.previousCrashed).toBe(false);
    expect(fs.readFileSync(second.appFile, "utf8")).toContain("session-end");
    expect(fs.readFileSync(second.appFile, "utf8")).not.toContain("ended without session-end");
  });
});

describe("levels and terminal mirror", () => {
  it("reads the environment once at init", async () => {
    process.env.APP_LOG_LEVEL = "INFO";
    const { appFile } = logger.init(fakeApp());
    process.env.APP_LOG_LEVEL = "DEBUG";
    logger.log.debug("lvl", "should stay out of app.log");
    await logger.flush();
    process.env.APP_LOG_LEVEL = "INFO";

    expect(fs.readFileSync(appFile, "utf8")).not.toContain("should stay out of app.log");
  });

  it("mirrors INFO and WARN to the terminal only when the app is not packaged", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.init({ ...fakeApp(), isPackaged: true });
    logger.log.info("mirror", "packaged line");
    expect(spy).not.toHaveBeenCalled();

    logger.init({ ...fakeApp(), isPackaged: false });
    logger.log.warn("mirror", "dev line");
    expect(spy.mock.calls.some((call) => String(call[0]).includes("dev line"))).toBe(true);
    spy.mockRestore();
  });
});

// Each check below has its full version in logScrub.test.js or logger.events.test.js; these are the minimal reference.
describe("covered in logScrub.test.js and logger.events.test.js", () => {
  afterEach(() => logger.setLevel({ level: "INFO", scopes: [], keep: false }));

  it("scrubs one sample of a header, bearer, key and query secret", () => {
    const scrub = require("./logScrub.cjs");
    const key = `sk-ant-${"A1b2C3d4E5f6G7h8".repeat(2)}`;
    expect(scrub.scrubSecrets(`x ${key}`)).toBe("x [secret:anthropic-key]");
    expect(scrub.scrubSecrets("Authorization: Basic abcdefghijklmnop")).toBe("Authorization: [secret:authorization]");
    expect(scrub.scrubSecrets("GET /v1?access_token=abc123def456")).toBe("GET /v1?access_token=[secret:query]");
  });

  it("writes events.jsonl rows with level, session, proc, pid, scope, msg, ts and seq", async () => {
    const { eventsFile, sessionId } = logger.init(fakeApp());
    logger.log.info("shape", "row", { n: 1 });
    await logger.flush();

    const row = fs.readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((entry) => entry.msg === "row");
    expect(row).toMatchObject({ level: "INFO", session: sessionId, scope: "shape", msg: "row", data: { n: 1 } });
    expect(row).toEqual(expect.objectContaining({ ts: expect.any(String), proc: expect.any(String), pid: process.pid, seq: expect.any(Number) }));
  });

  it("raises a listed scope to DEBUG in app.log and leaves the others alone", async () => {
    const { appFile } = logger.init(fakeApp());
    logger.setLevel({ scopes: ["alpha"] });
    logger.log.debug("alpha.child", "scope raised");
    logger.log.debug("beta", "scope left alone");
    await logger.flush();

    const text = fs.readFileSync(appFile, "utf8");
    expect(text).toContain("scope raised");
    expect(text).not.toContain("scope left alone");
  });

  it("changes level at runtime without a restart", async () => {
    const { appFile } = logger.init(fakeApp());
    logger.setLevel({ level: "INFO" });
    logger.log.debug("runtime", "before change");
    logger.setLevel({ level: "DEBUG" });
    logger.log.debug("runtime", "after change");
    await logger.flush();

    const text = fs.readFileSync(appFile, "utf8");
    expect(text).not.toContain("before change");
    expect(text).toContain("after change");
  });
});
