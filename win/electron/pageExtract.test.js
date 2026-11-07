import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { readPage, clearCache, buildExtractScript } = require("./pageExtract.cjs");

const body = (text, type = "text/html") => ({
  status: 200,
  url: "",
  headers: new Headers({ "content-type": type }),
  arrayBuffer: async () => new TextEncoder().encode(text).buffer,
});

function deps(overrides = {}) {
  const base = {
    fetch: vi.fn(async () => body("<html><head><title>T</title></head><body>hi</body></html>")),
    userAgent: "test",
    isFetchable: (url) => /^https:\/\/ok\./.test(url),
    refusalFor: () => "refused",
    extractHtml: vi.fn(async () => ({ markdown: "word ".repeat(200), title: "T", byline: "", siteName: "" })),
    render: vi.fn(async () => ({ markdown: "rendered ".repeat(200), title: "R", html: "", finalUrl: "https://ok.test/a" })),
    readPdf: vi.fn(async () => "--- Page 1 ---\nhello pdf"),
    saveSnapshot: vi.fn(() => "hash1"),
    log: { warn: vi.fn() },
  };
  return { ...base, ...overrides };
}

beforeEach(() => clearCache());

describe("readPage", () => {
  it("refuses an address the policy refuses without fetching", async () => {
    const d = deps();
    const result = await readPage("http://127.0.0.1/", 1, d);
    expect(result.blocked).toBe("refused");
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a blocked address", async () => {
    const d = deps({
      fetch: vi.fn(async () => ({ status: 302, headers: new Headers({ location: "http://10.0.0.1/x" }) })),
    });
    const result = await readPage("https://ok.test/a", 1, d);
    expect(result.blocked).toBe("refused");
    expect(d.render).not.toHaveBeenCalled();
  });

  it("takes the fast path when the text is long enough", async () => {
    const d = deps({ extractHtml: vi.fn(async () => ({ markdown: "word ".repeat(200), title: "T" })) });
    const result = await readPage("https://ok.test/a", 1, d);
    expect(d.render).not.toHaveBeenCalled();
    expect(result.snapshotHash).toBe("hash1");
    expect(result.pageCount).toBe(1);
    expect(result.pageNote).toBe("");
  });

  it("renders when the fast path finds too little", async () => {
    const d = deps({ extractHtml: vi.fn(async () => ({ markdown: "tiny", title: "T" })) });
    const result = await readPage("https://ok.test/a", 1, d);
    expect(d.render).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("rendered");
  });

  it("reads a pdf by content type", async () => {
    const d = deps({ fetch: vi.fn(async () => body("%PDF-1.4", "application/pdf")) });
    const result = await readPage("https://ok.test/download", 1, d);
    expect(d.readPdf).toHaveBeenCalledTimes(1);
    expect(d.extractHtml).not.toHaveBeenCalled();
    expect(result.text).toContain("hello pdf");
  });

  it("pages a long read and serves later pages from the cache", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ` + "y".repeat(990)).join("\n\n");
    const d = deps({ extractHtml: vi.fn(async () => ({ markdown: long, title: "T" })) });
    const first = await readPage("https://ok.test/long", 1, d);
    expect(first.pageCount).toBeGreaterThan(2);
    expect(first.pageNote).toMatch(/^Page 1 of \d+\. More follows.*page=2/);
    const second = await readPage("https://ok.test/long", 2, d);
    expect(second.page).toBe(2);
    expect(second.text).not.toBe(first.text);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.saveSnapshot).toHaveBeenCalledTimes(1);
    const past = await readPage("https://ok.test/long", 99, d);
    expect(past.text).toBe("");
    expect(past.pageNote).toContain("does not exist");
  });
});

describe("buildExtractScript", () => {
  it("embeds the html as data", () => {
    const script = buildExtractScript({ readability: "", turndown: "", html: "</script><b>", baseUrl: "https://x.test/" });
    expect(script).toContain(JSON.stringify("</script><b>"));
  });
});
