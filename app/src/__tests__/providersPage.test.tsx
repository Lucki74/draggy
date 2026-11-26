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
  pinnedModels: [], promptProfile: "auto", modelOverrides: {}, hasKey: false, keyHint: "", needsKey: true, newModels: [], ...over,
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
  (window as unknown as { draggy: unknown }).draggy = { providers: api };
  return api;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { draggy?: unknown }).draggy;
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

  it("pins a model with its switch, and unpins it again", async () => {
    const api = stubMain({ instances: [instance("openai", { hasKey: true, keyHint: "1234", enabled: true })] });
    page();
    await expand("openai");
    const model = await screen.findByRole("switch", { name: "m-2" });
    expect(model.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(model);
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("openai", { pinnedModels: ["m-2"] }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "m-2" }).getAttribute("aria-checked")).toBe("true"));
    expect(api.update).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("m-2"));
    await waitFor(() => expect(api.update).toHaveBeenLastCalledWith("openai", { pinnedModels: [] }));
    expect(api.update).toHaveBeenCalledTimes(2);
  });

  it("names a local server's cloud model switch with its Cloud badge", async () => {
    const api = stubMain({ instances: [instance("ollama", { kind: "local", needsKey: false, enabled: true })] });
    api.models.mockResolvedValueOnce({
      success: true,
      models: [{ id: "big:cloud", ref: "@ollama/big:cloud", capabilities: ["completion"], cloud: true, pinned: false, override: null }],
    });
    page();
    await expand("ollama");
    expect(await screen.findByRole("switch", { name: `big:cloud ${en("cloudModelBadge")}` })).toBeTruthy();
  });

  it("shows the address of a provider that only providers.json knows, and adds it only once confirmed", async () => {
    const api = stubMain({ catalog: [entry("newcloud", { remote: true, baseUrl: "https://api.newcloud.example/v1" })] });
    page();
    fireEvent.click(await screen.findByRole("button", { name: en("addProvider") }));
    fireEvent.click(await screen.findByRole("button", { name: "newcloud" }));
    expect(screen.getByText("https://api.newcloud.example/v1")).toBeTruthy();
    expect(api.add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: en("confirm") }));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith({ type: "newcloud" }));
  });

  it("asks for a custom provider's address in the Add list, and adds it with that address", async () => {
    const api = stubMain({ catalog: [entry("custom", { name: "Custom (OpenAI-compatible)", needsKey: false, editableBaseUrl: true, baseUrl: null })] });
    page();
    fireEvent.click(await screen.findByRole("button", { name: en("addProvider") }));
    fireEvent.click(await screen.findByRole("button", { name: "Custom (OpenAI-compatible)" }));
    const field = screen.getByRole("textbox", { name: en("providerAddress") });
    expect(document.activeElement).toBe(field);
    expect(api.add).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: " http://192.168.64.1:1234/v1 " } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(api.add).toHaveBeenCalledWith({ type: "custom", baseUrl: "http://192.168.64.1:1234/v1" }));
    expect(await screen.findByRole("switch", { name: "custom" })).toBeTruthy();
  });

  it("says why an add was refused, and keeps the address to correct", async () => {
    const api = stubMain({ catalog: [entry("custom", { name: "Custom (OpenAI-compatible)", needsKey: false, editableBaseUrl: true, baseUrl: null })] });
    api.add.mockImplementation(async () => ({ success: false, error: { kind: "provider-unknown-error", message: "That address is not a URL." } }) as never);
    page();
    fireEvent.click(await screen.findByRole("button", { name: en("addProvider") }));
    fireEvent.click(await screen.findByRole("button", { name: "Custom (OpenAI-compatible)" }));
    fireEvent.change(screen.getByRole("textbox", { name: en("providerAddress") }), { target: { value: "not a url" } });
    fireEvent.click(screen.getByRole("button", { name: en("confirm") }));
    expect(await screen.findByText(en("providerChangeFailed"))).toBeTruthy();
    expect(api.add).toHaveBeenCalledWith({ type: "custom", baseUrl: "not a url" });
    expect((screen.getByRole("textbox", { name: en("providerAddress") }) as HTMLInputElement).value).toBe("not a url");
    expect(screen.queryByRole("switch", { name: "custom" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: en("cancel") }));
    expect(screen.queryByText(en("providerChangeFailed"))).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: en("searchProviders") }));
  });

  it("leaves the Enter that confirms an IME candidate to the IME", async () => {
    const api = stubMain({ catalog: [entry("custom", { name: "Custom (OpenAI-compatible)", needsKey: false, editableBaseUrl: true, baseUrl: null })] });
    page();
    fireEvent.click(await screen.findByRole("button", { name: en("addProvider") }));
    fireEvent.click(await screen.findByRole("button", { name: "Custom (OpenAI-compatible)" }));
    const field = screen.getByRole("textbox", { name: en("providerAddress") });
    fireEvent.change(field, { target: { value: "http://192.168.64.1:1234/v1" } });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(api.add).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: en("providerAddress") })).toBeTruthy();
  });

  it("adds a custom provider once when Enter is pressed again before the answer", async () => {
    const api = stubMain({ catalog: [entry("custom", { name: "Custom (OpenAI-compatible)", needsKey: false, editableBaseUrl: true, baseUrl: null })] });
    api.add.mockImplementation(() => new Promise<never>(() => {}));
    page();
    fireEvent.click(await screen.findByRole("button", { name: en("addProvider") }));
    fireEvent.click(await screen.findByRole("button", { name: "Custom (OpenAI-compatible)" }));
    const field = screen.getByRole("textbox", { name: en("providerAddress") });
    fireEvent.change(field, { target: { value: "http://192.168.64.1:1234/v1" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(api.add).toHaveBeenCalledTimes(1);
  });

  it("shows each provider's logo beside its name, on its row and in the Add list", async () => {
    stubMain({
      instances: [instance("openai")],
      catalog: [entry("openai"), entry("mistral", { name: "Mistral" })],
      servers: [{ type: "lmstudio", name: "LM Studio", port: 1234, baseUrl: "http://127.0.0.1:1234/v1", guessed: false }],
    });
    const { container } = page();
    await screen.findByRole("switch", { name: "LM Studio" });
    fireEvent.click(screen.getByRole("button", { name: en("addProvider") }));
    await screen.findByText("Mistral");
    const shown = [...container.querySelectorAll("[data-icon]")].map((icon) => (icon as HTMLElement).dataset.icon);
    expect(shown).toEqual(expect.arrayContaining(["openai", "lmstudio", "mistral"]));
  });

  it("marks a provider whose curated models grew with a new badge", async () => {
    stubMain({ instances: [instance("openai", { newModels: ["gpt-9"] })] });
    page();
    expect(await screen.findByText(en("newModelsBadge"))).toBeTruthy();
  });

  it("says why keyed providers cannot be switched on without a keystore", async () => {
    stubMain({ catalog: [entry("openai", { available: false }), entry("ollama", { kind: "local", needsKey: false })] });
    page();
    expect(await screen.findByText(en("noKeystoreProviders"))).toBeTruthy();
  });
});
