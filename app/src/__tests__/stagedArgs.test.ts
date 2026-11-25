import { describe, expect, it } from "vitest";
import { STAGE_THRESHOLD, splitText, stagedChunks } from "../platform/stagedArgs";

describe("splitText", () => {
  it("rejoins to the original text", () => {
    const text = "x".repeat(1000);
    expect(splitText(text, 300).join("")).toBe(text);
  });

  it("never leaves a lone surrogate at a cut", () => {
    const text = "a\u{1F600}b\u{1F600}c";
    for (let size = 2; size <= text.length; size += 1) {
      for (const part of splitText(text, size)) {
        const first = part.charCodeAt(0);
        const last = part.charCodeAt(part.length - 1);
        expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      }
      expect(splitText(text, size).join("")).toBe(text);
    }
  });
});

describe("stagedChunks", () => {
  it("sends small arguments whole", () => {
    expect(stagedChunks("[1,2]")).toBeNull();
  });

  it("splits a large argument list into pieces under the threshold", () => {
    const json = JSON.stringify(["y".repeat(STAGE_THRESHOLD * 2)]);
    const chunks = stagedChunks(json);
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBeGreaterThan(1);
    expect(chunks!.join("")).toBe(json);
  });
});
