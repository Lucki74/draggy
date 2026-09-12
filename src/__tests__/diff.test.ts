import { describe, expect, it } from "vitest";
import { CONTEXT_LINES, describeDiff, diffLines } from "../chat/diff";
import type { DiffLine } from "../chat/diff";

/**
 * What the timeline shows after an edit. The rule these tests hold to: the
 * lines that changed are the ones marked, and nothing that did not change is
 * ever shown as a change.
 */

const flat = (before: string, after: string): DiffLine[] =>
  diffLines(before, after).hunks.flatMap((hunk) => hunk.lines);

const shown = (before: string, after: string) =>
  flat(before, after).map((line) => `${symbol(line.kind)}${line.text}`);

const symbol = (kind: DiffLine["kind"]) =>
  kind === "added" ? "+" : kind === "removed" ? "-" : " ";

describe("a change in the middle of a file", () => {
  const before = "one\ntwo\nthree\n";
  const after = "one\nTWO\nthree\n";

  it("marks the line that changed and keeps the rest as context", () => {
    expect(shown(before, after)).toEqual([" one", "-two", "+TWO", " three", " "]);
  });

  it("counts what went in and what came out", () => {
    const diff = diffLines(before, after);

    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(describeDiff(diff)).toBe("+1 -1");
  });

  it("numbers the lines on the side they belong to", () => {
    const lines = flat(before, after);
    const removed = lines.find((line) => line.kind === "removed");
    const added = lines.find((line) => line.kind === "added");

    expect(removed?.before).toBe(1);
    expect(removed?.after).toBeNull();
    expect(added?.after).toBe(1);
    expect(added?.before).toBeNull();
  });
});

describe("adding and removing", () => {
  it("shows a line added to the end", () => {
    expect(shown("a\nb", "a\nb\nc")).toEqual([" a", " b", "+c"]);
  });

  it("shows a line taken out", () => {
    expect(shown("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
  });

  it("shows a whole new file as added", () => {
    const diff = diffLines("", "one\ntwo\n");

    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
  });

  it("says nothing changed when nothing did", () => {
    const diff = diffLines("same\ntext\n", "same\ntext\n");

    expect(diff.hunks).toEqual([]);
    expect(describeDiff(diff)).toBe("");
  });

  it("reads a file the same whichever line endings it uses", () => {
    const diff = diffLines("a\r\nb\r\n", "a\nb\n");

    expect(diff.hunks).toEqual([]);
  });
});

describe("a long file with two small changes", () => {
  const before = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const after = before
    .split("\n")
    .map((line, i) => (i === 5 || i === 50 ? `${line} changed` : line))
    .join("\n");

  it("shows them as two hunks rather than the whole file", () => {
    const diff = diffLines(before, after);

    expect(diff.hunks).toHaveLength(2);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(2);
  });

  it("keeps a few lines either side of each one", () => {
    const [first] = diffLines(before, after).hunks;
    const context = first.lines.filter((line) => line.kind === "context");

    expect(context.length).toBeLessThanOrEqual(CONTEXT_LINES * 2);
    expect(first.lines[0].text).toBe("line 2");
  });

  it("says how much it skipped between them", () => {
    const [, second] = diffLines(before, after).hunks;

    expect(second.skipped).toBeGreaterThan(30);
  });
});

describe("a change too big to line up", () => {
  const before = Array.from({ length: 900 }, (_, i) => `old ${i}`).join("\n");
  const after = Array.from({ length: 900 }, (_, i) => `new ${i}`).join("\n");

  it("counts it instead of drawing it", () => {
    const diff = diffLines(before, after);

    expect(diff.hunks).toEqual([]);
    expect(diff.summary).toBe("900 lines replaced with 900");
    expect(describeDiff(diff)).toBe("900 lines replaced with 900");
  });

  it("still lines up a small change inside a long file", () => {
    const changed = `${before}\nand one more`;
    const diff = diffLines(before, changed);

    expect(diff.summary).toBeUndefined();
    expect(diff.added).toBe(1);
  });
});

describe("indentation", () => {
  it("treats a line moved in or out as a change", () => {
    expect(shown("if (a) {\nb();\n}", "if (a) {\n  b();\n}")).toEqual([
      " if (a) {",
      "-b();",
      "+  b();",
      " }",
    ]);
  });
});
