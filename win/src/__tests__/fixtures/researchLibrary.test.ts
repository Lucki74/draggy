import { beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib = require("../../../electron/researchLibrary.cjs") as any;

const DAY = 24 * 60 * 60 * 1000;

function run(id: string, startedAt: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: "w1",
    chatId: "c1",
    status: "done",
    startedAt,
    endedAt: startedAt + 1000,
    contactedHosts: ["example.com"],
    plan: { question: "How fast is the borrow checker?", subQuestions: ["Speed", "Cost"], depth: "quick", sources: ["web"] },
    sources: [
      { id: "s1", url: "https://example.com/a", key: "example.com/a", title: "A", status: "read", text: "The borrow checker runs in linear time." },
      { id: "s2", url: "https://example.com/b", key: "example.com/b", title: "B", status: "blocked" },
    ],
    notes: [
      { id: "n1", subQuestion: 1, claim: "It is linear", quote: "runs in linear time", sourceId: "s1", confidence: "single_source", verified: true },
    ],
    ...extra,
  };
}

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  lib.init(db);
});

describe("research library", () => {
  it("round-trips a run with its sources, snapshot and notes", () => {
    lib.saveRun(run("r1", 1000));
    const saved = lib.getRun("r1");
    expect(saved.question).toBe("How fast is the borrow checker?");
    expect(saved.sourceCount).toBe(1);
    expect(saved.noteCount).toBe(1);
    expect(saved.contactedHosts).toEqual(["example.com"]);
    expect(saved.notes[0]).toMatchObject({ id: "n1", verified: true });
    expect(saved.sources[0].canonicalUrl).toBe("example.com/a");
    expect(lib.snapshot(saved.sources[0].snapshotHash).markdown).toContain("linear time");
    expect(saved.sources[1].snapshotHash).toBeNull();
  });

  it("replaces an earlier save of the same run", () => {
    lib.saveRun(run("r1", 1000));
    lib.saveRun(run("r1", 1000, { notes: [] }));
    expect(lib.getRun("r1").noteCount).toBe(0);
    expect(lib.searchRuns("linear")).toHaveLength(1);
  });

  it("lists newest first and filters by workspace", () => {
    lib.saveRun(run("old", 1000));
    lib.saveRun(run("new", 2000, { workspaceId: "w2" }));
    expect(lib.listRuns().map((row: { id: string }) => row.id)).toEqual(["new", "old"]);
    expect(lib.listRuns("w2").map((row: { id: string }) => row.id)).toEqual(["new"]);
  });

  it("searches questions, notes and pages, safe against FTS syntax", () => {
    lib.saveRun(run("r1", 1000));
    const kinds = lib.searchRuns("linear").map((hit: { kind: string }) => hit.kind).sort();
    expect(kinds).toEqual(["note", "source"]);
    expect(lib.searchRuns("borrow", { runId: "nope" })).toEqual([]);
    expect(() => lib.searchRuns('"AND OR ( NEAR')).not.toThrow();
    expect(lib.searchRuns("   ")).toEqual([]);
  });

  it("removes a run and its orphaned snapshots", () => {
    lib.saveRun(run("r1", 1000));
    const hash = lib.getRun("r1").sources[0].snapshotHash;
    lib.removeRun("r1");
    expect(lib.getRun("r1")).toBeNull();
    expect(lib.snapshot(hash)).toBeNull();
    expect(lib.searchRuns("linear")).toEqual([]);
  });

  it("keeps a snapshot another run still uses", () => {
    lib.saveRun(run("r1", 1000));
    lib.saveRun(run("r2", 1000));
    const hash = lib.getRun("r1").sources[0].snapshotHash;
    lib.removeRun("r1");
    expect(lib.snapshot(hash)).not.toBeNull();
  });

  it("drops runs past the retention window", () => {
    const now = 100 * DAY;
    lib.saveRun(run("old", now - 40 * DAY));
    lib.saveRun(run("new", now - 10 * DAY));
    expect(lib.applyRetention("forever", now)).toBe(0);
    expect(lib.applyRetention("30", now)).toBe(1);
    expect(lib.listRuns().map((row: { id: string }) => row.id)).toEqual(["new"]);
  });
});
