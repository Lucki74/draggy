import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../voice/playerWorklet.ts?worker&url", () => ({ default: "player.js" }));

import { createCloudVoice, type CloudFailure } from "../voice/cloudVoice";

type Frame = { turnId: number; pcm: Int16Array; sampleRate: number };

function setup(speak: (turnId: number, request: { text: string }) => Promise<{ success: boolean; code?: string; characters?: number }>) {
  let deliver: (frame: Frame) => void = () => {};
  const posted: { type: string }[] = [];
  const cancelled: number[] = [];
  const param = { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} };
  const node = () => ({ connect() {}, disconnect() {} });
  const filter = () => ({ ...node(), frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, type: "" });
  const context = {
    currentTime: 0,
    destination: {},
    audioWorklet: { addModule: async () => {} },
    createBiquadFilter: filter,
    createDynamicsCompressor: () => ({ ...node(), threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } }),
    createGain: () => ({ ...node(), gain: param }),
  } as unknown as AudioContext;
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port: { postMessage: (m: { type: string }) => void; onmessage: unknown } = { postMessage: (m) => posted.push(m), onmessage: null };
      connect() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("window", {
    electronAPI: {
      tts: {
        speak,
        cancel: async (turn: number) => void cancelled.push(turn),
        onFrames: (cb: (frame: Frame) => void) => {
          deliver = cb;
          return () => {};
        },
      },
    },
  });
  return { context, posted, cancelled, frame: (turnId: number) => deliver({ turnId, pcm: new Int16Array(960), sampleRate: 24000 }) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const options = (onFailure: (failure: CloudFailure) => void) => ({
  provider: "openai",
  language: "en",
  voice: "",
  rate: 1,
  onSpeakingChange: () => {},
  onFailure,
});

describe("the cloud voice", () => {
  it("hands the current and queued fragments back when a request fails", async () => {
    const calls: string[] = [];
    const { context } = setup(async (_turn, request) => {
      calls.push(request.text);
      return { success: false, code: "http-429" };
    });
    const failures: CloudFailure[] = [];
    const voice = await createCloudVoice(context, options((failure) => failures.push(failure)));

    voice.enqueue("One.");
    voice.enqueue("Two.");
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toEqual(["One."]);
    expect(failures).toEqual([{ code: "http-429", remaining: ["One.", "Two."] }]);
  });

  it("calls a fragment stalled when no audio arrives, and not while frames keep coming", async () => {
    const { context, frame } = setup(() => new Promise(() => {}));
    const failures: CloudFailure[] = [];
    const voice = await createCloudVoice(context, options((failure) => failures.push(failure)));

    voice.enqueue("Slow start.");
    await vi.advanceTimersByTimeAsync(5000);
    frame(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(failures).toEqual([]);

    const silent = setup(() => new Promise(() => {}));
    const second: CloudFailure[] = [];
    const quiet = await createCloudVoice(silent.context, options((failure) => second.push(failure)));
    quiet.enqueue("Nothing comes.");
    await vi.advanceTimersByTimeAsync(6500);
    expect(second.map((failure) => failure.code)).toEqual(["stalled"]);
  });

  it("drops frames from a cancelled turn", async () => {
    const { context, frame, posted } = setup(() => new Promise(() => {}));
    const voice = await createCloudVoice(context, options(() => {}));

    voice.enqueue("Hello.");
    voice.cancel();
    frame(1);

    expect(posted.filter((message) => message.type === "pcm")).toEqual([]);
    expect(posted.some((message) => message.type === "cancel")).toBe(true);
  });
});
