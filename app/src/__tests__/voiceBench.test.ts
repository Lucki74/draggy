// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain script, no types
import { readWav, truePeak } from "../../scripts/voice-bench.mjs";

function writeWav(file: string, samples: number[], rate = 24000) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(v * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

describe("voice bench helpers", () => {
  it("reads a PCM16 wav and reports its rate", () => {
    const file = path.join(os.tmpdir(), `bench-${process.pid}.wav`);
    writeWav(file, [0, 0.5, -0.5, 0.25]);
    const { samples, rate } = readWav(file);
    fs.rmSync(file);
    expect(rate).toBe(24000);
    expect(samples.length).toBe(4);
    expect(samples[1]).toBeCloseTo(0.5, 3);
  });

  it("finds a peak between samples", () => {
    expect(truePeak(Float32Array.from([0, 0.8, 0]))).toBeCloseTo(0.8, 2);
  });
});
