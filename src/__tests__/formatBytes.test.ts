import { describe, expect, it } from "vitest";
import { formatBytes, formatTransferred } from "../formatBytes";

describe("formatBytes", () => {
  it("is decimal, like Hugging Face", () => {
    expect(formatBytes(4_920_000_000, "en")).toBe("4.9 GB");
    expect(formatBytes(1_763_578_176, "en")).toBe("1.8 GB");
  });
  it("uses MB below a gigabyte and is empty when unknown", () => {
    expect(formatBytes(335_304_388, "en")).toBe("335 MB");
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(NaN)).toBe("");
  });
});

describe("formatTransferred", () => {
  it("keeps both numbers in the total's unit", () => {
    expect(formatTransferred(900_000_000, 4_600_000_000, "en")).toBe("0.90 / 4.60 GB");
    expect(formatTransferred(50_000_000, 200_000_000, "en")).toBe("50 / 200 MB");
  });
});
