// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ModelsPage from "../settings/ModelsPage";
import type { ModelManager } from "../settings/useModelManager";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";

const t = (key: string) => translations.en[key] || key;

const manager: ModelManager = {
  installed: [],
  loaded: [],
  refresh: vi.fn(),
  pulls: [],
  startPull: vi.fn(async () => true),
  cancelPull: vi.fn(),
  remove: vi.fn(async () => undefined),
  unload: vi.fn(async () => undefined),
  error: "",
  vram: 0,
  unifiedMemory: false,
};

const model = (name: string, capabilities: string[]) => ({
  name,
  repo: `someone/${name}-GGUF`,
  description: `${name} description`,
  capabilities,
  sizes: [],
});

beforeEach(() => {
  installFakeElectronApi();
});

afterEach(() => {
  cleanup();
  clearFakeElectronApi();
});

/** The tags on the result cards. The Chat button beside "Choose model" is not one of them. */
const tags = () => screen.queryAllByText("Chat").filter((node) => node.tagName === "SPAN");

async function renderWith(models: ReturnType<typeof model>[]) {
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.searchModels = async () => ({
    success: true,
    models,
  });

  render(
    <ModelsPage
      manager={manager}
      settings={defaultSettings}
      chatModel=""
      onUpdate={vi.fn()}
      t={t}
    />,
  );
  await screen.findByText(models[0].name, {}, { timeout: 3000 });
}

describe("model tags in the download list", () => {
  it("does not tag a chat model as Chat, since they all are", async () => {
    await renderWith([model("Llama-3", ["tools", "thinking", "completion"])]);

    const row = within(screen.getByRole("button", { name: /Llama-3/ }));
    expect(row.getByText("Tools")).toBeTruthy();
    expect(row.getByText("Thinking")).toBeTruthy();
    expect(tags()).toHaveLength(0);
  });

  it("says what a model that cannot chat is instead", async () => {
    await renderWith([
      model("FLUX", ["image-generation"]),
      model("bge", ["embedding"]),
      model("Mystery", ["other"]),
    ]);

    const rows = screen.getAllByRole("button", { expanded: false });
    for (const [name, tag] of [["FLUX", "Image generation"], ["bge", "Embedding"], ["Mystery", "Other"]]) {
      const row = rows.find((button) => button.textContent?.startsWith(name));
      expect(row && within(row).getByText(tag)).toBeTruthy();
    }
    expect(tags()).toHaveLength(0);
  });

  it("hides a model the app cannot run yet", async () => {
    await renderWith([
      model("Llama-3", ["completion"]),
      model("Whisper", ["speech-recognition"]),
      model("Kokoro", ["text-to-speech"]),
    ]);

    expect(screen.queryByText("Whisper")).toBeNull();
    expect(screen.queryByText("Kokoro")).toBeNull();
  });
});

describe("ability filters", () => {
  it("offers a chip for each ability in the results and keeps only the models that have it", async () => {
    await renderWith([model("Llama-3", ["tools", "completion"]), model("bge", ["embedding"])]);

    const chips = within(screen.getByRole("group", { name: "Filter by ability" }));
    expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual(["Tools", "Embedding"]);

    fireEvent.click(chips.getByRole("button", { name: "Embedding" }));
    expect(chips.getByRole("button", { name: "Embedding" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /Llama-3/ })).toBeNull();
    expect(screen.getByRole("button", { name: /bge/ })).toBeTruthy();
  });
});

describe("type labels", () => {
  // Every type the Hugging Face backend can produce needs a label in every language.
  const TYPES = [
    "embedding", "reranking", "image-generation", "video-generation", "3d-generation", "speech-recognition",
    "text-to-speech", "audio-generation", "audio-processing", "image-analysis", "video-analysis", "translation",
    "summarization", "question-answering", "fill-mask", "text-classification", "time-series", "tabular",
    "robotics", "graph", "other",
  ];

  it("has a translation for each type in every language", () => {
    const keyOf = (type: string) => "capability" + type.replace(/(^|-)([a-z0-9])/g, (_m, _d, c: string) => c.toUpperCase());

    for (const [language, table] of Object.entries(translations)) {
      for (const type of TYPES) {
        expect(table[keyOf(type)], `${language}: ${type}`).toBeTruthy();
      }
    }
  });
});

describe("removing an installed model", () => {
  it("asks for confirmation naming the model before removing", () => {
    const removeFn = vi.fn(async () => undefined);
    render(
      <ModelsPage
        manager={{
          ...manager,
          installed: [
            {
              name: "qwen3:8b",
              size: 4.5 * 1024 ** 3,
              parameterSize: "8B",
              family: "qwen",
              capabilities: ["tools"],
            },
          ],
          remove: removeFn,
        }}
        settings={defaultSettings}
        chatModel=""
        onUpdate={vi.fn()}
        t={t}
      />,
    );

    const removeBtn = screen.getByRole("button", { name: "Remove qwen3:8b" });
    fireEvent.click(removeBtn);
    expect(removeFn).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Remove.*qwen3:8b.*\?/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(removeFn).toHaveBeenCalledWith("qwen3:8b");
  });
});

