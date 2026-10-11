// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FilesPane from "../files/FilesPane";
import { appendMention } from "../chat/mentions";
import { translations } from "../translations";
import type { GitStatus } from "../types";

/** The dock's file tree: git letters on changed files, and the right-click menu on any path. */

const ROOT = "C:\\project";
const t = (key: string) => translations.en[key] || key;

let openMock = vi.fn();
let revealMock = vi.fn();

beforeEach(() => {
  openMock = vi.fn(async () => ({ success: true }));
  revealMock = vi.fn(async () => ({ success: true }));
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    files: {
      list: vi.fn(async () => ({
        success: true,
        entries: [
          { name: "main.ts", path: "C:\\project\\main.ts", isDirectory: false, size: 30, modified: 0 },
          { name: "notes.md", path: "C:\\project\\notes.md", isDirectory: false, size: 10, modified: 0 },
        ],
      })),
      open: openMock,
      reveal: revealMock,
      onChanged: () => () => undefined,
    },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const gitStatus = {
  success: true,
  files: [{ path: "main.ts", kind: "modified" }],
} as unknown as GitStatus;

describe("FilesPane", () => {
  it("marks a changed file with its git letter and opens a file on click", async () => {
    const onOpenFile = vi.fn();
    render(<FilesPane workspaceId="w1" rootPath={ROOT} gitStatus={gitStatus} t={t} onOpenFile={onOpenFile} />);

    const row = await screen.findByRole("button", { name: /main\.ts/ });
    expect(row.textContent).toContain("M");
    expect(row.textContent).toContain("Modified");
    expect(screen.getByRole("button", { name: /notes\.md/ }).textContent).not.toContain("M");

    fireEvent.click(row);
    expect(onOpenFile).toHaveBeenCalledWith("C:\\project\\main.ts");
  });

  it("offers Claude Code's path menu on right-click", async () => {
    const onAttachContext = vi.fn();
    render(<FilesPane workspaceId="w1" rootPath={ROOT} t={t} onAttachContext={onAttachContext} />);

    fireEvent.contextMenu(await screen.findByRole("button", { name: /notes\.md/ }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Attach as context",
      "Open in system editor",
      "Reveal in file manager",
      "Copy path",
      "Delete",
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: /Reveal/ }));
    expect(revealMock).toHaveBeenCalledWith("w1", "C:\\project\\notes.md");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByRole("button", { name: /notes\.md/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Attach/ }));
    expect(onAttachContext).toHaveBeenCalledWith("C:\\project\\notes.md");
  });
});

describe("appendMention", () => {
  it("adds the path as its own word, once", () => {
    expect(appendMention("", "src/a.ts")).toBe("@src/a.ts ");
    expect(appendMention("look at", "src/a.ts")).toBe("look at @src/a.ts ");
    expect(appendMention("look at @src/a.ts ", "src/a.ts")).toBe("look at @src/a.ts ");
  });
});
