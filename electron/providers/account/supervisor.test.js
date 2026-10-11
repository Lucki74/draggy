import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createSupervisor, IDLE_MS } = require("./supervisor.cjs");

/** A runtime that records its starts and lets the test crash the live one. */
function fakeRuntime({ failStarts = 0 } = {}) {
  const runtime = { starts: 0, stops: 0, exit: null };
  runtime.start = vi.fn(async (onExit) => {
    runtime.starts += 1;
    if (runtime.starts <= failStarts) throw new Error("spawn failed");
    runtime.exit = onExit;
    return { id: runtime.starts, stop: async () => void (runtime.stops += 1) };
  });
  return runtime;
}

const sleeps = [];
const make = (runtime, options = {}) =>
  createSupervisor({ start: runtime.start, sleep: async (ms) => void sleeps.push(ms), ...options });

beforeEach(() => {
  sleeps.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("supervisor", () => {
  it("starts nothing until first used, then shares one runtime", async () => {
    const runtime = fakeRuntime();
    const supervisor = make(runtime);
    expect(runtime.starts).toBe(0);
    const [a, b] = await Promise.all([supervisor.acquire(), supervisor.acquire()]);
    expect(a).toBe(b);
    expect(runtime.starts).toBe(1);
    expect(supervisor.state).toBe("running");
  });

  it("stops ten minutes after the last user lets go, and not while one holds on", async () => {
    const runtime = fakeRuntime();
    const supervisor = make(runtime);
    await supervisor.acquire();
    await supervisor.acquire();
    supervisor.release();
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(runtime.stops).toBe(0);
    supervisor.release();
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(runtime.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.stops).toBe(1);
    expect(supervisor.state).toBe("stopped");
  });

  it("stops at once on quit, and a stop on purpose is not a crash", async () => {
    const runtime = fakeRuntime();
    const supervisor = make(runtime);
    await supervisor.acquire();
    await supervisor.stop();
    runtime.exit();
    expect(runtime.stops).toBe(1);
    await supervisor.acquire();
    expect(sleeps).toEqual([]);
  });

  it("restarts after a crash with growing backoff, and gives up after the third", async () => {
    const runtime = fakeRuntime();
    const supervisor = make(runtime);
    for (let crash = 0; crash < 3; crash += 1) {
      await supervisor.acquire();
      supervisor.release();
      runtime.exit();
    }
    expect(sleeps).toEqual([1000, 4000]);
    await supervisor.acquire();
    runtime.exit();
    expect(sleeps).toEqual([1000, 4000, 16000]);
    expect(supervisor.state).toBe("unavailable");
    await expect(supervisor.acquire()).rejects.toMatchObject({ code: "account-runtime-unavailable" });
    expect(runtime.starts).toBe(4);
  });

  it("counts a start that fails as a crash", async () => {
    const runtime = fakeRuntime({ failStarts: 4 });
    const supervisor = make(runtime);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(supervisor.acquire()).rejects.toMatchObject({ code: "account-runtime-unavailable" });
    }
    expect(supervisor.state).toBe("unavailable");
    supervisor.reset();
    await expect(supervisor.acquire()).resolves.toMatchObject({ id: 5 });
  });

  it("forgets old crashes once a run idles out cleanly", async () => {
    const runtime = fakeRuntime();
    const supervisor = make(runtime);
    await supervisor.acquire();
    runtime.exit();
    await supervisor.acquire();
    supervisor.release();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    await supervisor.acquire();
    expect(sleeps).toEqual([1000]);
  });

  it("reports each state change once", async () => {
    const onState = vi.fn();
    const runtime = fakeRuntime();
    const supervisor = make(runtime, { onState });
    await supervisor.acquire();
    await supervisor.stop();
    expect(onState.mock.calls.flat()).toEqual(["starting", "running", "stopped"]);
  });
});
