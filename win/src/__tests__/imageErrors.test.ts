import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageFailure } from "../ai/engineErrors";
import { languages, translations } from "../translations";

/** Image engine failures in the reader's words, each linked to its article where the site has one. */

let lang = "en";

beforeEach(() => {
  lang = "en";
  vi.stubGlobal("document", { documentElement: { get lang() { return lang; } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("imageFailure", () => {
  it("links each engine failure to the article on it", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ code: "E_VRAM", params: { needGB: "2.5" } }, "image-out-of-memory"],
      [{ code: "E_ENGINE_START", params: { reason: "boom" } }, "image-engine-would-not-start"],
      [{ code: "E_CRASH" }, "image-engine-would-not-start"],
      [{ kind: "missing-library" }, "image-engine-would-not-start"],
      [{ kind: "unsupported-cpu" }, "image-engine-unsupported-cpu"],
      [{ code: "E_MODEL_HASH" }, "image-model-damaged"],
    ];
    for (const [result, slug] of cases) {
      expect(imageFailure(result), slug).toContain(`https://draggy.org/error/${slug}`);
    }
  });

  it("fills in the numbers and names the message asks for", () => {
    expect(imageFailure({ code: "E_VRAM", params: { needGB: "6.0" } })).toContain("about 6.0 GB");
    expect(imageFailure({ code: "E_LORA", params: { name: "ink" } })).toContain("no LoRA called ink");
    expect(imageFailure({ code: "E_ENGINE_START", error: "x", params: { reason: "missing weights" } })).toContain("missing weights");
  });

  it("keeps the engine's own words for a failure it has no message for", () => {
    expect(imageFailure({ code: "E_FAILED", error: "generate_image returned empty results" })).toContain("generate_image returned empty results");
  });

  it("links to the article in the reader's language", () => {
    lang = "fr";
    expect(imageFailure({ code: "E_VRAM", params: { needGB: "2" } }, { markdown: true })).toContain("](https://draggy.org/fr/error/image-out-of-memory)");
  });
});

describe("the image messages in every language", () => {
  const keys = Object.keys(translations.en).filter((key) => /^(image|generateImageCommand)/.test(key));
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

  it("finds them", () => {
    expect(keys.length).toBeGreaterThanOrEqual(30);
  });

  for (const { code } of languages) {
    it(`${code} keeps the placeholders English has`, () => {
      const wrong = keys.filter((key) => placeholders(translations[code][key]).join() !== placeholders(translations.en[key]).join());
      expect(wrong).toEqual([]);
    });

    it(`${code} lists the /image flags exactly, since they are typed as written`, () => {
      for (const flag of ["--to", "--from", "--size", "--seed", "--steps", "--strength", "--negative", "--lora", "--hires", "--overwrite"]) {
        expect(translations[code].imageCommandBadFlag).toContain(flag);
      }
    });
  }
});
