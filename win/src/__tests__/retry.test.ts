import { describe, expect, it, vi } from "vitest";
import { MAX_RETRIES, TransientError, backoffMs, isTransientStatus, openStream, withRetries } from "../agent/retry";

// A reply that stalls or drops mid-way is tried again up to five times before the turn is given up on.

const now = async () => {};

describe("withRetries", () => {
  it("tries again after a transient failure and returns the first success", async () => {
    const run = vi.fn().mockRejectedValueOnce(new TransientError("dropped")).mockResolvedValue("done");
    const seen: number[] = [];

    await expect(withRetries(run, { sleep: now, onRetry: (attempt) => seen.push(attempt) })).resolves.toBe("done");
    expect(run).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([1]);
  });

  it("gives up after five retries, six tries in all", async () => {
    const run = vi.fn().mockRejectedValue(new TransientError("engine starting", 503));

    await expect(withRetries(run, { sleep: now })).rejects.toThrow("engine starting");
    expect(MAX_RETRIES).toBe(5);
    expect(run).toHaveBeenCalledTimes(6);
  });

  it("does not retry a failure another try cannot fix", async () => {
    const run = vi.fn().mockRejectedValue(new Error("model file missing"));

    await expect(withRetries(run, { sleep: now })).rejects.toThrow("model file missing");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops at once when the user stops the turn", async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => {
      controller.abort();
      throw new TransientError("dropped");
    });

    await expect(withRetries(run, { sleep: now, signal: controller.signal })).rejects.toThrow("dropped");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports how many tries there are, for the on-screen count", async () => {
    const run = vi.fn().mockRejectedValueOnce(new TransientError("x")).mockResolvedValue(1);
    const onRetry = vi.fn();

    await withRetries(run, { sleep: now, onRetry });

    expect(onRetry).toHaveBeenCalledWith(1, 5, 500, expect.any(TransientError));
  });
});

describe("what counts as transient", () => {
  it("covers a busy or restarting engine but not a bad request", () => {
    expect([408, 500, 502, 503, 504].every(isTransientStatus)).toBe(true);
    expect([400, 401, 404, 422].some(isTransientStatus)).toBe(false);
  });

  it("waits longer each time, capped", () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(backoffMs(9)).toBe(8000);
  });
});

describe("a reply stream that dies before its first chunk", () => {
  async function* chunks(...items: string[]) {
    for (const item of items) yield item;
  }
  async function* dies() {
    throw new TypeError("network error");
    yield "never";
  }
  const collect = async (stream: AsyncGenerator<string, void, unknown>) => {
    const out: string[] = [];
    for await (const item of stream) out.push(item);
    return out;
  };

  it("hands every chunk on, the first included", async () => {
    expect(await collect(await openStream(chunks("a", "b", "c")))).toEqual(["a", "b", "c"]);
    expect(await collect(await openStream(chunks()))).toEqual([]);
  });

  it("becomes a failure that is tried again, so a stall before any text costs a retry not the turn", async () => {
    let tries = 0;
    const text = await withRetries(
      async () => collect(await openStream(++tries < 3 ? dies() : chunks("hello"))),
      { sleep: now },
    );

    expect(text).toEqual(["hello"]);
    expect(tries).toBe(3);
  });

  it("lets a stop through untouched", async () => {
    async function* stopped() {
      throw new DOMException("Aborted", "AbortError");
      yield "never";
    }
    await expect(openStream(stopped())).rejects.toMatchObject({ name: "AbortError" });
  });
});
