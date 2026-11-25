import { describe, expect, it } from "vitest";
import { createPlayerRing } from "../voice/playerRing";

const RATE = 48000;
const QUANTUM = 128;

function tone(seconds: number, rate: number, level = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  out.fill(level);
  return out;
}

function pull(ring: ReturnType<typeof createPlayerRing>, quanta: number): Float32Array {
  const out = new Float32Array(quanta * QUANTUM);
  for (let q = 0; q < quanta; q++) ring.process(out.subarray(q * QUANTUM, (q + 1) * QUANTUM));
  return out;
}

describe("player ring", () => {
  it("stays silent until 120 ms is buffered", () => {
    const ring = createPlayerRing(RATE);
    ring.write(tone(0.1, RATE), RATE);
    expect(Math.max(...pull(ring, 10))).toBe(0);
    ring.write(tone(0.1, RATE), RATE);
    expect(Math.max(...pull(ring, 100))).toBeGreaterThan(0.4);
  });

  it("plays a short turn once it is finished", () => {
    const ring = createPlayerRing(RATE);
    ring.write(tone(0.05, RATE), RATE);
    ring.finish();
    expect(Math.max(...pull(ring, 40))).toBeGreaterThan(0.4);
  });

  it("fades in and out instead of stepping", () => {
    const ring = createPlayerRing(RATE);
    ring.write(tone(0.2, RATE), RATE);
    const out = pull(ring, 120);
    let step = 0;
    for (let i = 1; i < out.length; i++) step = Math.max(step, Math.abs(out[i] - out[i - 1]));
    expect(step).toBeLessThan(0.01);
  });

  it("fades out on an underrun, counts it, and recovers", () => {
    const ring = createPlayerRing(RATE);
    ring.write(tone(0.2, RATE), RATE);
    const out = pull(ring, 200);
    let step = 0;
    for (let i = 1; i < out.length; i++) step = Math.max(step, Math.abs(out[i] - out[i - 1]));
    expect(step).toBeLessThan(0.01);
    expect(out[out.length - 1]).toBe(0);
    expect(ring.stats().underruns).toBe(1);
    ring.write(tone(0.2, RATE), RATE);
    expect(Math.max(...pull(ring, 100))).toBeGreaterThan(0.4);
  });

  it("does not count the end of a finished turn as an underrun", () => {
    const ring = createPlayerRing(RATE);
    ring.write(tone(0.2, RATE), RATE);
    ring.finish();
    pull(ring, 200);
    expect(ring.stats().underruns).toBe(0);
  });

  it("cancels within 30 ms and discards what was queued", () => {
    const ring = createPlayerRing(RATE);
    ring.write(tone(1, RATE), RATE);
    pull(ring, 20);
    ring.cancel();
    expect(ring.stats().buffered).toBe(0);
    const out = pull(ring, 20);
    const silentFrom = out.findIndex((value, i) => i > 0 && out.slice(i).every((v) => v === 0));
    expect(silentFrom).toBeGreaterThan(0);
    expect(silentFrom).toBeLessThanOrEqual(Math.round(0.03 * RATE) + 1);
    let step = 0;
    for (let i = 1; i < out.length; i++) step = Math.max(step, Math.abs(out[i] - out[i - 1]));
    expect(step).toBeLessThan(0.01);
  });

  it("resamples a 24 kHz voice into a 48 kHz context without changing its length or level", () => {
    const ring = createPlayerRing(RATE);
    ring.write(tone(0.5, 24000), 24000);
    const { buffered } = ring.stats();
    expect(Math.abs(buffered - 0.5 * RATE)).toBeLessThanOrEqual(2);
    ring.finish();
    const out = pull(ring, 100);
    expect(out[3000]).toBeCloseTo(0.5, 2);
  });

  it("joins consecutive writes without a seam", () => {
    const ring = createPlayerRing(RATE);
    const ramp = new Float32Array(24000).map((_, i) => i / 48000);
    ring.write(ramp.subarray(0, 12000), 24000);
    ring.write(ramp.subarray(12000), 24000);
    ring.finish();
    const out = pull(ring, 200);
    let worst = 0;
    for (let i = 2000; i < 20000; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1]));
    expect(worst).toBeLessThan(0.001);
  });

  it("refuses audio that would overflow three seconds", () => {
    const ring = createPlayerRing(RATE);
    expect(ring.write(tone(2, RATE), RATE)).toBe(true);
    expect(ring.write(tone(2, RATE), RATE)).toBe(false);
  });
});
