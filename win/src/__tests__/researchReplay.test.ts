// Checks the research bench corpus and its replay search and read, with no model and no network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORPUS_DIR, loadCorpus, readPage, replayApi, search } from "../../scripts/research-bench/replay.mjs";
import { citationPrecision, citationRecall, parseAnswer, parseVerdict } from "../../scripts/research-bench/metrics.mjs";
import { registerBuiltinTools } from "../tools/builtin";
import { resetRegistry, runTool } from "../tools/registry";
import type { ToolContext, ToolEnvironment } from "../tools/registry";

type Multihop = {
  id: string;
  kind: string;
  question: string;
  gold: string;
  goldPages: string[];
  evidence: { url: string; quote: string }[];
};

const BENCH = path.resolve(CORPUS_DIR, "..");
const corpus = loadCorpus();
const multihop = (JSON.parse(readFileSync(path.join(BENCH, "questions.json"), "utf8")) as Multihop[]).filter(
  (q) => q.kind === "multihop",
);

describe("research bench corpus", () => {
  it("holds 60 to 80 pages with unique URLs and valid dates", () => {
    expect(corpus.pages.length).toBeGreaterThanOrEqual(60);
    expect(corpus.pages.length).toBeLessThanOrEqual(80);
    expect(corpus.byUrl.size).toBe(corpus.pages.length);
    for (const p of corpus.pages) {
      expect(p.url).toMatch(/^https:\/\/[a-z0-9.-]+\.example\//);
      expect(p.date).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(p.body.length).toBeGreaterThan(40);
      expect(p.keywords.length).toBeGreaterThan(2);
    }
  });

  it("has an index that matches the page front matter", () => {
    const index = JSON.parse(readFileSync(path.join(CORPUS_DIR, "index.json"), "utf8")) as {
      file: string;
      url: string;
      title: string;
      date: string;
      keywords: string[];
    }[];
    expect(index.map((e) => e.url).sort()).toEqual(corpus.pages.map((p) => p.url).sort());
    for (const e of index) {
      const p = corpus.byUrl.get(e.url)!;
      expect(e).toEqual({ file: `pages/${p.file}`, url: p.url, title: p.title, date: p.date, keywords: p.keywords });
    }
  });
});

describe("research bench multi-hop questions", () => {
  it("are 40, each needing 2 to 4 corpus pages", () => {
    expect(multihop).toHaveLength(40);
    for (const q of multihop) {
      expect(q.goldPages.length, q.id).toBeGreaterThanOrEqual(2);
      expect(q.goldPages.length, q.id).toBeLessThanOrEqual(4);
      for (const url of q.goldPages) expect(corpus.byUrl.has(url), `${q.id} ${url}`).toBe(true);
    }
  });

  it("cite evidence quotes that appear in their pages, covering every gold page", () => {
    for (const q of multihop) {
      for (const e of q.evidence) {
        expect(corpus.byUrl.get(e.url)!.body, `${q.id}: ${e.quote}`).toContain(e.quote);
      }
      expect([...new Set(q.evidence.map((e) => e.url))].sort(), q.id).toEqual([...q.goldPages].sort());
    }
  });

  it("reach every gold page through the replay search with the question as the query", () => {
    for (const q of multihop) {
      const found = search(corpus, q.question).map((r) => r.url);
      for (const url of q.goldPages) expect(found, `${q.id} ${url}`).toContain(url);
    }
  });

  it("read the evidence back through readPage", async () => {
    const api = replayApi(corpus);
    for (const q of multihop) {
      for (const e of q.evidence) {
        const page = await api.readUrl(e.url);
        expect(page.text, q.id).toContain(e.quote);
      }
    }
  });
});

describe("replay search", () => {
  const hops: [string, string[]][] = [
    ["brindle python retries default", ["https://docs.brindle.example/4.x/retries", "https://docs.brindle.example/3.x/retries"]],
    ["marlow systems headquarters", ["https://marlow.example/about"]],
    ["kessing bay population", ["https://kessingbay.example/about"]],
    ["quillmark license mit mpl", ["https://docs.quillmark.example/changelog", "https://docs.quillmark.example/v2/install"]],
    ["quillmark 3.0 relicense sponsor request", ["https://blog.quillmark.example/3-0-release"]],
    ["AI-90 sensor accuracy datasheet", ["https://aldous-instruments.example/ai-90/datasheet", "https://aldous-instruments.example/ai-90/datasheet-rev-a"]],
    ["who acquired Aldous Instruments", ["https://corvane.example/press/aldous-acquisition"]],
    ["Veldmoor renamed Saltry", ["https://veldmoor.example/history", "https://veldmoor-council.example/about-the-town"]],
    ["Fenwright compaction stalls erratum Hearthdb p99", ["https://fenwright.example/papers/compaction-stalls-erratum", "https://fenwright.example/papers/compaction-stalls"]],
  ];

  it.each(hops)("finds the pages for %s", (query, urls) => {
    const found = search(corpus, query).map((r) => r.url);
    for (const url of urls) expect(found).toContain(url);
  });

  it("is deterministic and returns nothing for unrelated words", () => {
    expect(search(corpus, "quillmark license")).toEqual(search(corpus, "quillmark license"));
    expect(search(corpus, "zxqv wibble")).toEqual([]);
  });

  it("returns a near-identical distractor next to the page it imitates", () => {
    const found = search(corpus, "brindle default retries").map((r) => r.url);
    expect(found).toContain("https://brindle-ruby.example/");
    expect(found).toContain("https://brindle.example/");
  });

  it("reports an unknown address as unreachable", () => {
    expect(readPage(corpus, "https://nowhere.example/").blocked).toBe("unreachable");
  });
});

describe("replay behind the web tools", () => {
  const WEB: ToolEnvironment = {
    webMode: "on",
    codeExecution: false,
    libraryReady: false,
    hasFolder: false,
    hasSkills: false,
    projectRoot: "",
  };
  const context = () =>
    ({
      t: (key: string) => key,
      settings: {} as never,
      pushStep: () => {},
      patchStep: () => {},
      syncSteps: () => {},
      newId: () => "id",
      signal: new AbortController().signal,
      memo: new Map<string, unknown>(),
    }) as unknown as ToolContext;

  beforeEach(() => {
    resetRegistry();
    registerBuiltinTools();
    vi.stubGlobal("window", { electronAPI: replayApi(corpus) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("serves search_web and read_url from the corpus", async () => {
    const ctx = context();
    const searched = await runTool("search_web", { query: "brindle 4.x retries backoff" }, ctx, WEB);
    expect(searched).toContain("URL: https://docs.brindle.example/4.x/retries");
    const read = await runTool("read_url", { url: "https://docs.brindle.example/4.x/retries" }, ctx, WEB);
    expect(read).toContain("the delays are 2, 6, 18, 54 and 162 seconds");
    expect(read).toContain("Published: 2025-04-22");
  });
});

describe("research bench metrics", () => {
  const answer = [
    "The default is 5 retries [1]. It changed in 4.0.0 [2].",
    "",
    "Sources:",
    '[1] https://docs.brindle.example/4.x/retries "The default max_retries is 5."',
    '[2] https://docs.brindle.example/changelog "The default max_retries went from 3 to 4."',
    '[3] https://nowhere.example/ "The default max_retries is 5."',
  ].join("\n");

  it("parse the sources and score quotes against the cited page", () => {
    const { body, citations } = parseAnswer(answer);
    expect(body).toContain("changed in 4.0.0");
    expect(citations.map((c: { n: number }) => c.n)).toEqual([1, 2, 3]);
    expect(citationPrecision(citations, corpus)).toEqual({ supported: 1, total: 3 });
    expect(citationRecall(body)).toEqual({ cited: 2, total: 2 });
    expect(citationRecall("It is five. It changed in 4.0.0 [1].")).toEqual({ cited: 1, total: 2 });
  });

  it("read a grader verdict and treat anything else as incorrect", () => {
    expect(parseVerdict('{"verdict": "correct", "covered": null, "reason": "same"}')).toBe("correct");
    expect(parseVerdict("no idea")).toBe("incorrect");
  });
});
