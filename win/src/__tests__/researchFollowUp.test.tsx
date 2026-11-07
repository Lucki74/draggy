// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { applyReceipts, receiptFor } from "../research/receipts";
import { followUpInstruction, holdsFinishedRun } from "../research/command";
import { addNote, addSource, createRun, readPlan, type ResearchRun } from "../research/run";
import { priorRun, settleRun } from "../research/session";
import { RESEARCH_TOOLS } from "../tools/research";
import { ResearchSourceList } from "../chat/ResearchSourceList";
import type { ResearchRunView } from "../research/runView";
import type { ToolContext } from "../tools/registry";

const page = (id: string) => `TOOL RESULT (read_url):\nSource id: ${id}. Record what it says.\nTitle: T\nContent:\n${"word ".repeat(500)}`;

function runWithNote(): ResearchRun {
  const run = createRun("r1", readPlan({ question: "Q", subQuestions: "A\nB" })!, 0);
  addSource(run, { url: "https://a.example/x", title: "Alpha", status: "read" });
  addSource(run, { url: "https://b.example/y", title: "Beta", status: "read" });
  addNote(run, { claim: "Alpha is fast", quote: "Alpha is fast today", source: "s1" });
  return run;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("receipts", () => {
  it("replaces a page that has notes and keeps one that has none", () => {
    const run = runWithNote();
    const wire = [
      { role: "tool", content: page("s1") },
      { role: "tool", content: page("s2") },
      { role: "user", content: "hello" },
    ];
    expect(applyReceipts(wire, run)).toBe(1);
    expect(wire[0].content).toContain("Title: Alpha");
    expect(wire[0].content).toContain("URL: https://a.example/x");
    expect(wire[0].content).toContain("n1");
    expect(wire[0].content.length).toBeLessThan(600);
    expect(wire[1].content).toBe(page("s2"));
    expect(applyReceipts(wire, run)).toBe(0);
  });

  it("gives no receipt before a note exists", () => {
    const run = createRun("r", readPlan({ question: "Q" })!, 0);
    addSource(run, { url: "https://a.example/x", status: "read" });
    expect(receiptFor(run, page("s1"))).toBeNull();
  });
});

describe("follow-ups", () => {
  it("spots a finished run in the chat", () => {
    const done = { type: "research_run", researchRun: { endedAt: 5 } };
    expect(holdsFinishedRun([{ steps: [done] }])).toBe(true);
    expect(holdsFinishedRun([{ steps: [{ type: "research_run", researchRun: {} }] }, {}])).toBe(false);
    expect(followUpInstruction()).toMatch(/search_notes/);
  });

  it("searches the saved run once the turn is gone", async () => {
    const saved = {
      id: "r1",
      notes: [{ id: "n1", sourceId: "s1", claim: "Alpha is fast", quote: "Alpha is fast today", subQuestion: 1, confidence: "confirmed" }],
    };
    vi.stubGlobal("window", {
      electronAPI: {
        research: {
          list: vi.fn(async () => ({ success: true, runs: [{ id: "r1", chatId: "c1", status: "done", endedAt: 9 }] })),
          get: vi.fn(async () => ({ success: true, run: saved })),
          search: vi.fn(async () => ({ success: true, hits: [{ runId: "r1", kind: "source", ref: "s1", snippet: "fast page" }] })),
        },
      },
    });
    const ctx = { memo: new Map(), chatId: "c1" } as unknown as ToolContext;
    expect((await priorRun(ctx))?.id).toBe("r1");
    const found = await RESEARCH_TOOLS.find((spec) => spec.name === "search_notes")!.run({ query: "alpha" }, ctx);
    expect(found).toContain("n1 (s1): Alpha is fast");
    expect(found).toContain("page s1: fast page");
  });
});

describe("settleRun", () => {
  it("verifies notes and saves a run the model never finished", async () => {
    const save = vi.fn(async () => ({ success: true }));
    vi.stubGlobal("window", { electronAPI: { research: { save } } });
    const run = runWithNote();
    const ctx = { memo: new Map<string, unknown>([["research:run", run], ["research:pages", new Map([["s1", "Alpha is fast today."]])]]), chatId: "c1" } as unknown as ToolContext;
    expect(await settleRun(ctx)).toEqual({ dropped: 0 });
    expect(run.endedAt).toBeDefined();
    expect(run.notes[0].verified).toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "r1", chatId: "c1" }));
  });

  it("marks a page still reading as skipped and a stop as cancelled", async () => {
    vi.stubGlobal("window", { electronAPI: { research: { save: vi.fn(async () => ({ success: true })) } } });
    const run = runWithNote();
    addSource(run, { url: "https://c.example/z", status: "reading" });
    const ctx = { memo: new Map<string, unknown>([["research:run", run]]) } as unknown as ToolContext;
    await settleRun(ctx, "cancelled");
    expect(run.status).toBe("cancelled");
    expect(run.sources.map((source) => source.status)).toEqual(["read", "read", "skipped"]);
    expect(run.notes).toHaveLength(1);
    expect(await settleRun(ctx, "cancelled")).toBeNull();
  });
});

describe("finish_research", () => {
  it("says where a long report goes", async () => {
    vi.stubGlobal("window", { electronAPI: { research: { save: vi.fn(async () => ({ success: true })) } } });
    const ctx = { memo: new Map([["research:run", runWithNote()]]) } as unknown as ToolContext;
    const result = await RESEARCH_TOOLS.find((spec) => spec.name === "finish_research")!.run({}, ctx);
    expect(result).toMatch(/create_file/);
    expect(result).toMatch(/1,500 words/);
  });
});

describe("source list", () => {
  it("numbers the sources that have notes like the chips do", () => {
    const run: ResearchRunView = {
      id: "r", depth: "quick", startedAt: 0, endedAt: 5, wallMs: 1, gathering: false, questions: [], hosts: [],
      sources: [
        { id: "s1", url: "https://skip.example/a", title: "No notes", status: "read" },
        { id: "s2", url: "https://b.example/b", title: "Beta", site: "Beta Site", published: "2026-05-01T10:00:00Z", status: "read" },
      ],
      notes: [{ id: "n1", sourceId: "s2", quote: "q", verified: true }],
    };
    render(<ResearchSourceList run={run} t={(key) => key} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Beta Site · 2026-05-01")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });
});
