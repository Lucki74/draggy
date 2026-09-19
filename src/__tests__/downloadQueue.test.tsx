// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { MAX_PARALLEL_PULLS, useModelManager } from "../settings/useModelManager";
import type { PullProgress } from "../llama";

interface Call {
  name: string;
  onProgress: (progress: PullProgress) => void;
  signal?: AbortSignal;
  finish: () => void;
  fail: (message: string) => void;
}

const calls: Call[] = [];

vi.mock("../llama", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llama")>()),
  listInstalledModels: vi.fn(async () => []),
  describeLoadedModels: vi.fn(async () => []),
  deleteModel: vi.fn(async () => undefined),
  unloadModel: vi.fn(async () => undefined),
  pullModel: vi.fn(
    (name: string, onProgress: (progress: PullProgress) => void, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ name, onProgress, signal, finish: resolve, fail: (message) => reject(new Error(message)) });
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
  ),
}));

/** Lets the promise chains behind a settled download run. */
const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const phases = (result: { current: ReturnType<typeof useModelManager> }) =>
  Object.fromEntries(result.current.pulls.map((pull) => [pull.name, pull.phase]));

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("download queue", () => {
  it("runs a few downloads at once and queues the rest in the order asked", () => {
    const { result } = renderHook(() => useModelManager());

    act(() => {
      void result.current.startPull("a");
      void result.current.startPull("b");
      void result.current.startPull("c");
    });

    expect(MAX_PARALLEL_PULLS).toBe(2);
    expect(calls.map((call) => call.name)).toEqual(["a", "b"]);
    expect(phases(result)).toEqual({ a: "preparing", b: "preparing", c: "queued" });
  });

  it("starts the next one the moment a download finishes, and resolves the finished one true", async () => {
    const { result } = renderHook(() => useModelManager());
    let first: Promise<boolean> = Promise.resolve(false);

    act(() => {
      first = result.current.startPull("a");
      void result.current.startPull("b");
      void result.current.startPull("c");
    });

    calls[0].finish();
    await flush();

    await expect(first).resolves.toBe(true);
    expect(calls.map((call) => call.name)).toEqual(["a", "b", "c"]);
    expect(phases(result)).toEqual({ b: "preparing", c: "preparing" });
  });

  it("keeps each download's progress to itself", () => {
    const { result } = renderHook(() => useModelManager());

    act(() => {
      void result.current.startPull("a");
      void result.current.startPull("b");
    });
    act(() => {
      calls[1].onProgress({ phase: "downloading", completed: 40, total: 100, percent: 40 });
    });

    const byName = Object.fromEntries(result.current.pulls.map((pull) => [pull.name, pull]));
    expect(byName.b.percent).toBe(40);
    expect(byName.b.phase).toBe("downloading");
    expect(byName.a.percent).toBe(0);
  });

  it("takes a waiting download out of the queue without ever starting it", async () => {
    const { result } = renderHook(() => useModelManager());
    let waiting: Promise<boolean> = Promise.resolve(true);

    act(() => {
      void result.current.startPull("a");
      void result.current.startPull("b");
      waiting = result.current.startPull("c");
    });
    act(() => result.current.cancelPull("c"));

    await expect(waiting).resolves.toBe(false);
    calls[0].finish();
    await flush();

    expect(calls.map((call) => call.name)).toEqual(["a", "b"]);
    expect(phases(result)).toEqual({ b: "preparing" });
  });

  it("aborts a running download when cancelled and hands its slot to the next", async () => {
    const { result } = renderHook(() => useModelManager());

    act(() => {
      void result.current.startPull("a");
      void result.current.startPull("b");
      void result.current.startPull("c");
    });
    act(() => result.current.cancelPull("a"));
    await flush();

    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(["a", "b", "c"]);
    expect(phases(result)).toEqual({ b: "preparing", c: "preparing" });
    expect(result.current.error).toBe("");
  });

  it("returns the running download when the same model is asked for again", () => {
    const { result } = renderHook(() => useModelManager());
    let one: Promise<boolean> = Promise.resolve(false);
    let two: Promise<boolean> = Promise.resolve(false);

    act(() => {
      one = result.current.startPull("a");
      two = result.current.startPull("a");
    });

    expect(two).toBe(one);
    expect(calls).toHaveLength(1);
    expect(result.current.pulls).toHaveLength(1);
  });

  it("lets an immediate download past a full queue", () => {
    const { result } = renderHook(() => useModelManager());

    act(() => {
      void result.current.startPull("a");
      void result.current.startPull("b");
      void result.current.startPull("embed", { immediate: true });
    });

    expect(calls.map((call) => call.name)).toEqual(["a", "b", "embed"]);
  });

  it("reports a failure, resolves false, and keeps the queue moving", async () => {
    const { result } = renderHook(() => useModelManager());
    let first: Promise<boolean> = Promise.resolve(true);

    act(() => {
      first = result.current.startPull("a");
      void result.current.startPull("b");
      void result.current.startPull("c");
    });
    calls[0].fail("Server returned HTTP 404");
    await flush();

    await expect(first).resolves.toBe(false);
    expect(result.current.error).toBe("Server returned HTTP 404");
    expect(calls.map((call) => call.name)).toEqual(["a", "b", "c"]);
  });
});
