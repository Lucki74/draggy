// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import ModelChoices from "../providers/ModelChoices";
import { useProviderOf, useProviders } from "../providers/useProviders";
import { translations } from "../translations";
import type { ProviderInstance } from "../types";

const en = (key: string) => translations.en[key];

const instance = (id: string, over: Partial<ProviderInstance> = {}): ProviderInstance => ({
  id, type: id, label: `Label ${id}`, name: id, kind: "cloud", protocol: "openai", baseUrl: "https://x/v1", enabled: true,
  pinnedModels: [], promptProfile: "auto", modelOverrides: {}, hasKey: true, keyHint: "1234", needsKey: true, newModels: [], ...over,
});

function stub(ggufs: string[], instances: ProviderInstance[]) {
  let kept = instances;
  const providers = {
    list: vi.fn(async () => kept),
    models: vi.fn(async () => ({ success: true, models: [] })),
    update: vi.fn(async (id: string, patch: Partial<ProviderInstance>) => {
      kept = kept.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { success: true };
    }),
    catalog: vi.fn(async () => []),
    scan: vi.fn(async () => ({ success: true, servers: [] })),
  };
  const gguf = { listModels: vi.fn(async () => ggufs.map((filename) => ({ filename, size: 1 }))) };
  (window as unknown as { electronAPI: unknown }).electronAPI = { providers, gguf };
  return providers;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const menu = (onPick = vi.fn()) => render(<ModelChoices open model="a.gguf" onPick={onPick} t={en} />);

describe("the composer's model list", () => {
  it("stays the flat list it was while no provider is on", async () => {
    stub(["a.gguf", "b.gguf"], [instance("off", { enabled: false, pinnedModels: ["x"] })]);
    menu();
    await screen.findByText("b.gguf");
    expect(screen.queryByText(en("draggyEngine"))).toBeNull();
    expect(screen.queryByText("x")).toBeNull();
  });

  it("puts each provider's ticked models under its name, and picks the full reference", async () => {
    stub(["a.gguf"], [instance("openai", { pinnedModels: ["gpt-x"] })]);
    const onPick = vi.fn();
    menu(onPick);
    const group = await screen.findByRole("group", { name: "Label openai" });
    expect(screen.getByRole("group", { name: en("draggyEngine") }).textContent).toContain("a.gguf");
    fireEvent.click(group.querySelector("button")!);
    expect(onPick).toHaveBeenCalledWith("@openai/gpt-x");
  });

  it("offers a search past eight models, across every group", async () => {
    stub(["a.gguf", "b.gguf"], [instance("openai", { pinnedModels: ["m1", "m2", "m3", "m4", "m5", "m6", "zeta"] })]);
    menu();
    const search = await screen.findByLabelText(en("searchModelsPlaceholder"));
    fireEvent.change(search, { target: { value: "zet" } });
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["zeta"]);
  });

  it("lists again when a provider changes", async () => {
    stub(["a.gguf"], [instance("openai", { pinnedModels: [] })]);
    menu();
    await screen.findByText("a.gguf");
    const { result } = renderHook(() => useProviders({ scanOnOpen: false }));
    await act(async () => {
      await result.current.update("openai", { pinnedModels: ["late"] });
    });
    await screen.findByText("late");
  });
});

describe("the pill's provider", () => {
  it("is none for the engine, and follows a provider's changes", async () => {
    stub([], [instance("lm", { kind: "local", label: "LM" })]);
    expect(renderHook(() => useProviderOf("a.gguf")).result.current).toBeNull();
    const { result } = renderHook(() => useProviderOf("@lm/qwen"));
    await waitFor(() => expect(result.current?.label).toBe("LM"));
    const providers = renderHook(() => useProviders({ scanOnOpen: false })).result;
    await act(async () => {
      await providers.current.update("lm", { label: "Renamed" });
    });
    await waitFor(() => expect(result.current?.label).toBe("Renamed"));
  });
});
