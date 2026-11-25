import { describe, expect, it, vi } from "vitest";
import { previewVoice } from "../voice/preview";

function setup() {
  const dispose = vi.fn();
  const enqueue = vi.fn();
  const close = vi.fn(() => Promise.resolve());
  let speaking: (value: boolean) => void = () => {};
  const createVoice = vi.fn(async (_context: unknown, options: { onSpeakingChange: (v: boolean) => void }) => {
    speaking = options.onSpeakingChange;
    return { id: "neural", device: "wasm", enqueue, dispose, cancel: vi.fn(), duck: vi.fn() };
  });
  const deps = { createContext: () => ({ close }) as unknown as AudioContext, createVoice: createVoice as never };
  return { dispose, enqueue, close, deps, speaking: (v: boolean) => speaking(v) };
}

const options = { voice: "F1", language: "en", rate: 1, text: "Hello." };

describe("voice preview", () => {
  it("speaks the sample, then releases the engine and audio when it ends", async () => {
    const { deps, enqueue, dispose, close, speaking } = setup();
    const done = vi.fn();
    previewVoice({ ...options, onDone: done }, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(enqueue).toHaveBeenCalledWith("Hello.", "final");
    speaking(true);
    expect(dispose).not.toHaveBeenCalled();
    speaking(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("stops early without speaking when cancelled before the engine is ready", async () => {
    const { deps, enqueue, dispose } = setup();
    const stop = previewVoice(options, deps);
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(enqueue).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("finishes when the engine cannot start", async () => {
    const done = vi.fn();
    const deps = {
      createContext: () => ({ close: () => Promise.resolve() }) as unknown as AudioContext,
      createVoice: (() => Promise.reject(new Error("no model"))) as never,
    };
    previewVoice({ ...options, onDone: done }, deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
