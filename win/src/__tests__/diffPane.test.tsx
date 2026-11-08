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
diff --git a/src/second.ts b/src/second.ts
new file mode 100644
--- /dev/null
+++ b/src/second.ts
@@ -0,0 +1,1 @@
+export const second = 2;
`;

const COMMIT_DIFF = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
`;

const COMMITS = [
  { hash: "b".repeat(40), short: "bbbbbbb", author: "Ada", date: "today", subject: "Second commit", parents: ["a".repeat(40)], refs: [{ name: "main", kind: "head" }] },
  { hash: "a".repeat(40), short: "aaaaaaa", author: "Ada", date: "yesterday", subject: "First commit", parents: [], refs: [] },
];

let git: Record<string, ReturnType<typeof vi.fn>>;

async function renderPane(width = 600) {
  await act(async () => {
    render(<DiffPane workspaceId="w1" rootPath="/app" gitStatus={MOCK_GIT_STATUS} t={t} width={width} onOpenFile={vi.fn()} />);
  });
}

const fileRows = () => screen.getAllByTestId("review-file");

describe("DiffPane", () => {
  beforeEach(() => {
    git = {
      status: vi.fn().mockResolvedValue(MOCK_GIT_STATUS),
      diff: vi.fn().mockResolvedValue({ success: true, diff: MOCK_DIFF }),
      log: vi.fn().mockResolvedValue({ success: true, commits: COMMITS }),
      show: vi.fn().mockResolvedValue({ success: true, diff: COMMIT_DIFF }),
      branches: vi.fn().mockResolvedValue({ success: true, branches: [{ name: "main", current: true }, { name: "feature", current: false }] }),
      checkout: vi.fn().mockResolvedValue({ success: true }),
    };
    (window as unknown as Record<string, unknown>).electronAPI = { git };
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it("shows the branch, its distance and how many files changed", async () => {
    await renderPane();
    expect(screen.getByTitle("main").textContent).toContain("main");
    expect(screen.getByTitle(t("gitAhead")).textContent).toContain("2");
    expect(screen.getByTitle(t("gitBehind")).textContent).toContain("1");
    expect(screen.getByText(t("gitChangedFiles").replace("{count}", "2"))).toBeTruthy();
    expect(git.diff).toHaveBeenCalledWith("w1", ".", false, true, false);
  });

  it("lists each file with its counts and opens one at a time", async () => {
    await renderPane();
    const [first, second] = fileRows();
    expect(first.textContent).toContain("first.ts");
    expect(first.textContent).toContain("+2");
    expect(first.textContent).toContain("-1");
    expect(first.querySelector("[data-kind='added']")).toBeTruthy();
    expect(second.querySelector("[data-kind]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /second\.ts/ }));
    expect(fileRows()[1].querySelector("[data-kind='added']")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /first\.ts/ }));
    expect(fileRows()[0].querySelector("[data-kind]")).toBeNull();
  });

  it("splits a modified file but keeps a new file in one column", async () => {
    await renderPane(900);
    fireEvent.click(screen.getByRole("button", { name: t("more") }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: t("reviewSplit") }));
    fireEvent.click(screen.getByRole("button", { name: /second\.ts/ }));
    const [first, second] = fileRows();
    expect(first.querySelector("[data-kind]")).toBeNull();
    expect(first.textContent).toContain("return 1;");
    expect(second.querySelector("[data-kind='added']")).toBeTruthy();
  });

  it("offers split only when the pane is wide enough", async () => {
    await renderPane(500);
    fireEvent.click(screen.getByRole("button", { name: t("more") }));
    expect(screen.getByRole("menuitemcheckbox", { name: t("reviewSplit") }).getAttribute("aria-disabled")).toBe("true");
  });

  it("asks git to ignore whitespace and expands every file", async () => {
    await renderPane();
    fireEvent.click(screen.getByRole("button", { name: t("more") }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: t("reviewHideWhitespace") }));
    });
    expect(git.diff).toHaveBeenLastCalledWith("w1", ".", false, true, true);

    fireEvent.click(screen.getByRole("button", { name: t("more") }));
    fireEvent.click(screen.getByRole("menuitem", { name: t("reviewExpandAll") }));
    for (const row of fileRows()) expect(row.querySelector("[data-kind]")).toBeTruthy();
  });

  it("filters the files by path", async () => {
    await renderPane();
    fireEvent.click(screen.getByRole("button", { name: t("search") }));
    fireEvent.change(screen.getByLabelText(t("reviewFilter")), { target: { value: "second" } });
    expect(fileRows()).toHaveLength(1);
    expect(fileRows()[0].textContent).toContain("second.ts");
  });

  it("draws every branch and shows a commit's files until going back", async () => {
    await renderPane();
    expect(git.log).toHaveBeenCalledWith("w1", 200, true);
    const graph = screen.getByTestId("git-graph");
    expect(graph.querySelectorAll("circle")).toHaveLength(2);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Second commit/ }));
    });
    expect(git.show).toHaveBeenCalledWith("w1", "b".repeat(40), false);
    expect(fileRows()).toHaveLength(1);
    expect(fileRows()[0].textContent).toContain("README.md");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t("reviewBack") }));
    });
    expect(fileRows()).toHaveLength(2);
  });

  it("checks out a branch from the header menu", async () => {
    await renderPane();
    await act(async () => {
      fireEvent.click(screen.getByTitle("main"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "feature" }));
    });
    expect(git.checkout).toHaveBeenCalledWith("w1", "feature");
    expect(git.status).toHaveBeenCalled();
  });
});
