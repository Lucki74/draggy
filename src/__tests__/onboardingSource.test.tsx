// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import Onboarding from "../onboarding/Onboarding";
import { useFirstDownload } from "../onboarding/useFirstDownload";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import type { AppSettings, DiscoveredServer } from "../types";

const en = (key: string) => translations.en[key];

/** A new machine with the engine installed and nothing downloaded; `vram` picks the ladder's rung. */
function machine({ vram = 12, ram = 16, servers = [] as DiscoveredServer[] } = {}) {
  const api = {
    getSystemSpecs: vi.fn(async () => ({ cpu: "AMD", ram, vram, gpu: "GPU", platform: "win32", arch: "x64" })),
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
      listModels: vi.fn(async () => []),
      onProgress: () => () => {},
      downloadModel: vi.fn(() => new Promise(() => {})),
      cancelDownload: vi.fn(async () => ({ success: true })),
    },
    onboarding: {
      start: vi.fn(async () => ({ success: true, record: null })),
      complete: vi.fn(async () => ({ success: true })),
    },
    providers: {
      list: vi.fn(async () => []),
      catalog: vi.fn(async () => []),
      scan: vi.fn(async () => ({ success: true, servers })),
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return api;
}

function Harness() {
  const [settings, setSettings] = useState<AppSettings>({ ...defaultSettings });
  const download = useFirstDownload(window.electronAPI);
  return (
    <Onboarding
      settings={settings}
      onUpdateSettings={(patch) => setSettings((previous) => ({ ...previous, ...patch }))}
      download={download}
      onFinish={() => {}}
    />
  );
}

const continueButton = () => screen.getByRole("button", { name: en("onbContinue") });

async function toSource() {
  await screen.findByRole("heading", { name: en("onbWelcomeTitle") });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: en("onbAppearanceTitle") });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: en("onbSourceTitle") });
}

beforeEach(() => localStorage.setItem("draggy_settings", "{}"));

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("where the AI runs", () => {
  it("looks for a local server only once the step opens", async () => {
    const api = machine();
    render(<Harness />);
    await screen.findByRole("heading", { name: en("onbWelcomeTitle") });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.providers.scan).not.toHaveBeenCalled();

    await toSource();
    await waitFor(() => expect(api.providers.scan).toHaveBeenCalledTimes(1));
  });

  it("names a server it found and drops the line about files leaving the machine", async () => {
    machine({ servers: [{ type: "ollama", name: "Ollama", port: 11434, baseUrl: "http://127.0.0.1:11434/v1", guessed: false }] });
    render(<Harness />);
    await toSource();

    const found = en("onbSourceFound").replace("{name}", "");
    expect(await screen.findAllByText((_, node) => node?.tagName === "SPAN" && /Ollama/.test(node.textContent ?? "") && (node.textContent ?? "").includes(found.trim()))).not.toHaveLength(0);
    expect(screen.queryByText(en("onbSourceProviderData"))).toBeNull();
  });

  it("says who receives the data when no local server answers", async () => {
    machine();
    render(<Harness />);
    await toSource();
    expect(await screen.findByText(en("onbSourceProviderData"))).toBeTruthy();
  });

  it("warns that small models will be basic on weak hardware, and keeps local preselected", async () => {
    machine({ vram: 0, ram: 4 });
    render(<Harness />);
    await toSource();

    expect(await screen.findByText(en("onbSourceWeak"))).toBeTruthy();
    const local = screen.getByRole("radio", { name: new RegExp(en("onbSourceLocal")) });
    expect(local.getAttribute("aria-checked")).toBe("true");
  });

  it("does not call a capable machine weak", async () => {
    machine({ vram: 12 });
    render(<Harness />);
    await toSource();
    await screen.findByText(/Needs a download of about/);
    expect(screen.queryByText(en("onbSourceWeak"))).toBeNull();
  });
});
