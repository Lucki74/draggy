// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SplitDiffView } from "../diff/SplitDiffView";
import type { ParsedFileDiff } from "../diff/diffParser";
import { translations } from "../translations";

afterEach(cleanup);

const t = (key: string) => translations.en[key] || key;

const sampleDiff: ParsedFileDiff = {
  oldPath: "src/file.ts",
  newPath: "src/file.ts",
  added: 1,
  removed: 1,
  hunks: [
    {
      header: "@@ -1,2 +1,2 @@",
      oldStart: 1,
      oldCount: 2,
      newStart: 1,
      newCount: 2,
      lines: [
        { kind: "removed", text: "const veryLongLine = 'old_value_that_exceeds_viewport';", beforeLine: 1, afterLine: null },
        { kind: "added", text: "const veryLongLine = 'new_value_that_exceeds_viewport';", beforeLine: null, afterLine: 1 },
      ],
    },
  ],
};

describe("SplitDiffView", () => {
  it("enables horizontal scrolling instead of clipping code lines with text-ellipsis", () => {
    const { container } = render(
      <SplitDiffView
        fileDiff={sampleDiff}
        comments={[]}
        activeCommentLine={null}
        commentDraft=""
        onStartComment={vi.fn()}
        onCancelComment={vi.fn()}
        onChangeCommentDraft={vi.fn()}
        onSaveComment={vi.fn()}
        onDeleteComment={vi.fn()}
        t={t}
      />,
    );

    const codeSpans = container.querySelectorAll(".whitespace-pre");
    expect(codeSpans.length).toBeGreaterThan(0);

    for (const span of codeSpans) {
      expect(span.className).toContain("overflow-x-auto");
      expect(span.className).not.toContain("overflow-hidden");
      expect(span.className).not.toContain("text-ellipsis");
    }
  });
});
