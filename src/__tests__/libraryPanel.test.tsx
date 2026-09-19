// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
