import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBuiltinTools } from "../tools/builtin";
import { resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";
import { createRun } from "../research/run";
import { activeRun, setRun } from "../research/session";

const WEB: ToolEnvironment = { webMode: "on", codeExecution: false, libraryReady: false, hasFolder: false, hasSkills: false, projectRoot: "" };

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

const paper = { title: "AlphaFold", url: "https://doi.org/10.1/x", snippet: "Proteins", source: "openalex", year: 2021, authors: "J. Jumper", doi: "10.1/x" };

let searchSource: ReturnType<typeof vi.fn>;
let searchWebDetailed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetRegistry();
  registerBuiltinTools();
  searchSource = vi.fn(async () => ({ results: [paper], status: "ok", tried: ["openalex"], provider: "papers" }));
  searchWebDetailed = vi.fn(async () => ({ results: [], status: "empty", tried: [], provider: null }));
  vi.stubGlobal("window", { electronAPI: { searchSource, searchWebDetailed } });
});

afterEach(() => vi.unstubAllGlobals());

describe("search_web source parameter", () => {
  it("sends papers to the source search and shows year, authors and DOI", async () => {
    const out = await runTool("search_web", { query: "alphafold", source: "papers" }, context(), WEB);
    expect(searchSource).toHaveBeenCalledWith("alphafold", "papers");
    expect(searchWebDetailed).not.toHaveBeenCalled();
    expect(out).toMatch(/Source: openalex/);
    expect(out).toMatch(/Year: 2021/);
    expect(out).toMatch(/Authors: J\. Jumper/);
    expect(out).toMatch(/DOI: 10\.1\/x/);
  });

  it("keeps the web path as the default and for unknown values", async () => {
    await runTool("search_web", { query: "a" }, context(), WEB);
    await runTool("search_web", { query: "b", source: "images" }, context(), WEB);
    expect(searchWebDetailed).toHaveBeenCalledTimes(2);
    expect(searchSource).not.toHaveBeenCalled();
  });

  it("tells an unavailable source apart from an empty one", async () => {
    searchSource.mockResolvedValue({ results: [], status: "unavailable", tried: ["github"], provider: null });
    const out = await runTool("search_web", { query: "x", source: "code" }, context(), WEB);
    expect(out).toMatch(/temporary outage/);
  });

  it("logs the kind in a research run and keeps web and papers repeats apart", async () => {
    const ctx = context();
    setRun(ctx, createRun("r1", { question: "Q?", subQuestions: ["One"], depth: "standard", sources: ["web", "papers"] }, Date.now()));
    await runTool("search_web", { query: "alphafold", source: "papers" }, ctx, WEB);
    expect(activeRun(ctx)!.queries[0]).toMatchObject({ kind: "papers" });
    await runTool("search_web", { query: "alphafold" }, ctx, WEB);
    expect(searchWebDetailed).toHaveBeenCalledTimes(1);
    const again = await runTool("search_web", { query: "alphafold", source: "papers" }, ctx, WEB);
    expect(again).toMatch(/already/);
    expect(searchSource).toHaveBeenCalledTimes(1);
  });
});
