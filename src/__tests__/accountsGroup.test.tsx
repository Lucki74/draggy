// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProvidersPage from "../settings/ProvidersPage";
import { accountSubtitle } from "../providers/accountSubtitle";
import { fill } from "../onboarding/text";
import { translations } from "../translations";
import type { AccountProgress, AccountStatus, ProviderCatalogEntry, ProviderInstance } from "../types";

const en = (key: string) => translations.en[key];

const chatgpt: ProviderCatalogEntry = {
  id: "chatgpt", name: "ChatGPT", kind: "account", protocol: "codex", keyUrl: null, needsKey: false, available: true, baseUrl: null, editableBaseUrl: false, remote: false,
};
const openai: ProviderCatalogEntry = { ...chatgpt, id: "openai", name: "OpenAI", kind: "cloud", protocol: "openai", needsKey: true };

const account = (over: Partial<ProviderInstance> = {}): ProviderInstance => ({
  id: "chatgpt", type: "chatgpt", label: "ChatGPT", name: "ChatGPT", kind: "account", protocol: "codex", baseUrl: "", enabled: false,
  pinnedModels: [], promptProfile: "auto", modelOverrides: {}, hasKey: false, keyHint: "", needsKey: false, newModels: [], ...over,
});

const PRO: AccountStatus = {
  signedIn: true, email: "me@example.com", plan: "pro",
  limits: [{ window: 300, usedPercent: 23, resetsAt: null }, { window: 10080, usedPercent: 41.4, resetsAt: null }],
};

/** A fake main for the account calls; `signIn` stays pending until the test settles it. */
function stubMain({ instances = [] as ProviderInstance[], status = { signedIn: false } as AccountStatus } = {}) {
  let kept = instances;
  const progress = new Set<(p: AccountProgress) => void>();
  let settle: (answer: unknown) => void = () => {};
  const api = {
    catalog: vi.fn(async () => [openai, chatgpt]),
    list: vi.fn(async () => kept.map((item) => ({ ...item }))),
    scan: vi.fn(async () => ({ success: true, servers: [] })),
    add: vi.fn(async ({ type }: { type: string }) => {
      const added = account({ id: type, type });
      kept = [...kept, added];
      return { success: true, instance: added };
    }),
    update: vi.fn(async (id: string, patch: Partial<ProviderInstance>) => {
      kept = kept.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return { success: true, instance: kept.find((item) => item.id === id) };
    }),
    models: vi.fn(async (id: string) => ({
      success: true,
      models: ["gpt-5.5", "gpt-5.4"].map((model) => ({ id: model, ref: `@${id}/${model}`, capabilities: ["completion"], cloud: true, pinned: false, override: null })),
    })),
    accountStatus: vi.fn(async () => ({ success: true, status })),
    accountSignIn: vi.fn(() => new Promise((resolve) => (settle = resolve))),
    accountCancel: vi.fn(async () => ({ success: true })),
    accountSignOut: vi.fn(async () => ({ success: true })),
    onAccountProgress: vi.fn((callback: (p: AccountProgress) => void) => {
      progress.add(callback);
      return () => progress.delete(callback);
    }),
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = { providers: api };
  const emit = (p: AccountProgress) => act(() => progress.forEach((callback) => callback(p)));
  return { api, emit, settle: (answer: unknown) => act(async () => settle(answer)), listeners: () => progress.size };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const page = () => render(<ProvidersPage engineModels={3} t={en} />);

describe("the Accounts group", () => {
  it("offers a sign-in for an account never used, reads nothing to show it, and keeps it out of the Add list", async () => {
    const { api } = stubMain();
    page();
    expect(await screen.findByText(en("accountsGroup"))).toBeTruthy();
    expect(screen.getByText(en("notSignedIn"))).toBeTruthy();
    expect(screen.getByRole("button", { name: fill(en("signInWith"), { name: "ChatGPT" }) })).toBeTruthy();
    expect(api.accountStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: en("addProvider") }));
    expect(screen.getByRole("button", { name: "OpenAI" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ChatGPT" })).toBeNull();
  });

  it("signs in through the vendor's page, can be cancelled while waiting, and ticks what the plan offers", async () => {
    const { api, emit, settle, listeners } = stubMain();
    page();
    fireEvent.click(await screen.findByRole("button", { name: fill(en("signInWith"), { name: "ChatGPT" }) }));
    await waitFor(() => expect(api.accountSignIn).toHaveBeenCalledWith("chatgpt"));
    expect(api.add).toHaveBeenCalledWith({ type: "chatgpt" });

    emit({ id: "chatgpt", step: "installing", percent: 40 });
    expect(screen.getByText(fill(en("installingRuntime"), { name: "ChatGPT", percent: "40" }))).toBeTruthy();
    emit({ id: "chatgpt", step: "browser", url: "https://auth.openai.com/x" });
    expect(screen.getByText(en("finishInBrowser"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en("cancel") }));
    expect(api.accountCancel).toHaveBeenCalledWith("chatgpt");

    await settle({ success: true, status: PRO });
    expect(await screen.findByText(`Pro · ${fill(en("usageHours"), { count: "5" })} 23% · ${en("usageWeek")} 41%`)).toBeTruthy();
    expect(api.update).toHaveBeenLastCalledWith("chatgpt", { enabled: true, pinnedModels: ["gpt-5.5", "gpt-5.4"] });
    expect(listeners()).toBe(0);
  });

  it("says nothing went wrong when the user cancels, and names a failure otherwise", async () => {
    const { settle } = stubMain();
    page();
    const button = await screen.findByRole("button", { name: fill(en("signInWith"), { name: "ChatGPT" }) });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: en("cancel") })).toBeTruthy());
    await settle({ success: true, status: { signedIn: false, cancelled: true } });
    expect(screen.queryByText(en("signInFailed"))).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: fill(en("signInWith"), { name: "ChatGPT" }) }));
    await waitFor(() => expect(screen.getByRole("button", { name: en("cancel") })).toBeTruthy());
    await settle({ success: true, status: { signedIn: false, error: "denied" } });
    expect(await screen.findByText(en("signInFailed"))).toBeTruthy();
  });

  it("reads a signed-in account's status on open, and signs out from the open row", async () => {
    const { api } = stubMain({ instances: [account({ enabled: true, pinnedModels: ["gpt-5.5"] })], status: PRO });
    page();
    await waitFor(() => expect(api.accountStatus).toHaveBeenCalledTimes(1));
    fireEvent.click((await screen.findAllByRole("button", { name: "ChatGPT" }))[0]);
    expect(await screen.findByText(fill(en("signedInAs"), { email: "me@example.com" }))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en("signOut") }));
    await waitFor(() => expect(api.accountSignOut).toHaveBeenCalledWith("chatgpt"));
    await waitFor(() => expect(api.update).toHaveBeenLastCalledWith("chatgpt", { enabled: false }));
    expect(await screen.findByText(en("notSignedIn"))).toBeTruthy();
  });
});

describe("an account's subtitle", () => {
  it("shows the plan and each window, or just that it is signed in", () => {
    expect(accountSubtitle({ signedIn: true }, en)).toBe(en("signedIn"));
    expect(accountSubtitle({ signedIn: true, limits: [{ window: 1440, usedPercent: 5, resetsAt: null }] }, en)).toBe(`${fill(en("usageDays"), { count: "1" })} 5%`);
    expect(accountSubtitle(null, en)).toBe(en("notSignedIn"));
  });
});
