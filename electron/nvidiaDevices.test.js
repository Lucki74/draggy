import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseNvidiaDevices } = require("./platform.cjs");

describe("parseNvidiaDevices", () => {
  it("puts the biggest card first", () => {
    expect(parseNvidiaDevices("0, 4096\n1, 16376\n")).toEqual([
      { index: 1, totalMiB: 16376 },
      { index: 0, totalMiB: 4096 },
    ]);
  });

  it("ignores empty or malformed output", () => {
    expect(parseNvidiaDevices("")).toEqual([]);
    expect(parseNvidiaDevices("No devices were found")).toEqual([]);
  });
});
