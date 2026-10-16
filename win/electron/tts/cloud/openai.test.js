import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildRequest, speak, FRAME_BYTES } = require("./openai.cjs");

const connection = { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", headers: {} };

function streamOf(...chunks) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) },
  };
}

describe("OpenAI cloud speech", () => {
  it("asks for raw PCM with a fixed style line, keeping the key in the header only", () => {
    const { url, init } = buildRequest(connection, { text: "Hello there", voice: "nova" });
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    const body = JSON.parse(init.body);
    expect(body.response_format).toBe("pcm");
    expect(body.voice).toBe("nova");
    expect(body.instructions).toMatch(/warmly/);
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(init.body).not.toContain("sk-test");
  });

  it("refuses empty text", () => {
    expect(() => buildRequest(connection, { text: "   " })).toThrow(/nothing to speak/);
  });

  it("cuts the stream into 40 ms frames and never splits a sample", async () => {
    const bytes = Buffer.alloc(FRAME_BYTES * 2 + 7, 1);
    const frames = [];
    const result = await speak(connection, { text: "Hi" }, {
      fetchImpl: async () => streamOf(bytes.subarray(0, 1001), bytes.subarray(1001)),
      onFrames: (f) => frames.push(f),
    });
    expect(frames).toHaveLength(3);
    expect(frames[0].length).toBe(FRAME_BYTES / 2);
    expect(frames[2].length).toBe(3);
    expect(result).toEqual({ characters: 2, frames: 3 });
  });

  it("reports a missing key and an HTTP failure by code, without the text", async () => {
    await expect(speak({ ...connection, apiKey: "" }, { text: "Hi" })).rejects.toMatchObject({ code: "no-key" });
    const failure = speak(connection, { text: "secret words" }, { fetchImpl: async () => ({ ok: false, status: 429 }) });
    await expect(failure).rejects.toMatchObject({ code: "http-429" });
    await expect(failure).rejects.not.toThrow(/secret/);
  });
});
