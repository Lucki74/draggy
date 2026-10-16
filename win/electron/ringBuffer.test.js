import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const { createRing } = createRequire(import.meta.url)("./ringBuffer.cjs");

describe("ring buffer", () => {
  it("keeps only the newest lines and dumps them as one block", () => {
    const ring = createRing(3);
    ["a", "b", "c", "d"].forEach((line) => ring.push(line));

    expect(ring.length).toBe(3);
    expect(ring.dump()).toBe("b\nc\nd");
    expect(ring.tail(2)).toEqual(["c", "d"]);
  });
});
