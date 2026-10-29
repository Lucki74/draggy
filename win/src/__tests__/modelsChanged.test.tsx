// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useProviderGroups } from "../providers/modelOptions";

type Change = { id: string; added: string[] };

describe("models found by the main process", () => {
  afterEach(() => {
    cleanup();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("show up in the model menu without a click, and the listener is released", async () => {
    let pinned = ["gpt-5.5"];
    const listeners = new Set<(change: Change) => void>();
    const stop = vi.fn();
    const providers = {
      list: vi.fn(async () => [{ id: "openai", label: "OpenAI", kind: "cloud", type: "openai", enabled: true, pinnedModels: pinned }]),
      models: vi.fn(async () => ({ success: true, models: pinned.map((id) => ({ id, ref: `@openai/${id}`, capabilities: ["completion"], cloud: true, pinned: true, override: null })) })),
      onModelsChanged: vi.fn((callback: (change: Change) => void) => {
        listeners.add(callback);
        return () => {
          stop();
          listeners.delete(callback);
        };
      }),
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = { providers };
    const { result, unmount } = renderHook(() => useProviderGroups());
    await waitFor(() => expect(result.current[0]?.models.map((m) => m.id)).toEqual(["gpt-5.5"]));

    pinned = ["gpt-5.5", "gpt-6"];
    act(() => listeners.forEach((listener) => listener({ id: "openai", added: ["gpt-6"] })));
    await waitFor(() => expect(result.current[0].models.map((m) => m.id)).toEqual(["gpt-5.5", "gpt-6"]));

    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
