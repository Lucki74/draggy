import { describe, expect, it } from "vitest";
import {
  addNote,
  addSource,
  budgetOf,
  coverage,
  createRun,
  DEPTHS,
  findRepeat,
  loopLimitFor,
  logSearch,
  normaliseQuery,
  readPlan,
  recordHost,
  renderRunState,
  sourceKey,
  stopReason,
  tick,
  type ResearchRun,
} from "../research/run";

function run(depth: "quick" | "standard" | "deep" = "standard", questions = ["What", "Why"]): ResearchRun {
  const plan = readPlan({ question: "Topic", subQuestions: questions, depth, sources: ["web"] });
  if (!plan) throw new Error("plan");
  return createRun("r1", plan, 0);
}

function readSource(r: ResearchRun, url: string) {
  return addSource(r, { url, title: url, status: "read" });
}

describe("readPlan", () => {
  it("strips list markers, dedupes and caps by depth", () => {
    const plan = readPlan({ question: "Q", subQuestions: "1. a\n- b\n* a\n2) c\nd", depth: "quick" });
    expect(plan?.subQuestions).toEqual(["a", "b", "c"]);
    expect(plan?.depth).toBe("quick");
  });

  it("falls back to standard depth, web source and the question itself", () => {
    const plan = readPlan({ question: "Q", subQuestions: [], depth: "huge", sources: "nope" });
    expect(plan).toEqual({ question: "Q", subQuestions: ["Q"], depth: "standard", sources: ["web"] });
  });

  it("rejects an empty question", () => {
    expect(readPlan({ question: "  " })).toBeNull();
  });

  it("keeps known source kinds from a comma list", () => {
    expect(readPlan({ question: "Q", sources: "papers, wiki,bogus" })?.sources).toEqual(["papers", "wiki"]);
  });
});

describe("queries and sources", () => {
  it("treats word order, case and filler words as the same query", () => {
    expect(normaliseQuery("What is the Rust borrow checker?")).toBe(normaliseQuery("rust Borrow checker"));
  });

  it("finds repeats per source kind only", () => {
    const r = run();
    logSearch(r, "rust borrow checker", "web", []);
    expect(findRepeat(r, "Borrow checker in Rust", "web")).not.toBeNull();
    expect(findRepeat(r, "Borrow checker in Rust", "papers")).toBeNull();
  });

  it("collapses tracking links and trailing slashes", () => {
    expect(sourceKey("https://www.example.com/a/?utm_source=x#top")).toBe(sourceKey("https://example.com/a"));
    expect(sourceKey("https://example.com/a?id=2")).not.toBe(sourceKey("https://example.com/a"));
  });

  it("gives one id per page and updates its status", () => {
    const r = run();
    const first = addSource(r, { url: "https://example.com/a" });
    const again = addSource(r, { url: "https://example.com/a/", status: "read" });
    expect(again.id).toBe(first.id);
    expect(again.status).toBe("read");
    expect(r.sources).toHaveLength(1);
  });

  it("records each contacted host once", () => {
    const r = run();
    recordHost(r, "https://Example.com/a");
    recordHost(r, "https://example.com/b");
    recordHost(r, "not a url");
    expect(r.contactedHosts).toEqual(["example.com"]);
  });
});

describe("notes", () => {
  it("needs a claim, a quote and a read source", () => {
    const r = run();
    addSource(r, { url: "https://example.com/unread" });
    expect(addNote(r, { claim: "", quote: "q", source: "s1" })).toMatch(/no claim/);
    expect(addNote(r, { claim: "c", quote: "", source: "s1" })).toMatch(/no quote/);
    expect(addNote(r, { claim: "c", quote: "q", source: "s9" })).toMatch(/not one you have read/);
    expect(addNote(r, { claim: "c", quote: "q", source: "s1" })).toMatch(/not read successfully/);
  });

  it("accepts a source by id or url and clamps the sub-question", () => {
    const r = run();
    readSource(r, "https://example.com/a");
    const byId = addNote(r, { claim: "c", quote: "q", source: "s1", subQuestion: 2, confidence: "confirmed" });
    const byUrl = addNote(r, { claim: "c", quote: "q", source: "https://example.com/a/", subQuestion: 9 });
    expect(byId).toMatchObject({ id: "n1", subQuestion: 2, confidence: "confirmed" });
    expect(byUrl).toMatchObject({ id: "n2", subQuestion: 1, confidence: "single_source" });
  });
});

describe("stop rule", () => {
  it("stops when every sub-question has enough notes", () => {
    const r = run("quick", ["a", "b"]);
    readSource(r, "https://example.com/a");
    addNote(r, { claim: "c", quote: "q", source: "s1", subQuestion: 1 });
    expect(stopReason(r, 0)).toBeNull();
    addNote(r, { claim: "c", quote: "q", source: "s1", subQuestion: 2 });
    expect(stopReason(r, 0)).toBe("covered");
  });

  it("does not count disputed or unverified notes", () => {
    const r = run("quick", ["a"]);
    readSource(r, "https://example.com/a");
    addNote(r, { claim: "c", quote: "q", source: "s1", confidence: "disputed" });
    const note = addNote(r, { claim: "c", quote: "q", source: "s1" });
    if (typeof note !== "string") note.verified = false;
    expect(coverage(r)[0].notes).toBe(0);
  });

  it("stops after two searches in a row add no note", () => {
    const r = run();
    logSearch(r, "one", "web", []);
    logSearch(r, "two", "web", []);
    expect(stopReason(r, 0)).toBeNull();
    logSearch(r, "three", "web", []);
    expect(stopReason(r, 0)).toBe("dry");
  });

  it("resets the dry streak when a note lands between searches", () => {
    const r = run();
    readSource(r, "https://example.com/a");
    logSearch(r, "one", "web", []);
    logSearch(r, "two", "web", []);
    addNote(r, { claim: "c", quote: "q", source: "s1" });
    logSearch(r, "three", "web", []);
    expect(r.dryStreak).toBe(0);
  });

  it("warns at 80 percent and stops at the budget", () => {
    const r = run("quick");
    const wall = DEPTHS.quick.wallMs;
    expect(budgetOf(r, wall * 0.5).wrap).toBe(false);
    expect(budgetOf(r, wall * 0.8).wrap).toBe(true);
    expect(stopReason(r, wall)).toBe("budget");
  });

  it("counts tool calls against the cap and moves to writing", () => {
    const r = run("quick");
    for (let i = 0; i < DEPTHS.quick.toolCalls - 1; i += 1) expect(tick(r, 0)).toBeNull();
    expect(tick(r, 0)).toBe("budget");
    expect(r.status).toBe("writing");
    expect(r.stopReason).toBe("budget");
  });
});

describe("renderRunState", () => {
  it("shows coverage, notes and the next step", () => {
    const r = run();
    readSource(r, "https://example.com/a");
    addNote(r, { claim: "Rust has a borrow checker", quote: "q", source: "s1" });
    logSearch(r, "rust borrow", "web", []);
    const text = renderRunState(r, 60_000);
    expect(text).toContain("1. [ ] What (1 notes)");
    expect(text).toContain("n1 q1 s1 single_source: Rust has a borrow checker");
    expect(text).toContain('Searched: "rust borrow"');
    expect(text).toContain("Next: find support for sub-question 1.");
  });

  it("tells the model to write once gathering stops", () => {
    const r = run("quick");
    expect(renderRunState(r, DEPTHS.quick.wallMs)).toMatch(/write the report now/);
  });
});

describe("loopLimitFor", () => {
  it("raises the cap only during a run", () => {
    expect(loopLimitFor(null, 30)).toBe(30);
    expect(loopLimitFor(run("deep"), 30)).toBe(DEPTHS.deep.toolCalls + 20);
  });
});
