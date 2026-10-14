/* eslint-disable @typescript-eslint/no-explicit-any -- the drivers take untyped fixture JSON and call CJS modules, so their values are dynamic */
/** Runs the account runtime supervisor through an ordered list of steps, with its timers faked and its runtime a
 * counter. Steps: acquire, release, advance (the clock moves), stop (quit), crash (the live runtime goes away), reset.
 * Shared by the fixture runner and its generator. */
import { createRequire } from "node:module";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const { createSupervisor } = require("../../../electron/providers/account/supervisor.cjs");

export async function runSupervisor(input: any): Promise<any> {
  vi.useFakeTimers();
  try {
    const runtime = { starts: 0, stops: 0, exit: null as null | (() => void), fail: input.failStarts ?? 0 };
    const start = async (onExit: () => void) => {
      runtime.starts += 1;
      if (runtime.starts <= runtime.fail) throw new Error("spawn failed");
      runtime.exit = onExit;
      return { id: runtime.starts, stop: async () => void (runtime.stops += 1) };
    };
    const states: string[] = [];
    const sleeps: number[] = [];
    const results: unknown[] = [];
    const supervisor = createSupervisor({
      start,
      sleep: async (ms: number) => void sleeps.push(ms),
      onState: (next: string) => states.push(next),
    });
    const settle = async () => {
      for (let i = 0; i < 4; i++) await Promise.resolve();
    };
    for (const op of input.ops as any[]) {
      if (op.op === "acquire") {
        try {
          await supervisor.acquire();
          results.push("ok");
        } catch (error: any) {
          results.push(error.message);
        }
      } else if (op.op === "release") supervisor.release();
      else if (op.op === "advance") vi.advanceTimersByTime(op.ms);
      else if (op.op === "stop") await supervisor.stop();
      else if (op.op === "crash") runtime.exit?.();
      else if (op.op === "reset") supervisor.reset();
      await settle();
    }
    return { results, states, starts: runtime.starts, stops: runtime.stops, sleeps, state: supervisor.state };
  } finally {
    vi.useRealTimers();
  }
}
