import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createTtsHandlers } = require("./ipc.cjs");
const { createConsent } = require("./consent.cjs");
const gemini = require("./cloud/gemini.cjs");
const { FRAME_BYTES } = require("./cloud/frames.cjs");

const memory = () => {
  const data = {};
  return { getValue: (k) => data[k] ?? null, setValue: (k, v) => void (data[k] = v) };
};

const registry = (keyed = true) => ({
  connectionFor: (id) => ({ baseUrl: id === "openai" ? "https://api.openai.com/v1" : "https://generativelanguage.googleapis.com/v1beta", apiKey: keyed ? "SECRET-KEY" : "", headers: {} }),
});

function body(bytes) {
  let sent = false;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })) }) } };
}

describe("cloud voice IPC", () => {
  it("refuses to speak before the user has agreed, and never calls out", async () => {
    let called = false;
    const handlers = createTtsHandlers({ registry: registry(), consent: createConsent(memory()), send() {}, fetchImpl: async () => ((called = true), body(Buffer.alloc(0))) });
    expect(await handlers["tts:speak"](1, { provider: "openai", text: "Hi" })).toEqual({ success: false, code: "no-consent" });
    expect(called).toBe(false);
  });

  it("streams frames tagged with the turn, and answers with counts only", async () => {
    const consent = createConsent(memory());
    consent.grant("openai");
    const sent = [];
    const handlers = createTtsHandlers({
      registry: registry(),
      consent,
      send: (channel, payload) => sent.push([channel, payload]),
      fetchImpl: async () => body(Buffer.alloc(FRAME_BYTES * 2)),
    });
    const result = await handlers["tts:speak"](7, { provider: "openai", text: "Private words" });
    expect(result).toEqual({ success: true, characters: 13, frames: 2, provider: "openai" });
    expect(sent).toHaveLength(2);
    expect(sent[0][0]).toBe("tts:frames");
    expect(sent[0][1].turnId).toBe(7);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("reports a missing key by code", async () => {
    const consent = createConsent(memory());
    consent.grant("gemini");
    const handlers = createTtsHandlers({ registry: registry(false), consent, send() {} });
    expect(await handlers["tts:speak"](1, { provider: "gemini", text: "Hi" })).toEqual({ success: false, code: "no-key" });
  });

  it("cancels an in-flight request", async () => {
    const consent = createConsent(memory());
    consent.grant("openai");
    const handlers = createTtsHandlers({
      registry: registry(),
      consent,
      send() {},
      fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    });
    const pending = handlers["tts:speak"](3, { provider: "openai", text: "Hi" });
    handlers["tts:cancel"](3);
    expect(await pending).toEqual({ success: false, code: "cancelled" });
  });

  it("revokes consent", async () => {
    const consent = createConsent(memory());
    consent.grant("openai");
    expect(consent.has("openai")).toBe(true);
    consent.revoke("openai");
    expect(consent.has("openai")).toBe(false);
  });

  it("lists only configured status, never keys", () => {
    const handlers = createTtsHandlers({ registry: registry(), consent: createConsent(memory()), send() {} });
    const out = handlers["tts:providers"]();
    expect(out.providers.every((p) => p.configured)).toBe(true);
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });
});

describe("Gemini speech", () => {
  it("reads base64 audio out of server events and frames it", async () => {
    const audio = Buffer.alloc(FRAME_BYTES + 10, 2);
    const event = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: audio.toString("base64") } }] } }] })}\n\n`;
    const frames = [];
    const result = await gemini.speak({ baseUrl: "https://x/v1beta", apiKey: "k", headers: {} }, { text: "Hello" }, {
      fetchImpl: async () => body(Buffer.from(event)),
      onFrames: (f) => frames.push(f),
    });
    expect(result.frames).toBe(2);
    expect(frames[0].length).toBe(FRAME_BYTES / 2);
  });

  it("puts the key in a header, not the address", () => {
    const { url, init } = gemini.buildRequest({ baseUrl: "https://x/v1beta", apiKey: "KEY", headers: {} }, { text: "Hi" });
    expect(url).not.toContain("KEY");
    expect(init.headers["x-goog-api-key"]).toBe("KEY");
  });
});
