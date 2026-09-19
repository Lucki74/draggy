// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
      onNavigate={vi.fn()}
      t={t}
    />,
  );
  await screen.findByText(models[0].name, {}, { timeout: 3000 });
}

describe("model tags in the download list", () => {
  it("does not tag a chat model as Chat, since they all are", async () => {
    await renderWith([model("Llama-3", ["tools", "thinking", "completion"])]);

    expect(screen.getByText("Tools")).toBeTruthy();
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(tags()).toHaveLength(0);
  });

  it("says what a model that cannot chat is instead", async () => {
    await renderWith([
      model("FLUX", ["image-generation"]),
      model("Whisper", ["speech-recognition"]),
      model("bge", ["embedding"]),
      model("Mystery", ["other"]),
    ]);

    expect(screen.getByText("Image generation")).toBeTruthy();
    expect(screen.getByText("Speech recognition")).toBeTruthy();
    expect(screen.getByText("Embedding")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
    expect(tags()).toHaveLength(0);
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
