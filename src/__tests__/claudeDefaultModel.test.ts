// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";

afterEach(() => localStorage.clear());

describe("a Claude model saved as `default`", () => {
  it("opens as `opus`, the model it named, in Chat and Code, and leaves other providers' models alone", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ modelName: "@claude/default", codeModel: "@claude-2/default" }));
    expect(loadSettings()).toMatchObject({ modelName: "@claude/opus", codeModel: "@claude-2/opus" });

    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ modelName: "@openai/default", codeModel: "@claude/haiku" }));
    expect(loadSettings()).toMatchObject({ modelName: "@openai/default", codeModel: "@claude/haiku" });
  });
});

describe("a ChatGPT model saved as gpt-5.5", () => {
  it("opens as gpt-6-astra, Codex's first pick, and leaves the OpenAI key's gpt-5.5 alone", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ modelName: "@chatgpt/gpt-5.5", codeModel: "@openai/gpt-5.5" }));
    expect(loadSettings()).toMatchObject({ modelName: "@chatgpt/gpt-6-astra", codeModel: "@openai/gpt-5.5" });
  });
});
