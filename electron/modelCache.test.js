import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { serveModelFile } = require("./modelCache.cjs");

const made = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-cache-"));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** An upstream that hands out `chunks` one read at a time and counts requests. */
function upstream(chunks, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    let i = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(new Uint8Array(chunks[i++]));
        else controller.close();
      },
    });
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    return new Response(status === 200 ? body : null, { status, headers: { "content-length": String(size) } });
  };
  return { fetchImpl, calls };
}

describe("model cache", () => {
  it("streams a download and keeps it for next time", async () => {
    const root = tmp();
    const { fetchImpl, calls } = upstream([[1, 2, 3], [4, 5]]);
    const first = await serveModelFile("org/model/resolve/main/a.onnx", { root, origin: "https://hf", fetchImpl });
    expect(first.headers.get("content-length")).toBe("5");
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual(["https://hf/org/model/resolve/main/a.onnx"]);

    const second = await serveModelFile("org/model/resolve/main/a.onnx", { root, origin: "https://hf", fetchImpl });
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect(calls.length).toBe(1);
    expect(fs.readdirSync(path.join(root, "org/model/resolve/main"))).toEqual(["a.onnx"]);
  });

  it("delivers the first bytes before the last have arrived", async () => {
    const root = tmp();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const fetchImpl = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([9]));
          },
          async pull(controller) {
            await gate;
            controller.enqueue(new Uint8Array([8]));
            controller.close();
          },
        }),
      );
    const response = await serveModelFile("x/y.bin", { root, origin: "https://hf", fetchImpl });
    const reader = response.body.getReader();
    expect([...(await reader.read()).value]).toEqual([9]);
    expect(fs.existsSync(path.join(root, "x/y.bin"))).toBe(false);
    release();
    while (!(await reader.read()).done);
    expect(fs.existsSync(path.join(root, "x/y.bin"))).toBe(true);
  });

  it("leaves nothing behind when a download is cancelled", async () => {
    const root = tmp();
    const { fetchImpl } = upstream([[1], [2], [3]]);
    const response = await serveModelFile("x/z.bin", { root, origin: "https://hf", fetchImpl });
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fs.existsSync(path.join(root, "x"))).toBe(true);
    expect(fs.readdirSync(path.join(root, "x"))).toEqual([]);
  });

  it("passes upstream failures through and refuses paths outside the cache", async () => {
    const root = tmp();
    const { fetchImpl } = upstream([], { status: 404 });
    expect((await serveModelFile("a/missing.bin", { root, origin: "https://hf", fetchImpl })).status).toBe(404);
    expect((await serveModelFile("../escape", { root, origin: "https://hf", fetchImpl })).status).toBe(400);
    expect((await serveModelFile("", { root, origin: "https://hf", fetchImpl })).status).toBe(400);
  });
});
