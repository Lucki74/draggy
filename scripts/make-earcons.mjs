#!/usr/bin/env node
/** Writes the interface sounds to public/sounds/*.wav. Each note is a struck bar: a fundamental and one
 * inharmonic overtone with their own decays, like a soft marimba, rather than a bare oscillator. Run
 * once; the files are committed. Levels are set by the GAIN table, checked by earcons.test.ts. */
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 24000;
const FADE = 0.005;

function note(freq, length, { overtone = 3.9, body = 0.07, ping = 0.018 } = {}) {
  const n = Math.round(length * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.002);
    out[i] = attack * (Math.exp(-t / body) * Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.exp(-t / ping) * Math.sin(2 * Math.PI * freq * overtone * t));
  }
  return out;
}

function mix(parts, total) {
  const out = new Float32Array(Math.round(total * RATE));
  for (const [at, samples] of parts) {
    const start = Math.round(at * RATE);
    for (let i = 0; i < samples.length && start + i < out.length; i++) out[start + i] += samples[i];
  }
  return out;
}

function finish(samples, gain) {
  const fade = Math.round(FADE * RATE);
  for (let i = 0; i < samples.length; i++) {
    let g = gain;
    if (i < fade) g *= i / fade;
    if (samples.length - 1 - i < fade) g *= (samples.length - 1 - i) / fade;
    samples[i] *= g;
  }
  return samples;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// Gains put each sound near -26 LUFS integrated.
const GAIN = { ready: 0.117, ended: 0.123, mute: 0.206, unmute: 0.197, error: 0.209 };

const sounds = {
  ready: [mix([[0, note(784, 0.12)], [0.07, note(1175, 0.11)]], 0.18), 0.18],
  ended: [mix([[0, note(1175, 0.12)], [0.08, note(784, 0.12)]], 0.2), 0.2],
  mute: [note(392, 0.06, { body: 0.02 }), 0.06],
  unmute: [note(659, 0.06, { body: 0.02 }), 0.06],
  error: [mix([[0, note(262, 0.07, { body: 0.025 })], [0.09, note(262, 0.07, { body: 0.025 })]], 0.16), 0.16],
};

mkdirSync("public/sounds", { recursive: true });
for (const [name, [samples, length]] of Object.entries(sounds)) {
  const trimmed = samples.subarray(0, Math.round(length * RATE));
  writeFileSync(`public/sounds/${name}.wav`, wav(finish(Float32Array.from(trimmed), GAIN[name])));
}
console.log("wrote", Object.keys(sounds).join(", "));
