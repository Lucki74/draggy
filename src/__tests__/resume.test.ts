import { describe, it, expect } from "vitest";
import {
  RESUME_BUDGET,
  buildResumeMessage,
  describeCompletedWork,
  joinContinuation,
} from "../agent/resume";
import type { SearchStep } from "../types";

const step = (partial: Partial<SearchStep> & { type: SearchStep["type"] }): SearchStep => ({
  id: Math.random().toString(36).slice(2),
  content: "",
  isComplete: true,
  ...partial,
});

describe("telling a cut-off reply what it already did", () => {
  it("says nothing when nothing was done", () => {
    expect(describeCompletedWork([])).toBeNull();
    expect(buildResumeMessage([])).toBeNull();
  });

  it("reports a created file with the path it was written to", () => {
    const work = describeCompletedWork([
      step({
        type: "create_file",
        content: "Created **report.docx**",
        filename: "report.docx",
        filepath: "C:/out/report.docx",
      }),
    ]);

    expect(work).toContain("report.docx");
    expect(work).toContain("C:/out/report.docx");
    expect(work).toContain("do not create it again");
  });

  it("reports code that already ran, with its output", () => {
    const work = describeCompletedWork([
      step({
        type: "run_code",
        content: "Code ran",
        language: "python",
        stdout: "788454",
      }),
    ]);

    expect(work).toContain("python");
    expect(work).toContain("788454");
    expect(work).toContain("Do not run it again");
  });

  it("carries the reasoning across", () => {
    const work = describeCompletedWork([
      step({ type: "thinking", content: "I decided to build the table first." }),
    ]);

    expect(work).toContain("build the table first");
  });

  it("includes what a search actually found, not just that it happened", () => {
    const work = describeCompletedWork([
      step({
        type: "results",
        content: "Search results for **paris**",
        results: [
          { title: "Paris - Wikipedia", url: "https://en.wikipedia.org/wiki/Paris", snippet: "" },
        ],
      }),
    ]);

    expect(work).toContain("Paris - Wikipedia");
    expect(work).toContain("en.wikipedia.org");
  });

  it("does not claim work that never finished", () => {
    const work = describeCompletedWork([
      step({
        type: "create_file",
        content: "Creating **half.docx**",
        filename: "half.docx",
        isComplete: false,
      }),
      step({ type: "thinking", content: "Thought about it." }),
    ]);

    expect(work).not.toContain("half.docx");
  });

  it("strips the markdown the step carries for display", () => {
    const work = describeCompletedWork([
      step({ type: "reading", content: "Reading **example.com**" }),
    ]);

    expect(work).not.toContain("**");
    expect(work).toContain("example.com");
  });
});

describe("staying small enough not to overflow again", () => {
  /**
   * The reply was cut off for running out of room, so the recap has to fit in
   * a budget rather than growing with the work.
   */
  const noisy: SearchStep[] = [
    ...Array.from({ length: 40 }, (_, i) =>
      step({ type: "thinking", content: `Long deliberation number ${i}. `.repeat(20) }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      step({ type: "searching", content: `Searching for topic ${i}` }),
    ),
    step({
      type: "create_file",
      content: "Created **important.docx**",
      filename: "important.docx",
      filepath: "C:/out/important.docx",
    }),
    step({
      type: "run_code",
      content: "Code ran",
      language: "python",
      stdout: "the answer is 42",
    }),
  ];

  it("keeps within the budget", () => {
    const work = describeCompletedWork(noisy);
    expect(work).not.toBeNull();
    expect((work as string).length).toBeLessThanOrEqual(RESUME_BUDGET);
  });

  it("never drops work that had a side effect", () => {
    const work = describeCompletedWork(noisy) as string;

    // These are the expensive things to repeat, so they outrank everything.
    expect(work).toContain("important.docx");
    expect(work).toContain("C:/out/important.docx");
    expect(work).toContain("the answer is 42");
  });

  it("drops reasoning before it drops actions", () => {
    const work = describeCompletedWork(noisy) as string;
    const thoughts = (work.match(/Reasoning so far/g) ?? []).length;
    expect(thoughts).toBeLessThan(40);
  });

  it("keeps the work in the order it happened", () => {
    const work = describeCompletedWork([
      step({ type: "thinking", content: "First I thought." }),
      step({
        type: "create_file",
        content: "Created **a.txt**",
        filename: "a.txt",
        filepath: "C:/out/a.txt",
      }),
      step({
        type: "create_file",
        content: "Created **b.txt**",
        filename: "b.txt",
        filepath: "C:/out/b.txt",
      }),
    ]) as string;

    expect(work.indexOf("a.txt")).toBeLessThan(work.indexOf("b.txt"));
    expect(work.indexOf("First I thought")).toBeLessThan(work.indexOf("a.txt"));
  });

  it("honours a tighter budget by keeping only the important work", () => {
    const work = describeCompletedWork(noisy, 200) as string;
    expect(work.length).toBeLessThanOrEqual(200);
    expect(work).toContain("important.docx");
  });
});

describe("the message put on the wire", () => {
  it("states plainly that the work really happened", () => {
    const message = buildResumeMessage([
      step({
        type: "create_file",
        content: "Created **report.docx**",
        filename: "report.docx",
        filepath: "C:/out/report.docx",
      }),
    ]) as string;

    expect(message).toContain("cut short");
    expect(message).toContain("really happened");
    expect(message).toContain("report.docx");
  });
});

describe("stitching a continued reply back on", () => {
  it("adds no separator, so a word split in half is made whole", () => {
    expect(joinContinuation("The sea is a vast expanse of salt", "water.")).toBe(
      "The sea is a vast expanse of saltwater.",
    );
  });

  it("does not start a new line where the reply was cut", () => {
    const joined = joinContinuation("the report covers three", " main areas.");
    expect(joined).toBe("the report covers three main areas.");
    expect(joined).not.toContain("\n");
  });

  it("removes a repeated tail when the model says it twice", () => {
    const before = "Beaches carry several risks, the most serious of which is";
    const after = "the most serious of which is drowning in a rip current.";

    expect(joinContinuation(before, after)).toBe(
      "Beaches carry several risks, the most serious of which is drowning in a rip current.",
    );
  });

  it("keeps only the new copy when the model starts over", () => {
    const before = "Beaches carry several risks. The first is drowning, which";
    const after =
      "Beaches carry several risks. The first is drowning, which happens fastest in rip currents.";

    expect(joinContinuation(before, after)).toBe(after);
  });

  it("does not mistake a short coincidence for a repeat", () => {
    // Both halves contain "the ", which is far too little to act on.
    expect(joinContinuation("I went to the", " the shop was shut.")).toBe(
      "I went to the the shop was shut.",
    );
  });

  it("copes with either half being empty", () => {
    expect(joinContinuation("", "only this")).toBe("only this");
    expect(joinContinuation("only this", "")).toBe("only this");
    expect(joinContinuation("", "")).toBe("");
  });

  it("leaves an ordinary continuation exactly as written", () => {
    expect(joinContinuation("First part.", " Second part.")).toBe(
      "First part. Second part.",
    );
  });
});
