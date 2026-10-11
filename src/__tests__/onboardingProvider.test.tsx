// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import Onboarding, { type SetupOutcome } from "../onboarding/Onboarding";
import { useFirstDownload } from "../onboarding/useFirstDownload";
import App from "../App";
import { installFakeElectronApi } from "./helpers/electronApi";
import { defaultSettings } from "../app/settings";
import { fill } from "../onboarding/text";
import { translations } from "../translations";
import type { AccountProgress, AppSettings, ProviderCatalogEntry, ProviderInstance } from "../types";

const en = (key: string) => translations.en[key];

const openai = (patch: Partial<ProviderInstance> = {}): ProviderInstance => ({
  id: "openai",
  type: "openai",
  label: "OpenAI",
  name: "OpenAI",
  kind: "cloud",
  protocol: "openai",
  baseUrl: "https://api.openai.com/v1",
  enabled: true,
  pinnedModels: ["gpt-x"],
  promptProfile: "auto",
  modelOverrides: {},
  hasKey: true,
  keyHint: "abcd",
  needsKey: true,
  newModels: [],
  ...patch,
});

const entry = (available = true): ProviderCatalogEntry => ({
  id: "openai",
  name: "OpenAI",
  kind: "cloud",
  protocol: "openai",
  vendor: "openai",
  keyUrl: null,
  needsKey: true,
  available,
  remote: false,
  baseUrl: null,
  editableBaseUrl: false,
});

/** A new machine with the engine installed; `installed` files count as models already on disk. */
function machine({ instances = [] as ProviderInstance[], catalog = [entry()], installed = [] as string[] } = {}) {
  const api = {
    getSystemSpecs: vi.fn(async () => ({ cpu: "AMD", ram: 16, vram: 12, gpu: "GPU", platform: "win32", arch: "x64" })),
    checkDiskSpace: vi.fn(async () => 500),
    checkInternet: vi.fn(async () => true),
    resolveModelUrl: vi.fn(async (reference: string) => {
      const filename = `${reference.split("/")[1].split(":")[0]}.gguf`;
      return { url: `https://huggingface.co/x/${filename}`, filename, size: 2e9 };
    }),
    modelSize: vi.fn(async () => ({ success: false })),
    onDownloadProgress: () => () => {},
    gguf: {
      status: vi.fn(async () => ({ hasBinary: true, ready: true, modelsDir: "C:\\Draggy\\models" })),
      setupEngine: vi.fn(async () => ({ success: true })),
      listModels: vi.fn(async () =>
        installed.map((filename) => ({ name: filename, filename, size: 1, path: filename, architecture: "llama", contextLength: 1, blockCount: 1, fileType: 1, capabilities: ["completion"] })),
      ),
      onProgress: () => () => {},
      downloadModel: vi.fn(() => new Promise(() => {})),
      cancelDownload: vi.fn(async () => ({ success: true })),
    },
    onboarding: {
      start: vi.fn(async () => ({ success: true, record: null })),
      complete: vi.fn(async () => ({ success: true })),
    },
    providers: {
      list: vi.fn(async () => instances),
      catalog: vi.fn(async () => catalog),
      scan: vi.fn(async () => ({ success: true, servers: [] })),
      models: vi.fn(async (id: string) => ({
        success: true,
        models: [{ id: "gpt-x", ref: `@${id}/gpt-x`, contextLength: null, maxOutputTokens: null, capabilities: ["completion"], cloud: true, pinned: true, override: null }],
      })),
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return api;
}

function Harness({ onFinish }: { onFinish: (model: string, outcome: SetupOutcome) => void }) {
  const [settings, setSettings] = useState<AppSettings>({ ...defaultSettings });
  const download = useFirstDownload(window.electronAPI);
  return (
    <Onboarding
      settings={settings}
      onUpdateSettings={(patch) => setSettings((previous) => ({ ...previous, ...patch }))}
      download={download}
      onFinish={onFinish}
    />
  );
}

const continueButton = () => screen.getByRole("button", { name: en("onbContinue") }) as HTMLButtonElement;

async function toProvider(card: "onbSourceProvider" | "onbSourceBoth") {
  await screen.findByRole("heading", { name: en("onbWelcomeTitle") });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: en("onbAppearanceTitle") });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: en("onbSourceTitle") });
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(en(card)) }));
  fireEvent.click(continueButton());
  if (card === "onbSourceBoth") {
    await screen.findByRole("heading", { name: en("onbLocalTitle") });
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
  }
  await screen.findByRole("heading", { name: en("onbProviderTitle") });
}

async function toReady() {
  await waitFor(() => expect(continueButton().disabled).toBe(false));
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: en("onbPrefsTitle") });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: en("onbReadyTitle") });
}

beforeEach(() => localStorage.setItem("draggy_settings", "{}"));

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("the provider step", () => {
  it("finishes on a provider's model alone, recorded at once, with no model downloaded", async () => {
    const api = machine({ instances: [openai()] });
    const onFinish = vi.fn();
    render(<Harness onFinish={onFinish} />);
    await toProvider("onbSourceProvider");
    await toReady();

    expect(screen.getByText(en("onbReadyMoreProviders"))).toBeTruthy();
    expect(screen.queryByText(en("onbReadyWaiting"))).toBeNull();
    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("@openai/gpt-x", expect.objectContaining({ path: "provider" })));
    expect(api.onboarding.complete).toHaveBeenCalledWith("provider");
    expect(api.gguf.downloadModel).not.toHaveBeenCalled();
  });

  it("holds Continue until a provider is on with a model ticked", async () => {
    machine({ instances: [openai({ enabled: false })] });
    render(<Harness onFinish={() => {}} />);
    await toProvider("onbSourceProvider");

    expect(await screen.findByText(en("onbProviderPick"))).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(continueButton().disabled).toBe(true);
  });

  it("shows keyed providers switched off, with the reason, when there is no keystore", async () => {
    machine({ instances: [openai({ enabled: false, hasKey: false, keyHint: "" })], catalog: [entry(false)] });
    render(<Harness onFinish={() => {}} />);
    await toProvider("onbSourceProvider");

    expect(await screen.findByText(en("noKeystoreProviders"))).toBeTruthy();
    const toggle = (await screen.findByRole("switch", { name: "OpenAI" })) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
  });

  it("keeps Draggy's own model as the default on both, and leaves the record to the app", async () => {
    const api = machine({ instances: [openai()], installed: ["have.gguf"] });
    const onFinish = vi.fn();
    render(<Harness onFinish={onFinish} />);
    await toProvider("onbSourceBoth");
    await toReady();

    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("have.gguf", expect.objectContaining({ path: "both" })));
    expect(api.onboarding.complete).not.toHaveBeenCalled();
  });
});

/** The whole app on a new install, the fake main process under this file's machine. */
function freshApp(options: Parameters<typeof machine>[0]) {
  installFakeElectronApi();
  const fake = window.electronAPI as unknown as Record<string, unknown>;
  const api = machine(options);
  for (const [key, value] of Object.entries(api)) fake[key] = value;
  (window as unknown as { electronAPI: unknown }).electronAPI = fake;
  window.history.pushState(null, "", "/?onboarding=true");
  render(<App />);
  return api;
}

describe("from the provider step into the app", () => {
  it("opens on the provider's model, recorded as provider", async () => {
    const api = freshApp({ instances: [openai()] });
    await toProvider("onbSourceProvider");
    await toReady();
    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();
    expect(api.onboarding.complete).toHaveBeenCalledWith("provider");
    await waitFor(() => expect(localStorage.getItem("draggy_settings")).toContain("@openai/gpt-x"));
    expect(api.onboarding.complete).not.toHaveBeenCalledWith("local");
  });

  it("records both once Draggy's own model is on disk", async () => {
    const api = freshApp({ instances: [openai()], installed: ["have.gguf"] });
    await toProvider("onbSourceBoth");
    await toReady();
    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    await waitFor(() => expect(api.onboarding.complete).toHaveBeenCalledWith("both"));
    expect(api.onboarding.complete).not.toHaveBeenCalledWith("local");
  });
});

const chatgpt: ProviderCatalogEntry = { ...entry(), id: "chatgpt", name: "ChatGPT", kind: "account", protocol: "codex", needsKey: false, download: 52e6 };

/** A new machine whose catalog has a plan; status always reads signed out, and the sign-in waits for the test. */
function withPlan() {
  const api = machine({ catalog: [entry(), chatgpt] });
  let kept: ProviderInstance[] = [];
  let settle: (answer: unknown) => void = () => {};
  const progress = new Set<(p: AccountProgress) => void>();
  const extra = {
    list: vi.fn(async () => kept.map((item) => ({ ...item }))),
    add: vi.fn(async ({ type }: { type: string }) => {
      const added = openai({ id: type, type, label: "ChatGPT", name: "ChatGPT", kind: "account", protocol: "codex", enabled: false, pinnedModels: [], hasKey: false, needsKey: false });
      kept = [...kept, added];
      return { success: true, instance: added };
    }),
    update: vi.fn(async (id: string, patch: Partial<ProviderInstance>) => {
      kept = kept.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { success: true, instance: kept.find((item) => item.id === id) };
    }),
    accountStatus: vi.fn(async () => ({ success: true, status: { signedIn: false } })),
    accountSignIn: vi.fn(() => new Promise((resolve) => (settle = resolve))),
    accountCancel: vi.fn(async () => ({ success: true })),
    accountSignOut: vi.fn(async () => ({ success: true })),
    onAccountProgress: vi.fn((callback: (p: AccountProgress) => void) => {
      progress.add(callback);
      return () => progress.delete(callback);
    }),
  };
  Object.assign(api.providers, extra);
  return { api: api.providers as typeof api.providers & typeof extra, settle: (answer: unknown) => act(async () => settle(answer)) };
}

const signInButton = () => screen.findByRole("button", { name: fill(en("signInWith"), { name: "ChatGPT" }) });

describe("a plan on the provider step", () => {
  it("offers the plan in its own group with the size of its first sign-in, fetching nothing to show it", async () => {
    const { api } = withPlan();
    render(<Harness onFinish={() => {}} />);
    await toProvider("onbSourceProvider");

    expect(await screen.findByText(en("accountsGroup"))).toBeTruthy();
    expect(await signInButton()).toBeTruthy();
    expect(screen.getByText(fill(en("onbSourceDownload"), { size: "52 MB" }))).toBeTruthy();
    expect(api.add).not.toHaveBeenCalled();
    expect(api.accountSignIn).not.toHaveBeenCalled();
  });

  it("signs in from the tile, names who receives the conversations, and lets the step go on with the plan's model", async () => {
    const { api, settle } = withPlan();
    render(<Harness onFinish={() => {}} />);
    await toProvider("onbSourceProvider");
    fireEvent.click(await signInButton());
    await waitFor(() => expect(api.accountSignIn).toHaveBeenCalledWith("chatgpt"));
    expect(continueButton().disabled).toBe(true);

    await settle({ success: true, status: { signedIn: true, email: "me@example.com" } });
    expect(await screen.findByText(fill(en("onbAccountData"), { vendor: "OpenAI" }))).toBeTruthy();
    expect(screen.queryByText(fill(en("onbSourceDownload"), { size: "52 MB" }))).toBeNull();
    expect(api.update).toHaveBeenLastCalledWith("chatgpt", { enabled: true, pinnedModels: ["gpt-x"] });
    await waitFor(() => expect(continueButton().disabled).toBe(false));

    // The runtime is on disk now, so signing out offers the sign-in again without the size.
    fireEvent.click(screen.getByRole("button", { name: en("signOut") }));
    expect(await signInButton()).toBeTruthy();
    expect(screen.queryByText(fill(en("onbSourceDownload"), { size: "52 MB" }))).toBeNull();
  });

  it("finishes on the plan's model once signed in, recorded as provider", async () => {
    const { api, settle } = withPlan();
    const onFinish = vi.fn();
    render(<Harness onFinish={onFinish} />);
    await toProvider("onbSourceProvider");
    fireEvent.click(await signInButton());
    await waitFor(() => expect(api.accountSignIn).toHaveBeenCalled());
    await settle({ success: true, status: { signedIn: true } });
    await toReady();
    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("@chatgpt/gpt-x", expect.objectContaining({ path: "provider" })));
  });

  it("asks plan or key when the vendor is picked from the Add list, and the plan signs in from its tile", async () => {
    const { api } = withPlan();
    render(<Harness onFinish={() => {}} />);
    await toProvider("onbSourceProvider");
    fireEvent.click(await screen.findByRole("button", { name: en("addProvider") }));
    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(api.add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(en("planRoute")));
    await waitFor(() => expect(api.accountSignIn).toHaveBeenCalledWith("chatgpt"));
    expect(api.add).toHaveBeenCalledWith({ type: "chatgpt" });
  });

  it("switches nothing on when the sign-in is cancelled", async () => {
    const { api, settle } = withPlan();
    render(<Harness onFinish={() => {}} />);
    await toProvider("onbSourceProvider");
    fireEvent.click(await signInButton());
    fireEvent.click(await screen.findByRole("button", { name: en("cancel") }));
    expect(api.accountCancel).toHaveBeenCalledWith("chatgpt");
    await settle({ success: false, status: { signedIn: false, cancelled: true } });

    expect(await signInButton()).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
    expect(continueButton().disabled).toBe(true);
  });
});
