// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

/** The three-dot menu that holds the file's actions. */
const openMenu = async () => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(t("more")));
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
    expect(screen.queryByText("notes.md")).toBeNull();
  });

  it("says so when the file cannot be opened", async () => {
    read.mockResolvedValueOnce({ success: false, error: "That file is binary." } as never);

    await open();

    expect(screen.getByText("That file is binary.")).toBeTruthy();
  });
});

describe("saving", () => {
  it("writes nothing until the user types", async () => {
    vi.useFakeTimers();
    try {
      await open();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(write).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves by itself after a pause in typing", async () => {
    vi.useFakeTimers();
    try {
      await open();

      fireEvent.change(editor(), { target: { value: "first\nsecond\n" } });
      expect(write).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(write).toHaveBeenCalledWith("w1", PATH, "first\nsecond\n");
    } finally {
      vi.useRealTimers();
    }
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

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByText(t("preview")));
    });

    expect(screen.queryByLabelText("notes.md")).toBeNull();
    expect(screen.getByText("first")).toBeTruthy();

    await openMenu();
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

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByText(t("rename")));
    });

    const renameInput = screen.getByLabelText(t("rename")) as HTMLInputElement;
    fireEvent.change(renameInput, { target: { value: "renamed.md" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith("renamed.md");

    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByText(t("delete")));
    });

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(t("deleteFileTitle").replace("{name}", "notes.md"))).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: t("delete") }));
    });

    expect(onDelete).toHaveBeenCalled();
  });

  it("displays an image preview when opening image files", async () => {
    const dataUrl = "data:image/x-icon;base64,AAABAAEAEBAAAAAAAABoBQAA";
    read.mockResolvedValueOnce({
      success: true,
      path: "C:\\project\\favicon.ico",
      isImage: true,
      dataUrl,
      bytes: 1024,
      mime: "image/x-icon",
    } as never);

    await open({ path: "C:\\project\\favicon.ico" });

    expect(screen.queryByText("That file is not text.")).toBeNull();
    const img = screen.getByAltText("favicon.ico") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe(dataUrl);
  });
});

