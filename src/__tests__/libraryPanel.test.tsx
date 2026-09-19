// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LibraryPanel from "../settings/LibraryPanel";
import type { ModelManager, PullState } from "../settings/useModelManager";
import { translations } from "../translations";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";

const t = (key: string) => translations.en[key] || key;

function managerPulling(pull: PullState | null): ModelManager {
  return {
    installed: [],
    loaded: [],
    refresh: vi.fn(),
    pulls: pull ? [pull] : [],
    startPull: vi.fn(async () => true),
    cancelPull: vi.fn(),
    remove: vi.fn(async () => undefined),
    unload: vi.fn(async () => undefined),
    error: "",
    vram: 0,
    unifiedMemory: false,
  };
}

function download(name: string): PullState {
  return { name, percent: 40, phase: "downloading", remainingSeconds: 90 };
}

beforeEach(() => {
  installFakeElectronApi();
});

afterEach(() => {
  cleanup();
  clearFakeElectronApi();
});

describe("LibraryPanel while a download is running", () => {
  it("ignores a chat model pulled from the Models tab and keeps Add folder", () => {
    const name = "ornith-ai/Ornith-1.5-35B-A3B-GGUF:Q4_K_M";
    render(<LibraryPanel workspaceId="chat" manager={managerPulling(download(name))} embedModel="" t={t} />);

    expect(screen.queryByText(name)).toBeNull();
    expect(screen.getByRole("button", { name: "Add folder" })).toBeTruthy();
  });

  it("shows the progress of an embedding model and hides Add folder", () => {
    render(
      <LibraryPanel workspaceId="chat" manager={managerPulling(download("nomic-embed-text"))} embedModel="" t={t} />,
    );

    expect(screen.getByText("nomic-embed-text")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add folder" })).toBeNull();
  });
});

describe("LibraryPanel adding a folder before any embedding model is installed", () => {
  it("downloads the size-matched model by its repository, then indexes with the file that landed", async () => {
    const index = vi.fn(async () => ({ success: true }));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      library: {
        list: async () => ({ success: true, sources: [] }),
        onProgress: () => () => {},
        pickFolder: async () => ({ success: true, path: "/docs" }),
        index,
      },
      gguf: { listModels: async () => [{ filename: "Qwen3-Embedding-0.6B-Q8_0.gguf" }] },
    };
    const manager = { ...managerPulling(null), vram: 7 };

    render(<LibraryPanel workspaceId="chat" manager={manager} embedModel="" t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));

    await waitFor(() => expect(index).toHaveBeenCalled());
    expect(manager.startPull).toHaveBeenCalledWith("Qwen/Qwen3-Embedding-0.6B-GGUF:Q8_0", { immediate: true });
    expect(index).toHaveBeenCalledWith("/docs", "Qwen3-Embedding-0.6B-Q8_0.gguf", "chat");
  });
});
