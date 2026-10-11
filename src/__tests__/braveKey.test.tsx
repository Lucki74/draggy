// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { defaultSettings, useSettings } from "../app/settings";
import { WebSearchPage } from "../settings/GeneralPages";
import { SETTINGS_KEY } from "../storage";
import { translations } from "../translations";

const en = (key: string) => translations.en[key];

function stubKeyStore(initial: { hasKey: boolean; keyHint?: string; keystore?: boolean }) {
  let status = { keyHint: "", keystore: true, ...initial };
  const setBraveKey = vi.fn(async (key: string) => {
    status = { ...status, hasKey: Boolean(key), keyHint: key.slice(-4) };
    return { success: true, kept: status.keystore };
  });
  const setSearchConfig = vi.fn(async () => ({ success: true }));
  const updater = { configure: vi.fn(async () => undefined) };
  (window as unknown as { electronAPI: unknown }).electronAPI = { setBraveKey, braveKeyStatus: vi.fn(async () => status), setSearchConfig, updater };
  return { setBraveKey, setSearchConfig };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("the Brave key field", () => {
  const page = () => render(<WebSearchPage settings={{ ...defaultSettings, searchProvider: "brave" }} onUpdate={() => {}} t={en} />);

  it("shows only the stored key's last four, and sends what is typed to the keystore", async () => {
    const { setBraveKey } = stubKeyStore({ hasKey: true, keyHint: "9x2k" });
    page();
    const input = (await screen.findByPlaceholderText("•••• 9x2k")) as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "BSA-new-key7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(setBraveKey).toHaveBeenCalledWith("BSA-new-key7"));
    await screen.findByPlaceholderText("•••• key7");
    expect(input.value).toBe("");
  });

  it("removes the key, and says when it cannot outlive this run", async () => {
    const { setBraveKey } = stubKeyStore({ hasKey: true, keyHint: "9x2k", keystore: false });
    page();
    expect(await screen.findByText(en("braveKeyThisRun"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en("remove") }));
    await waitFor(() => expect(setBraveKey).toHaveBeenCalledWith(""));
    await screen.findByPlaceholderText("BSA...");
  });
});

describe("a key an earlier version saved in the settings", () => {
  it("leaves the saved settings and goes to the keystore, never over a key already there", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, braveApiKey: "BSA-old" }));
    const { setBraveKey, setSearchConfig } = stubKeyStore({ hasKey: false });
    const { result } = renderHook(() => useSettings(false));
    expect("braveApiKey" in result.current[0]).toBe(false);
    await waitFor(() => expect(setBraveKey).toHaveBeenCalledWith("BSA-old"));
    expect(localStorage.getItem(SETTINGS_KEY)).not.toContain("BSA-old");
    expect(JSON.stringify(setSearchConfig.mock.calls)).not.toContain("BSA-old");

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, braveApiKey: "BSA-older" }));
    const kept = stubKeyStore({ hasKey: true, keyHint: "-new" });
    renderHook(() => useSettings(false));
    await waitFor(() => expect(localStorage.getItem(SETTINGS_KEY)).not.toContain("BSA-older"));
    expect(kept.setBraveKey).not.toHaveBeenCalled();
  });
});
