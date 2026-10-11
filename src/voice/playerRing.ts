/** The playback buffer behind every local voice: engines push PCM at their own rate, the audio thread
 * pulls one render quantum at a time. It lives apart from the worklet shell so it can be tested
 * directly. A jitter buffer holds playback until enough audio has arrived; an underrun fades out
 * rather than clicking; cancel fades over 30 ms and drops everything behind the fade. */

const CAPACITY_SECONDS = 3;
const PREBUFFER_MS = 120;
const EDGE_FADE_MS = 10;
const CANCEL_FADE_MS = 30;

export interface PlayerStats {
  buffered: number;
  underruns: number;
}

export interface PlayerRing {
  /** Adds audio recorded at `sourceRate`. Returns false when it does not fit and was dropped. */
  write: (pcm: Float32Array, sourceRate: number) => boolean;
  /** Fills one render quantum. */
  process: (out: Float32Array) => void;
  /** No more audio is coming for this turn, so what is left plays without waiting for the jitter
   * buffer to fill. */
  finish: () => void;
  /** Nothing queued, nothing sounding, no fade left. */
  idle: () => boolean;
  /** Fade out over 30 ms and discard whatever is queued. */
  cancel: () => void;
  stats: () => PlayerStats;
}

export function createPlayerRing(contextRate: number): PlayerRing {
  const capacity = Math.round(CAPACITY_SECONDS * contextRate);
  const prebuffer = Math.round((PREBUFFER_MS / 1000) * contextRate);
  const edge = Math.max(1, Math.round((EDGE_FADE_MS / 1000) * contextRate));
  const cancelFade = Math.max(1, Math.round((CANCEL_FADE_MS / 1000) * contextRate));

  const ring = new Float32Array(capacity);
  let head = 0;
  let size = 0;

  let playing = false;
  let finished = false;
  let underruns = 0;
  /** Samples of fade-in left after (re)starting. */
  let fadeIn = 0;
  /** Samples of fade-out left, after an underrun or a cancel; 0 when none. */
  let fadeOut = 0;
  let fadeOutLength = 0;
  let last = 0;
  /** Source position carried between writes so resampling has no seam. */
  let carry = 0;
  let previous = 0;
  let hasPrevious = false;

  const push = (value: number): boolean => {
    if (size >= capacity) return false;
    ring[(head + size) % capacity] = value;
    size++;
    return true;
  };

  return {
    write(pcm, sourceRate) {
      finished = false;
      const step = sourceRate / contextRate;
      if (size + Math.ceil(pcm.length / step) > capacity) return false;
      if (step === 1) {
        for (let i = 0; i < pcm.length; i++) push(pcm[i]);
        previous = pcm[pcm.length - 1] ?? previous;
        hasPrevious = pcm.length > 0 || hasPrevious;
        carry = 0;
        return true;
      }
      // Linear interpolation, with the last sample of the previous write as position -1.
      let position = carry;
      for (;;) {
        const index = Math.floor(position);
        if (index + 1 > pcm.length) break;
        const a = index < 0 ? (hasPrevious ? previous : pcm[0]) : pcm[index];
        const b = pcm[Math.min(index + 1, pcm.length - 1)];
        const fraction = position - index;
        push(a + (b - a) * fraction);
        position += step;
      }
      carry = position - pcm.length;
      previous = pcm[pcm.length - 1] ?? previous;
      hasPrevious = pcm.length > 0 || hasPrevious;
      return true;
    },

    process(out) {
      for (let i = 0; i < out.length; i++) {
        if (!playing && size > 0 && (size >= prebuffer || finished)) {
          playing = true;
          fadeIn = edge;
        }

        if (fadeOut > 0) {
          // Falling away from the last sample heard; queued audio is left alone until the fade ends.
          const gain = fadeOut / fadeOutLength;
          out[i] = last * gain;
          fadeOut--;
          if (fadeOut === 0) last = 0;
          continue;
        }

        if (!playing) {
          out[i] = 0;
          continue;
        }

        if (size === 0) {
          // Ran dry mid-turn: fade out from the last sample and wait for more.
          playing = false;
          if (!finished) underruns++;
          finished = false;
          fadeOutLength = edge;
          fadeOut = edge;
          i--;
          continue;
        }

        let value = ring[head];
        head = (head + 1) % capacity;
        size--;
        if (fadeIn > 0) {
          value *= 1 - fadeIn / edge;
          fadeIn--;
        }
        last = value;
        out[i] = value;
      }
    },

    finish() {
      finished = true;
    },

    cancel() {
      size = 0;
      head = 0;
      playing = false;
      finished = false;
      carry = 0;
      hasPrevious = false;
      fadeIn = 0;
      fadeOutLength = cancelFade;
      fadeOut = last === 0 ? 0 : cancelFade;
    },

    idle: () => !playing && size === 0 && fadeOut === 0,

    stats: () => ({ buffered: size, underruns }),
  };
}
