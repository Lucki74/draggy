import { describe, expect, it } from "vitest";
import { createSpeedMeter } from "../downloadSpeed";

describe("createSpeedMeter", () => {
  it("averages the speed over the last 10 seconds only", () => {
    const meter = createSpeedMeter();
    meter.sample(0, 1e9, 0);
    // 100 MB/s for the first 10 s, then 10 MB/s: only the slow stretch is in the window at 20 s.
    meter.sample(1e9 / 1.0 / 10, 1e9, 10_000);
    const slow = meter.sample(1e8 + 1e8, 1e9, 20_000);
    expect(slow.bytesPerSecond).toBeCloseTo(1e7, -3);
  });

  it("derives the time left from the same speed", () => {
    const meter = createSpeedMeter();
    meter.sample(0, 1000, 0);
    const result = meter.sample(200, 1000, 4000);
    expect(result.bytesPerSecond).toBe(50);
    expect(result.remainingSeconds).toBe(16);
  });

  it("reports nothing before a second has passed", () => {
    const meter = createSpeedMeter();
    meter.sample(0, 1000, 0);
    expect(meter.sample(500, 1000, 500)).toEqual({ bytesPerSecond: null, remainingSeconds: null });
  });

  it("starts over when the file restarts", () => {
    const meter = createSpeedMeter();
    meter.sample(0, 1000, 0);
    meter.sample(800, 1000, 4000);
    meter.sample(0, 1000, 5000);
    expect(meter.sample(100, 1000, 7000).bytesPerSecond).toBe(50);
  });
});
