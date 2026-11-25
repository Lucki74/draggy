import { describe, expect, it } from "vitest";
import {
  modelKey,
  modelOptions,
  resolveChoice,
  splitModelKey,
  usableProviders,
  voiceOptions,
  type CloudProvider,
} from "../settings/cloudChoice";

const providers: CloudProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    configured: true,
    models: [{ id: "gpt-4o-mini-tts", voices: ["alloy", "nova"] }],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    configured: false,
    models: [{ id: "gemini-3.8-flash-tts", voices: ["Kore"] }],
  },
  {
    id: "groq",
    name: "Groq",
    configured: true,
    models: [{ id: "canopylabs/orpheus-v1-english", voices: ["troy", "hannah"] }],
  },
];

describe("cloud voice choice", () => {
  it("lists only configured providers that have a model", () => {
    expect(usableProviders(providers).map((provider) => provider.id)).toEqual(["openai", "groq"]);
  });

  it("keeps a saved choice that still resolves", () => {
    expect(
      resolveChoice(providers, { provider: "groq", model: "canopylabs/orpheus-v1-english", voice: "hannah" }),
    ).toEqual({ provider: "groq", model: "canopylabs/orpheus-v1-english", voice: "hannah" });
  });

  it("migrates a legacy save with no model to the provider's first model", () => {
    expect(resolveChoice(providers, { provider: "openai", model: "", voice: "nova" })).toEqual({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice: "nova",
    });
  });

  it("clears a legacy free-text voice the model does not offer", () => {
    expect(resolveChoice(providers, { provider: "openai", model: "", voice: "Kore" })).toEqual({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice: "",
    });
  });

  it("moves a choice from a provider that lost its key to the first usable one", () => {
    expect(resolveChoice(providers, { provider: "gemini", model: "gemini-3.8-flash-tts", voice: "Kore" })).toEqual({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice: "",
    });
  });

  it("resolves to nothing when no provider can speak", () => {
    const none = providers.map((provider) => ({ ...provider, configured: false }));
    expect(resolveChoice(none, { provider: "openai", model: "gpt-4o-mini-tts", voice: "" }).provider).toBe("");
  });

  it("groups model names under their provider with the id as the option", () => {
    const options = modelOptions(providers);
    expect(options).toEqual([
      { id: "openai|gpt-4o-mini-tts", label: "gpt-4o-mini-tts", group: "OpenAI", groupType: "openai" },
      {
        id: "groq|canopylabs/orpheus-v1-english",
        label: "canopylabs/orpheus-v1-english",
        group: "Groq",
        groupType: "groq",
      },
    ]);
  });

  it("offers the automatic voice first, then the chosen model's voices", () => {
    const choice = { provider: "groq", model: "canopylabs/orpheus-v1-english", voice: "" };
    expect(voiceOptions(providers, choice, "Automatic").map((option) => option.id)).toEqual(["", "troy", "hannah"]);
  });

  it("splits a model option back into provider and model, even with slashes in the model", () => {
    const key = modelKey("groq", "canopylabs/orpheus-v1-english");
    expect(splitModelKey(key)).toEqual({ provider: "groq", model: "canopylabs/orpheus-v1-english" });
  });
});
