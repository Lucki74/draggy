import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { checkConnectivity, PROBE_URL } = require("./connectivity.cjs");
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A request that answers with a status, fails, or never answers. */
function fakeRequest(outcome) {
  const calls = [];
  const request = (url, options, onResponse) => {
    const req = new EventEmitter();
    let onTimeout = null;
    req.setTimeout = (_ms, callback) => (onTimeout = callback);
    req.destroy = () => {};
    req.end = () => {
      calls.push({ url, method: options.method });
      setTimeout(() => {
        if (outcome === "error") req.emit("error", new Error("ENOTFOUND"));
        else if (outcome === "timeout") onTimeout?.();
        else onResponse({ statusCode: outcome, resume: () => {} });
      }, 0);
    };
    return req;
  };
  return { request, calls };
}

describe("the connectivity check", () => {
  it("asks Hugging Face with a HEAD request", async () => {
    const { request, calls } = fakeRequest(200);
    await checkConnectivity({ request });
    expect(calls).toEqual([{ url: "https://huggingface.co/api/models?limit=1", method: "HEAD" }]);
    expect(new URL(PROBE_URL).hostname).toBe("huggingface.co");
  });

  it("counts any 2xx or 3xx as online", async () => {
    for (const status of [200, 204, 301, 302, 399]) {
      expect(await checkConnectivity({ request: fakeRequest(status).request }), String(status)).toBe(true);
    }
  });

  it("counts an error status, a failure or a timeout as offline", async () => {
    for (const outcome of [404, 500, "error", "timeout"]) {
      expect(await checkConnectivity({ request: fakeRequest(outcome).request }), String(outcome)).toBe(false);
    }
  });

  it("is what the splash's check-internet uses, and nothing asks google.com", () => {
    const main = fs.readFileSync(path.join(HERE, "main.cjs"), "utf8");
    expect(main).toContain('ipcMain.handle("check-internet", () => connectivity.checkConnectivity());');
    expect(main).not.toMatch(/google\.com/);
  });
});
