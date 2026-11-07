import { describe, expect, it, vi } from "vitest";
import { RESEARCH_TOOLS } from "../tools/research";
import { activeRun, recordRead, spendCall } from "../research/session";
import type { ToolContext } from "../tools/registry";

const tool = (name: string) => RESEARCH_TOOLS.find((spec) => spec.name === name)!;

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  let next = 0;
  return {
    t: (key: string) => key,
    newId: () => `id${(next += 1)}`,
    pushStep: vi.fn(),
    patchStep: vi.fn(),
    syncSteps: vi.fn(),
    memo: new Map(),
    signal: new AbortController().signal,
    ...overrides,
  } as unknown as ToolContext;
}

const PLAN = { question: "How fast is X?", sub_questions: "Speed\nCost", depth: "quick", sources: "web" };

describe("start_research", () => {
  it("starts a run once the user approves", async () => {
    const ctx = context({ askUser: vi.fn(async () => ({ choices: ["approve"], text: "" })) });
    const result = await tool("start_research").run(PLAN, ctx);
    expect(result).toMatch(/plan is approved/);
    expect(activeRun(ctx)?.plan.subQuestions).toEqual(["Speed", "Cost"]);
  });

  it("takes the plan the user edited on the card", async () => {
    const edited = { subQuestions: ["Speed only"], depth: "deep", sources: ["web", "papers"] };
    const ctx = context({ askUser: vi.fn(async () => ({ choices: ["approve"], text: JSON.stringify(edited) })) });
    await tool("start_research").run(PLAN, ctx);
    expect(activeRun(ctx)?.plan).toEqual({ question: "How fast is X?", ...edited });
    expect(ctx.pushStep).toHaveBeenCalledWith(expect.objectContaining({ type: "research_plan" }));
  });

  it("does not start when the user cancels", async () => {
    const ctx = context({ askUser: vi.fn(async () => ({ choices: ["Cancel"], text: "" })) });
    expect(await tool("start_research").run(PLAN, ctx)).toMatch(/did not approve/);
    expect(activeRun(ctx)).toBeNull();
  });

  it("uses the edited plan from the approval card", async () => {
    const ctx = context({
      approveResearch: vi.fn(async (plan) => ({ ...plan, subQuestions: ["Only this"] })),
    });
    await tool("start_research").run(PLAN, ctx);
    expect(activeRun(ctx)?.plan.subQuestions).toEqual(["Only this"]);
  });
});

describe("notes and finish", () => {
  async function started() {
    const ctx = context({ approveResearch: async (plan) => plan });
    await tool("start_research").run(PLAN, ctx);
    return ctx;
  }

  it("rejects a note on a page that was not read", async () => {
    const ctx = await started();
    expect(await tool("add_note").run({ claim: "c", quote: "q", source_id: "s1" }, ctx)).toMatch(/not one you have read/);
  });

  it("keeps notes whose quote is on the page and drops the rest", async () => {
    const ctx = await started();
    const page = "X runs at nine hundred frames per second on a laptop. It costs nothing to use.";
    const source = recordRead(ctx, { url: "https://example.com/x", title: "X", text: page, ok: true });
    expect(source?.id).toBe("s1");
    await tool("add_note").run(
      { sub_question: 1, claim: "X is fast", quote: "X runs at nine hundred frames per second", source_id: "s1" },
      ctx,
    );
    await tool("add_note").run({ sub_question: 2, claim: "X is free", quote: "X is totally free forever", source_id: "s1" }, ctx);
    const result = await tool("finish_research").run({}, ctx);
    expect(result).toContain("n1 q1 single_source: X is fast");
    expect(result).not.toContain("X is free");
    expect(result).toMatch(/1 notes were left out/);
    expect(result).toContain("2. Cost");
    expect(activeRun(ctx)?.contactedHosts).toEqual(["example.com"]);
  });

  it("finds notes by keyword", async () => {
    const ctx = await started();
    recordRead(ctx, { url: "https://example.com/x", text: "a b c", ok: true });
    await tool("add_note").run({ claim: "Latency is low", quote: "a b c", source_id: "s1" }, ctx);
    expect(await tool("search_notes").run({ query: "latency" }, ctx)).toContain("n1 (s1): Latency is low");
    expect(await tool("search_notes").run({ query: "price" }, ctx)).toMatch(/No notes match/);
  });

  it("reports stop once the call budget is spent", async () => {
    const ctx = await started();
    let stopped = false;
    for (let i = 0; i < 20 && !stopped; i += 1) stopped = spendCall(ctx);
    expect(stopped).toBe(true);
    expect(activeRun(ctx)?.status).toBe("writing");
  });
});
