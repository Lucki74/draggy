import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const library = require("./library.cjs");

const {
  chunkText,
  normalise,
  rankChunks,
  fuse,
  toSearchQuery,
  toBlob,
  fromBlob,
  CHUNK_TARGET_CHARS,
} =
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
  /**
   * The shape the index holds: vectors end to end in one buffer, ids alongside.
   * Passage text is not in it, and is fetched for the few being returned.
   */
  function matrix(vectors, ids, sources = null) {
    const dim = vectors[0].length;
    const data = new Float32Array(vectors.length * dim);
    vectors.forEach((vector, index) => data.set(vector, index * dim));

    return {
      ids,
      sources: sources ?? ids.map(() => 1),
      data,
      dim,
    };
  }

  const vectors = [
    normalise(Float32Array.from([1, 0, 0])),
    normalise(Float32Array.from([0, 1, 0])),
    normalise(Float32Array.from([0.9, 0, 0.1])),
  ];

  const index = matrix(vectors, [1, 2, 3]);

  it("puts the closest passage first", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    const ranked = rankChunks(query, index, 3);

    expect(ranked[0].id).toBe(1);
    expect(ranked[1].id).toBe(3);
    expect(ranked[2].id).toBe(2);
  });

  it("returns scores in descending order", () => {
    const query = normalise(Float32Array.from([0.5, 0.5, 0]));
    const ranked = rankChunks(query, index, 3);

    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it("honours the requested limit", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    expect(rankChunks(query, index, 2)).toHaveLength(2);
  });

  it("treats a missing or zero limit as the full candidate depth", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));

    expect(rankChunks(query, index, 0)).toHaveLength(3);
    expect(rankChunks(query, index, undefined)).toHaveLength(3);
  });

  it("guards against a negative limit", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    expect(rankChunks(query, index, -5).length).toBeGreaterThanOrEqual(1);
  });

  it("finds the right passage for a realistic query direction", () => {
    const baking = normalise(Float32Array.from([0.05, 0.99, 0]));
    expect(rankChunks(baking, index, 1)[0].id).toBe(2);

    // Ids 1 and 3 are two passages of the same contract, either of which is a
    // right answer here; id 2 is the recipe and is not.
    const contract = normalise(Float32Array.from([0.95, 0.05, 0.1]));
    expect([1, 3]).toContain(rankChunks(contract, index, 1)[0].id);
  });

  it("searches one folder when asked to", () => {
    const scoped = matrix(vectors, [1, 2, 3], [7, 9, 7]);
    const query = normalise(Float32Array.from([1, 0, 0]));

    const ranked = rankChunks(query, scoped, 10, 9);
    expect(ranked.map((hit) => hit.id)).toEqual([2]);
  });

  it("returns nothing for an empty index", () => {
    const query = normalise(Float32Array.from([1, 0, 0]));
    expect(rankChunks(query, { ids: [], sources: [], data: new Float32Array(0), dim: 0 }, 5))
      .toEqual([]);
  });
});

describe("turning a typed question into an FTS5 query", () => {
  it("quotes each word and joins them with OR", () => {
    expect(toSearchQuery("payment terms")).toBe('"payment" OR "terms"');
  });

  it("survives punctuation that would otherwise be FTS5 syntax", () => {
    // Each of these is a syntax error if passed through unaltered.
    expect(() => toSearchQuery('what about "quotes" and NEAR and -minus?')).not.toThrow();
    expect(toSearchQuery('"quoted"')).toBe('"quoted"');
    expect(toSearchQuery("a - b")).toBe(null);
  });

  it("keeps identifiers a vector search would miss", () => {
    expect(toSearchQuery("error ENOENT in build_step_2")).toContain('"enoent"');
    expect(toSearchQuery("error ENOENT in build_step_2")).toContain('"build_step_2"');
  });

  it("handles languages that are not English", () => {
    expect(toSearchQuery("échéance du contrat")).toContain('"échéance"');
    expect(toSearchQuery("契約 の 期限")).toContain('"契約"');
  });

  it("returns nothing to search for when there are no usable words", () => {
    expect(toSearchQuery("")).toBe(null);
    expect(toSearchQuery("   ")).toBe(null);
    expect(toSearchQuery("? ! -")).toBe(null);
  });

  it("caps a very long question", () => {
    const many = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    expect(toSearchQuery(many).split(" OR ")).toHaveLength(24);
  });
});

describe("fusing the two arms of the search", () => {
  const vectorHits = [
    { id: 1, score: 0.9 },
    { id: 2, score: 0.8 },
    { id: 3, score: 0.7 },
  ];

  it("ranks a passage both arms found above one only a single arm did", () => {
    const fused = fuse(vectorHits, [3, 9], 4);
    expect(fused[0].id).toBe(3);
  });

  it("keeps a keyword-only hit that the vectors missed entirely", () => {
    // The whole reason for a second arm: an exact term the embedding does not
    // place anywhere near the query.
    const fused = fuse(vectorHits, [42], 10);
    expect(fused.map((hit) => hit.id)).toContain(42);
  });

  it("keeps a vector-only hit that shares no words with the query", () => {
    const fused = fuse(vectorHits, [], 10);
    expect(fused.map((hit) => hit.id)).toEqual([1, 2, 3]);
  });

  it("reports the cosine score, not the fusion score, for a vector hit", () => {
    const [top] = fuse(vectorHits, [1], 1);
    expect(top.similarity).toBeCloseTo(0.9, 6);
  });

  it("has no cosine score to report for a keyword-only hit", () => {
    const fused = fuse([], [5], 1);
    expect(fused[0].similarity).toBeNull();
  });

  it("honours the limit", () => {
    expect(fuse(vectorHits, [7, 8, 9], 2)).toHaveLength(2);
  });

  it("returns nothing when neither arm found anything", () => {
    expect(fuse([], [], 5)).toEqual([]);
  });

  it("never lists the same passage twice", () => {
    const fused = fuse(vectorHits, [1, 2, 3], 10);
    expect(new Set(fused.map((hit) => hit.id)).size).toBe(fused.length);
  });
});
