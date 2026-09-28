// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { Select } from "../settings/Controls";
import { useProviderGroups, withProviderModels } from "../providers/modelOptions";
import type { ModelGroup } from "../ai/providers";
import type { ProviderModel } from "../types";

const model = (instance: string, id: string) => ({ id, ref: `@${instance}/${id}` }) as ProviderModel;
const openai: ModelGroup = { instanceId: "openai", label: "OpenAI", kind: "cloud", models: [model("openai", "gpt-x")] };
const engine = [
  { id: "a.gguf", label: "a.gguf" },
  { id: "b.gguf", label: "b.gguf" },
];

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("the preferences' model options", () => {
  it("leave the engine's alone while no provider is on", () => {
    expect(withProviderModels(engine, [], "Draggy engine")).toEqual(engine);
  });

  it("head the engine's and each provider's, and choose a provider's by its full reference", () => {
    const onChange = vi.fn();
    const options = [{ id: "", label: "Same as Chat" }, ...withProviderModels(engine, [openai], "Draggy engine")];
    render(<Select label="Model" value="" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    const list = screen.getByRole("listbox").textContent ?? "";
    expect(list.indexOf("Draggy engine")).toBeLessThan(list.indexOf("a.gguf"));
    expect(list.indexOf("OpenAI")).toBeLessThan(list.indexOf("gpt-x"));
    expect(list.match(/Draggy engine/g)).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "gpt-x" }));
    expect(onChange).toHaveBeenCalledWith("@openai/gpt-x");
  });

  it("come from the enabled providers' ticked models", async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      providers: {
        list: async () => [
          { id: "openai", label: "OpenAI", kind: "cloud", enabled: true, pinnedModels: ["gpt-x"] },
          { id: "off", label: "Off", kind: "cloud", enabled: false, pinnedModels: ["y"] },
        ],
        models: async () => ({ success: true, models: [] }),
      },
    };
    const { result } = renderHook(() => useProviderGroups());
    await waitFor(() => expect(result.current.map((group) => group.label)).toEqual(["OpenAI"]));
  });
});
