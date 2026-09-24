/** The small sounds a person makes around their words: a breath before speaking, a sigh, a thinking
 * "hmm", a laugh. The model asks for them with inline cues (<breath>, <sigh>, <hmm>, <laugh>) and
 * Draggy adds the breaths a speaker takes on its own.
 *
 * They are synthesised here rather than left to the voice model: Supertonic's <laugh> is convincing,
 * but its <breath> and <sigh> are barely audible, and the system voice has none at all. Each sound
 * is shaped noise and a glottal source through vocal-tract resonances, randomised a little every
 * time, so no two breaths are the same recording. */

export type VocalSound = "breath" | "sigh" | "hmm" | "laugh";
export const VOCAL_SOUNDS: readonly VocalSound[] = ["breath", "sigh", "hmm", "laugh"];

/** How high the voice sits, so a hum or laugh matches the speaker. */
export type VoiceRegister = "low" | "mid" | "high";

// ------------------------------------------------------------------------------------------ cues

const CUE = /<\s*(breath|sigh|hmm|laugh)\s*\/?\s*>/gi;
/** A cue still being streamed in, "<la" before "ugh>" arrives. */
const TRAILING_PARTIAL = /<[a-z\s]*$/i;

export type Segment = { kind: "text"; text: string } | { kind: "sound"; sound: VocalSound };

/** Splits spoken text into words and sounds, in order. Cues the engine voices itself (Supertonic's
 * <laugh>) are left inside the text, written the way that engine expects them. */
export function splitCues(text: string, inline: ReadonlySet<VocalSound> = new Set()): Segment[] {
  const segments: Segment[] = [];
  let pending = "";
  let last = 0;
  for (const match of text.matchAll(CUE)) {
    const sound = match[1].toLowerCase() as VocalSound;
    pending += text.slice(last, match.index);
    last = (match.index ?? 0) + match[0].length;
    if (inline.has(sound)) {
      pending += `<${sound}>`;
      continue;
    }
    if (pending.trim()) segments.push({ kind: "text", text: pending.trim() });
    pending = "";
    segments.push({ kind: "sound", sound });
  }
  pending += text.slice(last);
  if (pending.trim()) segments.push({ kind: "text", text: pending.trim() });
  return segments;
}

/** The text as it should be shown: every cue gone, including one still arriving. */
export function stripCues(text: string): string {
  return text
    .replace(CUE, " ")
    .replace(TRAILING_PARTIAL, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trimStart();
}

/** Stands in for cues while text goes through cleaning that would eat their angle brackets. */
const GUARD = "\u2063";
export function protectCues(text: string): string {
  return text.replace(CUE, (_, name: string) => `${GUARD}${name.toLowerCase()}${GUARD}`);
}
export function restoreCues(text: string): string {
  return text.replace(new RegExp(`${GUARD}(breath|sigh|hmm|laugh)${GUARD}`, "g"), "<$1>");
}

// ------------------------------------------------------------------------------------ automatic

/** When a speaker draws breath unprompted: usually before starting, and before going on after a
 * long sentence. Never twice in a row, and never next to a sound the model asked for. */
export function createBreathing(random: () => number = Math.random) {
  let started = false;
  let lastLength = 0;
  let lastWasSound = false;

  return {
    /** Called for each segment about to be said; returns true if a breath should come first. */
    before(segment: Segment): boolean {
      if (segment.kind === "sound") {
        lastWasSound = true;
        started = true;
        return false;
      }
      const opening = !started;
      const chance = opening ? 0.6 : lastLength >= 100 ? 0.35 : 0;
      const breathe = !lastWasSound && random() < chance;
      started = true;
      lastWasSound = false;
      lastLength = segment.text.length;
      return breathe;
    },
    reset() {
      started = false;
      lastLength = 0;
      lastWasSound = false;
    },
  };
}

// ------------------------------------------------------------------------------------ synthesis

/** A biquad band-pass (RBJ cookbook, constant peak gain), run in place. */
function bandPass(samples: Float32Array, rate: number, frequency: number, q: number): Float32Array {
  const w = (2 * Math.PI * frequency) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** A one-pole low-pass, for the muffled hum of a closed mouth. */
function lowPass(samples: Float32Array, rate: number, cutoff: number): Float32Array {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
  const out = new Float32Array(samples.length);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y += k * (samples[i] - y);
    out[i] = y;
  }
  return out;
}

function whiteNoise(length: number, random: () => number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = random() * 2 - 1;
  return out;
}

/** A breathy glottal source: harmonics falling off like a relaxed voice, pitch following `f0`. */
function glottal(length: number, rate: number, f0: (t: number) => number, random: () => number): Float32Array {
  const out = new Float32Array(length);
  let phase = 0;
  const jitter = 0.004;
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    phase += (2 * Math.PI * f0(t) * (1 + (random() - 0.5) * jitter)) / rate;
    let v = 0;
    for (let h = 1; h <= 14; h++) v += Math.sin(h * phase) / h ** 1.4;
    out[i] = v;
  }
  return out;
}

function mix(...layers: [Float32Array, number][]): Float32Array {
  const out = new Float32Array(layers[0][0].length);
  for (const [layer, gain] of layers) for (let i = 0; i < out.length; i++) out[i] += layer[i] * gain;
  return out;
}

/** Scales to `peak` and applies an envelope given as a function of position 0..1. */
function shape(samples: Float32Array, peak: number, envelope: (x: number) => number): Float32Array {
  let max = 0;
  for (const value of samples) max = Math.max(max, Math.abs(value));
  const scale = max > 0 ? peak / max : 0;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * scale * envelope(i / samples.length);
  return out;
}

const between = (random: () => number, lo: number, hi: number) => lo + (hi - lo) * random();
const smooth = (x: number) => Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, x))) ** 2;

const PITCH: Record<VoiceRegister, number> = { low: 110, mid: 150, high: 205 };

/** Levels are set against speech peaking near 0.3: a breath is heard, never louder than a word. */
export function synthesizeSound(
  sound: VocalSound,
  { rate, register = "mid", random = Math.random }: { rate: number; register?: VoiceRegister; random?: () => number },
): Float32Array {
  const base = PITCH[register] * between(random, 0.94, 1.06);

  if (sound === "breath") {
    // An inhale through the mouth: turbulence shaped by the open tract, swelling then cut off.
    const length = Math.round(rate * between(random, 0.34, 0.5));
    const noise = whiteNoise(length, random);
    const air = mix(
      [bandPass(noise, rate, between(random, 1000, 1400), 1.1), 1],
      [bandPass(noise, rate, between(random, 2300, 2900), 2.2), 0.55],
      [bandPass(noise, rate, 5200, 1.5), 0.2],
    );
    const top = between(random, 0.68, 0.8);
    return shape(air, between(random, 0.028, 0.04), (x) => (x < top ? smooth(x / top) : smooth((1 - x) / (1 - top))));
  }

  if (sound === "sigh") {
    // A long exhale on "haah", voiced at first and trailing off into breath, pitch falling.
    const length = Math.round(rate * between(random, 0.75, 1.05));
    const f0 = (t: number) => base * (1.05 - 0.28 * Math.min(1, t / 0.8));
    const source = mix(
      [glottal(length, rate, f0, random), 0.35],
      [whiteNoise(length, random), 1],
    );
    const tract = mix(
      [bandPass(source, rate, between(random, 700, 850), 4), 1],
      [bandPass(source, rate, between(random, 1150, 1350), 5), 0.6],
      [bandPass(source, rate, 2500, 4), 0.25],
    );
    return shape(tract, between(random, 0.05, 0.07), (x) => smooth(x / 0.08) * (1 - x) ** 1.6);
  }

  if (sound === "hmm") {
    // A closed-mouth hum: nasal and muffled, rising a touch then settling.
    const length = Math.round(rate * between(random, 0.42, 0.6));
    const f0 = (t: number) => base * (1 + 0.06 * Math.sin(Math.PI * Math.min(1, t / 0.5)));
    const hum = lowPass(lowPass(glottal(length, rate, f0, random), rate, 420), rate, 900);
    return shape(hum, between(random, 0.09, 0.12), (x) => smooth(x / 0.1) * smooth((1 - x) / 0.25));
  }

  // A soft laugh: three or four breathy "ha"s, each lower and quieter than the last.
  const beats = random() < 0.5 ? 3 : 4;
  const beat = Math.round(rate * between(random, 0.15, 0.18));
  const length = beat * beats;
  const out = new Float32Array(length);
  for (let n = 0; n < beats; n++) {
    const f0 = (t: number) => base * (1.35 - n * 0.08 - t * 0.6);
    const burst = mix(
      [glottal(beat, rate, f0, random), 0.6],
      [whiteNoise(beat, random), 0.8],
    );
    const vowel = mix(
      [bandPass(burst, rate, between(random, 750, 900), 3.5), 1],
      [bandPass(burst, rate, between(random, 1200, 1400), 4), 0.7],
    );
    const syllable = shape(vowel, 0.1 * 0.8 ** n, (x) => smooth(x / 0.15) * smooth((0.75 - x) / 0.35));
    out.set(syllable, n * beat);
  }
  return out;
}

/** The pitch a Supertonic voice sits at, from its id (F1..F5, M1..M5). */
export function registerForVoice(voiceId: string | null | undefined): VoiceRegister {
  if (voiceId?.startsWith("F")) return "high";
  if (voiceId?.startsWith("M")) return "low";
  return "mid";
}
