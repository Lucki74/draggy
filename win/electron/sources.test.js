import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const sources = require("./sources.cjs");

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../shared/fixtures/web/sources-${name}.json`, import.meta.url), "utf8"));

describe("paper parsers", () => {
  it("reads OpenAlex works with DOI, authors and the rebuilt abstract", () => {
    const [first, second] = sources.parseOpenAlex(fixture("openalex"));
    expect(first).toMatchObject({ doi: "10.1038/s41586-021-03819-2", year: 2021, source: "openalex", snippet: "Proteins are essential" });
    expect(first.authors).toBe("John Jumper, Richard Evans, Alexander Pritzel, et al.");
    expect(first.url).toBe("https://doi.org/10.1038/s41586-021-03819-2");
    expect(second.doi).toBeUndefined();
  });

  it("reads the arXiv feed", () => {
    const [first, second] = sources.parseArxiv(fixture("arxiv").xml);
    expect(first).toMatchObject({ title: "Highly accurate protein structure prediction with AlphaFold", year: 2021, doi: "10.1038/s41586-021-03819-2" });
    expect(first.snippet).toBe("Proteins are essential & hard to predict.");
    expect(second.url).toBe("https://arxiv.org/abs/2201.00001v1");
    expect(second.pdf).toBe("https://arxiv.org/pdf/2201.00001v1");
  });

  it("reads Crossref items and skips ones without a title", () => {
    const rows = sources.parseCrossref(fixture("crossref"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ year: 2021, authors: "John Jumper, DeepMind Team", snippet: "Proteins are essential." });
  });

  it("merges by DOI, keeping the first row and filling gaps", () => {
    const merged = sources.mergePapers([
      sources.parseOpenAlex(fixture("openalex")),
      sources.parseArxiv(fixture("arxiv").xml),
      sources.parseCrossref(fixture("crossref")),
    ]);
    const alpha = merged.filter((row) => row.doi === "10.1038/s41586-021-03819-2");
    expect(alpha).toHaveLength(1);
    expect(alpha[0].source).toBe("openalex");
    expect(alpha[0].pdf).toContain("nature.com");
  });

  it("normalises DOI spellings", () => {
    expect(sources.normaliseDoi("https://doi.org/10.1000/ABC")).toBe("10.1000/abc");
    expect(sources.normaliseDoi("doi:10.1000/abc")).toBe("10.1000/abc");
    expect(sources.normaliseDoi("not a doi")).toBe("");
  });
});

describe("wiki and code parsers", () => {
  it("reads Wikipedia search, summary and Wikidata", () => {
    const rows = sources.parseWikiSearch(fixture("wikipedia"));
    expect(rows[0]).toMatchObject({ title: "Alan Turing", snippet: "English mathematician & computer scientist", url: "https://en.wikipedia.org/wiki/Alan_Turing" });
    expect(sources.parseWikiSummary(fixture("wikipedia-summary")).url).toBe("https://en.wikipedia.org/wiki/Alan_Turing");
    expect(sources.parseWikiSummary({})).toBeNull();
    expect(sources.parseWikidata(fixture("wikidata"))).toEqual([
      { title: "Alan Turing", url: "https://www.wikidata.org/wiki/Q7251", snippet: "English computer scientist (1912-1954)", source: "wikidata" },
    ]);
  });

  it("reads GitHub, npm, PyPI and crates.io", () => {
    expect(sources.parseGithub(fixture("github"))[0]).toMatchObject({ title: "ggml-org/llama.cpp", source: "github" });
    expect(sources.parseNpm(fixture("npm")).map((r) => r.url)).toEqual(["https://www.npmjs.com/package/left-pad", "https://www.npmjs.com/package/nolinks"]);
    expect(sources.parsePypi(fixture("pypi"))[0].title).toBe("requests 2.32.3");
    expect(sources.parsePypi({})).toEqual([]);
    expect(sources.parseCrates(fixture("crates"))[1].url).toBe("https://crates.io/crates/serde_json");
  });
});

const reply = (body, status = 200) => ({ status, ok: status < 400, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

function deps(handler) {
  let clock = 0;
  const fetch = vi.fn(async (url, init) => handler(new URL(url), init));
  return { fetch, version: "3.0.5", now: () => clock, sleep: async (ms) => { clock += ms; } };
}

describe("searchSource", () => {
  it("sends the Draggy user agent and merges the paper providers", async () => {
    const d = deps((url) => {
      if (url.host === "api.openalex.org") return reply(fixture("openalex"));
      if (url.host === "export.arxiv.org") return reply(fixture("arxiv").xml);
      return reply(fixture("crossref"));
    });
    const outcome = await sources.searchSource("alphafold", "papers", d);
    expect(outcome.status).toBe("ok");
    expect(outcome.results.filter((r) => r.doi === "10.1038/s41586-021-03819-2")).toHaveLength(1);
    expect(d.fetch.mock.calls[0][1].headers["User-Agent"]).toBe("Draggy/3.0.5 (+https://draggy.org)");
  });

  it("reports a GitHub 403 as unavailable and not as empty", async () => {
    const d = deps((url) => (url.host === "api.github.com" ? reply({}, 403) : reply({}, 404)));
    const outcome = await sources.searchSource("zzzz", "code", d);
    expect(outcome.status).toBe("unavailable");
  });

  it("keeps the other registries when GitHub is limited", async () => {
    const d = deps((url) => {
      if (url.host === "api.github.com") return reply({}, 403);
      if (url.host === "registry.npmjs.org") return reply(fixture("npm"));
      return reply({}, 404);
    });
    const outcome = await sources.searchSource("left-pad", "code", d);
    expect(outcome.status).toBe("ok");
    expect(outcome.results[0].source).toBe("npm");
  });

  it("reports empty when every provider answered with nothing", async () => {
    const d = deps(() => reply({ search: [], query: { search: [] } }));
    expect((await sources.searchSource("nothing", "wiki", d)).status).toBe("empty");
  });

  it("refuses an unknown source without any request", async () => {
    const d = deps(() => reply({}));
    expect((await sources.searchSource("x", "images", d)).status).toBe("empty");
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("spaces requests to one host apart", async () => {
    const d = deps((url) => reply(url.pathname.includes("rest_v1") ? fixture("wikipedia-summary") : fixture("wikipedia")));
    const times = [];
    const base = d.fetch;
    d.fetch = vi.fn(async (...a) => {
      if (new URL(a[0]).hostname.endsWith(".wikipedia.org")) times.push(d.now());
      return base(...a);
    });
    await sources.searchSource("turing", "wiki", d);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(900);
  });
});
