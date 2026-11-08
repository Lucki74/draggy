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
  created?: boolean;
  deleted?: boolean;
  binary?: boolean;
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

/** Strips git's standard path prefixes (a/ and b/) and quotes while preserving bare paths. */
function cleanGitPath(pathStr: string): string {
  let trimmed = pathStr.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) trimmed = trimmed.slice(1, -1);
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) return trimmed.slice(2);
  return trimmed;
}

/** The two paths of a `diff --git` line. Paths may hold spaces, so the line is split in the middle
 * where both halves match, which holds for every diff except a rename (fixed up by rename lines). */
function parseGitHeader(line: string): { oldPath: string; newPath: string } {
  const rest = line.slice("diff --git ".length);
  const quoted = /^"((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/.exec(rest);
  if (quoted) return { oldPath: cleanGitPath(quoted[1]), newPath: cleanGitPath(quoted[2]) };

  const middle = rest.length - 1;
  if (middle % 2 === 0 && rest[middle / 2] === " ") {
    const left = rest.slice(0, middle / 2);
    const right = rest.slice(middle / 2 + 1);
    if (left.startsWith("a/") && right.startsWith("b/")) {
      return { oldPath: cleanGitPath(left), newPath: cleanGitPath(right) };
    }
  }

  const at = rest.indexOf(" b/");
  if (at > 0) return { oldPath: cleanGitPath(rest.slice(0, at)), newPath: cleanGitPath(rest.slice(at + 1)) };
  const parts = rest.split(" ");
  return { oldPath: cleanGitPath(parts[0] ?? ""), newPath: cleanGitPath(parts[1] ?? parts[0] ?? "") };
}

const emptyFile = (oldPath = "", newPath = oldPath): ParsedFileDiff => ({
  oldPath,
  newPath,
  hunks: [],
  added: 0,
  removed: 0,
});

/** Parses raw unified diff output into structured per-file hunks and lines. A hunk ends when the
 * counts in its header are used up, so a changed line that happens to read like a file header
 * ("-- note", "++ n") is counted as a change and not mistaken for one. */
export function parseDiff(rawDiff: string): ParsedFileDiff[] {
  if (!rawDiff || !rawDiff.trim()) return [];

  const files: ParsedFileDiff[] = [];
  const lines = rawDiff.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  let currentFile: ParsedFileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let beforeLine = 0;
  let afterLine = 0;
  let oldLeft = 0;
  let newLeft = 0;

  const closeHunk = () => {
    if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
    currentHunk = null;
  };
  const closeFile = () => {
    closeHunk();
    if (currentFile) files.push(currentFile);
    currentFile = null;
  };
  const named = (value: string) => (value === "/dev/null" ? "" : cleanGitPath(value));

  for (const line of lines) {
    const inHunk = currentHunk !== null && (oldLeft > 0 || newLeft > 0);

    if (inHunk && currentHunk && currentFile) {
      if (line.startsWith("\\")) continue;
      if (line.startsWith("+")) {
        currentHunk.lines.push({ kind: "added", text: line.slice(1), beforeLine: null, afterLine });
        afterLine++;
        newLeft--;
        currentFile.added++;
        continue;
      }
      if (line.startsWith("-")) {
        currentHunk.lines.push({ kind: "removed", text: line.slice(1), beforeLine, afterLine: null });
        beforeLine++;
        oldLeft--;
        currentFile.removed++;
        continue;
      }
      if (line.startsWith(" ") || line === "") {
        currentHunk.lines.push({ kind: "context", text: line.slice(1), beforeLine, afterLine });
        beforeLine++;
        afterLine++;
        oldLeft--;
        newLeft--;
        continue;
      }
    }

    if (line.startsWith("diff --git ")) {
      closeFile();
      const { oldPath, newPath } = parseGitHeader(line);
      currentFile = emptyFile(oldPath, newPath);
      continue;
    }

    if (line.startsWith("@@ ")) {
      closeHunk();
      const info = parseHunkHeader(line);
      if (!info) continue;
      if (!currentFile) currentFile = emptyFile();
      beforeLine = info.oldStart;
      afterLine = info.newStart;
      oldLeft = info.oldCount;
      newLeft = info.newCount;
      currentHunk = { header: line, lines: [], ...info };
      continue;
    }

    // A file with no `diff --git` line, as `git diff --no-index` and plain `diff -u` print it.
    if (line.startsWith("--- ") && (!currentFile || currentFile.hunks.length > 0)) {
      closeFile();
      currentFile = emptyFile();
    }

    if (!currentFile) continue;

    if (line.startsWith("--- ")) {
      const old = named(line.slice(4).replace(/\t.*$/, ""));
      if (!old) currentFile.created = true;
      else if (!currentFile.oldPath) currentFile.oldPath = old;
    } else if (line.startsWith("+++ ")) {
      const next = named(line.slice(4).replace(/\t.*$/, ""));
      if (!next) currentFile.deleted = true;
      else currentFile.newPath = next;
      if (!currentFile.oldPath) currentFile.oldPath = currentFile.newPath;
    } else if (line.startsWith("new file mode")) currentFile.created = true;
    else if (line.startsWith("deleted file mode")) currentFile.deleted = true;
    else if (line.startsWith("rename from ")) currentFile.oldPath = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) currentFile.newPath = line.slice("rename to ".length);
    else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) currentFile.binary = true;
  }

  closeFile();
  return files;
}

export type ClassifiedKind = "add" | "remove" | "hunk" | "meta" | "context";

/** Every line of a diff, sorted into what it is, by the same count-based reading as `parseDiff`. */
export function classifyDiffLines(rawDiff: string): Array<{ kind: ClassifiedKind; text: string }> {
  const lines = String(rawDiff || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  const result: Array<{ kind: ClassifiedKind; text: string }> = [];
  let oldLeft = 0;
  let newLeft = 0;

  for (const text of lines) {
    if (oldLeft > 0 || newLeft > 0) {
      if (text.startsWith("\\")) {
        result.push({ kind: "meta", text });
        continue;
      }
      if (text.startsWith("+")) {
        newLeft--;
        result.push({ kind: "add", text });
        continue;
      }
      if (text.startsWith("-")) {
        oldLeft--;
        result.push({ kind: "remove", text });
        continue;
      }
      if (text.startsWith(" ") || text === "") {
        oldLeft--;
        newLeft--;
        result.push({ kind: "context", text });
        continue;
      }
    }

    const info = text.startsWith("@@") ? parseHunkHeader(text) : null;
    if (info) {
      oldLeft = info.oldCount;
      newLeft = info.newCount;
      result.push({ kind: "hunk", text });
    } else if (text.startsWith("@@")) {
      result.push({ kind: "hunk", text });
    } else if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename (from|to)|copy (from|to)|Binary files|GIT binary patch)/.test(text)) {
      result.push({ kind: "meta", text });
    } else if (text.startsWith("+")) {
      result.push({ kind: "add", text });
    } else if (text.startsWith("-")) {
      result.push({ kind: "remove", text });
    } else {
      result.push({ kind: "context", text });
    }
  }

  return result;
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
