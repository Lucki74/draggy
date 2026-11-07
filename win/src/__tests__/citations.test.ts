import { describe, expect, it } from "vitest";
import {
  bestMatchRatio,
  judgeCitation,
  normaliseForMatch,
  quoteAppears,
  verifyCitations,
} from "../research/citations";

describe("normaliseForMatch", () => {
  it("collapses whitespace and strips punctuation", () => {
    expect(normaliseForMatch("  Hello,   world!\n\tagain.  ")).toBe("hello world again");
  });

  it("folds fullwidth forms through NFKC", () => {
    expect(normaliseForMatch("ＡＢＣ test")).toBe("abc test");
  });
});

describe("quoteAppears", () => {
  it("ignores whitespace and punctuation differences", () => {
    const page = "The results however were clear and widely reported.";
    expect(quoteAppears("The  results,   however: were clear", page)).toBe(true);
  });

  it("matches curly quotes against straight quotes", () => {
    const page = 'She said it\'s a "fine" result today in the report.';
    expect(quoteAppears("she said it’s a “fine” result today", page)).toBe(true);
  });

  it("matches en dash against hyphen", () => {
    expect(quoteAppears("state–of–the–art research methods", "We use state-of-the-art research methods here.")).toBe(true);
  });

  it("ignores case differences", () => {
    expect(quoteAppears("THE GREAT WALL stands", "the great wall stands tall")).toBe(true);
  });

  it("rejects a two-word quote", () => {
    expect(quoteAppears("climate change", "Climate change is real and urgent.")).toBe(false);
  });

  it("rejects a reworded quote", () => {
    const page = "Members decided to postpone the decision until spring.";
    expect(quoteAppears("the council voted to delay the vote", page)).toBe(false);
  });

  it("does not match inside a longer word", () => {
    expect(quoteAppears("cat sat down", "concat sat down there")).toBe(false);
  });

  it("rejects an empty quote", () => {
    expect(quoteAppears("", "some page text here")).toBe(false);
    expect(quoteAppears("   ", "some page text here")).toBe(false);
  });

  it("matches French accents and apostrophes", () => {
    const page = "Hier, le café où l’élève réfléchit longtemps, près de la gare.";
    expect(quoteAppears("Le café où l'élève réfléchit longtemps", page)).toBe(true);
  });

  it("matches decomposed and composed French accents", () => {
    expect(quoteAppears("le café est ouvert", "Ici le café est ouvert le matin.")).toBe(true);
  });

  it("matches Russian Cyrillic text", () => {
    const page = "Сегодня: привет мир, это тестовая цитата в статье.";
    expect(quoteAppears("Привет, мир! Это тестовая цитата.", page)).toBe(true);
  });
});

describe("bestMatchRatio", () => {
  it("returns 1 for a verbatim quote", () => {
    expect(bestMatchRatio("one two three four", "x one two three four y")).toBe(1);
  });

  it("returns 0 when no words overlap", () => {
    expect(bestMatchRatio("alpha beta gamma", "delta epsilon zeta")).toBe(0);
  });

  it("returns 0 for an empty quote", () => {
    expect(bestMatchRatio("", "some page")).toBe(0);
  });

  it("ignores text beyond the 400000 character cap", () => {
    const page = "a".repeat(400_000) + " the quick brown fox jumps";
    expect(bestMatchRatio("the quick brown fox jumps", page)).toBe(0);
  });
});

describe("judgeCitation", () => {
  it("gives near when one word at the end changed", () => {
    const quote = "the committee approved the new budget for the coming fiscal year";
    const page = "the committee approved the new budget for the coming fiscal quarter";
    expect(judgeCitation(quote, page)).toBe("near");
  });

  it("gives unverified when the near threshold is not reached", () => {
    const quote = "the committee approved the new budget for the coming fiscal year";
    const page = "the committee adopted the new budget for the coming fiscal year";
    expect(judgeCitation(quote, page, 0.9)).toBe("unverified");
  });

  it("gives verified for an exact quote", () => {
    expect(judgeCitation("the new budget was approved", "Yes: the new budget was approved.")).toBe("verified");
  });
});

describe("verifyCitations", () => {
  const notes = [
    { id: "n1", claim: "c1", quote: "the new budget was approved", sourceId: "s1" },
    { id: "n2", claim: "c2", quote: "an exact sentence from nowhere", sourceId: "s2" },
    { id: "n3", claim: "c3", quote: "some quote text here", sourceId: "missing" },
  ];

  it("judges each note against its source page", () => {
    const pages = new Map([
      ["s1", "Report: the new budget was approved in May."],
      ["s2", "Completely unrelated content about gardens."],
    ]);
    const verdicts = verifyCitations(notes, pages);
    expect(verdicts.get("n1")).toBe("verified");
    expect(verdicts.get("n2")).toBe("unverified");
  });

  it("marks a note with no page as unverified", () => {
    const verdicts = verifyCitations(notes, new Map());
    expect(verdicts.get("n3")).toBe("unverified");
    expect(verdicts.size).toBe(3);
  });
});

describe("hyphens and short quotes", () => {
  it("matches a hyphenated phrase against spaced words", () => {
    expect(quoteAppears("a well-known result here", "It is a well known result here.")).toBe(true);
  });

  it("gives unverified for a two-word quote even when it appears", () => {
    expect(judgeCitation("borrow checker", "The borrow checker runs.")).toBe("unverified");
  });
});
