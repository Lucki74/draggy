/** Pure calculations and parsing for unified and side-by-side git diff views. */

export type DiffLineKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface ParsedFileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

export interface SplitRow {
  before: DiffLine | null;
  after: DiffLine | null;
}

const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Parses a git hunk header into line counts and offsets. */
function parseHunkHeader(line: string) {
  const match = HUNK_HEADER_REGEX.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] !== undefined ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newCount: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

/** Strips git's standard path prefixes (a/ and b/) while preserving bare paths. */
function cleanGitPath(pathStr: string): string {
  const trimmed = pathStr.trim();
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

/** Parses raw unified diff output into structured per-file hunks and lines. */
export function parseDiff(rawDiff: string): ParsedFileDiff[] {
  if (!rawDiff || !rawDiff.trim()) return [];

  const files: ParsedFileDiff[] = [];
  const lines = rawDiff.replace(/\r\n/g, "\n").split("\n");

  let currentFile: ParsedFileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let beforeLine = 0;
  let afterLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("diff --git ")) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      if (currentFile) files.push(currentFile);
      currentHunk = null;

      const parts = line.split(" ");
      const oldPath = parts[2] ? cleanGitPath(parts[2]) : "";
      const newPath = parts[3] ? cleanGitPath(parts[3]) : oldPath;

      currentFile = {
        oldPath,
        newPath,
        hunks: [],
        added: 0,
        removed: 0,
      };
      continue;
    }

    if (line.startsWith("--- ")) {
      if (currentFile && !currentFile.oldPath) {
        currentFile.oldPath = cleanGitPath(line.slice(4));
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (currentFile) {
        currentFile.newPath = cleanGitPath(line.slice(4));
        if (!currentFile.oldPath) currentFile.oldPath = currentFile.newPath;
      }
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
      const headerInfo = parseHunkHeader(line);
      if (!headerInfo) continue;

      beforeLine = headerInfo.oldStart;
      afterLine = headerInfo.newStart;

      currentHunk = {
        header: line,
        lines: [],
        oldStart: headerInfo.oldStart,
        oldCount: headerInfo.oldCount,
        newStart: headerInfo.newStart,
        newCount: headerInfo.newCount,
      };

      if (!currentFile) {
        currentFile = {
          oldPath: "",
          newPath: "",
          hunks: [],
          added: 0,
          removed: 0,
        };
      }
      continue;
    }

    if (!currentHunk || !currentFile) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        kind: "added",
        text: line.slice(1),
        beforeLine: null,
        afterLine,
      });
      afterLine++;
      currentFile.added++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        kind: "removed",
        text: line.slice(1),
        beforeLine,
        afterLine: null,
      });
      beforeLine++;
      currentFile.removed++;
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push({
        kind: "context",
        text: line.startsWith(" ") ? line.slice(1) : line,
        beforeLine,
        afterLine,
      });
      beforeLine++;
      afterLine++;
    }
  }

  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  return files;
}

/** Aligns removed and added lines side by side within a hunk. */
export function hunkToSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.kind === "context") {
      rows.push({ before: line, after: line });
      i++;
      continue;
    }

    const removedGroup: DiffLine[] = [];
    const addedGroup: DiffLine[] = [];

    while (i < lines.length && (lines[i].kind === "removed" || lines[i].kind === "added")) {
      if (lines[i].kind === "removed") removedGroup.push(lines[i]);
      else addedGroup.push(lines[i]);
      i++;
    }

    const maxLen = Math.max(removedGroup.length, addedGroup.length);
    for (let j = 0; j < maxLen; j++) {
      rows.push({
        before: removedGroup[j] ?? null,
        after: addedGroup[j] ?? null,
      });
    }
  }

  return rows;
}

/** Calculates added and removed statistics mapped by file path. */
export function parseDiffStats(rawDiff: string): Record<string, { added: number; removed: number }> {
  const files = parseDiff(rawDiff);
  const result: Record<string, { added: number; removed: number }> = {};
  for (const file of files) {
    const key = file.newPath || file.oldPath;
    if (key) {
      result[key] = { added: file.added, removed: file.removed };
    }
  }
  return result;
}
