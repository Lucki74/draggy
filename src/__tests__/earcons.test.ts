import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { integratedLoudness } from "../voice/loudness";

const LENGTH_MS: Record<string, number> = { ready: 180, ended: 200, mute: 60, unmute: 60, error: 160 };

function read(name: string) {
  const file = readFileSync(`public/sounds/${name}.wav`);
  const rate = file.readUInt32LE(24);
  const samples = new Float32Array((file.length - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = file.readInt16LE(44 + i * 2) / 32768;
  return { rate, samples };
}

describe("interface sounds", () => {
  for (const [name, ms] of Object.entries(LENGTH_MS)) {
    it(`${name} has its length, soft edges and a quiet level`, () => {
      const { rate, samples } = read(name);
      expect(Math.abs((samples.length / rate) * 1000 - ms)).toBeLessThan(2);
      expect(samples[0]).toBe(0);
      expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.002);
      expect(Math.max(...samples.map(Math.abs))).toBeLessThan(0.6);
      // Short sounds fall under the gate of a gated loudness measure, so measure the body ungated
      // against the plan's -26 within a few LU.
      expect(Math.abs(integratedLoudness(samples, rate) + 26)).toBeLessThan(3);
    });
  }
});
