// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProvidersPage from "../settings/ProvidersPage";
import { translations } from "../translations";
import type { DiscoveredServer, ProviderCatalogEntry, ProviderInstance } from "../types";

const en = (key: string) => translations.en[key];

const entry = (id: string, over: Partial<ProviderCatalogEntry> = {}): ProviderCatalogEntry =>
  ({ id, name: id, kind: "cloud", protocol: "openai", keyUrl: null, needsKey: true, available: true, baseUrl: null, editableBaseUrl: false, ...over }) as ProviderCatalogEntry;

const instance = (id: string, over: Partial<ProviderInstance> = {}): ProviderInstance => ({
  id, type: id, label: id, name: id, kind: "cloud", protocol: "openai", baseUrl: "https://api.example.com/v1", enabled: false,
  pinnedModels: [], promptProfile: "auto", modelOverrides: {}, hasKey: false, keyHint: "", needsKey: true, ...over,
});

/** A fake main that keeps what it is told, the way the registry does, and answers with its view. */
function stubMain({ instances = [] as ProviderInstance[], catalog = [entry("openai")], servers = [] as DiscoveredServer[] } = {}) {
  let kept = instances;
  const find = (id: string) => kept.find((item) => item.id === id)!;
  const api = {
    catalog: vi.fn(async () => catalog),
    list: vi.fn(async () => kept.map((item) => ({ ...item }))),
    scan: vi.fn(async () => ({ success: true, servers })),
    add: vi.fn(async (input: { type: string; baseUrl?: string }) => {
      const added = instance(input.type, { kind: "local", needsKey: false, baseUrl: input.baseUrl ?? "" });
      kept = [...kept, added];
      return { success: true, instance: added };
    }),
    update: vi.fn(async (id: string, patch: Partial<ProviderInstance>) => {
      kept = kept.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { success: true, instance: find(id) };
    }),
    setKey: vi.fn(async (id: string, key: string) => {
      kept = kept.map((item) => (item.id === id ? { ...item, hasKey: Boolean(key), keyHint: key.slice(-4) } : item));
      return { success: true, instance: find(id) };
    }),
    remove: vi.fn(async () => ({ success: true })),
    test: vi.fn(async () => ({ success: true, count: 0 })),
    models: vi.fn(async (id: string) => ({
      success: true,
      models: ["m-1", "m-2"].map((model) => ({ id: model, ref: `@${id}/${model}`, capabilities: ["completion"], cloud: false, pinned: find(id).pinnedModels.includes(model), override: null })),
    })),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { providers: api };
  return api;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const page = () => render(<ProvidersPage engineModels={3} t={en} />);
const expand = async (label: string) => fireEvent.click((await screen.findAllByRole("button", { name: label }))[0]);

describe("the Providers page", () => {
  it("scans once when it opens, and offers only the servers not added yet", async () => {
    const api = stubMain({
      instances: [instance("ollama", { kind: "local", needsKey: false, baseUrl: "http://127.0.0.1:11434" })],
      servers: [
        { type: "ollama", name: "Ollama", port: 11434, baseUrl: "http://127.0.0.1:11434/v1", guessed: false },
        { type: "lmstudio", name: "LM Studio", port: 1234, baseUrl: "http://127.0.0.1:1234/v1", guessed: false },
      ],
    });
    page();
    await screen.findByRole("switch", { name: "LM Studio" });
    expect(screen.getAllByRole("switch", { name: /ollama|Ollama/ })).toHaveLength(1);
    expect(screen.getByText(/built-in/)).toBeTruthy();
    expect(api.scan).toHaveBeenCalledTimes(1);
  });

  it("adds a found server with its address, then switches it on", async () => {
    const api = stubMain({ servers: [{ type: "lmstudio", name: "LM Studio", port: 1234, baseUrl: "http://127.0.0.1:1234/v1", guessed: false }] });
    page();
    fireEvent.click(await screen.findByRole("switch", { name: "LM Studio" }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("lmstudio", { enabled: true }));
    expect(api.add).toHaveBeenCalledWith({ type: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1" });
  });

  it("keeps a keyed provider off until it has a key, and never shows the key back", async () => {
    const api = stubMain({ instances: [instance("openai")] });
    page();
    const toggle = await screen.findByRole("switch", { name: "openai" });
    expect(toggle.hasAttribute("disabled")).toBe(true);

    await expand("openai");
    const field = screen.getByLabelText("API key openai") as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: "sk-secret-1234" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(api.setKey).toHaveBeenCalledWith("openai", "sk-secret-1234"));
    await waitFor(() => expect(screen.getByRole("switch", { name: "openai" }).hasAttribute("disabled")).toBe(false));
    expect(field.value).toBe("");
    expect(document.body.innerHTML).not.toContain("sk-secret");
  });

  it("pins a model by ticking it", async () => {
    const api = stubMain({ instances: [instance("openai", { hasKey: true, keyHint: "1234", enabled: true })] });
    page();
    await expand("openai");
    const box = (await screen.findByText("m-2")).closest("label")!.querySelector("input")!;
    fireEvent.click(box);
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("openai", { pinnedModels: ["m-2"] }));
  });

  it("says why keyed providers cannot be switched on without a keystore", async () => {
    stubMain({ catalog: [entry("openai", { available: false }), entry("ollama", { kind: "local", needsKey: false })] });
    page();
    expect(await screen.findByText(en("noKeystoreProviders"))).toBeTruthy();
  });
});
