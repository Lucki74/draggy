import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const scrub = require("./logScrub.cjs");

afterEach(() => scrub.forgetSecrets());

// Built from pieces so no secret-shaped literal sits in the repository.
const tail = (n) => "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8".slice(0, n);

const CASES = [
  ["anthropic key", `sk-ant-${tail(30)}`, "[secret:anthropic-key]"],
  ["openai key", `sk-${tail(30)}`, "[secret:sk-key]"],
  ["google key", `AIza${tail(35)}`, "[secret:google-key]"],
  ["github token", `ghp_${tail(30)}`, "[secret:github-token]"],
  ["github fine-grained token", `github_pat_${tail(30)}`, "[secret:github-token]"],
  ["hugging face token", `hf_${tail(30)}`, "[secret:hf-token]"],
  ["slack bot token", `xoxb-${tail(20)}`, "[secret:slack-token]"],
  ["slack user token", `xoxp-${tail(20)}`, "[secret:slack-token]"],
  ["jwt", `eyJ${tail(12)}.${tail(14)}.${tail(16)}`, "[secret:jwt]"],
  ["bearer token", `Bearer ${tail(24)}`, "Bearer [secret:bearer]"],
];

describe("secret scrubber", () => {
  for (const [name, secret, replacement] of CASES) {
    it(`replaces a ${name}`, () => {
      const out = scrub.scrubSecrets(`request failed with ${secret} in the message`);
      expect(out).not.toContain(secret);
      expect(out).toContain(replacement);
    });
  }

  it("keeps the header name and drops its value", () => {
    const out = scrub.scrubSecrets(`Authorization: Basic ${tail(20)}`);
    expect(out).toBe("Authorization: [secret:authorization]");
  });

  it("drops query values for key, token, access_token and OAuth codes", () => {
    for (const name of ["key", "token", "access_token", "code"]) {
      const out = scrub.scrubSecrets(`https://host.test/path?a=1&${name}=${tail(18)}&b=2`);
      expect(out).not.toContain(tail(18));
      expect(out).toContain(`${name}=[secret:query]&b=2`);
    }
  });

  it("leaves ordinary text alone", () => {
    const text = "model loaded in 2140 ms, task-key list has 3 items, skipping sk-short";
    expect(scrub.scrubSecrets(text)).toBe(text);
  });

  it("drops a registered value that matches no pattern", () => {
    scrub.registerSecret("hunter2-but-longer");
    expect(scrub.scrubSecrets("password is hunter2-but-longer ok")).toBe("password is [secret:stored] ok");
  });

  it("recognises secret field names", () => {
    for (const key of ["apiKey", "api_key", "accessToken", "Authorization", "client_secret", "password", "code_verifier", "cookie"]) {
      expect(scrub.isSecretKey(key)).toBe(true);
    }
    for (const key of ["tokens", "inputTokens", "model", "code", "status"]) expect(scrub.isSecretKey(key)).toBe(false);
  });
});

describe("path scrubber", () => {
  const bs = String.fromCharCode(92);
  const home = ["C:", "Users", "jdoe"].join(bs);
  const options = { home, user: "jdoe" };

  it("replaces the home directory in every separator style", () => {
    const winPath = [home, "AppData", "Roaming", "Draggy"].join(bs);
    const jsonPath = JSON.stringify({ path: [home, "x.txt"].join(bs) });
    const out = scrub.scrubPaths([winPath, "C:/Users/jdoe/Documents", jsonPath].join(" "), options);
    expect(out).not.toMatch(/jdoe/i);
    expect(out).toContain(["~", "AppData", "Roaming", "Draggy"].join(bs));
    expect(out).toContain("~/Documents");
    expect(out).toContain('"path":"~');
  });

  it("replaces the bare user name on word boundaries only", () => {
    const out = scrub.scrubPaths("owner jdoe wrote jdoeson-notes", options);
    expect(out).toBe("owner <user> wrote jdoeson-notes");
  });

  it("ignores user names shorter than three characters", () => {
    expect(scrub.scrubPaths("me and my", { user: "me" })).toBe("me and my");
  });
});

describe("presigned urls", () => {
  it("drops the signature, policy and key id from a CDN redirect", () => {
    const url = `https://cdn.example.test/file?Expires=1&Policy=${tail(20)}&Signature=${tail(20)}&Key-Pair-Id=${tail(10)}&X-Amz-Credential=${tail(12)}`;
    const out = scrub.scrubSecrets(url);
    for (const part of [tail(20), tail(10), tail(12)]) expect(out).not.toContain(part);
    expect(out).toContain("Expires=1");
  });
});
