import type { GitChange, GitStatus } from "../types";

/** How git's output is shown: pure, so the strip and the timeline read a diff and a status the same
 * way, and so both can be tested without a repository. */

export type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Sorts each line of a unified diff into what it is. */
export function classifyDiff(diff: string): DiffLine[] {
  const lines = String(diff || "").replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  return lines.map((text) => {
    if (text.startsWith("@@")) return { kind: "hunk", text };
    if (
      text.startsWith("diff --git") ||
      text.startsWith("index ") ||
      text.startsWith("--- ") ||
      text.startsWith("+++ ") ||
      text.startsWith("new file mode") ||
      text.startsWith("deleted file mode") ||
      text.startsWith("similarity index") ||
      text.startsWith("rename from") ||
      text.startsWith("rename to") ||
      text.startsWith("Binary files")
    ) {
      return { kind: "meta", text };
    }
    if (text.startsWith("+")) return { kind: "add", text };
    if (text.startsWith("-")) return { kind: "remove", text };
    return { kind: "context", text };
  });
}

/** Lines added and removed, the way a pull request counts them. */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const line of classifyDiff(diff)) {
    if (line.kind === "add") added += 1;
    if (line.kind === "remove") removed += 1;
  }

  return { added, removed };
}

export const CHANGE_LETTER: Record<GitChange["kind"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "!",
};

export const CHANGE_COLOR: Record<GitChange["kind"], string> = {
  modified: "#d4a017",
  added: "#10b981",
  deleted: "#ef4444",
  renamed: "#3b82f6",
  untracked: "#10b981",
  conflicted: "#ef4444",
};

/** Whether there is anything for the strip to show at all. */
export function shouldShowStrip(status: GitStatus | null | undefined): status is GitStatus {
  return Boolean(status && status.success && status.available && status.isRepo);
}

/** The absolute path of a changed file, for opening it in the canvas. */
export function changePath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const cleanRoot = root.replace(/[\\/]+$/, "");
  return `${cleanRoot}${separator}${relative.split("/").join(separator)}`;
}
