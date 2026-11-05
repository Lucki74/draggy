import type { ToolAnnotations } from "./permissions";

/** Most calls of one reply that run at the same moment. A model that asks for more is queued behind
 * these, not refused. */
export const MAX_PARALLEL_TOOLS = 16;

/** Read-only tools that still share state or the screen, so two of them in one reply keep the order
 * the model wrote them in. */
const ORDERED_TOOLS = new Set(["update_plan", "ask_user", "use_skill", "view_image"]);

/** Whether a call may run beside its neighbours. Only tools that change nothing qualify, and an
 * annotation that is missing reads as "not safe". The embedded browser is one page with one cursor,
 * so its tools never overlap. */
export function runsInParallel(name: string, annotations: ToolAnnotations, group?: string): boolean {
  if (ORDERED_TOOLS.has(name) || group === "browser") return false;
  if (annotations.executes) return false;

  return Boolean(annotations.readOnlyHint ?? annotations.readOnly);
}

export interface CallBatch<C, R> {
  /** Whether this call may overlap the ones next to it. */
  parallel: (call: C) => boolean;
  run: (call: C) => Promise<R>;
  /** True once the turn was stopped: no further call starts. */
  stopped: () => boolean;
  limit?: number;
}

/** Runs a reply's tool calls. A run of parallel-safe calls goes out together, up to `limit` at once; any
 * other call waits for everything before it and holds back everything after it, so a write is never
 * reordered past a read. Results come back in the order the calls were written, and a call that never
 * started (the turn was stopped) is `undefined`. If calls throw, the rest of their run still settles
 * before the first error is rethrown. */
export async function runCalls<C, R>(
  calls: readonly C[],
  { parallel, run, stopped, limit = MAX_PARALLEL_TOOLS }: CallBatch<C, R>,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = calls.map(() => undefined);
  const width = Math.max(1, Math.floor(limit));
  let at = 0;

  while (at < calls.length && !stopped()) {
    if (!parallel(calls[at])) {
      results[at] = await run(calls[at]);
      at++;
      continue;
    }

    const start = at;
    let end = at;
    while (end < calls.length && parallel(calls[end])) end++;

    let next = start;
    let failure: { error: unknown } | undefined;
    const worker = async () => {
      while (next < end && !stopped()) {
        const index = next++;
        try {
          results[index] = await run(calls[index]);
        } catch (error) {
          failure ??= { error };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(width, end - start) }, worker));
    if (failure) throw failure.error;

    at = end;
  }

  return results;
}
