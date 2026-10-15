import type { Boundary } from "./chunker";

/** Makes separately synthesised fragments sound like one speaker talking: silence trimmed to what the
 * voice meant, edges faded so a seam cannot click, and the pause a person would leave between
 * phrases put back in. */

const GUARD_S = 0.01;
const FADE_IN_S = 0.006;
const FADE_OUT_S = 0.01;

/** Pause ranges in seconds, by how the previous fragment ended. */
const PAUSE: Record<Boundary, [number, number]> = {
  clause: [0.09, 0.14],
  forced: [0.02, 0.06],
  sentence: [0.22, 0.32],
  final: [0.22, 0.32],
};
const QUESTION_PAUSE: [number, number] = [0.3, 0.38];

/** Drops leading and trailing silence, keeping a short guard so soft onsets survive. */
export function trimSilence(samples: Float32Array, rate: number): Float32Array {
  if (samples.length === 0) return samples;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  const rms = Math.sqrt(energy / samples.length);
  const threshold = Math.max(0.0015, rms * 0.08);

  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start++;
  if (start === samples.length) return samples.subarray(0, 0);
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) end--;

  const guard = Math.round(GUARD_S * rate);
  return samples.subarray(Math.max(0, start - guard), Math.min(samples.length, end + 1 + guard));
}

/** Raised-cosine fades at both ends, in place. Never lengthens the fragment. */
export function applyFades(samples: Float32Array, rate: number): Float32Array {
  const half = Math.floor(samples.length / 2);
  const fadeIn = Math.min(half, Math.round(FADE_IN_S * rate));
  const fadeOut = Math.min(half, Math.round(FADE_OUT_S * rate));
  for (let i = 0; i < fadeIn; i++) samples[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  for (let i = 0; i < fadeOut; i++) {
    samples[samples.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  }
  return samples;
}

/** Seconds of silence to leave after a fragment, jittered so the rhythm does not tick, and scaled by
 * the speaking speed (a faster voice pauses less). */
export function pauseSeconds(
  boundary: Boundary,
  text: string,
  speed = 1,
  random: () => number = Math.random,
): number {
  const question = /[?？]["'”’)\]]?\s*$/.test(text) && (boundary === "sentence" || boundary === "final");
  const [low, high] = question ? QUESTION_PAUSE : PAUSE[boundary];
  return (low + (high - low) * random()) / Math.max(0.5, speed);
}

/** A fragment ready to schedule: trimmed, faded, with its trailing pause. */
export function prepareFragment(
  samples: Float32Array,
  rate: number,
  boundary: Boundary,
  text: string,
  speed = 1,
  random: () => number = Math.random,
): { samples: Float32Array; pause: number } {
  const trimmed = trimSilence(samples, rate);
  // Copy: the trimmed view shares the worker's buffer, and fades write in place.
  return {
    samples: applyFades(Float32Array.from(trimmed), rate),
    pause: pauseSeconds(boundary, text, speed, random),
  };
}
