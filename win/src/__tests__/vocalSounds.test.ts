import { describe, expect, it } from "vitest";
import { splitCues, stripCues, isPlayful } from "../voice/vocalSounds";
import { speakableText } from "../voice/chunker";
import { createSpeaker } from "../voice/speaker";
import { buildVoicePrompt } from "../prompts";
import type { VocalSound } from "../voice/vocalSounds";
import type { VoiceEngine } from "../voice/voiceEngine";

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

describe("speaker with sounds", () => {
  function fakeEngine(inline: VocalSound[] = []) {
    const said: string[] = [];
    const engine: VoiceEngine = {
      id: "neural",
      inlineCues: new Set(inline),
      enqueue: (text) => said.push(text),
      cancel: () => said.push("(cancel)"),
      duck: () => {},
      dispose: () => {},
    };
    return { engine, said };
  }

  const reply = (speaker: ReturnType<typeof createSpeaker>, text: string) => {
    speaker.push(text);
    speaker.flush();
  };

  it("keeps only the cues the engine voices itself, and none in the first reply", () => {
    const { engine, said } = fakeEngine(["laugh"]);
    const speaker = createSpeaker(engine, { sounds: true, playful: () => true });
    reply(speaker, "Oh dear. <sigh> It's funny <laugh> too.");
    expect(said).toEqual(["Oh dear.", "It's funny too."]);
    said.length = 0;
    reply(speaker, "Oh dear. <sigh> It's funny <laugh> too.");
    expect(said).toEqual(["Oh dear.", "It's funny <laugh> too."]);
  });

  it("allows one cue per reply and one in four replies", () => {
    const { engine, said } = fakeEngine(["laugh"]);
    const speaker = createSpeaker(engine, { sounds: true, playful: () => true });
    reply(speaker, "Hello there.");
    said.length = 0;
    reply(speaker, "Ha <laugh> and again <laugh> done.");
    expect(said.join(" ")).toBe("Ha <laugh> and again done.");
    for (let i = 0; i < 3; i++) {
      said.length = 0;
      reply(speaker, "Fun <laugh> thing.");
      expect(said.join(" ")).toBe("Fun thing.");
    }
    said.length = 0;
    reply(speaker, "Fun <laugh> thing.");
    expect(said.join(" ")).toBe("Fun <laugh> thing.");
  });

  it("laughs only when the person was playful", () => {
    let playful = false;
    const { engine, said } = fakeEngine(["laugh"]);
    const speaker = createSpeaker(engine, { sounds: true, playful: () => playful });
    reply(speaker, "Hello there.");
    said.length = 0;
    reply(speaker, "That is funny <laugh> indeed.");
    expect(said.join(" ")).toBe("That is funny indeed.");
    playful = true;
    for (let i = 0; i < 3; i++) reply(speaker, "Hm.");
    said.length = 0;
    reply(speaker, "That is funny <laugh> indeed.");
    expect(said.join(" ")).toBe("That is funny <laugh> indeed.");
  });

  it("reads jokes in four languages", () => {
    for (const text of ["haha good one", "LOL", "jajaja qu├® bueno", "mdr c'est nul", "хаха очень смешно", "that is great 😂"]) {
      expect(isPlayful(text), text).toBe(true);
    }
    for (const text of ["What is the weather", "Hahahn", "Explain recursion"]) expect(isPlayful(text), text).toBe(false);
  });

  it("drops every cue when sounds are off or the engine has none", () => {
    for (const options of [{ sounds: false }, { sounds: true }]) {
      const { engine, said } = fakeEngine();
      const speaker = createSpeaker(engine, options);
      reply(speaker, "Fine.");
      said.length = 0;
      reply(speaker, "<sigh> Long day. ");
      expect(said).toEqual(["Long day."]);
    }
  });

  it("never plays a sound as a separate event", () => {
    const { engine, said } = fakeEngine(["laugh"]);
    const speaker = createSpeaker(engine, { sounds: true, playful: () => true });
    reply(speaker, "Hi.");
    reply(speaker, "Hmm <hmm> well <breath> yes.");
    expect(said.some((entry) => entry.startsWith("["))).toBe(false);
  });

  it("holds text while suspended", () => {
    const { engine, said } = fakeEngine();
    const speaker = createSpeaker(engine, { sounds: true, playful: () => true });
    speaker.suspend();
    speaker.push("Well. Let me think about that one for a second. ");
    speaker.flush();
    expect(said).toEqual(["(cancel)"]);
    speaker.resume();
    expect(said).toEqual(["(cancel)", "Well.", "Let me think about that one for a second."]);
  });
});

describe("the voice prompt", () => {
  it("offers the cues only when sounds are on", () => {
    expect(buildVoicePrompt(false, ["laugh", "sigh", "hmm", "breath"])).toContain("<laugh> <sigh> <hmm> <breath>");
    expect(buildVoicePrompt(false, [])).not.toContain("<laugh>");
    expect(buildVoicePrompt(true, ["laugh", "sigh", "hmm", "breath"]).startsWith("If answering needs")).toBe(true);
  });
});
