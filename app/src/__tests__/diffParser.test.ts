import { describe, expect, it } from "vitest";
import {
  hunkToSplitRows,
  parseDiff,
  parseDiffStats,
} from "../diff/diffParser";

const SAMPLE_DIFF = `diff --git a/src/hello.ts b/src/hello.ts
index 123..456 100644
--- a/src/hello.ts
+++ b/src/hello.ts
@@ -1,5 +1,6 @@
 import React from "react";
-const greeting = "hi";
+const greeting = "hello";
+const extra = "world";
 export default greeting;
@@ -10,3 +11,2 @@
 function test() {
-  return false;
 }
`;

describe("diffParser", () => {
  it("returns empty array for empty diff string", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("   ")).toEqual([]);
  });

  it("parses hunks and lines with correct line numbers", () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.oldPath).toBe("src/hello.ts");
    expect(file.newPath).toBe("src/hello.ts");
    expect(file.added).toBe(2);
    expect(file.removed).toBe(2);
    expect(file.hunks).toHaveLength(2);

    const hunk1 = file.hunks[0];
    expect(hunk1.lines).toHaveLength(5);
    expect(hunk1.lines[0]).toEqual({
      kind: "context",
      text: 'import React from "react";',
      beforeLine: 1,
      afterLine: 1,
    });
    expect(hunk1.lines[1]).toEqual({
      kind: "removed",
      text: 'const greeting = "hi";',
      beforeLine: 2,
      afterLine: null,
    });
    expect(hunk1.lines[2]).toEqual({
      kind: "added",
      text: 'const greeting = "hello";',
      beforeLine: null,
      afterLine: 2,
    });
    expect(hunk1.lines[3]).toEqual({
      kind: "added",
      text: 'const extra = "world";',
      beforeLine: null,
      afterLine: 3,
    });
    expect(hunk1.lines[4]).toEqual({
      kind: "context",
      text: "export default greeting;",
      beforeLine: 3,
      afterLine: 4,
    });
  });

  it("aligns split rows with paired and padded sides", () => {
    const files = parseDiff(SAMPLE_DIFF);
    const hunk1 = files[0].hunks[0];
    const rows = hunkToSplitRows(hunk1);

    // Row 0: context
    expect(rows[0].before?.text).toBe('import React from "react";');
    expect(rows[0].after?.text).toBe('import React from "react";');

    // Row 1: removed vs added
    expect(rows[1].before?.text).toBe('const greeting = "hi";');
    expect(rows[1].after?.text).toBe('const greeting = "hello";');

    // Row 2: padded on left (before is null), added on right
    expect(rows[2].before).toBeNull();
    expect(rows[2].after?.text).toBe('const extra = "world";');

    // Row 3: context
    expect(rows[3].before?.text).toBe("export default greeting;");
    expect(rows[3].after?.text).toBe("export default greeting;");
  });

  it("extracts diff stats mapped by file path", () => {
    const stats = parseDiffStats(SAMPLE_DIFF);
    expect(stats["src/hello.ts"]).toEqual({ added: 2, removed: 2 });
  });
});


describe("parseDiff edge cases", () => {
  it("counts a removed line whose text starts with two dashes", () => {
    const raw = ["diff --git a/q.sql b/q.sql", "--- a/q.sql", "+++ b/q.sql", "@@ -1,2 +1,1 @@", "--- old comment", " keep", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.removed).toBe(1);
    expect(file.hunks[0].lines[0]).toMatchObject({ kind: "removed", text: "-- old comment" });
  });

  it("counts an added line whose text starts with two pluses", () => {
    const raw = ["diff --git a/n.txt b/n.txt", "--- a/n.txt", "+++ b/n.txt", "@@ -1,1 +1,2 @@", " keep", "+++ counter", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.added).toBe(1);
    expect(file.newPath).toBe("n.txt");
  });

  it("keeps the real path for a deleted file", () => {
    const raw = ["diff --git a/gone.ts b/gone.ts", "deleted file mode 100644", "--- a/gone.ts", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-bye", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.newPath).toBe("gone.ts");
    expect(file.deleted).toBe(true);
  });

  it("flags a new file and keeps its path", () => {
    const raw = ["diff --git a/new.ts b/new.ts", "new file mode 100644", "--- /dev/null", "+++ b/new.ts", "@@ -0,0 +1,1 @@", "+hi", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.oldPath).toBe("new.ts");
    expect(file.created).toBe(true);
  });

  it("reads paths that contain spaces", () => {
    const raw = ["diff --git a/my dir/a b.ts b/my dir/a b.ts", "--- a/my dir/a b.ts", "+++ b/my dir/a b.ts", "@@ -1,1 +1,1 @@", "-x", "+y", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.newPath).toBe("my dir/a b.ts");
  });

  it("does not add a phantom context line for the trailing newline", () => {
    const raw = ["diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -1,1 +1,1 @@", "-x", "+y", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.hunks[0].lines).toHaveLength(2);
  });

  it("reads renames and binary files without hunks", () => {
    const raw = ["diff --git a/old.png b/new.png", "similarity index 100%", "rename from old.png", "rename to new.png", "Binary files a/old.png and b/new.png differ", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.oldPath).toBe("old.png");
    expect(file.newPath).toBe("new.png");
    expect(file.binary).toBe(true);
  });

  it("ignores the no-newline marker", () => {
    const raw = ["diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -1,1 +1,1 @@", "-x", "\\ No newline at end of file", "+y", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.hunks[0].lines.map((l) => l.kind)).toEqual(["removed", "added"]);
  });

  it("reads a diff with no diff --git line, as --no-index leaves", () => {
    const raw = ["--- /dev/null", "+++ b/x.ts", "@@ -0,0 +1,1 @@", "+a", ""].join("\n");
    const [file] = parseDiff(raw);
    expect(file.newPath).toBe("x.ts");
    expect(file.added).toBe(1);
  });
});

describe("classifyDiff and diffStats share the parser's reading", () => {
  const raw = ["diff --git a/q.sql b/q.sql", "--- a/q.sql", "+++ b/q.sql", "@@ -1,2 +1,1 @@", "--- old comment", " keep", ""].join("\n");

  it("calls a changed line that reads like a header a removal", async () => {
    const { classifyDiff, diffStats } = await import("../project/gitView");
    expect(classifyDiff(raw).map((l) => l.kind)).toEqual(["meta", "meta", "meta", "hunk", "remove", "context"]);
    expect(diffStats(raw)).toEqual({ added: 0, removed: 1 });
  });
});
