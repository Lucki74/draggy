import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createAgyAdapter, locateAgy, judgeBuild, toPrompt, createEventReader, resultFailure } = require("./agy.cjs");

// Event shapes follow Google's documented headless stream-json output, not a capture from a live account.
const INIT = { event: "init", permission_mode: "request-review", tools: [{ name: "view_file" }] };
const delta = (text) => ({ event: "step_update", step_type: "agent_response", text_delta: text });
const SUCCESS = { event: "result", status: "SUCCESS", response: "hello there", usage: { input_tokens: 3, output_tokens: 2 } };
const lines = (events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

/** A fake `agy` process that prints `stdout`, writes `stderr` and exits with `code`. */
function fakeSpawn({ stdout = "", stderr = "", code = 0 } = {}) {
  const calls = [];
  const spawn = (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => child.emit("close", null));
    setImmediate(() => {
      child.stdout.write(stdout);
      child.stderr.write(stderr);
      child.emit("close", code);
    });
    return child;
  };
  return { spawn, calls };
}

const HELP = "Usage: agy [options]\n  -p, --print\n  --output-format <text|json|stream-json>\n  --print-timeout <duration>\n";
const execFake = (answers = {}) => (binary, args, options, callback) => {
  const key = args[0];
  const reply = answers[key] ?? (key === "--version" ? "agy 1.2.3\n" : key === "--help" ? HELP : "");
  callback(null, reply, "");
};

describe("locateAgy", () => {
  it("prefers DRAGGY_AGY_PATH and otherwise walks PATH", () => {
    const exists = (p) => p === path.join("/b", "agy.exe") || p === "/custom/agy.exe";
    expect(locateAgy({ env: { DRAGGY_AGY_PATH: "/custom/agy.exe" }, exists, isWindows: true })).toBe("/custom/agy.exe");
    expect(locateAgy({ env: { DRAGGY_AGY_PATH: "/missing" }, exists, isWindows: true })).toBeNull();
    expect(locateAgy({ env: { PATH: ["/a", "/b"].join(path.delimiter) }, exists, isWindows: true })).toBe(path.join("/b", "agy.exe"));
    expect(locateAgy({ env: { PATH: "/a" }, exists, isWindows: true })).toBeNull();
  });
});

describe("judgeBuild", () => {
  it("refuses a build without stream-json", () => {
    expect(judgeBuild({ version: "0.9", help: "Usage: agy -p" }).ok).toBe(false);
    expect(judgeBuild({ version: "0.9", help: "--output-format <text|json>" }).ok).toBe(false);
    expect(judgeBuild({ version: "1.2.3", help: HELP })).toEqual({ ok: true, version: "1.2.3" });
  });
});

describe("createEventReader", () => {
  it("reads events split across chunks and counts stray lines", () => {
    const seen = { deltas: [], strays: [], result: null, init: null };
    const reader = createEventReader({
      init: (e) => (seen.init = e),
      delta: (d) => seen.deltas.push(d),
      stray: (n) => seen.strays.push(n),
      result: (e) => (seen.result = e),
    });
    const text = lines([INIT, delta("he"), delta("llo"), SUCCESS]) + "not json\n";
    reader.push(text.slice(0, 40));
    reader.push(text.slice(40));
    reader.end();
    expect(seen.init.permission_mode).toBe("request-review");
    expect(seen.deltas).toEqual(["he", "llo"]);
    expect(seen.result.status).toBe("SUCCESS");
    expect(seen.strays).toEqual([8]);
  });
});

describe("resultFailure", () => {
  it("is null for success and Google's classification otherwise", () => {
    expect(resultFailure(SUCCESS)).toBeNull();
    const denied = { status: "ERROR", error: { code: 403, message: "Gemini CLI no longer serves this plan.", status: "PERMISSION_DENIED" } };
    expect(resultFailure(denied)).toMatchObject({ kind: "account-access-denied", status: 403 });
    expect(resultFailure({ status: "CANCELED" }).kind).toBe("provider-unknown-error");
  });
});

describe("toPrompt", () => {
  it("puts earlier turns before the new message and drops the oldest when too long", () => {
    const small = toPrompt([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(small.dropped).toBe(0);
    expect(small.prompt.endsWith("three")).toBe(true);
    expect(small.prompt).toContain("one");

    const big = toPrompt([
      { role: "user", content: "x".repeat(30_000) },
      { role: "assistant", content: "ok" },
      { role: "user", content: "last" },
    ]);
    expect(big.dropped).toBeGreaterThan(0);
    expect(big.prompt.length).toBeLessThan(24_000);
    expect(big.prompt.endsWith("last")).toBe(true);
  });
});

describe("the adapter", () => {
  let dir;
  let binary;
  const make = (extra = {}) =>
    createAgyAdapter({ appData: dir, confirm: async () => true, locate: () => binary, exec: execFake({ models: "gemini-3-pro  Gemini 3 Pro\nclaude-sonnet  Claude\n" }), env: {}, ...extra });
  const sseMock = () => ({ delta: vi.fn(), finish: vi.fn() });
  const body = { messages: [{ role: "user", content: "hi" }] };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-agy-"));
    binary = path.join(dir, "agy.exe");
    fs.writeFileSync(binary, "");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("stays off until the user accepts the warning", async () => {
    const adapter = make({ confirm: async () => false });
    expect(await adapter.signIn("x")).toMatchObject({ signedIn: false, cancelled: true });
    expect(await adapter.status()).toEqual({ signedIn: false });
    await expect(adapter.stream({ body, modelId: "m", sse: sseMock(), signal: null })).rejects.toMatchObject({ failure: { kind: "account-signed-out" } });
  });

  it("asks a user of the old Gemini CLI route to sign in again", async () => {
    fs.mkdirSync(path.join(dir, "gemini", "acct-1"), { recursive: true });
    const adapter = make({ spawn: fakeSpawn({ stdout: lines([INIT, SUCCESS]) }).spawn });
    expect(await adapter.status()).toEqual({ signedIn: false, reauth: true });
    await adapter.signIn("x");
    expect(await adapter.status()).toEqual({ signedIn: true });
    await adapter.signOut();
    expect(await adapter.status()).toEqual({ signedIn: false });
  });

  it("signs in only after a real turn succeeds, and streams text with usage", async () => {
    const { spawn, calls } = fakeSpawn({ stdout: lines([INIT, delta("hello "), delta("there"), SUCCESS]) });
    const adapter = make({ spawn });
    expect(await adapter.signIn("x")).toEqual({ signedIn: true });
    const sse = sseMock();
    await adapter.stream({ body, modelId: "gemini-3-pro", sse, signal: null });
    expect(sse.delta.mock.calls.map((c) => c[0].content).join("")).toBe("hello there");
    expect(sse.finish).toHaveBeenCalledWith("stop", expect.objectContaining({ promptTokens: 3, outputTokens: 2 }));
    const args = calls.at(-1).args;
    expect(args).toEqual(expect.arrayContaining(["--output-format", "stream-json", "--print-timeout", "--model", "gemini-3-pro"]));
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("does not sign in when the proof turn is refused with a 403", async () => {
    const denied = { event: "result", status: "ERROR", error: { code: 403, message: "Gemini CLI no longer serves this plan.", status: "PERMISSION_DENIED" } };
    const adapter = make({ spawn: fakeSpawn({ stdout: lines([INIT, denied]), code: 1 }).spawn });
    const answer = await adapter.signIn("x");
    expect(answer.signedIn).toBe(false);
    expect(answer.error).toContain("no longer serves");
  });

  it("surfaces the stderr reason of a non-zero exit with no result event", async () => {
    const ok = fakeSpawn({ stdout: lines([INIT, SUCCESS]) });
    const adapter = make({ spawn: ok.spawn });
    await adapter.signIn("x");
    const bad = make({ spawn: fakeSpawn({ stderr: '{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}', code: 1 }).spawn });
    await expect(bad.stream({ body, modelId: "m", sse: sseMock(), signal: null })).rejects.toMatchObject({ failure: { kind: "account-limit-reached", status: 429 } });
  });

  it("refuses a run when agy reports a permission mode that skips asking", async () => {
    const adapter = make({ spawn: fakeSpawn({ stdout: lines([INIT, SUCCESS]) }).spawn });
    await adapter.signIn("x");
    const risky = make({ spawn: fakeSpawn({ stdout: lines([{ ...INIT, permission_mode: "bypass" }, delta("x")]), code: 0 }).spawn });
    await expect(risky.stream({ body, modelId: "m", sse: sseMock(), signal: null })).rejects.toMatchObject({ failure: { message: expect.stringContaining("without asking") } });
  });

  it("refuses an agy build that cannot print stream-json", async () => {
    const adapter = make({ exec: execFake({ "--help": "Usage: agy -p <prompt>" }), spawn: fakeSpawn({ stdout: lines([INIT, SUCCESS]) }).spawn });
    const answer = await adapter.signIn("x");
    expect(answer.signedIn).toBe(false);
    expect(answer.error).toContain("stream-json");
  });

  it("says agy is missing instead of failing silently", async () => {
    const adapter = make({ locate: () => null });
    expect((await adapter.signIn("x")).error).toContain("not found");
  });

  it("lists the models agy offers once signed in, and forgets on sign-out", async () => {
    const adapter = make({ spawn: fakeSpawn({ stdout: lines([INIT, SUCCESS]) }).spawn });
    expect(await adapter.models()).toEqual([]);
    await adapter.signIn("x");
    expect((await adapter.models()).map((m) => m.id)).toEqual(["gemini-3-pro", "claude-sonnet"]);
    await adapter.signOut();
    expect(await adapter.status()).toEqual({ signedIn: false });
  });

  it("asks agy again on a refresh and keeps the list otherwise", async () => {
    let asked = 0;
    const exec = (binary, args, options, callback) => {
      if (args[0] === "models") asked += 1;
      execFake({ models: "gemini-3-pro  Gemini\n" })(binary, args, options, callback);
    };
    const adapter = make({ spawn: fakeSpawn({ stdout: lines([INIT, SUCCESS]) }).spawn, exec });
    await adapter.signIn("x");
    await adapter.models();
    await adapter.models();
    expect(asked).toBe(1);
    await adapter.models("x", { refresh: true });
    expect(asked).toBe(2);
  });

});
