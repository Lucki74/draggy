// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ModelsPage from "../settings/ModelsPage";
import type { ModelManager } from "../settings/useModelManager";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";

const t = (key: string) => translations.en[key] || key;
const SPLIT = "Qwen3-Coder-Next-Q4_K_M-00001-of-00004.gguf";

beforeEach(() => installFakeElectronApi());
afterEach(() => {
  cleanup();
  clearFakeElectronApi();
});

describe("a split model in the installed list", () => {
  it("shows its clean name without part counter, .gguf, or quantisation but acts on the real file", () => {
    const remove = vi.fn(async () => undefined);
    const manager: ModelManager = {
      installed: [{ name: SPLIT, size: 15_000_000_000, parameterSize: "48L", family: "qwen3", capabilities: ["tools"], contextLength: 131072 }],
      loaded: [],
      refresh: vi.fn(),
      pulls: [],
      startPull: vi.fn(async () => true),
      cancelPull: vi.fn(),
      remove,
      unload: vi.fn(async () => undefined),
      error: "",
      vram: 0,
      unifiedMemory: false,
    };

    render(
      <ModelsPage manager={manager} settings={defaultSettings} chatModel="" onUpdate={vi.fn()} onSelectChatModel={vi.fn()} t={t} />,
    );

    expect(screen.getByText("Qwen3-Coder-Next")).toBeTruthy();
    expect(screen.getByText(/Q4_K_M/)).toBeTruthy();
    expect(screen.queryByText(/00001-of-00004/)).toBeNull();

    // Opening details shows the context ceiling and file name.
    fireEvent.click(screen.getByLabelText(/Show details for.*Qwen3-Coder-Next/));
    expect(screen.getByText("128k")).toBeTruthy();
    expect(screen.getByText(SPLIT)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Qwen3-Coder-Next/, { selector: "button[aria-label^='Remove']" }));
    expect(remove).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Remove.*Qwen3-Coder-Next.*\?/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledWith(SPLIT);
  });

  it("numbers duplicate installed models with identical base name and parameter count", () => {
    const manager: ModelManager = {
      installed: [
        { name: "gemma-4-E4B-it-Q4_0.gguf", size: 4_000_000_000, parameterSize: "42L", family: "gemma4", capabilities: ["tools"] },
        { name: "gemma-4-E4B-it-Q8_0.gguf", size: 8_000_000_000, parameterSize: "42L", family: "gemma4", capabilities: ["tools"] },
      ],
      loaded: [],
      refresh: vi.fn(),
      pulls: [],
      startPull: vi.fn(async () => true),
      cancelPull: vi.fn(),
      remove: vi.fn(async () => undefined),
      unload: vi.fn(async () => undefined),
      error: "",
      vram: 0,
      unifiedMemory: false,
    };

    render(
      <ModelsPage manager={manager} settings={defaultSettings} chatModel="" onUpdate={vi.fn()} onSelectChatModel={vi.fn()} t={t} />,
    );

    expect(screen.getByText("gemma-4-E4B-it")).toBeTruthy();
    expect(screen.getByText("gemma-4-E4B-it (1)")).toBeTruthy();
  });
});
