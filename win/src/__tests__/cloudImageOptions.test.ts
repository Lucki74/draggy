// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { decodeImageChoice, encodeImageChoice, imageModelOptions } from "../images/cloudImageOptions";
import { migrateImageModel } from "../app/settings";

describe("image model migration", () => {
  it("turns a bare string into a local choice and keeps empty unset", () => {
    expect(migrateImageModel("flux-dev.gguf")).toEqual({ source: "local", model: "flux-dev.gguf" });
    expect(migrateImageModel("")).toEqual({ source: "local", model: "" });
    expect(migrateImageModel(undefined)).toEqual({ source: "local", model: "" });
  });

  it("keeps a saved cloud choice and drops a cloud choice with no provider", () => {
    expect(migrateImageModel({ source: "cloud", provider: "openai", model: "gpt-image-2.6-flare" })).toEqual({
      source: "cloud",
      provider: "openai",
      model: "gpt-image-2.6-flare",
    });
    expect(migrateImageModel({ source: "cloud", model: "x" })).toEqual({ source: "local", model: "x" });
  });
});

describe("image picker values", () => {
  it("round trips local and cloud choices, including model ids with colons", () => {
    const cloud = { source: "cloud" as const, provider: "openrouter", model: "google/gemini:free" };
    expect(decodeImageChoice(encodeImageChoice(cloud))).toEqual(cloud);
    const local = { source: "local" as const, model: "sdxl-turbo" };
    expect(decodeImageChoice(encodeImageChoice(local))).toEqual(local);
    expect(encodeImageChoice({ source: "local", model: "" })).toBe("");
  });
});

describe("imageModelOptions grouping", () => {
  it("lists automatic, then local models, then one group per connected provider", () => {
    const options = imageModelOptions({
      localModels: [{ id: "sdxl-turbo", label: "SDXL Turbo" }],
      cloud: [
        { id: "openai", name: "OpenAI", models: ["gpt-image-2.6-flare"] },
        { id: "together", name: "Together", models: ["black-forest-labs/FLUX.2-pro"] },
      ],
      automaticLabel: "Automatic",
      localLabel: "Local",
    });
    expect(options.map((option) => [option.label, option.group])).toEqual([
      ["Automatic", undefined],
      ["SDXL Turbo", "Local"],
      ["gpt-image-2.6-flare", "OpenAI"],
      ["black-forest-labs/FLUX.2-pro", "Together"],
    ]);
  });

  it("omits providers with no models", () => {
    const options = imageModelOptions({
      localModels: [],
      cloud: [{ id: "xai", name: "xAI", models: [] }],
      automaticLabel: "Automatic",
      localLabel: "Local",
    });
    expect(options).toHaveLength(1);
  });
});
