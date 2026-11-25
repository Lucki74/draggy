/** Runs work against a stop signal. If the signal fires first, `cancelled` is the answer and the
 * work is left to finish on its own; either way the listener is removed, so a long turn with many
 * tool calls does not pile up listeners on one signal. */
export async function raceAbort<T>(signal: AbortSignal, work: Promise<T>, cancelled: T): Promise<T> {
  if (signal.aborted) return cancelled;

  let onAbort: (() => void) | undefined;
  const stopped = new Promise<T>((resolve) => {
    onAbort = () => resolve(cancelled);
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([work, stopped]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
