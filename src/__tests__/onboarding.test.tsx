// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import Onboarding, { type SetupOutcome } from "../onboarding/Onboarding";
import { useFirstDownload } from "../onboarding/useFirstDownload";
import App from "../App";
import { GeneralPage } from "../settings/GeneralPages";
import { installFakeElectronApi } from "./helpers/electronApi";
import { THEME_PALETTES } from "../onboarding/palettes";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import type { AppSettings } from "../types";

const en = (key: string) => translations.en[key];
const ja = (key: string) => translations.ja[key];

/** A new machine: a 12 GB card, the engine installed, nothing downloaded, each transfer held open. */
function freshMachine({ online = true, installed = [] as string[] } = {}) {
  const pending = new Map<string, (result: { success: boolean }) => void>();
  const order: string[] = [];
  const api = {
    getSystemSpecs: vi.fn(async () => ({ cpu: "AMD", ram: 64, vram: 12, gpu: "NVIDIA GeForce RTX 4070", platform: "win32", arch: "x64" })),
    checkDiskSpace: vi.fn(async () => 500),
    checkInternet: vi.fn(async () => online),
    resolveModelUrl: vi.fn(async (reference: string) => {
      const filename = `${reference.split("/")[1].split(":")[0]}.gguf`;
      return { url: `https://huggingface.co/x/${filename}`, filename, size: 8e9 };
    }),
    searchModels: vi.fn(async () => ({ success: true, models: [] })),
    modelSize: vi.fn(async () => ({ success: false })),
    onDownloadProgress: () => () => {},
    quitApp: vi.fn(),
    gguf: {
      status: vi.fn(async () => ({ hasBinary: true, ready: true, modelsDir: "C:\\Draggy\\models" })),
      setupEngine: vi.fn(async () => ({ success: true })),
      listModels: vi.fn(async () =>
        installed.map((filename) => ({ name: filename, filename, size: 1, path: filename, architecture: "llama", contextLength: 1, blockCount: 1, fileType: 1, capabilities: ["completion"] })),
      ),
      onProgress: () => () => {},
      downloadModel: vi.fn(({ filename }: { filename: string }) => {
        order.push(`download ${filename}`);
        return new Promise<{ success: boolean }>((resolve) => pending.set(filename, resolve));
      }),
      cancelDownload: vi.fn(async (filename: string) => {
        order.push(`cancel ${filename}`);
        pending.get(filename)?.({ success: false });
        return { success: true };
      }),
      deleteModel: vi.fn(async () => true),
    },
    onboarding: {
      start: vi.fn(async () => ({ success: true, record: null })),
      complete: vi.fn(async (setupPath: string) => ({ success: true, record: { version: 1, status: "done", path: setupPath } })),
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return { api, order, finish: (filename: string) => pending.get(filename)?.({ success: true }) };
}

function Harness({
  language = "en",
  onFinish,
  onSettings,
}: {
  language?: string;
  onFinish: (model: string, outcome: SetupOutcome) => void;
  onSettings?: (settings: AppSettings) => void;
}) {
  const [settings, setSettings] = useState<AppSettings>({ ...defaultSettings, language });
  const download = useFirstDownload(window.electronAPI);
  onSettings?.(settings);
  return (
    <Onboarding
      settings={settings}
      onUpdateSettings={(patch) => setSettings((previous) => ({ ...previous, ...patch }))}
      download={download}
      onFinish={onFinish}
    />
  );
}

const continueButton = (t = en) => screen.getByRole("button", { name: t("onbContinue") }) as HTMLButtonElement;

async function toLocalStep(t = en) {
  fireEvent.click(continueButton(t));
  await screen.findByRole("heading", { name: t("onbAppearanceTitle") });
  fireEvent.click(continueButton(t));
  await screen.findByRole("heading", { name: t("onbModelTitle") });
}

beforeEach(() => {
  localStorage.setItem("draggy_settings", "{}");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("the setup's screens", () => {
  it("walks welcome, appearance and the model in English, each allowed on only when it may be", async () => {
    const { api } = freshMachine();
    render(<Harness onFinish={() => {}} />);

    expect(await screen.findByRole("heading", { name: en("onbWelcomeTitle") })).toBeTruthy();
    expect(continueButton().disabled).toBe(false);
    expect(api.onboarding.start).toHaveBeenCalled();

    await toLocalStep();
    expect(await screen.findByText(/NVIDIA GeForce RTX 4070/)).toBeTruthy();
    expect(screen.getByText(en("onbRecommended"))).toBeTruthy();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
  });

  it("speaks Japanese throughout when Japanese is chosen", async () => {
    freshMachine();
    render(<Harness language="ja" onFinish={() => {}} />);

    expect(await screen.findByRole("heading", { name: ja("onbWelcomeTitle") })).toBeTruthy();
    await toLocalStep(ja);
    expect(await screen.findByText(ja("onbRecommended"))).toBeTruthy();
    expect(screen.getByRole("button", { name: ja("onbSkip") })).toBeTruthy();
  });

  it("keeps the model step closed offline, and says why", async () => {
    freshMachine({ online: false });
    render(<Harness onFinish={() => {}} />);
    await toLocalStep();

    expect(await screen.findByText(en("onbOffline"))).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });
});

describe("nothing downloads before the user chooses", () => {
  it("starts neither the engine nor a model until Continue on the model step", async () => {
    const { api } = freshMachine();
    render(<Harness onFinish={() => {}} />);
    await toLocalStep();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(api.gguf.downloadModel).not.toHaveBeenCalled();
    expect(api.gguf.setupEngine).not.toHaveBeenCalled();
    expect(api.resolveModelUrl).not.toHaveBeenCalled();

    fireEvent.click(continueButton());
    await waitFor(() => expect(api.gguf.downloadModel).toHaveBeenCalledTimes(1));
  });

  it("cancels the first download before starting a different choice", async () => {
    const { order } = freshMachine();
    render(<Harness onFinish={() => {}} />);
    await toLocalStep();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    await waitFor(() => expect(order).toContain("download Ministral-3-14B-Instruct-2512-GGUF.gguf"));

    fireEvent.click(screen.getByRole("button", { name: en("onbBack") }));
    await screen.findByRole("heading", { name: en("onbModelTitle") });
    fireEvent.click(await screen.findByRole("radio", { name: /Gemma 4 12B/ }));
    fireEvent.click(continueButton());
    await waitFor(() => expect(order).toContain("download gemma-4-12b-it-GGUF.gguf"));

    const cancelled = order.indexOf("cancel Ministral-3-14B-Instruct-2512-GGUF.gguf");
    expect(cancelled).toBeGreaterThan(-1);
    expect(cancelled).toBeLessThan(order.indexOf("download gemma-4-12b-it-GGUF.gguf"));
  });
});

describe("finishing", () => {
  it("opens Start once the download is under way, leaving the record to the app", async () => {
    const { api } = freshMachine();
    const onFinish = vi.fn();
    render(<Harness onFinish={onFinish} />);
    await toLocalStep();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: en("onbPrefsTitle") });
    fireEvent.click(continueButton());

    await screen.findByRole("heading", { name: en("onbReadyTitle") });
    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    await waitFor(() => expect(api.gguf.downloadModel).toHaveBeenCalled());
    await waitFor(() => expect(start.disabled).toBe(false));
    expect(screen.getByText(en("onbReadyWaiting"))).toBeTruthy();

    fireEvent.click(start);
    await waitFor(() =>
      expect(onFinish).toHaveBeenCalledWith("Ministral-3-14B-Instruct-2512-GGUF.gguf", expect.objectContaining({ path: "local" })),
    );
    // Written by the app once the model is on disk, or a quit now would skip the setup next time.
    expect(api.onboarding.complete).not.toHaveBeenCalled();
  });

  it("runs the splash's own setup on Skip, and records it as skipped", async () => {
    const { api } = freshMachine({ installed: ["have.gguf"] });
    const onFinish = vi.fn();
    render(<Harness onFinish={onFinish} />);
    await screen.findByRole("heading", { name: en("onbWelcomeTitle") });

    fireEvent.click(screen.getByRole("button", { name: en("onbSkip") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(en("onbSkipBodyInstalled"))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: en("onbSkipConfirm") }));

    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("have.gguf", expect.objectContaining({ path: "skipped" })), {
      timeout: 4000,
    });
    expect(api.onboarding.complete).toHaveBeenCalledWith("skipped");
    expect(api.gguf.downloadModel).not.toHaveBeenCalled();
  });

  it("names the download and its size before a Skip starts one", async () => {
    freshMachine();
    render(<Harness onFinish={() => {}} />);
    await screen.findByRole("heading", { name: en("onbWelcomeTitle") });
    fireEvent.click(screen.getByRole("button", { name: en("onbSkip") }));
    const dialog = await screen.findByRole("dialog");
    // The size arrives isolated, so an Arabic sentence cannot reorder "8.2 GB".
    expect(within(dialog).getByText(/about ⁨8\.2 GB⁩/)).toBeTruthy();
  });
});

describe("the appearance cards", () => {
  it("draw each theme in the colours of src/index.css", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "index.css"), "utf8");
    const light = css.slice(css.indexOf(":root"), css.indexOf("body.dark"));
    const dark = css.slice(css.indexOf("body.dark"), css.indexOf("@layer"));
    const tokens = { base: "--bg-base", panel: "--bg-panel", input: "--bg-input", inverted: "--bg-inverted", border: "--border-light", muted: "--text-muted" };
    for (const [key, token] of Object.entries(tokens)) {
      expect(light, token).toContain(`${token}: ${THEME_PALETTES.light[key as keyof typeof tokens]};`);
      expect(dark, token).toContain(`${token}: ${THEME_PALETTES.dark[key as keyof typeof tokens]};`);
    }
  });
});

describe("from the setup into the app", () => {
  it("lands in the app on Start, and a reload would no longer open the setup", async () => {
    installFakeElectronApi();
    const fake = window.electronAPI as unknown as Record<string, unknown>;
    const machine = freshMachine();
    const parts = machine.api as unknown as Record<string, unknown>;
    for (const key of Object.keys(parts)) fake[key] = parts[key];
    (window as unknown as { electronAPI: unknown }).electronAPI = fake;
    const configure = vi.fn(async () => ({}));
    (fake.updater as { configure: unknown }).configure = configure;
    window.history.pushState(null, "", "/?onboarding=true");

    render(<App />);
    await screen.findByRole("heading", { name: en("onbWelcomeTitle") });
    await toLocalStep();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: en("onbPrefsTitle") });
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: en("onbReadyTitle") });
    // No update check, app or engine, may be scheduled before the user has chosen.
    expect(configure).not.toHaveBeenCalled();
    await waitFor(() => expect(machine.api.gguf.downloadModel).toHaveBeenCalled());
    machine.finish("Ministral-3-14B-Instruct-2512-GGUF.gguf");
    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: en("onbReadyTitle") })).toBeNull();
    expect(window.location.search).toBe("");
    expect(machine.api.onboarding.complete).toHaveBeenCalledWith("local");
    await waitFor(() => expect(configure).toHaveBeenCalledWith(expect.objectContaining({ automatic: true })));
  });
});

describe("running the setup again", () => {
  it("asks first, then has main reopen the setup", async () => {
    const fake = installFakeElectronApi();
    render(<GeneralPage settings={defaultSettings} onUpdate={() => {}} t={en} />);

    fireEvent.click(screen.getByRole("button", { name: en("onbRunAgainButton") }));
    const dialog = await screen.findByRole("dialog");
    expect(fake.resets).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: en("onbRunAgainConfirm") }));
    await waitFor(() => expect(fake.resets).toBe(1));
  });
});

describe("the preferences step", () => {
  async function toPreferences() {
    await toLocalStep();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: en("onbPrefsTitle") });
  }

  it("writes each preference where the app reads it", async () => {
    freshMachine();
    let latest = defaultSettings;
    render(<Harness onFinish={() => {}} onSettings={(settings) => (latest = settings)} />);
    await toPreferences();

    expect(screen.queryByRole("radiogroup", { name: en("onbPermissionTitle") })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: en("codeMode") }));
    expect(localStorage.getItem("draggy_mode")).toBe("code");
    const permissions = screen.getByRole("radiogroup", { name: en("onbPermissionTitle") });
    fireEvent.click(within(permissions).getAllByRole("radio")[0]);
    expect(latest.codePermissionMode).not.toBe("acceptEdits");

    fireEvent.click(screen.getByRole("switch", { name: en("onbUpdates") }));
    expect(latest.autoUpdate).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: en("onbMore") }));
    fireEvent.click(screen.getByRole("switch", { name: en("showMetrics") }));
    expect(latest.showMetrics).toBe(true);
    expect(latest.metricsChosen).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: en("high") }));
    expect(latest.thinkingMode).toBe("high");
  });

  it("queues a ticked extra behind the model", async () => {
    const { api, order, finish } = freshMachine();
    const onFinish = vi.fn();
    render(<Harness onFinish={onFinish} />);
    await toPreferences();

    fireEvent.click(screen.getByRole("checkbox", { name: en("onbExtraVoice") }));
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: en("onbReadyTitle") });
    await waitFor(() => expect(api.gguf.downloadModel).toHaveBeenCalled());
    expect(order.filter((entry) => entry.startsWith("download"))).toEqual(["download Ministral-3-14B-Instruct-2512-GGUF.gguf"]);

    finish("Ministral-3-14B-Instruct-2512-GGUF.gguf");
    // A 12 GB card gets Gemma 4 12B for voice.
    await waitFor(() => expect(order).toContain("download gemma-4-12b-it-GGUF.gguf"));
  });
});

describe("an extra still downloading at Start", () => {
  it("is taken on by the app's own downloads", async () => {
    installFakeElectronApi();
    const fake = window.electronAPI as unknown as Record<string, unknown>;
    const machine = freshMachine();
    const parts = machine.api as unknown as Record<string, unknown>;
    for (const key of Object.keys(parts)) fake[key] = parts[key];
    (window as unknown as { electronAPI: unknown }).electronAPI = fake;
    window.history.pushState(null, "", "/?onboarding=true");

    render(<App />);
    await screen.findByRole("heading", { name: en("onbWelcomeTitle") });
    await toLocalStep();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: en("onbPrefsTitle") });
    fireEvent.click(screen.getByRole("checkbox", { name: en("onbExtraVoice") }));
    fireEvent.click(continueButton());
    await screen.findByRole("heading", { name: en("onbReadyTitle") });
    await waitFor(() => expect(machine.api.gguf.downloadModel).toHaveBeenCalled());
    machine.finish("Ministral-3-14B-Instruct-2512-GGUF.gguf");
    await waitFor(() => expect(machine.order).toContain("download gemma-4-12b-it-GGUF.gguf"));

    fireEvent.click(screen.getByRole("button", { name: en("onbStart") }));
    expect(await screen.findByRole("button", { name: "Settings" })).toBeTruthy();
    // Asked for again by the model manager, which the main process joins to the transfer under way.
    await waitFor(() =>
      expect(machine.order.filter((entry) => entry === "download gemma-4-12b-it-GGUF.gguf")).toHaveLength(2),
    );
  });
});

/** The whole app on a new install, with the fake main process standing in for the real one. */
function freshApp() {
  installFakeElectronApi();
  const fake = window.electronAPI as unknown as Record<string, unknown>;
  const machine = freshMachine();
  const parts = machine.api as unknown as Record<string, unknown>;
  for (const key of Object.keys(parts)) fake[key] = parts[key];
  (window as unknown as { electronAPI: unknown }).electronAPI = fake;
  window.history.pushState(null, "", "/?onboarding=true");
  render(<App />);
  return machine;
}

async function toReady() {
  await screen.findByRole("heading", { name: en("onbWelcomeTitle") });
  await toLocalStep();
  await waitFor(() => expect(continueButton().disabled).toBe(false));
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: en("onbPrefsTitle") });
  fireEvent.click(continueButton());
  await screen.findByRole("heading", { name: en("onbReadyTitle") });
}

describe("entering the app while the model downloads", () => {
  it("shows the download, holds the first message, and sends it once the model lands", async () => {
    const machine = freshApp();
    await toReady();
    await waitFor(() => expect(machine.api.gguf.downloadModel).toHaveBeenCalled());
    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);

    const composer = (await screen.findByPlaceholderText(en("onbStillDownloading"))) as HTMLTextAreaElement;
    expect(screen.getByText("Ministral-3-14B-Instruct-2512-GGUF.gguf", { selector: "[aria-live] *" })).toBeTruthy();
    fireEvent.change(composer, { target: { value: "Hello" } });
    const send = composer.closest("form")!.querySelector("button[type=submit]") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(machine.api.onboarding.complete).not.toHaveBeenCalled();

    machine.finish("Ministral-3-14B-Instruct-2512-GGUF.gguf");
    await waitFor(() => expect(screen.queryByPlaceholderText(en("onbStillDownloading"))).toBeNull());
    expect(screen.queryByText("Ministral-3-14B-Instruct-2512-GGUF.gguf", { selector: "[aria-live] *" })).toBeNull();
    expect((composer.closest("form")!.querySelector("button[type=submit]") as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(machine.api.onboarding.complete).toHaveBeenCalledWith("local"));
  });

  it("puts a suggested prompt in the composer, not sent", async () => {
    const machine = freshApp();
    await toReady();
    await waitFor(() => expect(machine.api.gguf.downloadModel).toHaveBeenCalled());
    machine.finish("Ministral-3-14B-Instruct-2512-GGUF.gguf");
    const chip = screen.getByRole("button", { name: en("onbPrompt2") }) as HTMLButtonElement;
    await waitFor(() => expect(chip.disabled).toBe(false));
    fireEvent.click(chip);

    const composer = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    await waitFor(() => expect(composer.value).toBe(en("onbPrompt2")));
    expect(localStorage.getItem("draggy_mode")).toBe("chat");
    expect(screen.queryByText(en("onbPrompt2"), { selector: ".markdown-body *" })).toBeNull();
  });
});
