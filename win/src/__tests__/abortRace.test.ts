import { describe, expect, it } from "vitest";
import { raceAbort } from "../agent/abortRace";

describe("raceAbort", () => {
  it("returns the work when it finishes first, and leaves no listener behind", async () => {
    const controller = new AbortController();
    let added = 0;
    let removed = 0;
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
      added++;
      return add(...args);
    }) as typeof add;
    controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
      removed++;
      return remove(...args);
    }) as typeof remove;

    expect(await raceAbort(controller.signal, Promise.resolve("done"), "cancelled")).toBe("done");
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });

  it("answers cancelled when the signal fires first", async () => {
    const controller = new AbortController();
    const pending = raceAbort(controller.signal, new Promise<string>(() => {}), "cancelled");
    controller.abort();
    expect(await pending).toBe("cancelled");
  });

  it("answers cancelled at once for a signal already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await raceAbort(controller.signal, new Promise<string>(() => {}), "cancelled")).toBe("cancelled");
  });

  it("passes a rejection through", async () => {
    const controller = new AbortController();
    await expect(raceAbort(controller.signal, Promise.reject(new Error("boom")), "x")).rejects.toThrow("boom");
  });
});
