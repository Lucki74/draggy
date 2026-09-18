import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { loadFavicon, sniffImageType, isValidHostname } = require("./favicon.cjs");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
const HTML = Buffer.from("<!doctype html><html><body>nope</body></html>");

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "draggy-favicon-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function reply(body, ok = true) {
  return {
    ok,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
    text: async () => body.toString("utf8"),
  };
}

describe("recognising what actually is an image", () => {
  it("names the formats a favicon arrives in", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(ICO)).toBe("image/x-icon");
    expect(sniffImageType(Buffer.from('<svg xmlns="x"></svg>'))).toBe("image/svg+xml");
  });

  it("refuses an error page served where an icon was asked for", () => {
    expect(sniffImageType(HTML)).toBeNull();
  });

  it("refuses something too short to identify", () => {
    expect(sniffImageType(Buffer.from([0x89]))).toBeNull();
  });
});

describe("hostnames it will look up", () => {
  it("accepts ordinary ones", () => {
    expect(isValidHostname("example.com")).toBe(true);
    expect(isValidHostname("news.bbc.co.uk")).toBe(true);
  });

  it("refuses anything that could walk out of the cache directory", () => {
    expect(isValidHostname("../../etc/passwd")).toBe(false);
    expect(isValidHostname("a..b")).toBe(false);
    expect(isValidHostname("has/slash")).toBe(false);
    expect(isValidHostname("")).toBe(false);
  });
});

describe("fetching an icon", () => {
  it("takes /favicon.ico when the site has one", async () => {
    const calls = [];
    const bytes = await loadFavicon(dir, "example.com", {
      fetch: async (url) => {
        calls.push(url);
        return reply(PNG);
      },
    });

    expect(calls).toEqual(["https://example.com/favicon.ico"]);
    expect(bytes).toEqual(PNG);
  });

  it("falls back to the icon the page declares", async () => {
    const calls = [];
    const bytes = await loadFavicon(dir, "example.com", {
      fetch: async (url) => {
        calls.push(url);
        if (url.endsWith("/favicon.ico")) return reply(Buffer.alloc(0), false);
        if (url === "https://example.com")
          return reply(Buffer.from('<link rel="shortcut icon" href="/i/x.png">'));
        return reply(PNG);
      },
    });

    expect(calls).toContain("https://example.com/i/x.png");
    expect(bytes).toEqual(PNG);
  });

  it("reads a declared icon whose attributes are not quoted", async () => {
    // Minified pages really do ship `rel=icon href=/x.ico /`, and requiring
    // quotes silently loses every one of them.
    const bytes = await loadFavicon(dir, "example.com", {
      fetch: async (url) => {
        if (url.endsWith("/favicon.ico")) return reply(HTML, false);
        if (url === "https://example.com")
          return reply(Buffer.from("<link data-rh=true rel=icon href=/assets/f.ico />"));
        if (url === "https://example.com/assets/f.ico") return reply(ICO);
        return reply(Buffer.alloc(0), false);
      },
    });

    expect(bytes).toEqual(ICO);
  });

  it("tries the next declared icon when the first does not resolve", async () => {
    const bytes = await loadFavicon(dir, "example.com", {
      fetch: async (url) => {
        if (url.endsWith("/favicon.ico")) return reply(HTML, false);
        if (url === "https://example.com")
          return reply(
            Buffer.from(
              '<link rel="icon" href="/gone.png"><link rel="apple-touch-icon" href="/ok.png">',
            ),
          );
        if (url === "https://example.com/ok.png") return reply(PNG);
        return reply(Buffer.alloc(0), false);
      },
    });

    expect(bytes).toEqual(PNG);
  });

  it("does not cache an HTML error page as an icon", async () => {
    const bytes = await loadFavicon(dir, "example.com", {
      fetch: async () => reply(HTML),
    });

    expect(bytes).toBeNull();
  });

  it("reads the second request off the disk instead of the network", async () => {
    let requests = 0;
    const fetchOnce = async () => {
      requests++;
      return reply(PNG);
    };

    await loadFavicon(dir, "example.com", { fetch: fetchOnce });
    const again = await loadFavicon(dir, "example.com", { fetch: fetchOnce });

    expect(requests).toBe(1);
    expect(again).toEqual(PNG);
  });

  it("remembers a host with no icon so it is asked only once", async () => {
    let requests = 0;
    const failing = async () => {
      requests++;
      return reply(Buffer.alloc(0), false);
    };

    expect(await loadFavicon(dir, "nothing.example", { fetch: failing })).toBeNull();
    const before = requests;
    expect(await loadFavicon(dir, "nothing.example", { fetch: failing })).toBeNull();

    expect(requests).toBe(before);
  });

  it("never reaches the network for a hostname it would refuse", async () => {
    let requests = 0;
    const bytes = await loadFavicon(dir, "../../secret", {
      fetch: async () => {
        requests++;
        return reply(PNG);
      },
    });

    expect(bytes).toBeNull();
    expect(requests).toBe(0);
  });

  it("survives a host that never answers", async () => {
    const bytes = await loadFavicon(dir, "dead.example", {
      fetch: async () => {
        throw new Error("ETIMEDOUT");
      },
    });

    expect(bytes).toBeNull();
  });
});
