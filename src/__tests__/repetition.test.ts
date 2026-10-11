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

  describe("markdown tables", () => {
    const header = "| Feature | Draggy | Continue | Aider | Cursor |";

    it.each([
      ["aligned with spaces", "| :--- | :--- | :--- | :--- | :--- |"],
      ["compact", "|:---|:---|:---|:---|:---|"],
      ["plain dashes with spaces", "| --- | --- | --- | --- | --- |"],
      ["centred", "| :---: | :---: | :---: | :---: | :---: |"],
    ])("does not stop a reply at the separator row (%s)", (_name, separator) => {
      const text = `Summary Comparison Table\n\n${header}\n${separator}`;
      const result = detectRepetition(text);

      expect(result.hasLoop).toBe(false);
      expect(result.trimmedText).toBe(text);
    });

    it("does not stop a reply while a separator is still being written", () => {
      // Every prefix of a streamed table goes through the check, so each one has to pass.
      const text = `${header}\n| :--- | :--- | :--- | :--- | :--- |\n| Local | Yes | Yes | Yes | Yes |`;
      for (let end = 1; end <= text.length; end++) {
        expect(detectRepetition(text.slice(0, end)).hasLoop, JSON.stringify(text.slice(0, end))).toBe(false);
      }
    });

    it("lets cells repeat, since a comparison table is full of them", () => {
      const text = [header, "| --- | --- | --- | --- | --- |", "| Tests | ✓ | ✓ | ✓ | ✓ |", "| Diffs | ✓ | ✓ | ✓ | ✓ |"].join("\n");
      expect(detectRepetition(text).hasLoop).toBe(false);
    });

    it("lets a blank template table keep its empty rows", () => {
      const text = [header, "| --- | --- | --- | --- | --- |", "|   |   |   |   |   |", "|   |   |   |   |   |", "|   |   |   |   |   |"].join("\n");
      expect(detectRepetition(text).hasLoop).toBe(false);
    });

    it("still stops a table row that never ends", () => {
      const text = `${header}\n| --- | --- | --- | --- | --- |\n| ${"same | ".repeat(60)}`;
      expect(detectRepetition(text).hasLoop).toBe(true);
    });

    it("still stops a table whose whole row repeats without end", () => {
      const row = "| Local first | Yes | No | No | Yes |";
      const text = [header, "| --- | --- | --- | --- | --- |", row, row, row, row].join("\n");
      expect(detectRepetition(text).hasLoop).toBe(true);
    });
  });

  it("does not trip on short text", () => {
    const short = "hello world";
    expect(detectRepetition(short)).toEqual({ hasLoop: false, trimmedText: short });
  });
});
