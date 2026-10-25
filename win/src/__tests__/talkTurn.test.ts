// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechStageError } from "../speechPipeline";
import type { ConversationConfig, ConversationView } from "../voice/conversation";
import type { GateEvents } from "../voice/gate";

/** One talk turn through openConversation: the gate reports the end of speech, the transcript is
 * read, and a reply either starts or does not. */

let events: GateEvents;
const transcribeSamples = vi.fn();
const generateReply = vi.fn();

vi.mock("../speech", () => ({
  prepareSpeech: async () => {},
  transcribeSamples: (...args: unknown[]) => transcribeSamples(...args),
}));

vi.mock("../voice/gate", () => ({
  createGate: (captured: GateEvents) => {
    events = captured;
    return { push() {}, snapshot: () => null, state: () => ({ speaking: false }), setEndpointDelay() {}, reset() {} };
  },
}));

vi.mock("../voice/capture", () => ({
  startCapture: async () => ({ stop() {}, setMuted() {}, context: {}, denoising: () => false }),
}));

vi.mock("../voice/vad", () => ({
  createDetector: async () => ({ kind: "energy", push() {}, reset() {}, stop() {} }),
}));

vi.mock("../voice/talkModel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../voice/talkModel")>()),
  provideTalkModel: async () => ({ model: "test-model" }),
  warmTalkModel: async () => {},
}));

vi.mock("../voice/systemVoice", () => ({
  isSystemVoiceSupported: () => true,
  createSystemVoice: () => ({ id: "system", dispose() {} }),
}));

vi.mock("../voice/speaker", () => ({
  createSpeaker: () => ({
    push() {},
    flush() {},
    say() {},
    cancel() {},
    duck() {},
    resume() {},
    suspend() {},
    suspended: () => false,
    dispose() {},
  }),
}));

vi.mock("../voice/reply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../voice/reply")>()),
  generateReply: (...args: unknown[]) => generateReply(...args),
}));

const { openConversation } = await import("../voice/conversation");

// Stands in for a recording: the real speech engine cannot run under jsdom.
const sample = Float32Array.from({ length: 24000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16000));

const config: ConversationConfig = {
  language: "en",
  preferredModel: "",
  chatModel: "chat-model",
  installed: [],
  vram: 8,
  engine: "system",
  systemVoice: "",
  neuralVoice: "",
  rate: 1,
  searchEnabled: false,
  sounds: false,
};

const strings = {
  preparing: "preparing",
  downloadingModel: "downloading",
  warmingUp: "warming",
  loadingSpeechModel: "speech",
  loadingNeuralVoice: "voice",
  lookingItUp: "looking",
  noVoiceOutput: "none",
};

const open = async () => {
  const views: ConversationView[] = [];
  await openConversation(config, { onView: (view) => views.push(view), onStep: () => {}, strings });
  return views;
};

beforeEach(() => {
  transcribeSamples.mockReset();
  generateReply.mockReset();
  generateReply.mockImplementation(async (_request, handlers) => handlers.onSpeech("It is sunny."));
});

describe("talk turn", () => {
  it("answers the transcript it heard", async () => {
    transcribeSamples.mockResolvedValue("what is the weather today");
    const views = await open();

    events.onSpeechEnd(sample, 1000);

    await vi.waitFor(() => expect(views.at(-1)?.turns.at(-1)?.text).toBe("It is sunny."));
    const turns = generateReply.mock.calls[0][0].turns;
    expect(turns.at(-1)).toEqual({ role: "user", content: "what is the weather today" });
    expect(views.every((view) => view.error === "")).toBe(true);
  });

  it("does not reply to an empty transcript", async () => {
    transcribeSamples.mockResolvedValue("");
    const views = await open();

    events.onSpeechEnd(sample, 1000);

    await vi.waitFor(() => expect(views.at(-1)?.activity).toBe("listening"));
    expect(generateReply).not.toHaveBeenCalled();
  });

  it("reports a recognition failure and starts no reply", async () => {
    transcribeSamples.mockRejectedValue(new SpeechStageError("tokenizer", new Error("no tokenizer.json")));
    const views = await open();

    events.onSpeechEnd(sample, 1000);

    await vi.waitFor(() => expect(views.at(-1)?.error).toContain("failed at tokenizer"));
    expect(generateReply).not.toHaveBeenCalled();
  });
});
