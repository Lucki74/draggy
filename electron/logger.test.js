import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");

let tempDir;

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

  it("sanitizes long sensitive payloads in app.log while preserving raw in debug.log", async () => {
    const fakeApp = {
      getPath: () => tempDir,
      getName: () => "Draggy",
      getVersion: () => "1.2.7",
    };

    const { debugFile, appFile } = logger.init(fakeApp);

    const longSecretPrompt = "Super confidential secret user prompt that contains very sensitive personal data!";
    logger.logEntry({
      level: "INFO",
      correlationId: "req-12345",
      context: "agentLoop.ts:execute",
      message: "Turn prompt received",
      data: { prompt: longSecretPrompt },
    });
    await logger.flush?.();

    const debugContent = fs.readFileSync(debugFile, "utf8");
    const appContent = fs.readFileSync(appFile, "utf8");

    // debug.log must have the exact prompt
    expect(debugContent).toContain(longSecretPrompt);
    expect(debugContent).toContain("[req-12345]");

    // app.log must have the prefix and sha256 truncation, not the full secret
    expect(appContent).not.toContain(longSecretPrompt);
    expect(appContent).toContain("Super confidential secret user prompt that contain");
    expect(appContent).toContain("sha256:");
    expect(appContent).toContain("[req-12345]");
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
