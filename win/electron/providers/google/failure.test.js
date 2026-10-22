import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parseGoogleError, googleFailure } = require("./failure.cjs");
const logger = require("../../logger.cjs");

// Google's documented error envelope (google.rpc.Status with an ErrorInfo detail), not a capture from a live account.
const FORBIDDEN = JSON.stringify({
  error: {
    code: 403,
    message: "Gemini CLI no longer serves requests for Google AI Pro accounts. Use Antigravity.",
    status: "PERMISSION_DENIED",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com" }],
  },
});

describe("parseGoogleError", () => {
  it("reads status, reason and message from the envelope", () => {
    expect(parseGoogleError(FORBIDDEN)).toEqual({
      status: 403,
      reason: "SERVICE_DISABLED",
      message: "Gemini CLI no longer serves requests for Google AI Pro accounts. Use Antigravity.",
    });
  });

  it("finds the envelope behind a prefix and falls back to the status text", () => {
    expect(parseGoogleError(`GaxiosError: request failed ${FORBIDDEN}`).status).toBe(403);
    expect(parseGoogleError("Error 429: slow down")).toMatchObject({ status: 429, message: "Error 429: slow down" });
  });
});

describe("googleFailure", () => {
  it.each([
    [FORBIDDEN, "account-access-denied"],
    [JSON.stringify({ error: { code: 500, message: "The Gemini CLI has been retired for this plan." } }), "account-access-denied"],
    [JSON.stringify({ error: { code: 401, message: "x", status: "UNAUTHENTICATED" } }), "account-signed-out"],
    [JSON.stringify({ error: { code: 429, message: "x", status: "RESOURCE_EXHAUSTED" } }), "account-limit-reached"],
    [JSON.stringify({ error: { code: 503, message: "The model is overloaded", status: "UNAVAILABLE" } }), "provider-rate-limited"],
    ["something odd", "provider-unknown-error"],
  ])("maps %#", (input, kind) => {
    expect(googleFailure(input).kind).toBe(kind);
  });

  it("carries Google's own words and status", () => {
    expect(googleFailure(FORBIDDEN)).toMatchObject({ status: 403, providerMessage: expect.stringContaining("Antigravity") });
  });
});

describe("what it logs", () => {
  let dir;
  let files;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-google-"));
    files = logger.init({ getPath: () => dir, getName: () => "Draggy", getVersion: () => "0" });
  });
  afterEach(async () => {
    await logger.closeStreams();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("records status and reason in app.log, with no bearer token", async () => {
    googleFailure(`${FORBIDDEN} Authorization: Bearer ya29.a0AbcdefghijklmnopqrstuvwxyzTOKEN`);
    await logger.flush();
    const text = fs.readFileSync(files.appFile, "utf8");
    expect(text).toContain("google request failed");
    expect(text).toContain("403");
    expect(text).toContain("SERVICE_DISABLED");
    expect(text).not.toContain("ya29.");
  });
});
