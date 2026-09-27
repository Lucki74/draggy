// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import Onboarding from "../onboarding/Onboarding";
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

function Harness({ language = "en", onFinish }: { language?: string; onFinish: (model: string) => void }) {
  const [settings, setSettings] = useState<AppSettings>({ ...defaultSettings, language });
  return (
    <Onboarding
      settings={settings}
      onUpdateSettings={(patch) => setSettings((previous) => ({ ...previous, ...patch }))}
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
  it("opens Start once the model is on disk, and records the local path", async () => {
    const { api, finish } = freshMachine();
    const onFinish = vi.fn();
    render(<Harness onFinish={onFinish} />);
    await toLocalStep();
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());

    await screen.findByRole("heading", { name: en("onbReadyTitle") });
    const start = screen.getByRole("button", { name: en("onbStart") }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    await waitFor(() => expect(api.gguf.downloadModel).toHaveBeenCalled());
    finish("Ministral-3-14B-Instruct-2512-GGUF.gguf");
    await waitFor(() => expect(start.disabled).toBe(false));

    fireEvent.click(start);
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("Ministral-3-14B-Instruct-2512-GGUF.gguf"));
    expect(api.onboarding.complete).toHaveBeenCalledWith("local");
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

    await waitFor(() => expect(onFinish).toHaveBeenCalledWith("have.gguf"), { timeout: 4000 });
    expect(api.onboarding.complete).toHaveBeenCalledWith("skipped");
    expect(api.gguf.downloadModel).not.toHaveBeenCalled();
  });

  it("names the download and its size before a Skip starts one", async () => {
    freshMachine();
    render(<Harness onFinish={() => {}} />);
    await screen.findByRole("heading", { name: en("onbWelcomeTitle") });
    fireEvent.click(screen.getByRole("button", { name: en("onbSkip") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/about 8\.2 GB/)).toBeTruthy();
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
