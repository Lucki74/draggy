/** Lane layout for a commit graph, one row per commit in topological order, newest first. */

export interface GraphCommitInput {
  hash: string;
  parents?: string[];
}

/** One segment in a row. Lanes are columns; y runs 0 (row top) to 1 (row bottom), the dot at 0.5. */
export interface GraphLine {
  fromLane: number;
  fromY: 0 | 0.5;
  toLane: number;
  toY: 0.5 | 1;
  /** The lane whose colour the segment takes. */
  color: number;
}

export interface GraphRow {
  hash: string;
  lane: number;
  lines: GraphLine[];
  /** Lanes the row spans, for its width. */
  lanes: number;
}

const freeSlot = (lanes: (string | null)[]) => {
  const at = lanes.indexOf(null);
  return at === -1 ? lanes.length : at;
};

/** Each lane waits for the commit it leads to. A commit takes the first lane waiting for it, the
 * other lanes waiting for it join it, and its parents carry on below. */
export function layoutGraph(commits: GraphCommitInput[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) lane = freeSlot(lanes);
    const before = [...lanes];
    const lines: GraphLine[] = [];

    before.forEach((waiting, index) => {
      if (waiting === null) return;
      if (waiting === commit.hash) {
        lines.push({ fromLane: index, fromY: 0, toLane: lane, toY: 0.5, color: index });
        lanes[index] = null;
      } else {
        lines.push({ fromLane: index, fromY: 0, toLane: index, toY: 1, color: index });
      }
    });

    lanes[lane] = null;
    (commit.parents ?? []).forEach((parent, order) => {
      let target = lanes.indexOf(parent);
      // The first parent stays in this lane unless a lane further left already waits for it.
      if (order === 0 && (target === -1 || target > lane)) target = lane;
      else if (target === -1) target = freeSlot(lanes);
      lanes[target] = parent;
      lines.push({ fromLane: lane, fromY: 0.5, toLane: target, toY: 1, color: order === 0 ? lane : target });
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ hash: commit.hash, lane, lines, lanes: Math.max(before.length, lanes.length, lane + 1) });
  }
  return rows;
}
