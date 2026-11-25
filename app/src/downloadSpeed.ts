/** The window a download's speed is averaged over. */
export const SPEED_WINDOW_MS = 10_000;

export interface SpeedMeter {
  /** Records the bytes on disk at this moment and returns the speed and time left. */
  sample: (completed: number, total: number, now?: number) => { bytesPerSecond: number | null; remainingSeconds: number | null };
}

/** Speed is the bytes moved over the last 10 seconds, and the time left is what remains at that
 * speed, so the two figures on screen always agree. Both are null until there is time to measure. */
export function createSpeedMeter(windowMs = SPEED_WINDOW_MS): SpeedMeter {
  const samples: { time: number; completed: number }[] = [];
  return {
    sample(completed, total, now = Date.now()) {
      // Bytes going down means the file restarted, so the old samples describe another download.
      if (samples.length && completed < samples[samples.length - 1].completed) samples.length = 0;
      samples.push({ time: now, completed });
      while (samples.length > 2 && now - samples[1].time >= windowMs) samples.shift();
      const oldest = samples[0];
      const seconds = (now - oldest.time) / 1000;
      const bytesPerSecond = seconds >= 1 ? (completed - oldest.completed) / seconds : 0;
      if (bytesPerSecond <= 0) return { bytesPerSecond: null, remainingSeconds: total > 0 && completed >= total ? 0 : null };
      const remainingSeconds = total > completed ? Math.round((total - completed) / bytesPerSecond) : 0;
      return { bytesPerSecond, remainingSeconds };
    },
  };
}
