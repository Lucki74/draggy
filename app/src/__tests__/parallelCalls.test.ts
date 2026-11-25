import { describe, expect, it } from "vitest";
import { MAX_PARALLEL_TOOLS, runCalls, runsInParallel } from "../agent/parallelCalls";

interface Call {
  id: number;
  safe: boolean;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

function harness(calls: Call[], stop: () => boolean = () => false, limit?: number) {
  const started: number[] = [];
  const finished: number[] = [];
  let live = 0;
  let peak = 0;

  const run = async (call: Call) => {
    started.push(call.id);
    live++;
    peak = Math.max(peak, live);
    await tick();
    await tick();
    live--;
    finished.push(call.id);
    return `result ${call.id}`;
  };

  return {
    started,
    finished,
    peak: () => peak,
    done: runCalls(calls, { parallel: (call) => call.safe, run, stopped: stop, limit }),
  };
}

const batch = (count: number, safe = true): Call[] => Array.from({ length: count }, (_, id) => ({ id, safe }));

describe("runsInParallel", () => {
  it("lets read-only tools overlap", () => {
    expect(runsInParallel("read_file", { readOnly: true, readOnlyHint: true })).toBe(true);
    expect(runsInParallel("search_web", { readOnlyHint: true }, "web")).toBe(true);
  });

  it("keeps writes, commands and unannotated tools in order", () => {
    expect(runsInParallel("edit_file", { readOnly: false })).toBe(false);
    expect(runsInParallel("run_command", { executes: true, readOnly: true })).toBe(false);
    expect(runsInParallel("mystery", {})).toBe(false);
  });

  it("keeps stateful read-only tools and the browser in order", () => {
    expect(runsInParallel("update_plan", { readOnly: true })).toBe(false);
    expect(runsInParallel("view_image", { readOnly: true })).toBe(false);
    expect(runsInParallel("browser_snapshot", { readOnly: true }, "browser")).toBe(false);
  });
});

describe("runCalls", () => {
  it("runs at least ten safe calls at the same time", async () => {
    expect(MAX_PARALLEL_TOOLS).toBeGreaterThanOrEqual(10);
    const run = harness(batch(12));
    await run.done;
    expect(run.peak()).toBe(12);
  });

  it("queues calls past the limit instead of dropping them", async () => {
    const run = harness(batch(40), () => false, 16);
    const results = await run.done;
    expect(run.peak()).toBe(16);
    expect(results).toHaveLength(40);
    expect(results.every((result) => result !== undefined)).toBe(true);
  });

  it("returns results in the order the calls were written", async () => {
    const results = await harness(batch(5)).done;
    expect(results).toEqual(["result 0", "result 1", "result 2", "result 3", "result 4"]);
  });

  it("runs an unsafe call alone, after what precedes it and before what follows", async () => {
    const calls: Call[] = [
      { id: 0, safe: true },
      { id: 1, safe: true },
      { id: 2, safe: false },
      { id: 3, safe: true },
      { id: 4, safe: true },
    ];
    const run = harness(calls);
    await run.done;
    expect(run.finished.indexOf(2)).toBeGreaterThan(Math.max(run.finished.indexOf(0), run.finished.indexOf(1)));
    expect(run.started.indexOf(3)).toBeGreaterThan(run.finished.indexOf(2));
    expect(run.peak()).toBe(2);
  });

  it("starts nothing more once stopped", async () => {
    let stop = false;
    const calls = batch(6, false);
    const started: number[] = [];
    const results = await runCalls(calls, {
      parallel: () => false,
      stopped: () => stop,
      run: async (call) => {
        started.push(call.id);
        if (call.id === 1) stop = true;
        return call.id;
      },
    });
    expect(started).toEqual([0, 1]);
    expect(results.slice(2).every((result) => result === undefined)).toBe(true);
  });

  it("lets a run settle before rethrowing its first error", async () => {
    const finished: number[] = [];
    await expect(
      runCalls(batch(4), {
        parallel: () => true,
        stopped: () => false,
        run: async (call) => {
          await tick();
          if (call.id === 1) throw new Error("boom");
          finished.push(call.id);
          return call.id;
        },
      }),
    ).rejects.toThrow("boom");
    expect(finished.sort()).toEqual([0, 2, 3]);
  });
});
