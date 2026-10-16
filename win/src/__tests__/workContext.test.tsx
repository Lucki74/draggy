// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MessageItem from "../chat/MessageItem";
import { OpenFileContext } from "../chat/openFileContext";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";
import { defaultSettings } from "../app/settings";
import type { Message } from "../types";

/** In a project, the composer says where the turn works, and files a reply touched open in Draggy. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the project under the composer", () => {
  it("names the folder and branch, and both bring the files into view", () => {
    const onShow = vi.fn();
    render(<ComposerPreview workContext={{ folder: "draggy", branch: "ui-overhaul", onShow }} />);

    fireEvent.click(screen.getByRole("button", { name: "draggy" }));
    fireEvent.click(screen.getByRole("button", { name: "ui-overhaul" }));

    expect(onShow).toHaveBeenCalledTimes(2);
  });

  it("leaves the branch out of a folder that is not a repository", () => {
    render(<ComposerPreview workContext={{ folder: "notes", branch: null, onShow: vi.fn() }} />);

    expect(screen.getByRole("button", { name: "notes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ui-overhaul" })).toBeNull();
  });
});

const edited: Message = {
  id: "a1",
  role: "assistant",
  content: "Fixed.",
  steps: [
    {
      id: "e1",
      type: "edit_file",
      content: "Edited **Viewer.tsx**",
      isComplete: true,
      filename: "Viewer.tsx",
      filepath: "C:/project/src/Viewer.tsx",
    },
  ],
};

const reply = () => (
  <MessageItem
    msg={edited}
    idx={1}
    isGenerating={false}
    isLast
    onRegenerate={() => {}}
    onSwitchVersion={() => {}}
    copiedIndex={null}
    copyToClipboard={() => {}}
    settings={{ ...defaultSettings, showMetrics: false }}
    onEditMessage={() => {}}
  />
);

describe("a file the reply touched", () => {
  it("opens in the canvas inside a project", () => {
    const openInCanvas = vi.fn();
    const openFile = vi.fn();
    vi.stubGlobal("electronAPI", { openFile });
    render(<OpenFileContext.Provider value={openInCanvas}>{reply()}</OpenFileContext.Provider>);

    fireEvent.click(screen.getByRole("button", { name: "Viewer.tsx" }));

    expect(openInCanvas).toHaveBeenCalledWith("C:/project/src/Viewer.tsx");
    expect(openFile).not.toHaveBeenCalled();
  });

  it("opens in its own app outside one", () => {
    const openFile = vi.fn();
    vi.stubGlobal("electronAPI", { openFile });
    render(reply());

    fireEvent.click(screen.getByRole("button", { name: "Viewer.tsx" }));

    expect(openFile).toHaveBeenCalledWith("C:/project/src/Viewer.tsx");
  });
});
