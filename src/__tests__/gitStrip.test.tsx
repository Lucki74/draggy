// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import GitStrip from "../project/GitStrip";
import { translations } from "../translations";
import type { GitStatus } from "../types";

/**
 * The strip at the foot of a project's file tree.
 */

const t = (key: string) => translations.en[key] || key;

const STATUS: GitStatus = {
  success: true,
  available: true,
  isRepo: true,
  branch: "feature/wheel",
  upstream: "origin/feature/wheel",
  ahead: 3,
  behind: 1,
  files: [
    { path: "src/app.ts", kind: "modified", staged: false, unstaged: true },
    { path: "old.ts", kind: "deleted", staged: false, unstaged: true },
    { path: "notes.md", kind: "untracked", staged: false, unstaged: true },
  ],
};

const diff = vi.fn(async () => ({ success: true, diff: "@@ -1 +1 @@\n-before\n+after\n" }));

beforeEach(() => {
  diff.mockClear();
  (window as unknown as { electronAPI: unknown }).electronAPI = { git: { diff } };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const show = (status: GitStatus = STATUS, onOpenFile = vi.fn()) => {
  render(
    <GitStrip status={status} workspaceId="w1" root={"C:\\projects\\thing"} t={t} onOpenFile={onOpenFile} />,
  );
  return onOpenFile;
};

describe("closed", () => {
  it("shows the branch, how far it is from upstream, and how much changed", () => {
    show();

    expect(screen.getByText("feature/wheel")).toBeTruthy();
    expect(screen.getByTitle(t("gitAhead")).textContent).toBe("3");
    expect(screen.getByTitle(t("gitBehind")).textContent).toBe("1");
    expect(screen.getByText("3 changed")).toBeTruthy();
    expect(screen.queryByText("src/app.ts")).toBeNull();
  });

  it("says a clean tree is clean", () => {
    show({ ...STATUS, files: [], ahead: 0, behind: 0 });

    expect(screen.getByText(t("gitClean"))).toBeTruthy();
    expect(screen.queryByTitle(t("gitAhead"))).toBeNull();
  });

  it("says when HEAD is not on a branch", () => {
    show({ ...STATUS, branch: null, detached: true });

    expect(screen.getByText(t("gitDetached"))).toBeTruthy();
  });

  it("offers nothing that would commit", () => {
    show();
    fireEvent.click(screen.getByText("feature/wheel"));

    expect(screen.queryByText(/commit/i)).toBeNull();
  });
});

describe("open", () => {
  it("lists the changed files", () => {
    show();
    fireEvent.click(screen.getByText("feature/wheel"));

    expect(screen.getByText("src/app.ts")).toBeTruthy();
    expect(screen.getByText("old.ts")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
  });

  it("opens a changed file by its full path", () => {
    const onOpenFile = show();
    fireEvent.click(screen.getByText("feature/wheel"));
    fireEvent.click(screen.getByText("src/app.ts"));

    expect(onOpenFile).toHaveBeenCalledWith("C:\\projects\\thing\\src\\app.ts");
  });

  it("cannot open a file that was deleted", () => {
    const onOpenFile = show();
    fireEvent.click(screen.getByText("feature/wheel"));
    fireEvent.click(screen.getByText("old.ts"));

    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("shows a file's diff on request", async () => {
    show();
    fireEvent.click(screen.getByText("feature/wheel"));

    await act(async () => {
      fireEvent.click(screen.getAllByText(t("gitShowDiff"))[0]);
    });

    expect(diff).toHaveBeenCalledWith("w1", "src/app.ts", false);
    expect(screen.getByText("+after")).toBeTruthy();
    expect(screen.getByText("-before")).toBeTruthy();
  });

  it("offers no diff for a file git is not tracking yet", () => {
    show();
    fireEvent.click(screen.getByText("feature/wheel"));

    // Modified and deleted have one; untracked does not.
    expect(screen.getAllByText(t("gitShowDiff"))).toHaveLength(2);
  });
});
