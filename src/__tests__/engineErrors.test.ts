import { afterEach, describe, expect, it, vi } from "vitest";
import { articleUrl, engineFailure, engineUnreachable } from "../ai/engineErrors";
import { languages, translations } from "../translations";

function speak(language: string) {
  vi.stubGlobal("document", { documentElement: { lang: language } });
}

afterEach(() => vi.unstubAllGlobals());

describe("engineFailure", () => {
  it("explains the failures Draggy's logs have shown, and points at the article on each", () => {
    const image = engineFailure("image input is not supported - hint: you may need to provide the mmproj");
    expect(image).toContain("cannot read images");
    expect(image).toContain("https://draggy.org/error/image-not-supported");

    expect(engineFailure('Failed to parse messages: Missing tool call type: {"function":{}}')).toContain(
      "/error/tool-call-unreadable",
    );
    expect(engineFailure("E gguf_init_from_file: failed to open GGUF file 'x-00002-of-00004.gguf'")).toContain(
      "/error/missing-model-file",
    );
  });

  it("explains a full context, a busy engine and a missing memory", () => {
    expect(engineFailure("the request exceeds the available context size")).toContain("/error/context-too-long");
    expect(engineFailure("Loading model")).toContain("/error/model-still-loading");
    expect(engineFailure("cudaMalloc failed: out of memory")).toContain("/error/out-of-memory");
  });

  it("is a link in chat, where markdown is rendered, and a bare address elsewhere", () => {
    expect(engineFailure("Loading model", { markdown: true })).toMatch(
      /\[More about this error\]\(https:\/\/draggy\.org\/error\/model-still-loading\)$/,
    );
    expect(engineFailure("Loading model")).toMatch(/ https:\/\/draggy\.org\/error\/model-still-loading$/);
  });

  it("keeps the engine's own words when it cannot explain them, so there is something to search for", () => {
    const said = engineFailure("something nobody has seen");
    expect(said).toContain("reported a problem: something nobody has seen");
    expect(said).toContain("/error/unknown-engine-error");
  });

  it("says so when the engine gave no reason at all", () => {
    expect(engineFailure("")).toContain("/error/engine-would-not-start");
    expect(engineFailure(undefined)).toContain("/error/engine-would-not-start");
  });

  it("does not mistake a failed load for a model that is merely loading", () => {
    const failed = engineFailure("E llama_model_load: error loading model: something unheard of");
    expect(failed).not.toContain("still loading");
    expect(failed).toContain("/error/unknown-engine-error");
  });

  it("uses what the main process says about its own failures, not its English", () => {
    const slow = engineFailure({ error: "x", kind: "load-timeout", params: { model: "big.gguf" } });
    expect(slow).toContain("big.gguf took too long to load");
    expect(slow).toContain("/error/load-timeout");

    const parts = engineFailure({ error: "x", kind: "parts-missing", params: { model: "big-00001-of-00003.gguf", parts: "big-00002-of-00003.gguf" } });
    expect(parts).toContain("big-00002-of-00003.gguf");
    expect(parts).toContain("/error/model-parts-missing");

    expect(engineFailure({ error: "x", kind: "another-model" })).toContain("/error/another-model-started");
    expect(engineFailure({ error: "x", kind: "engine-missing" })).toContain("/error/engine-would-not-start");
  });

  it("explains a crash by its last words when they are a known cause, and by the crash when they are not", () => {
    const memory = engineFailure({
      kind: "stopped-loading",
      params: { model: "big.gguf", code: "1", reason: "cudaMalloc failed: out of memory" },
    });
    expect(memory).toContain("/error/out-of-memory");

    const unknown = engineFailure({
      kind: "stopped-loading",
      params: { model: "big.gguf", code: "3", reason: "something nobody has seen" },
    });
    expect(unknown).toContain("big.gguf (exit code 3): something nobody has seen");
    expect(unknown).toContain("/error/engine-stopped-loading");
  });

  it("has a message for an engine that cannot be reached", () => {
    expect(engineUnreachable()).toContain("could not reach");
    expect(engineUnreachable()).toContain("/error/engine-unreachable");
  });
});

describe("in another language", () => {
  it("answers in the reader's language and links to the article in it", () => {
    speak("fr");

    const said = engineFailure("Loading model", { markdown: true });
    expect(said).toContain("Le modèle est encore en cours de chargement");
    expect(said).toContain("[En savoir plus sur cette erreur](https://draggy.org/fr/error/model-still-loading)");
  });

  it("falls back to English, and to the English article, for a language the site does not have", () => {
    speak("xx");

    expect(engineFailure("Loading model")).toContain("The model is still loading");
    expect(articleUrl("out-of-memory", "xx")).toBe("https://draggy.org/error/out-of-memory");
  });

  it("gives English the address without a language folder, as the site does", () => {
    expect(articleUrl("out-of-memory", "en")).toBe("https://draggy.org/error/out-of-memory");
    expect(articleUrl("out-of-memory", "ar")).toBe("https://draggy.org/ar/error/out-of-memory");
  });
});

describe("the messages in every language", () => {
  const keys = Object.keys(translations.en).filter((key) => /^engine[A-Z]/.test(key));
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

  it("finds the engine messages to check", () => {
    expect(keys.length).toBeGreaterThanOrEqual(17);
  });

  for (const { code } of languages) {
    it(`${code} keeps the placeholders English has, so a name or a reason is never lost`, () => {
      const wrong = keys.filter(
        (key) => placeholders(translations[code][key]).join() !== placeholders(translations.en[key]).join(),
      );
      expect(wrong).toEqual([]);
    });

    it(`${code} never shows the engine's jargon in a message`, () => {
      // "llama." and "llama-" are the engine's names; "llamada" is Spanish for a call.
      const jargon = keys.filter((key) => /gguf|mmproj|llama[.-]/i.test(translations[code][key]));
      expect(jargon).toEqual([]);
    });
  }
});
