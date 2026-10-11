import { describe, expect, it } from "vitest";
import { createSentenceChunker, findBoundary, speakableText } from "../voice/chunker";
import { applyFades, pauseSeconds, prepareFragment, trimSilence } from "../voice/joins";
import { PEAK_CEILING, integratedLoudness, levelGain } from "../voice/loudness";
import { normalizeSpeech, numberToWords } from "../voice/normalize";
import { mulberry32, preprocessText } from "../voice/supertonic";
import { wasmThreads } from "../voice/threads";

const RATE = 24000;
const tone = (seconds: number, amplitude: number, frequency = 220) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE),
  );

describe("chunk boundaries", () => {
  it("labels sentence, clause and final fragments", () => {
    const chunker = createSentenceChunker();
    expect(chunker.pushFragments("Well, I think so. ").map((f) => f.boundary)).toEqual(["sentence"]);
    chunker.reset();
    expect(chunker.pushFragments("Well, I think").map((f) => f.boundary)).toEqual(["clause"]);
    chunker.reset();
    chunker.pushFragments("No sentence end yet");
    expect(chunker.flushFragment()).toEqual({ text: "No sentence end yet", boundary: "final" });
  });

  it("forces a long run apart at a clause mark, then a conjunction, then a space", () => {
    const clause = `${"word ".repeat(30)}and then, ${"more ".repeat(20)}`;
    const found = findBoundary(clause, false)!;
    expect(found.boundary).toBe("forced");
    expect(clause.slice(0, found.cut).trimEnd().endsWith(",")).toBe(true);

    const conjunction = `${"word ".repeat(30)}and ${"more ".repeat(20)}`;
    const cut = findBoundary(conjunction, false)!.cut;
    expect(conjunction.slice(cut).startsWith("and ")).toBe(true);

    const plain = "word ".repeat(60);
    const plainCut = findBoundary(plain, false)!.cut;
    expect(plainCut).toBeLessThanOrEqual(220);
    expect(plain[plainCut - 1]).toBe(" ");
  });

  it("closes a continuation with a comma and a statement with a full stop", () => {
    expect(preprocessText("so we went", "en", "forced")).toBe("<en>so we went,</en>");
    expect(preprocessText("so we went", "en", "clause")).toBe("<en>so we went,</en>");
    expect(preprocessText("so we went", "en", "sentence")).toBe("<en>so we went.</en>");
    expect(preprocessText("so we went", "en")).toBe("<en>so we went.</en>");
    expect(preprocessText("Really?", "en", "forced")).toBe("<en>Really?</en>");
  });
});

describe("joins", () => {
  it("trims silence but keeps a guard around the speech", () => {
    const speech = tone(0.3, 0.4);
    const padded = new Float32Array(RATE);
    padded.set(speech, RATE * 0.3);
    const trimmed = trimSilence(padded, RATE);
    expect(trimmed.length).toBeLessThan(padded.length * 0.5);
    expect(trimmed.length).toBeGreaterThan(speech.length);
    expect(trimSilence(new Float32Array(1000), RATE).length).toBe(0);
  });

  it("fades both edges to zero and never changes length", () => {
    const samples = Float32Array.from({ length: 4000 }, () => 0.5);
    const length = samples.length;
    applyFades(samples, RATE);
    expect(samples.length).toBe(length);
    expect(samples[0]).toBe(0);
    expect(Math.abs(samples[length - 1])).toBeLessThan(0.01);
    expect(samples[length >> 1]).toBe(0.5);

    const tiny = new Float32Array(10).fill(1);
    applyFades(tiny, RATE);
    expect(tiny.every(Number.isFinite)).toBe(true);
  });

  it("leaves no step above 0.05 at a join", () => {
    const a = prepareFragment(tone(0.4, 0.5), RATE, "sentence", "One.").samples;
    const b = prepareFragment(tone(0.4, 0.5, 330), RATE, "final", "Two.").samples;
    expect(Math.abs(a[a.length - 1] - b[0])).toBeLessThan(0.05);
  });

  it("pauses within range for each boundary, longer after a question, shorter when faster", () => {
    const low = () => 0;
    const high = () => 0.999;
    expect(pauseSeconds("clause", "so", 1, low)).toBeCloseTo(0.09);
    expect(pauseSeconds("clause", "so", 1, high)).toBeLessThanOrEqual(0.14);
    expect(pauseSeconds("sentence", "Done.", 1, low)).toBeCloseTo(0.22);
    expect(pauseSeconds("final", "Done.", 1, high)).toBeLessThanOrEqual(0.32);
    expect(pauseSeconds("sentence", "Really?", 1, low)).toBeCloseTo(0.3);
    expect(pauseSeconds("sentence", "Done.", 2, low)).toBeCloseTo(0.11);
  });
});

describe("loudness", () => {
  it("measures a full-scale 1 kHz tone near its known level", () => {
    // A -20 dBFS 1 kHz sine reads about -23 LUFS: K-weighting adds roughly 0.7 dB there, minus 3 dB for a sine.
    const level = integratedLoudness(tone(2, 0.1, 1000), 48000 / 2);
    expect(level).toBeGreaterThan(-24.5);
    expect(level).toBeLessThan(-22);
    expect(integratedLoudness(new Float32Array(RATE), RATE)).toBe(-Infinity);
  });

  it("brings quiet and loud fragments to the same level", () => {
    const target = -20;
    for (const amplitude of [0.08, 0.4]) {
      const samples = tone(1, amplitude);
      const gain = levelGain(samples, RATE, { previousDb: null }, target);
      const adjusted = samples.map((v) => v * gain);
      expect(Math.abs(integratedLoudness(adjusted, RATE) - target)).toBeLessThan(0.6);
    }
  });

  it("limits the step from the previous fragment and keeps the peak under -1 dBFS", () => {
    const state = { previousDb: 0 };
    const quiet = tone(1, 0.01);
    const gain = levelGain(quiet, RATE, state, -20);
    expect(20 * Math.log10(gain)).toBeCloseTo(4, 1);

    const loud = tone(1, 0.99);
    const loudGain = levelGain(loud, RATE, { previousDb: 10 }, -10);
    expect(0.99 * loudGain).toBeLessThanOrEqual(PEAK_CEILING + 1e-6);
  });
});

describe("seeded noise", () => {
  it("repeats for a seed and differs between seeds", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe("spoken text", () => {
  it("reads numbers in English", () => {
    expect(numberToWords("0", "en")).toBe("zero");
    expect(numberToWords("21", "en")).toBe("twenty-one");
    expect(numberToWords("1,205", "en")).toBe("one thousand two hundred five");
    expect(numberToWords("3.14", "en")).toBe("three point one four");
    expect(numberToWords("2000000", "en")).toBe("two million");
  });

  it("reads numbers in French", () => {
    expect(numberToWords("21", "fr")).toBe("vingt et un");
    expect(numberToWords("71", "fr")).toBe("soixante et onze");
    expect(numberToWords("80", "fr")).toBe("quatre-vingts");
    expect(numberToWords("82", "fr")).toBe("quatre-vingt-deux");
    expect(numberToWords("200", "fr")).toBe("deux cents");
    expect(numberToWords("1000", "fr")).toBe("mille");
    expect(numberToWords("2.5", "fr")).toBe("deux virgule cinq");
  });

  it("reads numbers in Spanish", () => {
    expect(numberToWords("21", "es")).toBe("veintiuno");
    expect(numberToWords("45", "es")).toBe("cuarenta y cinco");
    expect(numberToWords("100", "es")).toBe("cien");
    expect(numberToWords("101", "es")).toBe("ciento uno");
    expect(numberToWords("21000", "es")).toBe("veintiún mil");
    expect(numberToWords("1000000", "es")).toBe("un millón");
  });

  it("reads numbers in Chinese", () => {
    expect(numberToWords("10", "zh")).toBe("十");
    expect(numberToWords("25", "zh")).toBe("二十五");
    expect(numberToWords("200", "zh")).toBe("两百");
    expect(numberToWords("105", "zh")).toBe("一百零五");
    expect(numberToWords("10000", "zh")).toBe("一万");
    expect(numberToWords("3.5", "zh")).toBe("三点五");
  });

  it("reads money, percentages, ranges and units", () => {
    expect(normalizeSpeech("It costs $5 and €1.", "en")).toBe("It costs five dollars and one euro.");
    expect(normalizeSpeech("Up 20% since 2020", "en")).toBe("Up twenty percent since two thousand twenty");
    expect(normalizeSpeech("Takes 3-5 days", "en")).toBe("Takes three to five days");
    expect(normalizeSpeech("It is 12 km away, 1 kg", "en")).toBe("It is twelve kilometers away, one kilogram");
    expect(normalizeSpeech("Il fait 20 °C", "fr")).toBe("Il fait vingt degrés Celsius");
    expect(normalizeSpeech("Tom & Jerry", "en")).toBe("Tom and Jerry");
  });

  it("leaves words with digits inside alone", () => {
    expect(normalizeSpeech("Try GPT4 or mp3 files", "en")).toBe("Try GPT4 or mp3 files");
  });

  it("is applied by the chunker when a language is given", () => {
    const chunker = createSentenceChunker("en");
    expect(chunker.push("It takes 3 days. ")).toEqual(["It takes three days."]);
  });
});

describe("times, links and code", () => {
  it("reads clock times per language", () => {
    expect(normalizeSpeech("At 14:30 sharp", "en")).toBe("At fourteen thirty sharp");
    expect(normalizeSpeech("At 2:30 pm", "en")).toBe("At two thirty p m");
    expect(normalizeSpeech("At 9:05 am", "en")).toBe("At nine oh five a m");
    expect(normalizeSpeech("À 14:30", "fr")).toBe("À quatorze heures trente");
    expect(normalizeSpeech("A 1:00", "es")).toBe("A la una");
    expect(normalizeSpeech("A 14:30", "es")).toBe("A las catorce y treinta");
    expect(normalizeSpeech("10:05", "zh")).toBe("十点零五分");
  });

  it("says a link or a code snippet only when a language is known", () => {
    expect(speakableText("See https://example.com/a now")).toBe("See now");
    expect(speakableText("See https://example.com/a now", "en")).toBe("See a link now");
    expect(speakableText("Run ```ls -la``` ok", "fr")).toBe("Run un extrait de code ok");
  });

  it("lets an engine ask for longer fragments", () => {
    const text = `${"This is a fairly short sentence. ".repeat(4)}`;
    const limited = createSentenceChunker("en", { min: 200, max: 250 });
    limited.pushFragments("Hi there. ");
    expect(limited.pushFragments(text).length).toBe(0);
    expect(limited.flushFragment()?.text.length).toBeGreaterThan(100);
  });
});

describe("wasm threads", () => {
  it("stays on one thread unless the page is isolated, then uses half the cores up to four", () => {
    expect(wasmThreads(false, 16)).toBe(1);
    expect(wasmThreads(true, 1)).toBe(1);
    expect(wasmThreads(true, 4)).toBe(2);
    expect(wasmThreads(true, 32)).toBe(4);
  });
});

describe("acronyms and paths", () => {
  it("spells acronyms, leaves shouted words and said-as-word names", () => {
    expect(normalizeSpeech("The CPU and the API", "en")).toBe("The C P U and the A P I");
    expect(normalizeSpeech("NASA said NO", "en")).toBe("NASA said NO");
    expect(normalizeSpeech("Made in the USA", "en")).toBe("Made in the U S A");
  });

  it("reads a file path by its last segment and and/or as two words", () => {
    expect(normalizeSpeech("Open C:\\Users\\me\\notes.txt now", "en")).toBe("Open notes.txt now");
    expect(normalizeSpeech("See /usr/local/bin/node", "en")).toBe("See node");
    expect(normalizeSpeech("this and/or that", "en")).toBe("this and or that");
  });
});

describe("long sentences", () => {
  it("cuts a sentence longer than the cap instead of handing it over whole", () => {
    const chunker = createSentenceChunker("en", { min: 20, max: 100 });
    const sentence = `${"word ".repeat(40)}end. `;
    const fragments = chunker.pushFragments(sentence);
    const rest = chunker.flushFragment();
    if (rest) fragments.push(rest);
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.every((f) => f.text.length <= 100)).toBe(true);
  });

  it("holds Chinese to a third of the character limits", () => {
    const text = `${"今天的天气非常好，我们一起去公园散步吧，".repeat(5)}好的。`;
    const chunker = createSentenceChunker("zh", { min: 110, max: 250 });
    const fragments = chunker.pushFragments(text);
    const rest = chunker.flushFragment();
    if (rest) fragments.push(rest);
    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.every((f) => f.text.length <= 84)).toBe(true);
  });
});
