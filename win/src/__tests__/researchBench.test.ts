// Checks the research benchmark question set and grader templates in shared/fixtures/research-bench.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(import.meta.dirname, "../../../shared/fixtures/research-bench");

type Question = {
  id: string;
  kind: string;
  question: string;
  gold: string;
  acceptable?: string[];
  depth: string;
  sources: string[];
  area?: string;
  asOf: string;
};

const questions: Question[] = JSON.parse(readFileSync(path.join(DIR, "questions.json"), "utf8"));
const graders: Record<string, string> = JSON.parse(readFileSync(path.join(DIR, "graders.json"), "utf8"));

const KINDS = ["factual", "multihop", "report"];
const DEPTHS = ["quick", "standard", "deep"];
const SOURCES = ["web", "papers", "wiki", "code"];

describe("research benchmark question set", () => {
  it("has 120 entries, 40 of each kind", () => {
    expect(questions).toHaveLength(120);
    for (const kind of KINDS) {
      expect(questions.filter((q) => q.kind === kind)).toHaveLength(40);
    }
  });

  it("has unique ids", () => {
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
  });

  it("uses valid enums", () => {
    for (const q of questions) {
      expect(KINDS).toContain(q.kind);
      expect(DEPTHS).toContain(q.depth);
      expect(q.sources.length).toBeGreaterThan(0);
      for (const s of q.sources) expect(SOURCES).toContain(s);
      expect(q.asOf).toBe("2026-11");
    }
  });

  it("has non-empty gold and question text", () => {
    for (const q of questions) {
      expect(q.gold.trim().length).toBeGreaterThan(0);
      expect(q.question.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("research benchmark graders", () => {
  const placeholders: Record<string, string[]> = {
    accuracy: ["{question}", "{gold}", "{answer}"],
    citationPrecision: ["{claim}", "{quote}"],
    citationRecall: ["{answer}", "{claim}"],
  };

  it("has the three templates", () => {
    for (const name of Object.keys(placeholders)) {
      expect(typeof graders[name]).toBe("string");
    }
  });

  it("keeps each template's placeholders", () => {
    for (const [name, marks] of Object.entries(placeholders)) {
      for (const mark of marks) expect(graders[name]).toContain(mark);
    }
  });
});
