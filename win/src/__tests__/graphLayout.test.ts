import { describe, expect, it } from "vitest";
import { layoutGraph } from "../diff/graphLayout";

describe("layoutGraph", () => {
  it("keeps a straight history in one lane", () => {
    const rows = layoutGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows[0].lines).toEqual([{ fromLane: 0, fromY: 0.5, toLane: 0, toY: 1, color: 0 }]);
    expect(rows[1].lines).toHaveLength(2);
    expect(rows[2].lines).toEqual([{ fromLane: 0, fromY: 0, toLane: 0, toY: 0.5, color: 0 }]);
  });

  it("opens a lane for a merged branch and closes it where the branch started", () => {
    // m merges s into main; s and b both come from a.
    const rows = layoutGraph([
      { hash: "m", parents: ["b", "s"] },
      { hash: "s", parents: ["a"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);

    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 0]);
    expect(rows[0].lines).toContainEqual({ fromLane: 0, fromY: 0.5, toLane: 1, toY: 1, color: 1 });
    expect(rows[1].lines).toContainEqual({ fromLane: 0, fromY: 0, toLane: 0, toY: 1, color: 0 });
    // The side lane joins main at a.
    expect(rows[3].lines).toContainEqual({ fromLane: 1, fromY: 0, toLane: 0, toY: 0.5, color: 1 });
    expect(rows[3].lanes).toBe(2);
  });

  it("gives a second branch tip its own lane", () => {
    const rows = layoutGraph([
      { hash: "x", parents: ["a"] },
      { hash: "y", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);

    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0]);
    // y starts a lane, so nothing comes in from above it.
    expect(rows[1].lines.some((line) => line.fromLane === 1 && line.fromY === 0)).toBe(false);
  });
});
