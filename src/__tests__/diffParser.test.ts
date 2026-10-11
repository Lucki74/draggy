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
