import { describe, it, expect, vi } from "vitest";
import {
  BARGE_IN_MS,
  ENDPOINT_BASE_MS,
  ENDPOINT_FAST_MS,
  ENDPOINT_SLOW_MS,
  FRAME_MS,
  MIN_SPEECH_MS,
  PREROLL_MS,
  SPECULATE_AT_MS,
  VAD_FRAME,
  framesFor,
} from "../voice/constants";
import { createGate } from "../voice/gate";
import { judgeCompleteness, endpointDelay } from "../voice/turnDetector";
import { isBackchannel } from "../voice/backchannel";
import {
  createSentenceChunker,
  findCut,
  speakableText,
} from "../voice/chunker";
import { createEnergyDetector } from "../voice/vad";
import type { GateEvents } from "../voice/gate";

const frame = () => new Float32Array(VAD_FRAME);

function spyEvents() {
  const events: GateEvents = {
    onSpeechStart: vi.fn(),
    onSpeculate: vi.fn(),
    onSpeechEnd: vi.fn(),
    onBargeIn: vi.fn(),
    onDiscard: vi.fn(),
  };
  return events;
}

function push(
  gate: ReturnType<typeof createGate>,
  probability: number,
  count: number,
  outputActive = false,
) {
  for (let i = 0; i < count; i++) gate.push(frame(), probability, outputActive);
}

describe("deciding when a turn is over", () => {
  it("treats terminal punctuation after a real sentence as finished", () => {
    expect(judgeCompleteness("What time is the train?", "en")).toBe("complete");
    expect(endpointDelay("What time is the train?", "en")).toBe(ENDPOINT_FAST_MS);
  });

  it("waits longer when the speaker stopped on a filler", () => {
    expect(judgeCompleteness("I was thinking about, um", "en")).toBe("unfinished");
    expect(endpointDelay("I was thinking about, um", "en")).toBe(ENDPOINT_SLOW_MS);
  });

  it("waits longer on a trailing conjunction even with a full stop", () => {
    // Recognisers punctuate a trailing-off speaker as if they had finished.
    expect(judgeCompleteness("I went to the shop and.", "en")).toBe("unfinished");
  });

  it("treats a comma as mid-clause", () => {
    expect(judgeCompleteness("First of all,", "en")).toBe("unfinished");
  });

  it("gives no verdict on an unpunctuated fragment of ordinary length", () => {
    expect(judgeCompleteness("show me the weather map", "en")).toBe("unclear");
    expect(endpointDelay("show me the weather map", "en")).toBe(ENDPOINT_BASE_MS);
  });

  it("assumes a one or two word fragment is not finished", () => {
    expect(judgeCompleteness("actually wait", "en")).toBe("unfinished");
  });

  it("applies the same rules in other languages", () => {
    expect(judgeCompleteness("Quelle heure est-il ?", "fr")).toBe("complete");
    expect(judgeCompleteness("je pensais que", "fr")).toBe("unfinished");
    expect(judgeCompleteness("Wie spät ist es?", "de")).toBe("complete");
    expect(judgeCompleteness("ich wollte und", "de")).toBe("unfinished");
  });

  it("falls back to punctuation for languages written without spaces", () => {
    expect(judgeCompleteness("今日の天気は？", "ja")).toBe("complete");
    expect(judgeCompleteness("えっと", "ja")).toBe("unfinished");
  });

  it("says nothing about an empty transcript", () => {
    expect(judgeCompleteness("", "en")).toBe("unclear");
    expect(judgeCompleteness("   ", "en")).toBe("unclear");
  });
});

describe("recognising acknowledgements that are not turns", () => {
  it("matches the usual noises", () => {
    for (const text of ["mhm", "Mhm.", "yeah", "OK", "right", "got it", "uh huh"]) {
      expect(isBackchannel(text, "en"), text).toBe(true);
    }
  });

  it("does not match anything carrying content", () => {
    for (const text of [
      "yeah but wait",
      "ok what about tuesday",
      "right, show me the other one",
      "no",
      "stop talking about that",
    ]) {
      expect(isBackchannel(text, "en"), text).toBe(false);
    }
  });

  it("matches in the user's own language", () => {
    expect(isBackchannel("d'accord", "fr")).toBe(true);
    expect(isBackchannel("genau", "de")).toBe(true);
    expect(isBackchannel("嗯嗯", "zh")).toBe(true);
    expect(isBackchannel("なるほど", "ja")).toBe(true);
  });

  it("still catches English acknowledgements from a non-English speaker", () => {
    // People say "ok" in every language.
    expect(isBackchannel("ok", "fr")).toBe(true);
  });

  it("rejects anything long enough to be a real sentence", () => {
    expect(isBackchannel("yeah yeah yeah yeah yeah", "en")).toBe(false);
    expect(isBackchannel("", "en")).toBe(false);
  });
});

describe("cutting a reply into things worth saying", () => {
  it("lets the opening fragment leave on a comma", () => {
    const chunker = createSentenceChunker();
    const ready = chunker.push("Right, so the answer is about four hours");
    expect(ready).toEqual(["Right,"]);
  });

  it("sends the opening sentence out at any length", () => {
    const chunker = createSentenceChunker();
    expect(chunker.push("Yes. ")).toEqual(["Yes."]);
  });

  it("batches later sentences until they can carry their own rhythm", () => {
    const chunker = createSentenceChunker();
    chunker.push("Yes. ");

    // One short sentence is held back rather than spoken on its own.
    expect(chunker.push("It takes four hours. ")).toEqual([]);

    // Once there is enough behind it, the batch goes out in one piece.
    expect(
      chunker.push("You will want to leave before seven to be safe on the road. "),
    ).toEqual([
      "It takes four hours. You will want to leave before seven to be safe on the road.",
    ]);
  });

  it("does not split on an abbreviation", () => {
    expect(findCut("Ask Dr. ", true)).toBe(-1);
    expect(findCut("It costs 3.5 ", true)).toBe(-1);
  });

  it("splits a long run with no punctuation rather than growing forever", () => {
    const long = "word ".repeat(60);
    expect(findCut(long, false)).toBeGreaterThan(0);
    expect(findCut(long, false)).toBeLessThanOrEqual(220);
  });

  it("keeps everything left over on flush", () => {
    const chunker = createSentenceChunker();
    chunker.push("Sure thing. ");
    chunker.push("Half a sentence");
    expect(chunker.flush()).toBe("Half a sentence");
    expect(chunker.flush()).toBeNull();
  });

  it("removes what a synthesiser cannot say", () => {
    expect(speakableText("**bold** and `code`")).toBe("bold and code");
    expect(speakableText("see [the docs](https://example.com)")).toBe("see the docs");
    expect(speakableText("nice 🎉 work")).toBe("nice work");
    expect(speakableText("go to https://example.com now")).toBe("go to now");
  });

  it("turns line breaks into pauses rather than swallowing them", () => {
    expect(speakableText("First line\nSecond line")).toBe("First line. Second line");
  });
});

describe("turning speech probabilities into turns", () => {
  it("opens a turn when the probability crosses the threshold", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.1, 5);
    expect(events.onSpeechStart).not.toHaveBeenCalled();

    push(gate, 0.8, 1);
    expect(events.onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("keeps the turn open through a dip that never reaches the lower threshold", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.8, 10);
    // Below the opening threshold but above the closing one: still speaking.
    push(gate, 0.42, 30);
    expect(events.onSpeechEnd).not.toHaveBeenCalled();
    expect(gate.state().speaking).toBe(true);
  });

  it("throws away a burst too short to be speech", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.9, framesFor(MIN_SPEECH_MS) - 1);
    push(gate, 0.05, framesFor(ENDPOINT_BASE_MS) + 1);

    expect(events.onDiscard).toHaveBeenCalledTimes(1);
    expect(events.onSpeechEnd).not.toHaveBeenCalled();
  });

  it("closes the turn once the silence reaches the endpoint", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.9, 20);
    push(gate, 0.05, framesFor(ENDPOINT_BASE_MS) - 1);
    expect(events.onSpeechEnd).not.toHaveBeenCalled();

    push(gate, 0.05, 1);
    expect(events.onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("includes the audio from before the onset so the first sound is not clipped", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.05, 40);
    push(gate, 0.9, 20);
    push(gate, 0.05, framesFor(ENDPOINT_BASE_MS));

    const [samples] = (events.onSpeechEnd as ReturnType<typeof vi.fn>).mock.calls[0];
    const captured = (samples as Float32Array).length / VAD_FRAME;
    expect(captured).toBeGreaterThanOrEqual(20 + framesFor(PREROLL_MS));
  });

  it("offers audio for a speculative transcription before the endpoint", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.9, 20);
    push(gate, 0.05, framesFor(SPECULATE_AT_MS));

    expect(events.onSpeculate).toHaveBeenCalledTimes(1);
    expect(events.onSpeechEnd).not.toHaveBeenCalled();
  });

  it("uses the endpoint the turn detector asked for", () => {
    const events = spyEvents();
    const gate = createGate(events);

    gate.setEndpointDelay(ENDPOINT_FAST_MS);
    push(gate, 0.9, 20);
    push(gate, 0.05, framesFor(ENDPOINT_FAST_MS));

    expect(events.onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("does not interrupt the assistant for a short noise", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.9, framesFor(BARGE_IN_MS) - 1, true);
    expect(events.onBargeIn).not.toHaveBeenCalled();
  });

  it("interrupts the assistant once speech is sustained", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.9, framesFor(BARGE_IN_MS), true);
    expect(events.onBargeIn).toHaveBeenCalledTimes(1);

    // Once per turn, no matter how long they keep talking.
    push(gate, 0.9, 40, true);
    expect(events.onBargeIn).toHaveBeenCalledTimes(1);
  });

  it("never reports a barge-in while the assistant is silent", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.95, 60, false);
    expect(events.onBargeIn).not.toHaveBeenCalled();
  });

  it("resets the barge-in guard when the noise stops", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.9, framesFor(BARGE_IN_MS) - 1, true);
    push(gate, 0.1, 2, true);
    push(gate, 0.9, framesFor(BARGE_IN_MS) - 1, true);

    expect(events.onBargeIn).not.toHaveBeenCalled();
  });

  it("demands more confidence to open a turn while the assistant talks", () => {
    const quiet = spyEvents();
    const gateQuiet = createGate(quiet);
    push(gateQuiet, 0.55, 1, false);
    expect(quiet.onSpeechStart).toHaveBeenCalledTimes(1);

    const loud = spyEvents();
    const gateLoud = createGate(loud);
    push(gateLoud, 0.55, 1, true);
    expect(loud.onSpeechStart).not.toHaveBeenCalled();
  });

  it("reports nothing to transcribe before there is enough speech", () => {
    const gate = createGate(spyEvents());
    push(gate, 0.9, 2);
    expect(gate.snapshot()).toBeNull();

    push(gate, 0.9, 20);
    expect(gate.snapshot()).not.toBeNull();
  });

  it("forgets the turn in progress when reset", () => {
    const events = spyEvents();
    const gate = createGate(events);

    push(gate, 0.9, 20);
    gate.reset();
    expect(gate.state().speaking).toBe(false);
    expect(gate.state().endpointMs).toBeCloseTo(framesFor(ENDPOINT_BASE_MS) * FRAME_MS);

    push(gate, 0.05, 100);
    expect(events.onSpeechEnd).not.toHaveBeenCalled();
  });
});

describe("the detector used when the neural one will not load", () => {
  it("reports near zero for a quiet room and high for a voice", () => {
    const scores: number[] = [];
    const detector = createEnergyDetector((_, probability) =>
      scores.push(probability),
    );

    const quiet = new Float32Array(VAD_FRAME);
    for (let i = 0; i < VAD_FRAME; i++) quiet[i] = (Math.random() - 0.5) * 0.002;
    for (let i = 0; i < 40; i++) detector.push(quiet);

    expect(scores[scores.length - 1]).toBeLessThan(0.2);

    const voice = new Float32Array(VAD_FRAME);
    for (let i = 0; i < VAD_FRAME; i++) voice[i] = Math.sin(i / 4) * 0.2;
    detector.push(voice);

    expect(scores[scores.length - 1]).toBeGreaterThan(0.5);
  });

  it("hands back the frame it scored, so ordering is preserved", () => {
    const seen: Float32Array[] = [];
    const detector = createEnergyDetector((frameOut) => seen.push(frameOut));

    const first = new Float32Array(VAD_FRAME).fill(0.1);
    const second = new Float32Array(VAD_FRAME).fill(0.2);
    detector.push(first);
    detector.push(second);

    expect(seen[0][0]).toBeCloseTo(0.1);
    expect(seen[1][0]).toBeCloseTo(0.2);
  });
});
