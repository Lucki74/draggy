// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import DiffPane from "../diff/DiffPane";
import { translations } from "../translations";
import type { GitStatus } from "../types";

const t = (key: string) => translations.en[key] || key;

const MOCK_GIT_STATUS: GitStatus = {
  success: true,
  available: true,
  isRepo: true,
  branch: "main",
  detached: false,
  ahead: 2,
  behind: 1,
  files: [
    { path: "src/first.ts", kind: "modified", staged: false, unstaged: true },
    { path: "src/second.ts", kind: "added", staged: true, unstaged: false },
  ],
  counts: { modified: 1, added: 1, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
};

const MOCK_DIFF = `diff --git a/src/first.ts b/src/first.ts
--- a/src/first.ts
+++ b/src/first.ts
@@ -1,3 +1,4 @@
 export function first() {
-  return 1;
+  return 2;
+  return 3;
 }
`;

describe("DiffPane", () => {
  beforeEach(() => {
    const target = window as unknown as Record<string, unknown>;
    target.electronAPI = {
      git: {
        status: vi.fn().mockResolvedValue(MOCK_GIT_STATUS),
        diff: vi.fn().mockResolvedValue({ success: true, diff: MOCK_DIFF }),
      },
    };
  });

  afterEach(() => {
    cleanup();
    const target = window as unknown as Record<string, unknown>;
    delete target.electronAPI;
  });

  it("renders git header with branch, distance, and changed file count", async () => {
    await act(async () => {
      render(
        <DiffPane
          workspaceId="w1"
          rootPath="/app"
          gitStatus={MOCK_GIT_STATUS}
          t={t}
          width={600}
        />,
      );
    });

    expect(screen.getByTitle("main")).toBeTruthy();
    expect(screen.getByTitle("Commits not yet pushed")).toBeTruthy();
    expect(screen.getByTitle("Commits not yet pulled")).toBeTruthy();
    expect(screen.getByText("2 changed")).toBeTruthy();
  });

  it("renders changed file list with per-file diff stats", async () => {
    await act(async () => {
      render(
        <DiffPane
          workspaceId="w1"
          rootPath="/app"
          gitStatus={MOCK_GIT_STATUS}
          t={t}
          width={600}
        />,
      );
    });

    expect(screen.getByText("src/first.ts")).toBeTruthy();
    expect(screen.getByText("src/second.ts")).toBeTruthy();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("toggles between unified and split views when width is 900 or greater", async () => {
    await act(async () => {
      render(
        <DiffPane
          workspaceId="w1"
          rootPath="/app"
          gitStatus={MOCK_GIT_STATUS}
          t={t}
          width={960}
        />,
      );
    });

    const splitBtn = screen.getByRole("button", { name: "Split" });
    expect(splitBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(splitBtn);
    });

    // In split view, "Unified" button is also present to switch back
    const unifiedBtn = screen.getByRole("button", { name: "Unified" });
    expect(unifiedBtn).toBeTruthy();
  });

  it("allows adding inline comments and sending review prompt", async () => {
    const onSendReviewComment = vi.fn();

    await act(async () => {
      render(
        <DiffPane
          workspaceId="w1"
          rootPath="/app"
          gitStatus={MOCK_GIT_STATUS}
          t={t}
          width={600}
          onSendReviewComment={onSendReviewComment}
        />,
      );
    });

    // Click the add comment button on a line
    const commentButtons = screen.getAllByTestId("start-comment");
    expect(commentButtons.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(commentButtons[0]);
    });

    const textarea = screen.getByPlaceholderText("Leave a comment on this line...");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Please refactor this" } });
    });

    // Save the comment using the testid save button in the form
    const saveButton = screen.getByTestId("save-comment");
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(screen.getByText("Please refactor this")).toBeTruthy();
    expect(screen.getByText("1 Review comments")).toBeTruthy();

    // Send review button
    const sendButton = screen.getByRole("button", { name: /Send review/ });
    await act(async () => {
      fireEvent.click(sendButton);
    });

    expect(onSendReviewComment).toHaveBeenCalledTimes(1);
    expect(onSendReviewComment.mock.calls[0][0]).toContain("Please refactor this");
  });
});
