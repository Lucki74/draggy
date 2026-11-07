import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBuiltinTools } from "../tools/builtin";
import { resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import { createRun } from "../research/run";
import { activeRun, pageTexts, setRun } from "../research/session";

const WEB: ToolEnvironment = {
  webMode: "on",
  codeExecution: false,
  libraryReady: false,
  hasFolder: false,
  hasSkills: false,
  projectRoot: "",
};

function context(): ToolContext {
  let next = 0;
  return {
    t: (key: string) => key,
    settings: {} as never,
    pushStep: () => {},
    patchStep: () => {},
    syncSteps: () => {},
    newId: () => `id${(next += 1)}`,
    signal: new AbortController().signal,
    memo: new Map<string, unknown>(),
  } as unknown as ToolContext;
}

function researching(depth: "quick" | "standard" = "standard") {
  const ctx = context();
  setRun(ctx, createRun("r1", { question: "Q?", subQuestions: ["One"], depth, sources: ["web"] }, Date.now()));
  return ctx;
}

const hit = { title: "A", url: "https://a.example/page", snippet: "a" };

beforeEach(() => {
  resetRegistry();
  registerBuiltinTools();
  vi.stubGlobal("window", {
    electronAPI: {
      searchWebDetailed: vi.fn(async () => ({ results: [hit], status: "ok", tried: ["duckduckgo"], provider: "duckduckgo" })),
      readUrl: vi.fn(async () => ({ title: "Page A", text: "The answer is forty two." })),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("web tools during a research run", () => {
  it("log searches, give read pages a source id and keep their text", async () => {
    const ctx = researching();
    const searched = await runTool("search_web", { query: "speed of X" }, ctx, WEB);
    expect(searched).toMatch(/Budget|budget|calls/);
    const read = await runTool("read_url", { url: hit.url }, ctx, WEB);
    expect(read).toMatch(/Source id: s1/);
    const run = activeRun(ctx)!;
    expect(run.queries).toHaveLength(1);
    expect(run.sources[0]).toMatchObject({ id: "s1", status: "read", title: "Page A" });
    expect(pageTexts(ctx).get("s1")).toBe("The answer is forty two.");
  });

  it("turn away a reworded search the run already made", async () => {
    const ctx = researching();
    await runTool("search_web", { query: "speed of X" }, ctx, WEB);
    const again = await runTool("search_web", { query: "X speed" }, ctx, WEB);
    expect(again).toMatch(/already ran a search like/);
    expect(window.electronAPI!.searchWebDetailed).toHaveBeenCalledTimes(1);
  });

  it("stop gathering once the budget is spent", async () => {
    const ctx = researching("quick");
    activeRun(ctx)!.toolCalls = 1_000;
    const result = await runTool("read_url", { url: hit.url }, ctx, WEB);
    expect(result).toMatch(/budget is spent/);
    expect(window.electronAPI!.readUrl).not.toHaveBeenCalled();
  });

  it("still read pages after a burst of searches with no note yet", async () => {
    const ctx = researching();
    for (const query of ["alpha engines", "beta rockets", "gamma fuel", "delta orbits"]) {
      await runTool("search_web", { query }, ctx, WEB);
    }
    const read = await runTool("read_url", { url: hit.url }, ctx, WEB);
    expect(read).toMatch(/Source id: s1/);
    expect(activeRun(ctx)!.status).toBe("gathering");
  });

  it("name the real reason when gathering stops", async () => {
    const ctx = researching();
    activeRun(ctx)!.dryStreak = 3;
    const result = await runTool("read_url", { url: hit.url }, ctx, WEB);
    expect(result).toMatch(/found nothing new/);
    expect(result).not.toMatch(/budget is spent/);
  });

  it("mark a page that failed as a failed source", async () => {
    const ctx = researching();
    vi.mocked(window.electronAPI!.readUrl).mockRejectedValueOnce(new Error("boom"));
    await runTool("read_url", { url: hit.url }, ctx, WEB);
    expect(activeRun(ctx)!.sources[0].status).toBe("failed");
  });

  it("say nothing about research outside a run", async () => {
    const ctx = context();
    const read = await runTool("read_url", { url: hit.url }, ctx, WEB);
    expect(read).not.toMatch(/Source id/);
    expect(activeRun(ctx)).toBeNull();
  });
});
