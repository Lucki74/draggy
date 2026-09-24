import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBreathing,
  registerForVoice,
  splitCues,
  stripCues,
  synthesizeSound,
} from "../voice/vocalSounds";
import { speakableText } from "../voice/chunker";
import { createSpeaker } from "../voice/speaker";
import { createSystemVoice } from "../voice/systemVoice";
import { buildVoicePrompt } from "../prompts";
import type { VocalSound } from "../voice/vocalSounds";
import type { VoiceEngine } from "../voice/voiceEngine";

const seeded = (seed = 42) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("sound cues", () => {
  it("splits text and sounds in order, whatever the spelling of the cue", () => {
    expect(splitCues("<Sigh> Long day. <laugh/> Anyway <hmm >")).toEqual([
      { kind: "sound", sound: "sigh" },
      { kind: "text", text: "Long day." },
      { kind: "sound", sound: "laugh" },
      { kind: "text", text: "Anyway" },
      { kind: "sound", sound: "hmm" },
    ]);
  });

  it("leaves in the text the cues an engine voices itself", () => {
    expect(splitCues("That's funny <laugh> really.", new Set<VocalSound>(["laugh"]))).toEqual([
      { kind: "text", text: "That's funny <laugh> really." },
    ]);
  });

  it("shows no cue, not even one still arriving", () => {
    expect(stripCues("<sigh> Well, that happens <laugh>.")).toBe("Well, that happens.");
    expect(stripCues("Right <la")).toBe("Right ");
    expect(stripCues("Right")).toBe("Right");
  });

  it("survives the cleaning that removes markup", () => {
    expect(speakableText("**Well** <sigh> it's *done*.")).toBe("Well <sigh> it's done.");
  });
});

describe("automatic breathing", () => {
  const text = (value: string) => ({ kind: "text" as const, text: value });

  it("breathes before starting and after long sentences, never next to another sound", () => {
    const always = createBreathing(() => 0);
    expect(always.before(text("Hi."))).toBe(true);
    expect(always.before(text("Short."))).toBe(false);
    expect(always.before(text("x".repeat(120)))).toBe(false);
    expect(always.before(text("After a long one."))).toBe(true);
    expect(always.before({ kind: "sound", sound: "sigh" })).toBe(false);
    expect(always.before(text("x".repeat(120)))).toBe(false);
    always.reset();
    expect(always.before(text("New reply."))).toBe(true);
  });

  it("keeps it occasional", () => {
    const never = createBreathing(() => 0.99);
    expect(never.before(text("Hi."))).toBe(false);
  });
});

describe("speaker with sounds", () => {
  function fakeEngine(inline: VocalSound[] = []) {
    const said: string[] = [];
    const engine: VoiceEngine = {
      id: "neural",
      inlineCues: new Set(inline),
      enqueue: (text) => said.push(text),
      playSound: (sound) => said.push(`[${sound}]`),
      cancel: () => said.push("(cancel)"),
      duck: () => {},
      dispose: () => {},
    };
    return { engine, said };
  }

  it("turns cues into sounds and adds an opening breath", () => {
    const { engine, said } = fakeEngine(["laugh"]);
    const speaker = createSpeaker(engine, { sounds: true, random: () => 0 });
    speaker.push("Oh no. <sigh> That's a shame, but it's funny <laugh> too.");
    speaker.flush();
    expect(said).toEqual(["[breath]", "Oh no.", "[sigh]", "That's a shame, but it's funny <laugh> too."]);
  });

  it("drops every cue and adds nothing when sounds are off", () => {
    const { engine, said } = fakeEngine();
    const speaker = createSpeaker(engine, { sounds: false, random: () => 0 });
    speaker.push("<sigh> Long day. ");
    speaker.flush();
    expect(said).toEqual(["Long day."]);
  });

  it("holds sounds with the words while suspended", () => {
    const { engine, said } = fakeEngine();
    const speaker = createSpeaker(engine, { sounds: true, random: () => 0.99 });
    speaker.suspend();
    speaker.push("Well. <hmm> Let me think about that one for a second. ");
    speaker.flush();
    expect(said).toEqual(["(cancel)"]);
    speaker.resume();
    expect(said).toEqual(["(cancel)", "Well.", "[hmm]", "Let me think about that one for a second."]);
  });
});

describe("synthesised sounds", () => {
  const rate = 48000;
  const peak = (samples: Float32Array) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
  /** Crossings per second: breath is hiss, a hum is low and smooth. */
  const crossings = (samples: Float32Array) => {
    let count = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 !== samples[i] < 0) count++;
    return (count / samples.length) * rate;
  };

  it("makes every sound audible, below speech, and the length a person takes", () => {
    const lengths: Record<VocalSound, [number, number]> = {
      breath: [0.34, 0.5],
      sigh: [0.75, 1.05],
      hmm: [0.42, 0.6],
      laugh: [0.45, 0.72],
    };
    for (const sound of Object.keys(lengths) as VocalSound[]) {
      const samples = synthesizeSound(sound, { rate, random: seeded() });
      const seconds = samples.length / rate;
      expect(seconds).toBeGreaterThanOrEqual(lengths[sound][0] - 0.01);
      expect(seconds).toBeLessThanOrEqual(lengths[sound][1] + 0.01);
      expect(peak(samples)).toBeGreaterThan(0.02);
      expect(peak(samples)).toBeLessThanOrEqual(0.121);
      expect(samples.every(Number.isFinite)).toBe(true);
      // Fades in and out rather than clicking.
      expect(Math.abs(samples[0])).toBeLessThan(0.005);
      expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.01);
    }
  });

  it("sounds like air for a breath and like a voice for a hum", () => {
    const breath = synthesizeSound("breath", { rate, random: seeded(1) });
    const hmm = synthesizeSound("hmm", { rate, random: seeded(1), register: "low" });
    expect(crossings(breath)).toBeGreaterThan(1500);
    expect(crossings(hmm)).toBeLessThan(600);
  });

  it("never repeats itself exactly, and hums at the voice's pitch", () => {
    const a = synthesizeSound("breath", { rate, random: seeded(1) });
    const b = synthesizeSound("breath", { rate, random: seeded(2) });
    expect(a.length === b.length && a.every((v, i) => v === b[i])).toBe(false);
    const low = crossings(synthesizeSound("hmm", { rate, register: "low", random: seeded(3) }));
    const high = crossings(synthesizeSound("hmm", { rate, register: "high", random: seeded(3) }));
    expect(high).toBeGreaterThan(low * 1.4);
    expect(registerForVoice("F2")).toBe("high");
    expect(registerForVoice("M4")).toBe("low");
  });
});

describe("the voice prompt", () => {
  it("offers the cues only when sounds are on", () => {
    expect(buildVoicePrompt(false, true)).toContain("<laugh> <sigh> <hmm> <breath>");
    expect(buildVoicePrompt(false, false)).not.toContain("<laugh>");
    expect(buildVoicePrompt(true, true).startsWith("If answering needs")).toBe(true);
  });
});

describe("system voice with sounds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits for speech to end before a sound, and for the sound before more speech", () => {
    const spoken: { text: string; onend?: () => void }[] = [];
    vi.stubGlobal("window", { speechSynthesis: {} });
    vi.stubGlobal("speechSynthesis", {
      speak: (utterance: { text: string }) => spoken.push(utterance),
      cancel: () => {},
      getVoices: () => [],
      speaking: false,
      paused: false,
    });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        onend?: () => void;
        onerror?: () => void;
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    const sources: { onended?: () => void; started: boolean }[] = [];
    const context = {
      sampleRate: 48000,
      destination: {},
      createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
      createBufferSource: () => {
        const source = { buffer: null, onended: undefined as undefined | (() => void), started: false, connect: () => {}, start() { source.started = true; }, stop() {} };
        sources.push(source);
        return source;
      },
    } as unknown as AudioContext;

    const speaking: boolean[] = [];
    const voice = createSystemVoice({ language: "en", voice: "", rate: 1, context, onSpeakingChange: (value) => speaking.push(value) });
    voice.enqueue("First.");
    voice.playSound!("sigh");
    voice.enqueue("Second.");

    expect(spoken.map((u) => u.text)).toEqual(["First."]);
    expect(sources.length).toBe(0);

    spoken[0].onend!();
    expect(sources.length).toBe(1);
    expect(sources[0].started).toBe(true);
    expect(spoken.length).toBe(1);

    sources[0].onended!();
    expect(spoken.map((u) => u.text)).toEqual(["First.", "Second."]);
    spoken[1].onend!();
    expect(speaking).toEqual([true, false]);
  });
});
