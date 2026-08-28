import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const library = require("./library.cjs");

const { chunkText, normalise, rankChunks, toBlob, fromBlob, CHUNK_TARGET_CHARS } =
  library;

const paragraph = (word, times) => Array.from({ length: times }, () => word).join(" ");

describe("chunking documents for retrieval", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
    expect(chunkText(null)).toEqual([]);
  });

  it("drops fragments that are too short to be worth embedding", () => {
    expect(chunkText("hi")).toEqual([]);
  });

  it("keeps a normal paragraph as one chunk", () => {
    const text = paragraph("alpha", 40);
    const chunks = chunkText(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("alpha");
  });

  it("splits a long document into several chunks", () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(`para${i}`, 60)).join("\n\n");
    expect(chunkText(text).length).toBeGreaterThan(1);
  });

  it("keeps every chunk near the target size", () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(`para${i}`, 60)).join("\n\n");

    for (const chunk of chunkText(text)) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS * 1.5);
    }
  });

  it("splits a single paragraph that is longer than the target", () => {
    const chunks = chunkText("x".repeat(CHUNK_TARGET_CHARS * 3));
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("attaches the nearest markdown heading to each chunk", () => {
    const text = ["# Vendor contract", "", paragraph("terms", 40)].join("\n");
    const [chunk] = chunkText(text);

    expect(chunk.heading).toBe("Vendor contract");
  });

  it("keeps the body when a heading is followed by text on the very next line", () => {
    const text = [
      "## Term and renewal",
      "This agreement begins on 3 March 2025 and runs for eighteen months.",
      "It renews automatically unless either party gives ninety days notice.",
    ].join("\n");

    const chunks = chunkText(text);

    expect(chunks, "a heading must not swallow the paragraph under it").toHaveLength(1);
    expect(chunks[0].heading).toBe("Term and renewal");
    expect(chunks[0].text).toContain("3 March 2025");
    expect(chunks[0].text).toContain("ninety days notice");
  });

  it("keeps every section of a realistic markdown document", () => {
    const text = [
      "# Vendor agreement with Northwind Traders",
      "",
      "## Term and renewal",
      "The renewal date is therefore 3 September 2026.",
      "",
      "## Payment",
      "Invoices are payable within forty-five days of receipt.",
      "Late payment accrues interest at 1.5 percent per month.",
    ].join("\n");

    const joined = chunkText(text)
      .map((chunk) => chunk.text)
      .join("\n");

    expect(joined).toContain("3 September 2026");
    expect(joined).toContain("forty-five days");
    expect(joined).toContain("1.5 percent");
  });

  it("does not discard a short unpunctuated line that is really content", () => {
    const text = ["Chapter one", "", paragraph("body", 40)].join("\n");
    const joined = chunkText(text)
      .map((chunk) => chunk.text)
      .join("\n");

    expect(joined).toContain("Chapter one");
  });

  it("never loses text that is long enough to be a chunk", () => {
    const text = [
      "# A",
      "First body paragraph that is comfortably long enough to survive chunking on its own.",
      "",
      "## B",
      "Second body paragraph that is also comfortably long enough to survive chunking.",
    ].join("\n");

    const joined = chunkText(text)
      .map((chunk) => chunk.text)
      .join("\n");

    expect(joined).toContain("First body paragraph");
    expect(joined).toContain("Second body paragraph");
  });

  it("switches heading when a new one appears", () => {
    const text = [
      "# First section",
      "",
      paragraph("alpha", 40),
      "",
      "## Second section",
      "",
      paragraph("beta", 40),
    ].join("\n");

    const chunks = chunkText(text);

    expect(chunks[0].heading).toBe("First section");
    expect(chunks[chunks.length - 1].heading).toBe("Second section");
  });

  it("treats a slide marker as a heading", () => {
    const text = ["--- Slide 3 ---", "", paragraph("slide body", 30)].join("\n");
    expect(chunkText(text)[0].heading).toContain("Slide 3");
  });

  it("treats a sheet marker as a heading", () => {
    const text = ["--- Sheet: Q4 Budget ---", "", paragraph("rows", 40)].join("\n");
    expect(chunkText(text)[0].heading).toContain("Q4 Budget");
  });

  it("never emits a chunk that is only a heading", () => {
    for (const chunk of chunkText("# Just a heading\n\n# And another")) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("carries overlap between consecutive chunks so a sentence is not cut in half", () => {
    const text = Array.from({ length: 10 }, (_, i) =>
      `${paragraph(`body${i}`, 55)} MARKER${i}`,
    ).join("\n\n");

    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);

    const joined = chunks.map((c) => c.text).join(" ");
    for (let i = 0; i < 10; i++) expect(joined).toContain(`MARKER${i}`);
  });

  it("caps the number of chunks taken from one enormous file", () => {
    const text = Array.from({ length: 4000 }, (_, i) => paragraph(`p${i}`, 60)).join("\n\n");
    expect(chunkText(text).length).toBeLessThanOrEqual(400);
  });

  it("normalises windows line endings", () => {
    const text = paragraph("alpha", 40) + "\r\n\r\n" + paragraph("beta", 40);
    expect(chunkText(text).length).toBeGreaterThanOrEqual(1);
  });
});

describe("vector normalisation", () => {
  it("produces a unit vector", () => {
    const unit = normalise(Float32Array.from([3, 4]));

    expect(unit[0]).toBeCloseTo(0.6, 6);
    expect(unit[1]).toBeCloseTo(0.8, 6);
  });

  it("makes the dot product of a vector with itself one", () => {
    const unit = normalise(Float32Array.from([1, 2, 3, 4, 5]));

    let total = 0;
    for (let i = 0; i < unit.length; i++) total += unit[i] * unit[i];

    expect(total).toBeCloseTo(1, 5);
  });

  it("leaves a zero vector alone rather than dividing by zero", () => {
    const zero = normalise(Float32Array.from([0, 0, 0]));
    expect([...zero]).toEqual([0, 0, 0]);
  });

  it("ranks a closer vector higher under a dot product", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    const near = normalise(Float32Array.from([0.9, 0.1, 0]));
    const far = normalise(Float32Array.from([0, 1, 0]));

    const dot = (a, b) => a.reduce((total, value, i) => total + value * b[i], 0);

    expect(dot(query, near)).toBeGreaterThan(dot(query, far));
  });
});

describe("storing vectors as SQLite blobs", () => {
  it("survives a round trip through a blob", () => {
    const original = normalise(Float32Array.from([0.1, -0.2, 0.3, 0.4]));
    const restored = fromBlob(toBlob(original));

    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 6);
    }
  });

  it("produces four bytes per dimension", () => {
    expect(toBlob(new Float32Array(768)).byteLength).toBe(768 * 4);
  });

  it("round trips through an actual SQLite blob column", () => {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE v (id INTEGER PRIMARY KEY, embedding BLOB NOT NULL)");

    const original = normalise(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
    db.prepare("INSERT INTO v (embedding) VALUES (?)").run(toBlob(original));

    const restored = fromBlob(db.prepare("SELECT embedding FROM v").get().embedding);

    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 6);
    }
    db.close();
  });
});

describe("ranking retrieved passages", () => {
  const entries = [
    { id: 1, heading: "Payment", text: "Invoices are payable within forty-five days.", path: "/docs/contract.md" },
    { id: 2, heading: "Method", text: "Bake at two hundred and thirty degrees.", path: "/docs/recipe.md" },
    { id: 3, heading: "Term", text: "The renewal date is 3 September 2026.", path: "/docs/contract.md" },
  ];

  const vectors = [
    normalise(Float32Array.from([1, 0, 0])),
    normalise(Float32Array.from([0, 1, 0])),
    normalise(Float32Array.from([0.9, 0, 0.1])),
  ];

  it("puts the closest passage first", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    const ranked = rankChunks(query, vectors, entries, 3);

    expect(ranked[0].id).toBe(1);
    expect(ranked[1].id).toBe(3);
    expect(ranked[2].id).toBe(2);
  });

  it("returns scores in descending order", () => {
    const query = normalise(Float32Array.from([0.5, 0.5, 0]));
    const ranked = rankChunks(query, vectors, entries, 3);

    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it("honours the requested limit", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    expect(rankChunks(query, vectors, entries, 2)).toHaveLength(2);
  });

  it("treats a missing or zero limit as the default", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));

    expect(rankChunks(query, vectors, entries, 0)).toHaveLength(3);
    expect(rankChunks(query, vectors, entries, undefined)).toHaveLength(3);
  });

  it("never returns more than twenty passages", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));

    const manyEntries = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      heading: "",
      text: `passage ${i}`,
      path: `/docs/file${i}.md`,
    }));
    const manyVectors = manyEntries.map(() =>
      normalise(Float32Array.from([Math.random(), Math.random(), Math.random()])),
    );

    expect(rankChunks(query, manyVectors, manyEntries, 999)).toHaveLength(20);
  });

  it("guards against a negative limit", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    expect(rankChunks(query, vectors, entries, -5).length).toBeGreaterThanOrEqual(1);
  });

  it("attaches the file name so the model can cite a source", () => {
    const query = normalise(Float32Array.from([0, 1, 0]));
    expect(rankChunks(query, vectors, entries, 1)[0].name).toBe("recipe.md");
  });

  it("keeps the heading and body text on each hit", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    const [top] = rankChunks(query, vectors, entries, 1);

    expect(top.heading).toBe("Payment");
    expect(top.text).toContain("forty-five days");
  });

  it("finds the right passage for a realistic query direction", () => {
    const bakingQuery = normalise(Float32Array.from([0.05, 0.99, 0]));
    expect(rankChunks(bakingQuery, vectors, entries, 1)[0].name).toBe("recipe.md");

    const contractQuery = normalise(Float32Array.from([0.95, 0.05, 0.1]));
    expect(rankChunks(contractQuery, vectors, entries, 1)[0].name).toBe("contract.md");
  });
});
