// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Canvas from "../canvas/Canvas";
import { translations } from "../translations";

/** The canvas as the user meets it: a file beside the chat that saves through the guarded write,
 * and that notices when the model changes it. */

const t = (key: string) => translations.en[key] || key;

const PATH = "C:\\project\\notes.md";

type Change = { workspaceId: string; path: string; from?: string };

let onDisk = "first\n";
let listeners: ((change: Change) => void)[] = [];

const read = vi.fn(async () => ({ success: true, path: PATH, text: onDisk }));
const write = vi.fn(async (_workspace: string, _path: string, contents: string) => {
  onDisk = contents;
  return { success: true, path: PATH, checkpointId: 1 };
});

beforeEach(() => {
  onDisk = "first\n";
  listeners = [];
  read.mockClear();
  write.mockClear();

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    files: {
      read,
      write,
      onChanged: (callback: (change: Change) => void) => {
        listeners.push(callback);
        return () => {
          listeners = listeners.filter((one) => one !== callback);
        };
      },
    },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const open = async (props: Partial<Parameters<typeof Canvas>[0]> = {}) => {
  await act(async () => {
    render(
      <Canvas workspaceId="w1" path={PATH} t={t} onClose={() => undefined} {...props} />,
    );
  });
};

const editor = () => screen.getByLabelText("notes.md") as HTMLTextAreaElement;

/** The main process announcing that something wrote the file. */
const announce = async (change: Change) => {
  await act(async () => {
    for (const listener of listeners) listener(change);
  });
};

describe("opening a file", () => {
  it("shows what is on disk", async () => {
    await open();

    expect(editor().value).toBe("first\n");
    expect(screen.getByText("notes.md")).toBeTruthy();
  });

  it("says so when the file cannot be opened", async () => {
    read.mockResolvedValueOnce({ success: false, error: "That file is binary." } as never);

    await open();

    expect(screen.getByText("That file is binary.")).toBeTruthy();
  });
});

describe("saving", () => {
  it("has nothing to save until the user types", async () => {
    await open();

    expect((screen.getByLabelText(t("save")) as HTMLButtonElement).disabled).toBe(true);
  });

  it("writes through the guarded file bridge", async () => {
    await open();

    fireEvent.change(editor(), { target: { value: "first\nsecond\n" } });
    expect(screen.getByText(/Unsaved/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText(t("save")));
    });

    expect(write).toHaveBeenCalledWith("w1", PATH, "first\nsecond\n");
    expect(screen.queryByText(/Unsaved/)).toBeNull();
  });

  it("saves on Ctrl+S", async () => {
    await open();

    fireEvent.change(editor(), { target: { value: "changed\n" } });

    await act(async () => {
      fireEvent.keyDown(editor(), { key: "s", ctrlKey: true });
    });

    expect(write).toHaveBeenCalledWith("w1", PATH, "changed\n");
  });
});

describe("the model editing the open file", () => {
  it("shows the edit when the user has nothing unsaved", async () => {
    await open();

    onDisk = "first\nfrom the model\n";
    await announce({ workspaceId: "w1", path: "c:/project/NOTES.md" });

    expect(editor().value).toBe("first\nfrom the model\n");
  });

  it("asks rather than overwriting the user's changes", async () => {
    await open();

    fireEvent.change(editor(), { target: { value: "mine\n" } });

    onDisk = "theirs\n";
    await announce({ workspaceId: "w1", path: PATH });

    expect(editor().value).toBe("mine\n");
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByText(t("canvasTakeTheirs")));

    expect(editor().value).toBe("theirs\n");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores changes to other files", async () => {
    await open();
    read.mockClear();

    await announce({ workspaceId: "w1", path: "C:\\project\\other.md" });

    expect(read).not.toHaveBeenCalled();
  });

  it("follows the file when it is moved", async () => {
    const onMoved = vi.fn();
    await open({ onMoved });

    await announce({
      workspaceId: "w1",
      path: "C:\\project\\docs\\notes.md",
      from: PATH,
    });

    expect(onMoved).toHaveBeenCalledWith("C:\\project\\docs\\notes.md");
  });
});

describe("preview mode", () => {
  it("toggles between edit and markdown preview", async () => {
    await open();

    expect(editor().value).toBe("first\n");

    await act(async () => {
      fireEvent.click(screen.getByText(t("preview")));
    });

    expect(screen.queryByLabelText("notes.md")).toBeNull();
    expect(screen.getByText("first")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText(t("edit")));
    });

    expect(editor().value).toBe("first\n");
  });

  it("does not show preview toggle for code files", async () => {
    read.mockResolvedValueOnce({ success: true, path: "C:\\project\\run.ps1", text: "Get-Process\n" } as never);

    await open({ path: "C:\\project\\run.ps1" });

    expect(screen.queryByText(t("preview"))).toBeNull();
    expect(screen.queryByText(t("edit"))).toBeNull();
    const psEditor = screen.getByLabelText("run.ps1") as HTMLTextAreaElement;
    expect(psEditor.value).toBe("Get-Process\n");
  });

  it("indents with two spaces on Tab key", async () => {
    await open();

    editor().selectionStart = 0;
    editor().selectionEnd = 0;
    fireEvent.keyDown(editor(), { key: "Tab" });

    expect(editor().value).toBe("  first\n");
  });

  it("windows rendering for large files to keep UI responsive", async () => {
    const largeText = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i};`).join("\n");
    read.mockResolvedValueOnce({ success: true, path: "C:\\project\\big.ts", text: largeText } as never);

    await open({ path: "C:\\project\\big.ts" });

    const bigEditor = screen.getByLabelText("big.ts") as HTMLTextAreaElement;
    expect(bigEditor.value).toBe(largeText);
  });

  it("renders extensionless files like LICENSE as plain text without preview toggle", async () => {
    read.mockResolvedValueOnce({ success: true, path: "C:\\project\\LICENSE", text: "MIT License\n" } as never);

    await open({ path: "C:\\project\\LICENSE" });

    expect(screen.queryByText(t("preview"))).toBeNull();
    expect(screen.queryByText(t("edit"))).toBeNull();
    const licenseEditor = screen.getByLabelText("LICENSE") as HTMLTextAreaElement;
    expect(licenseEditor.value).toBe("MIT License\n");
    expect(licenseEditor.className).not.toContain("code-editor-textarea");
  });

  it("handles renaming and deleting files via action buttons", async () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();

    await open({ onRename, onDelete });

    const renameBtn = screen.getByLabelText(t("rename"));
    fireEvent.click(renameBtn);

    const renameInput = screen.getByLabelText(t("rename")) as HTMLInputElement;
    fireEvent.change(renameInput, { target: { value: "renamed.md" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith("renamed.md");

    const deleteBtn = screen.getByLabelText(t("delete"));
    fireEvent.click(deleteBtn);

    const confirmBtn = screen.getByText(t("confirm"));
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(onDelete).toHaveBeenCalled();
  });
});

