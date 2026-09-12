/**
 * Line diffs for the timeline. Draggy shows what a change did rather than what
 * the file now says, because a reply that rewrites a file is unreadable and a
 * handful of marked lines is not.
 *
 * The shape is the usual one: trim what both sides share at each end, then work
 * out the middle properly. An edit almost always leaves a middle of a few
 * lines, so the expensive part rarely runs.
 */

export type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** Line numbers, where the side has one. */
  before: number | null;
  after: number | null;
}

export interface DiffHunk {
  lines: DiffLine[];
  /** Lines skipped between this hunk and the one before it. */
  skipped: number;
}

export interface FileDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** Set when the change was too big to line up, with a count instead. */
  summary?: string;
}

/** How much unchanged text is shown either side of a change. */
export const CONTEXT_LINES = 3;

/** Past this, lining lines up costs more than it tells anyone. */
const MAX_ALIGNED_LINES = 600;

function split(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/**
 * The longest common subsequence of two line lists, as a table walked
 * backwards. Only ever called on the middle, after the shared ends are gone.
 */
function alignMiddle(before: string[], after: string[]): DiffLine[] {
  const rows = before.length;
  const columns = after.length;

  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0),
  );

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      lines.push({ kind: "context", text: before[i], before: i, after: j });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: "removed", text: before[i], before: i, after: null });
      i++;
    } else {
      lines.push({ kind: "added", text: after[j], before: null, after: j });
      j++;
    }
  }

  while (i < rows) {
    lines.push({ kind: "removed", text: before[i], before: i, after: null });
    i++;
  }

  while (j < columns) {
    lines.push({ kind: "added", text: after[j], before: null, after: j });
    j++;
  }

  return lines;
}

/** Groups the changed lines with a little of what is around them. */
function toHunks(lines: DiffLine[]): DiffHunk[] {
  const keep = new Set<number>();

  lines.forEach((line, index) => {
    if (line.kind === "context") return;

    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(lines.length - 1, index + CONTEXT_LINES);
    for (let i = from; i <= to; i++) keep.add(i);
  });

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  let gap = 0;
  let pending = 0;

  lines.forEach((line, index) => {
    if (keep.has(index)) {
      if (current.length === 0) pending = gap;
      current.push(line);
      gap = 0;
      return;
    }

    gap++;

    if (current.length > 0) {
      hunks.push({ lines: current, skipped: pending });
      current = [];
    }
  });

  if (current.length > 0) hunks.push({ lines: current, skipped: pending });

  return hunks;
}

export function diffLines(beforeText: string, afterText: string): FileDiff {
  const before = split(beforeText);
  const after = split(afterText);

  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }

  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }

  const beforeMiddle = before.slice(start, before.length - end);
  const afterMiddle = after.slice(start, after.length - end);

  if (beforeMiddle.length === 0 && afterMiddle.length === 0) {
    return { hunks: [], added: 0, removed: 0 };
  }

  if (
    beforeMiddle.length > MAX_ALIGNED_LINES ||
    afterMiddle.length > MAX_ALIGNED_LINES
  ) {
    return {
      hunks: [],
      added: afterMiddle.length,
      removed: beforeMiddle.length,
      summary: `${beforeMiddle.length} lines replaced with ${afterMiddle.length}`,
    };
  }

  const middle = alignMiddle(beforeMiddle, afterMiddle);

  const lines: DiffLine[] = [
    ...before.slice(0, start).map((text, index) => ({
      kind: "context" as const,
      text,
      before: index,
      after: index,
    })),
    ...middle.map((line) => ({
      ...line,
      before: line.before === null ? null : line.before + start,
      after: line.after === null ? null : line.after + start,
    })),
    ...before.slice(before.length - end).map((text, index) => ({
      kind: "context" as const,
      text,
      before: before.length - end + index,
      after: after.length - end + index,
    })),
  ];

  return {
    hunks: toHunks(lines),
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}

/** "+4 -1", the way a change reads at a glance. */
export function describeDiff(diff: FileDiff): string {
  if (diff.summary) return diff.summary;
  if (diff.added === 0 && diff.removed === 0) return "";

  const parts: string[] = [];
  if (diff.added > 0) parts.push(`+${diff.added}`);
  if (diff.removed > 0) parts.push(`-${diff.removed}`);

  return parts.join(" ");
}
