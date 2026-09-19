// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("shows its name without the part counter but acts on the real file", () => {
    const remove = vi.fn(async () => undefined);
    const manager: ModelManager = {
      installed: [{ name: SPLIT, size: 15_000_000_000, parameterSize: "48L", family: "qwen3", capabilities: ["tools"] }],
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
      <ModelsPage manager={manager} settings={defaultSettings} chatModel="" onUpdate={vi.fn()} onNavigate={vi.fn()} t={t} />,
    );

    expect(screen.getByText("Qwen3-Coder-Next-Q4_K_M.gguf")).toBeTruthy();
    expect(screen.queryByText(/00001-of-00004/)).toBeNull();

    fireEvent.click(screen.getByLabelText(/Qwen3-Coder-Next-Q4_K_M\.gguf/, { selector: "button[aria-label^='Remove']" }));
    expect(remove).toHaveBeenCalledWith(SPLIT);
  });
});
