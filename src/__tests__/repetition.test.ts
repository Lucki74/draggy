import { describe, expect, it } from "vitest";
import { detectRepetition } from "../agent/repetition";

describe("detectRepetition", () => {
  it("detects and trims safety refusal loop of repeated REDACTED markers", () => {
    const text = [
      "Here is the historical deep-dive into Victorian London.",
      "",
      "== [REDACTED] ==",
      "",
      "== [REDACTED] ==",
      "",
      "== [REDACTED] ==",
    ].join("\n");

    const result = detectRepetition(text);
    expect(result.hasLoop).toBe(true);
    expect(result.pattern).toBe("== [REDACTED] ==");
    expect(result.repeatCount).toBe(3);
    expect(result.trimmedText).toBe("Here is the historical deep-dive into Victorian London.");
  });

  it("leaves a single REDACTED marker alone", () => {
    const text = "Some text with == [REDACTED] == in the middle of a sentence.";
    const result = detectRepetition(text);
    expect(result.hasLoop).toBe(false);
    expect(result.trimmedText).toBe(text);
  });

  it("detects and trims a line repeated three times", () => {
    const text = [
      "Starting summary.",
      "The quick brown fox jumps over the lazy dog.",
      "The quick brown fox jumps over the lazy dog.",
      "The quick brown fox jumps over the lazy dog.",
    ].join("\n");

    const result = detectRepetition(text);
    expect(result.hasLoop).toBe(true);
    expect(result.trimmedText).toBe(
      "Starting summary.\nThe quick brown fox jumps over the lazy dog.",
    );
  });

  it("detects and trims multi-line block repetition", () => {
    const text = [
      "Chapter 1",
      "Item A: Description",
      "Item B: Description",
      "Item A: Description",
      "Item B: Description",
      "Item A: Description",
      "Item B: Description",
    ].join("\n");

    const result = detectRepetition(text);
    expect(result.hasLoop).toBe(true);
    expect(result.trimmedText).toBe("Chapter 1\nItem A: Description\nItem B: Description");
  });

  it("detects repeating inline phrases", () => {
    const text = "Analysis complete. I agree with that. I agree with that. I agree with that.";
    const result = detectRepetition(text);
    expect(result.hasLoop).toBe(true);
    expect(result.trimmedText).toBe("Analysis complete. I agree with that.");
  });

  it("does not trip on normal nested code blocks or braces", () => {
    const code = [
      "function nested() {",
      "  if (a) {",
      "    if (b) {",
      "      if (c) {",
      "      }",
      "    }",
      "  }",
      "}",
    ].join("\n");

    const result = detectRepetition(code);
    expect(result.hasLoop).toBe(false);
    expect(result.trimmedText).toBe(code);
  });

  it("does not trip on markdown horizontal rules or dividers", () => {
    const doc = ["# Section 1", "---", "# Section 2", "---", "# Section 3", "---"].join("\n");
    const result = detectRepetition(doc);
    expect(result.hasLoop).toBe(false);
    expect(result.trimmedText).toBe(doc);
  });

  it("does not trip on short text", () => {
    const short = "hello world";
    expect(detectRepetition(short)).toEqual({ hasLoop: false, trimmedText: short });
  });
});
