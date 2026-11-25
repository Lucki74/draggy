export const MAX_RETRIES = 5;

/** A reply that failed in a way another try can fix, such as a dropped connection or an engine still starting. */
export class TransientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransientError";
    this.status = status;
  }
}

export const isTransientStatus = (status: number): boolean => [408, 500, 502, 503, 504].includes(status);

/** Waits longer after each failure, up to 8 s, so a busy engine is not hammered. */
export const backoffMs = (attempt: number): number => Math.min(8000, 500 * 2 ** (attempt - 1));

/** Waits for a reply's first chunk, so a stream that dies before saying anything can be asked for again. */
export async function openStream<T>(source: AsyncGenerator<T, void, unknown>): Promise<AsyncGenerator<T, void, unknown>> {
  let first: IteratorResult<T, void>;
  try {
    first = await source.next();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new TransientError(error instanceof Error ? error.message : String(error), null, { cause: error });
  }
  return (async function* () {
    if (first.done) return;
    yield first.value;
    yield* source;
  })();
}

export interface RetryOptions {
  retries?: number;
  signal?: AbortSignal;
  /** Called before each wait with the attempt about to run, so the screen can show it. */
  onRetry?: (attempt: number, of: number, waitMs: number, error: TransientError) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

/** Runs `run`, trying again after a TransientError up to `retries` more times. Anything else, and a stop, ends it at once. */
export async function withRetries<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = MAX_RETRIES, signal, onRetry, sleep = sleepFor } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof TransientError) || attempt > retries || signal?.aborted) throw error;
      const wait = backoffMs(attempt);
      onRetry?.(attempt, retries, wait, error);
      await sleep(wait, signal);
    }
  }
}
