/** Loudness of a fragment of speech, to even out a reply: ITU-R BS.1770 K-weighting with gated
 * 400 ms blocks. Short fragments (under one block) are measured whole. */

type Biquad = { b: [number, number, number]; a: [number, number] };

function highShelf(rate: number): Biquad {
  const gain = 3.999843853973347;
  const q = 0.7071752369554196;
  const fc = 1681.9744509555319;
  const k = Math.tan((Math.PI * fc) / rate);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b: [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0],
    a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  };
}

function highPass(rate: number): Biquad {
  const q = 0.5003270373238773;
  const fc = 38.13547087613982;
  const k = Math.tan((Math.PI * fc) / rate);
  const a0 = 1 + k / q + k * k;
  return {
    b: [1 / a0, -2 / a0, 1 / a0],
    a: [(2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  };
}

function filter(samples: Float32Array, { b, a }: Biquad): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

const loudnessOf = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);

/** Integrated loudness in LUFS, or -Infinity for silence. */
export function integratedLoudness(samples: Float32Array, rate: number): number {
  if (samples.length === 0) return -Infinity;
  const weighted = filter(filter(samples, highShelf(rate)), highPass(rate));

  const block = Math.round(0.4 * rate);
  const hop = Math.round(0.1 * rate);
  const energies: number[] = [];
  const meanSquare = (from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += weighted[i] * weighted[i];
    return sum / Math.max(1, to - from);
  };

  if (weighted.length <= block) {
    energies.push(meanSquare(0, weighted.length));
  } else {
    for (let start = 0; start + block <= weighted.length; start += hop) {
      energies.push(meanSquare(start, start + block));
    }
  }

  const absolute = energies.filter((energy) => energy > 0 && loudnessOf(energy) > -70);
  if (absolute.length === 0) return -Infinity;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const relativeGate = loudnessOf(mean(absolute)) - 10;
  const gated = absolute.filter((energy) => loudnessOf(energy) > relativeGate);
  return loudnessOf(mean(gated.length > 0 ? gated : absolute));
}

/** Peak a fragment may reach after gain: -1 dBFS, a margin for the converter and the output chain. */
export const PEAK_CEILING = 10 ** (-1 / 20);

export const TARGET_LUFS = -20;
const MAX_STEP_DB = 4;
const MAX_BOOST_DB = 12;
const MAX_CUT_DB = 18;

export interface LevelState {
  /** Gain, in dB, given to the previous fragment of this reply. */
  previousDb: number | null;
}

/** Linear gain that brings a fragment toward the target without jumping more than a few dB from its
 * neighbour, so a quiet aside stays quieter. Updates `state`. */
export function levelGain(
  samples: Float32Array,
  rate: number,
  state: LevelState,
  target = TARGET_LUFS,
): number {
  const loudness = integratedLoudness(samples, rate);
  if (!Number.isFinite(loudness)) return 1;

  let db = Math.min(MAX_BOOST_DB, Math.max(-MAX_CUT_DB, target - loudness));
  if (state.previousDb !== null) {
    db = Math.min(state.previousDb + MAX_STEP_DB, Math.max(state.previousDb - MAX_STEP_DB, db));
  }

  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  let gain = 10 ** (db / 20);
  if (peak * gain > PEAK_CEILING) gain = PEAK_CEILING / peak;

  state.previousDb = 20 * Math.log10(gain);
  return gain;
}
