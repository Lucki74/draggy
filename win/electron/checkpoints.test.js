import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const checkpoints = require("./checkpoints.cjs");

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-checkpoints-"));
  checkpoints.init(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const blobFile = (hash) => path.join(dir, "checkpoints", hash.slice(0, 2), hash);

describe("checkpoints", () => {
  it("keeps bytes under their hash and reads them back", () => {
    const hash = checkpoints.keep("hello");
    expect(checkpoints.keep("hello")).toBe(hash);
    expect(checkpoints.read(hash).toString("utf8")).toBe("hello");
  });

  it("leaves no partial file behind", () => {
    const hash = checkpoints.keep("hello");
    expect(fs.readdirSync(path.dirname(blobFile(hash)))).toEqual([hash]);
  });

  it("refuses a blob whose bytes no longer match its hash", () => {
    const hash = checkpoints.keep("hello");
    fs.writeFileSync(blobFile(hash), "tampered");
    expect(checkpoints.read(hash)).toBeNull();
  });

  it("returns null for a hash the store never had", () => {
    expect(checkpoints.read("ab".repeat(32))).toBeNull();
  });

  it("collects only blobs no checkpoint refers to", () => {
    const keepHash = checkpoints.keep("keep me");
    const dropHash = checkpoints.keep("drop me");
    expect(checkpoints.collect([keepHash])).toBe(1);
    expect(checkpoints.read(keepHash)).not.toBeNull();
    expect(checkpoints.read(dropHash)).toBeNull();
  });

  it("skips a stray file at the top of the store", () => {
    const keepHash = checkpoints.keep("keep me");
    fs.writeFileSync(path.join(dir, "checkpoints", "stray.txt"), "x");
    expect(() => checkpoints.collect([keepHash])).not.toThrow();
  });
});
