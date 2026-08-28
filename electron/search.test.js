import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const search = require("./search.cjs");

const AUTO = { searchProvider: "auto", searxngUrl: "", braveApiKey: "" };

const ids = (chain) => chain.map((provider) => provider.id);

/**
 * Pacing and the cache both live in module state, so every test starts from a
 * clean slate and drives its own clock rather than sleeping for real.
 */
let clock = 0;
const deps = (extra) => ({
  now: () => clock,
  sleep: (ms) => {
    clock += ms;
    return Promise.resolve();
  },
  ...extra,
});

beforeEach(() => {
  clock = 1_000_000;
  search.clearCache();
});

describe("normalising results from any provider", () => {
  it("keeps well formed results", () => {
    const results = search.normaliseResults([
      { title: "A", url: "https://a.example", snippet: "one" },
    ]);

    expect(results).toEqual([{ title: "A", url: "https://a.example", snippet: "one" }]);
  });

  it("drops entries with no title", () => {
    expect(search.normaliseResults([{ url: "https://a.example", title: "" }])).toEqual([]);
  });

  it("drops non-http schemes, including javascript", () => {
    const results = search.normaliseResults([
      { title: "bad", url: "javascript:alert(1)" },
      { title: "bad", url: "file:///etc/passwd" },
      { title: "bad", url: "data:text/html,<script>" },
      { title: "good", url: "https://ok.example" },
    ]);

    expect(results.map((r) => r.title)).toEqual(["good"]);
  });

  it("removes duplicate urls, keeping the first", () => {
    const results = search.normaliseResults([
      { title: "first", url: "https://a.example" },
      { title: "second", url: "https://a.example" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("first");
  });

  it("caps the result count", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      title: `t${i}`,
      url: `https://e${i}.example`,
    }));

    expect(search.normaliseResults(many)).toHaveLength(search.RESULT_LIMIT);
  });

  it("truncates a runaway snippet", () => {
    const [result] = search.normaliseResults([
      { title: "t", url: "https://a.example", snippet: "x".repeat(5000) },
    ]);

    expect(result.snippet.length).toBe(500);
  });

  it("tolerates junk input", () => {
    expect(search.normaliseResults(null)).toEqual([]);
    expect(search.normaliseResults([null, undefined, 5, "x"])).toEqual([]);
  });
});

describe("building the provider chain", () => {
  it("uses the scrapers when nothing is configured", () => {
    expect(ids(search.buildChain(AUTO))).toEqual([
      "duckduckgo",
      "startpage",
      "duckduckgo-lite",
      "brave-html",
    ]);
  });

  it("offers several fallbacks, so no single engine can take search down", () => {
    expect(search.buildChain(AUTO).length).toBeGreaterThanOrEqual(3);
  });

  it("puts a configured SearXNG instance first", () => {
    const chain = search.buildChain({ ...AUTO, searxngUrl: "http://localhost:8080" });
    expect(chain[0].id).toBe("searxng");
  });

  it("puts a configured Brave key first when SearXNG is absent", () => {
    const chain = search.buildChain({ ...AUTO, braveApiKey: "BSA-x" });
    expect(chain[0].id).toBe("brave");
  });

  it("honours an explicit provider choice", () => {
    expect(search.buildChain({ ...AUTO, searchProvider: "startpage" })[0].id).toBe(
      "startpage",
    );
  });

  it("still keeps the others as fallbacks after an explicit choice", () => {
    const chain = search.buildChain({ ...AUTO, searchProvider: "startpage" });
    expect(chain.length).toBeGreaterThan(1);
    expect(ids(chain)).toContain("duckduckgo");
  });

  it("never offers a provider that has no credentials", () => {
    const chain = search.buildChain({ ...AUTO, searchProvider: "brave" });
    expect(ids(chain)).not.toContain("brave");
  });
});

const RESULTS = JSON.stringify([
  { title: "Result", url: "https://a.example", snippet: "s" },
]);

describe("failover", () => {
  it("returns the first provider that produces results", async () => {
    const scrape = vi.fn().mockResolvedValue(RESULTS);
    const outcome = await search.runSearch("hello", AUTO, deps({ scrape }));

    expect(outcome.provider).toBe("duckduckgo");
    expect(outcome.results).toHaveLength(1);
    expect(outcome.status).toBe("ok");
    expect(scrape).toHaveBeenCalledTimes(1);
  });

  it("moves to the next provider when the first throws", async () => {
    const scrape = vi
      .fn()
      .mockRejectedValueOnce(new Error("DuckDuckGo changed its markup"))
      .mockResolvedValueOnce(RESULTS);

    const outcome = await search.runSearch("hello", AUTO, deps({ scrape }));

    expect(outcome.provider).toBe("startpage");
    expect(outcome.tried).toEqual(["duckduckgo", "startpage"]);
  });

  it("moves on when the first returns an empty page rather than an error", async () => {
    const scrape = vi
      .fn()
      .mockResolvedValueOnce("[]")
      .mockResolvedValueOnce(RESULTS);

    const outcome = await search.runSearch("hello", AUTO, deps({ scrape }));
    expect(outcome.provider).toBe("startpage");
  });

  it("reports an outage as unavailable, not as an empty web", async () => {
    const scrape = vi.fn().mockRejectedValue(new Error("offline"));
    const outcome = await search.runSearch("hello", AUTO, deps({ scrape }));

    expect(outcome.results).toEqual([]);
    expect(outcome.provider).toBeNull();
    expect(outcome.status).toBe("unavailable");
    expect(outcome.tried).toEqual([
      "duckduckgo",
      "startpage",
      "duckduckgo-lite",
      "brave-html",
    ]);
  });

  it("reports a genuinely empty web as empty", async () => {
    const scrape = vi.fn().mockResolvedValue("[]");
    const outcome = await search.runSearch("hello", AUTO, deps({ scrape }));

    expect(outcome.status).toBe("empty");
  });

  it("does not call any provider for an empty query", async () => {
    const scrape = vi.fn();
    const outcome = await search.runSearch("   ", AUTO, deps({ scrape }));

    expect(scrape).not.toHaveBeenCalled();
    expect(outcome.results).toEqual([]);
  });

  it("passes a percent-encoded query into the scraper url", async () => {
    const scrape = vi.fn().mockResolvedValue(RESULTS);
    await search.runSearch("a & b", AUTO, deps({ scrape }));

    expect(scrape.mock.calls[0][0].url).toContain("a%20%26%20b");
  });

  it("asks the scraper for a desktop user agent", async () => {
    const scrape = vi.fn().mockResolvedValue(RESULTS);
    await search.runSearch("hello", AUTO, deps({ scrape }));

    expect(scrape.mock.calls[0][0].userAgent).toBe(search.DESKTOP_USER_AGENT);
  });
});

describe("staying under the rate limits", () => {
  it("spaces out repeated calls to the same provider", async () => {
    const scrape = vi.fn().mockResolvedValue(RESULTS);

    await search.runSearch("first question", AUTO, deps({ scrape }));
    const afterFirst = clock;
    await search.runSearch("second question", AUTO, deps({ scrape }));

    expect(clock - afterFirst).toBeGreaterThanOrEqual(search.PROVIDER_GAP_MS - 1);
  });

  it("does not make a lone search wait", async () => {
    const scrape = vi.fn().mockResolvedValue(RESULTS);
    const before = clock;
    await search.runSearch("only question", AUTO, deps({ scrape }));

    expect(clock).toBe(before);
  });
});

describe("answering repeats from memory", () => {
  it("does not ask the engine twice for the same question", async () => {
    const scrape = vi.fn().mockResolvedValue(RESULTS);

    await search.runSearch("same question", AUTO, deps({ scrape }));
    const again = await search.runSearch("Same Question", AUTO, deps({ scrape }));

    expect(scrape).toHaveBeenCalledTimes(1);
    expect(again.cached).toBe(true);
    expect(again.results).toHaveLength(1);
  });

  it("forgets an answer once it is stale", async () => {
    const scrape = vi.fn().mockResolvedValue(RESULTS);

    await search.runSearch("aging question", AUTO, deps({ scrape }));
    clock += search.CACHE_TTL_MS + 1;
    await search.runSearch("aging question", AUTO, deps({ scrape }));

    expect(scrape).toHaveBeenCalledTimes(2);
  });

  it("retries after an outage instead of remembering the failure", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    await search.runSearch("outage question", AUTO, deps({ scrape: failing }));

    const working = vi.fn().mockResolvedValue(RESULTS);
    const retry = await search.runSearch(
      "outage question",
      AUTO,
      deps({ scrape: working }),
    );

    expect(retry.status).toBe("ok");
    expect(working).toHaveBeenCalled();
  });
});

describe("following DuckDuckGo redirect links to the real page", () => {
  it("unwraps the uddg parameter", () => {
    expect(
      search.unwrapRedirect(
        "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.cdc.gov%2Flightning%2F&rut=abc",
      ),
    ).toBe("https://www.cdc.gov/lightning/");
  });

  it("leaves an ordinary url alone", () => {
    expect(search.unwrapRedirect("https://example.com/a?b=c")).toBe(
      "https://example.com/a?b=c",
    );
  });

  it("does not follow a redirect to a non-http target", () => {
    const hostile = "https://duckduckgo.com/l/?uddg=javascript%3Aalert(1)";
    expect(search.unwrapRedirect(hostile)).toBe(hostile);
  });

  it("normalises redirect links out of a result list", () => {
    const [result] = search.normaliseResults([
      {
        title: "CDC",
        url: "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.cdc.gov%2F",
      },
    ]);

    expect(result.url).toBe("https://www.cdc.gov/");
  });
});
