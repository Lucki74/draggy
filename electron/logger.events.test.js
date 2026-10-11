import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const logger = require("./logger.cjs");

let tempDir;

const sha8 = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
const fakeApp = () => ({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "1.2.7" });
const readLines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const readEvents = (file) => readLines(file).map((line) => JSON.parse(line));

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-events-test-"));
});

afterEach(async () => {
  await logger.closeStreams();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("events.jsonl", () => {
  it("writes one object per line with the documented fields", async () => {
    const { eventsFile, sessionId } = logger.init(fakeApp());
    logger.log.info("engine.llama", "ready", { port: 8080, durMs: 412.34, cid: "turn-1" });
    logger.log.warn("mcp.github", "slow handshake");
    await logger.flush();

    const events = readEvents(eventsFile);
    const ready = events.find((event) => event.msg === "ready");
    expect(ready).toMatchObject({
      level: "INFO",
      session: sessionId,
      proc: "engine",
      pid: process.pid,
      scope: "engine.llama",
      cid: "turn-1",
      durMs: 412.3,
      data: { port: 8080 },
    });
    expect(typeof ready.ts).toBe("string");
    expect(events.find((event) => event.scope === "mcp.github").proc).toBe("mcp:github");
  });

  it("numbers entries with a rising seq and stamps session and seq on the text lines", async () => {
    const { eventsFile, appFile, sessionId } = logger.init(fakeApp());
    for (let i = 0; i < 5; i++) logger.log.info("seqtest", `n${i}`);
    await logger.flush();

    const seqs = readEvents(eventsFile).map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(readLines(appFile).some((line) => line.includes(` ${sessionId}.`))).toBe(true);
  });

  it("hashes sensitive keys in events.jsonl like debug.log", async () => {
    const { eventsFile } = logger.init(fakeApp());
    logger.logEntry({ level: "INFO", context: "agent", message: "turn", data: { prompt: "my private question" } });
    await logger.flush();

    const text = fs.readFileSync(eventsFile, "utf8");
    expect(text).not.toContain("private question");
    expect(text).toContain(`sha256:${sha8("my private question")}`);
  });

  it("keeps the error code, status and cause chain", async () => {
    const { eventsFile, appFile } = logger.init(fakeApp());
    const root = Object.assign(new Error("connect refused"), { code: "ECONNREFUSED", errno: -111, syscall: "connect" });
    const mid = new Error("fetch failed", { cause: root });
    const top = Object.assign(new Error("provider call failed", { cause: mid }), { status: 502 });
    logger.log.fail("providers.openai", "request failed", top, { attempt: 2 });
    await logger.flush();

    const event = readEvents(eventsFile).find((entry) => entry.msg === "request failed");
    expect(event.level).toBe("ERROR");
    expect(event.err).toMatchObject({ message: "provider call failed", status: 502 });
    expect(event.err.cause.cause).toMatchObject({ code: "ECONNREFUSED", errno: -111, syscall: "connect" });
    expect(event.data).toEqual({ attempt: 2 });
    expect(fs.readFileSync(appFile, "utf8")).toContain("ECONNREFUSED");
  });
});

describe("secrets in log files", () => {
  it("never writes a key pattern, secret field or bearer token to any file", async () => {
    const { debugFile, appFile, eventsFile } = logger.init(fakeApp());
    const key = `sk-${"q1w2e3r4t5y6u7i8o9p0".repeat(2)}`;
    logger.log.error("providers", new Error(`401 for key ${key}`));
    logger.log.info("providers", `calling https://api.test/v1?key=${key}`);
    logger.logEntry({
      level: "INFO",
      context: "settings",
      message: "saved",
      data: { apiKey: key, nested: { token: "abc123xyz", url: `Bearer ${key}` } },
    });
    await logger.flush();

    for (const file of [debugFile, appFile, eventsFile]) {
      const text = fs.readFileSync(file, "utf8");
      expect(text).not.toContain(key);
      expect(text).not.toContain("abc123xyz");
      expect(text).not.toContain("q1w2e3r4t5y6u7i8o9p0");
    }
    expect(fs.readFileSync(eventsFile, "utf8")).toContain("[secret:apiKey]");
  });

  it("drops every value held by the keystore, whatever it looks like", async () => {
    const secrets = require("./secrets.cjs");
    const vault = {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text, "utf8"),
      decryptString: (buffer) => buffer.toString("utf8"),
    };
    secrets.init(tempDir, vault);
    secrets.set("server-a", { TOKEN_VALUE: "plain-looking-secret-1", OTHER: "second stored secret" });
    secrets.set("server-b", { PASS: "correct horse battery" });
    secrets.close();
    secrets.init(tempDir, vault);

    const { debugFile, appFile, eventsFile } = logger.init(fakeApp());
    for (const owner of secrets.owners()) {
      for (const [name, value] of Object.entries(secrets.get(owner))) {
        logger.log.info("mcp.test", `started with ${name}=${value}`, { env: { [name.toLowerCase()]: value } });
        logger.log.error("mcp.test", new Error(`bad env ${value}`));
      }
    }
    await logger.flush();

    expect(secrets.owners()).toHaveLength(2);
    for (const file of [debugFile, appFile, eventsFile]) {
      const text = fs.readFileSync(file, "utf8");
      for (const value of ["plain-looking-secret-1", "second stored secret", "correct horse battery"]) {
        expect(text).not.toContain(value);
      }
    }
    secrets.close();
  });
});

describe("levels", () => {
  afterEach(() => {
    delete process.env.DRAGGY_DEBUG;
    logger.setLevel({ level: "INFO", scopes: [], keep: false });
  });

  it("raises only the listed scopes to DEBUG in app.log", async () => {
    process.env.DRAGGY_DEBUG = "providers,mcp.github,ipc";
    const { appFile } = logger.init(fakeApp());
    logger.log.debug("providers.openai", "raised child");
    logger.log.debug("ipc.files", "raised ipc");
    logger.log.debug("mcp.github", "raised exact");
    logger.log.debug("mcp.gitlab", "not raised");
    logger.log.debug("providersx", "not a child scope");
    await logger.flush();

    const text = fs.readFileSync(appFile, "utf8");
    for (const msg of ["raised child", "raised ipc", "raised exact"]) expect(text).toContain(msg);
    expect(text).not.toContain("not raised");
    expect(text).not.toContain("not a child scope");
  });

  it("changes level at runtime without a restart and resets on the next boot", async () => {
    const first = logger.init(fakeApp());
    logger.log.debug("x", "before");
    logger.setLevel({ level: "DEBUG" });
    logger.log.debug("x", "during");
    await logger.flush();
    await logger.closeStreams();

    const text = fs.readFileSync(first.appFile, "utf8");
    expect(text).not.toContain("before");
    expect(text).toContain("during");

    const second = logger.init(fakeApp());
    expect(logger.getLevelState().level).toBe("INFO");
    logger.log.debug("x", "after reboot");
    await logger.flush();
    expect(fs.readFileSync(second.appFile, "utf8")).not.toContain("after reboot");
  });

  it("keeps verbose logging across boots only when asked", async () => {
    logger.init(fakeApp());
    logger.setLevel({ level: "DEBUG", keep: true });
    await logger.closeStreams();

    const second = logger.init(fakeApp());
    expect(logger.getLevelState()).toMatchObject({ level: "DEBUG", keep: true });
    logger.log.debug("x", "still verbose");
    await logger.flush();
    expect(fs.readFileSync(second.appFile, "utf8")).toContain("still verbose");
  });

  it("turns verbose logging off by itself after the duration", async () => {
    logger.init(fakeApp());
    logger.setLevel({ level: "DEBUG", durationMs: 30 });
    expect(logger.getLevelState().until).toBeGreaterThan(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(logger.getLevelState().level).toBe("INFO");
  });
});

describe("helpers", () => {
  it("log.swallow writes a DEBUG line with the reason and code, and swallowed() resolves to the fallback", async () => {
    const { eventsFile } = logger.init(fakeApp());
    logger.log.swallow("files", Object.assign(new Error("gone"), { code: "ENOENT" }), "temp file already removed");
    const fallback = await Promise.reject(new Error("x")).catch(logger.log.swallowed("files", "optional read", null));
    await logger.flush();

    const events = readEvents(eventsFile);
    expect(fallback).toBeNull();
    expect(events.find((e) => e.msg === "swallowed: temp file already removed")).toMatchObject({
      level: "DEBUG",
      scope: "files",
      data: { error: "gone", code: "ENOENT" },
    });
    expect(events.some((e) => e.msg === "swallowed: optional read")).toBe(true);
  });

  it("log.time records durMs, warns past the threshold and records failures", async () => {
    const { eventsFile } = logger.init(fakeApp());
    logger.log.time("engine.llama", "load", { model: "m" }).end({ ok: true });
    const slow = logger.log.time("engine.llama", "warm", {}, { warnMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    slow.end();
    logger.log.time("engine.llama", "bind", {}).fail(Object.assign(new Error("in use"), { code: "EADDRINUSE" }));
    await logger.flush();

    const events = readEvents(eventsFile);
    const load = events.find((e) => e.msg === "load");
    expect(load).toMatchObject({ level: "INFO", data: { model: "m", ok: true } });
    expect(typeof load.durMs).toBe("number");
    expect(events.find((e) => e.msg === "warm slow").level).toBe("WARN");
    expect(events.find((e) => e.msg === "bind failed")).toMatchObject({ level: "ERROR", err: { code: "EADDRINUSE" } });
  });

  it("log.once logs a key a single time", async () => {
    const { eventsFile } = logger.init(fakeApp());
    for (let i = 0; i < 5; i++) logger.log.once("missing-key:foo", "i18n", "missing translation", { key: "foo" });
    await logger.flush();

    expect(readEvents(eventsFile).filter((e) => e.msg === "missing translation")).toHaveLength(1);
  });

  it("log.limited collapses repeats into one summary line", async () => {
    const { eventsFile } = logger.init(fakeApp());
    for (let i = 0; i < 38; i++) logger.log.limited("hot", "WARN", "sse", "skipped event", undefined, 40);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await logger.flush();

    const messages = readEvents(eventsFile).map((e) => e.msg);
    expect(messages.filter((m) => m === "skipped event")).toHaveLength(1);
    expect(messages).toContain("skipped event repeated 37 times in 0 s");
  });

  it("log.swallow writes at DEBUG with the reason and the error code", async () => {
    const { eventsFile, appFile } = logger.init(fakeApp());
    logger.log.swallow("files", Object.assign(new Error("gone"), { code: "ENOENT" }), "temp file already removed");
    await logger.flush();

    const event = readEvents(eventsFile).find((e) => e.msg.startsWith("swallowed"));
    expect(event).toMatchObject({ level: "DEBUG", msg: "swallowed: temp file already removed", data: { code: "ENOENT", error: "gone" } });
    expect(fs.readFileSync(appFile, "utf8")).not.toContain("swallowed");
  });
});

describe("recent events", () => {
  it("dumps the last 100 lines as one record, without writing itself into the ring", async () => {
    const { eventsFile } = logger.init(fakeApp());
    for (let i = 0; i < 130; i++) logger.log.info("engine.llama", `step ${i}`, { cid: "t1" });
    logger.dumpRecent("test");
    logger.dumpRecent("again");
    await logger.flush();

    const dumps = readEvents(eventsFile).filter((event) => event.msg === "recent events before failure");
    expect(dumps).toHaveLength(2);
    const { recent, count } = dumps[0].data;
    expect(count).toBe(100);
    expect(recent).toHaveLength(100);
    expect(recent.at(-1)).toMatch(/step 129$/);
    expect(recent.at(-1)).toContain("[t1]");
    expect(recent.some((line) => line.includes("recent events"))).toBe(false);
  });
  it("reads DRAGGY_DEBUG from .env.local in development only", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-env-test-"));
    fs.writeFileSync(path.join(root, ".env.local"), 'OTHER=1\nDRAGGY_DEBUG="providers, mcp"\n');
    try {
      await logger.closeStreams();
      logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0", getAppPath: () => root, isPackaged: false });
      logger.log.debug("providers", "dev raised");
      logger.log.debug("engine", "dev not raised");
      await logger.flush();
      const text = fs.readFileSync(path.join(tempDir, "logs", "app.log"), "utf8");
      expect(text).toContain("dev raised");
      expect(text).not.toContain("dev not raised");
      await logger.closeStreams();
      logger.init({ getPath: () => tempDir, getName: () => "Draggy", getVersion: () => "0", getAppPath: () => root, isPackaged: true });
      logger.log.debug("providers", "packaged ignored");
      await logger.flush();
      expect(fs.readFileSync(path.join(tempDir, "logs", "app.log"), "utf8")).not.toContain("packaged ignored");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
