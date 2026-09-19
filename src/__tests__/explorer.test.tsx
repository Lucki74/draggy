// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Explorer from "../files/Explorer";
import { createProject, fallbackWorkspace } from "../workspaces";
import type { AppSettings, Workspace } from "../types";

/** Tests the Files explorer tab: CreatedFiles fallback, project tree, and Canvas editor integration. */

const settings = { language: "en" } as unknown as AppSettings;

const workspace: Workspace = createProject("project", "C:\\project");


let readMock = vi.fn();
let listMock = vi.fn();

beforeEach(() => {
  readMock = vi.fn(async (_workspaceId: string, path: string) => {
    if (path.endsWith("LICENSE")) return { success: true, path, text: "MIT License\n" };
    if (path.endsWith(".md")) return { success: true, path, text: "# Hello\n" };
    return { success: true, path, text: "const x = 1;\n" };
  });

  listMock = vi.fn(async () => ({
    success: true,
    entries: [
      { name: "README.md", path: "C:\\project\\README.md", isDirectory: false, size: 10, modified: 0 },
      { name: "LICENSE", path: "C:\\project\\LICENSE", isDirectory: false, size: 20, modified: 0 },
      { name: "main.ts", path: "C:\\project\\main.ts", isDirectory: false, size: 30, modified: 0 },
    ],
  }));

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    files: {
      read: readMock,
      list: listMock,
      write: vi.fn(async () => ({ success: true })),
      move: vi.fn(async () => ({ success: true })),
      remove: vi.fn(async () => ({ success: true })),
      onChanged: () => () => undefined,
    },
    listCreatedFiles: vi.fn(async () => ({ success: true, files: [] })),
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("Explorer component", () => {
  it("renders CreatedFiles when workspace has no rootPath", async () => {
    const noRootWorkspace = fallbackWorkspace();
    await act(async () => {
      render(<Explorer settings={settings} workspace={noRootWorkspace} />);
    });

    expect(screen.getByText("Created files")).toBeTruthy();
  });

  it("shows chooseFile prompt when no file is initially selected", async () => {
    await act(async () => {
      render(<Explorer settings={settings} workspace={workspace} />);
    });

    expect(screen.getByText("Choose a file to see it")).toBeTruthy();

  });

  it("renders Canvas editor when a file is selected with editing capabilities", async () => {
    await act(async () => {
      render(<Explorer settings={settings} workspace={workspace} initialPath="C:\\project\\main.ts" />);
    });

    const editor = screen.getByLabelText("main.ts") as HTMLTextAreaElement;
    expect(editor.value).toBe("const x = 1;\n");
    expect(screen.getByLabelText("Save")).toBeTruthy();
  });

  it("provides preview toggle for markdown files in files tab", async () => {
    await act(async () => {
      render(<Explorer settings={settings} workspace={workspace} initialPath="C:\\project\\README.md" />);
    });

    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Preview"));
    });

    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("renders extensionless files like LICENSE as editable plain text without preview toggle", async () => {
    await act(async () => {
      render(<Explorer settings={settings} workspace={workspace} initialPath="C:\\project\\LICENSE" />);
    });

    expect(screen.queryByText("Preview")).toBeNull();
    const editor = screen.getByLabelText("LICENSE") as HTMLTextAreaElement;
    expect(editor.value).toBe("MIT License\n");
    expect(editor.className).not.toContain("code-editor-textarea");
  });

  it("reloads file list in real time when onChanged fires", async () => {
    let changeCb: ((change: { workspaceId?: string }) => void) | null = null;
    (window as unknown as { electronAPI: { files: { onChanged: unknown } } }).electronAPI.files.onChanged = (
      cb: (change: { workspaceId?: string }) => void,
    ) => {
      changeCb = cb;
      return () => {
        changeCb = null;
      };
    };

    await act(async () => {
      render(<Explorer settings={settings} workspace={workspace} />);
    });

    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      changeCb?.({ workspaceId: workspace.id });
    });

    expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
