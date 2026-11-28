// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { resolveRole, type KnownModels } from "../app/modelRoles";
import { loadSettings } from "../app/settings";
import { SETTINGS_KEY } from "../storage";

afterEach(() => localStorage.clear());

const known: KnownModels = {
  local: new Set(["chat:7b", "plan:8b", "small:1b"]),
  cloud: new Set(["@claude/opus"]),
};

describe("resolveRole", () => {
  it("falls back to the active model when a role is blank", () => {
    expect(resolveRole({ planModel: "", summaryModel: "   " }, "plan", "chat:7b", known)).toBe("chat:7b");
    expect(resolveRole({ planModel: "", summaryModel: "   " }, "summary", "chat:7b", known)).toBe("chat:7b");
  });

  it("uses an installed local plan model and a signed-in cloud summary model", () => {
    const settings = { planModel: "plan:8b", summaryModel: "@claude/opus" };
    expect(resolveRole(settings, "plan", "chat:7b", known)).toBe("plan:8b");
    expect(resolveRole(settings, "summary", "chat:7b", known)).toBe("@claude/opus");
  });

  it("never swaps the loaded local engine for a summary", () => {
    expect(resolveRole({ planModel: "", summaryModel: "small:1b" }, "summary", "chat:7b", known)).toBe("chat:7b");
  });

  it("falls back when a saved model is deleted or its provider is signed out", () => {
    expect(resolveRole({ planModel: "gone:1b", summaryModel: "" }, "plan", "chat:7b", known)).toBe("chat:7b");
    expect(resolveRole({ planModel: "@openai/gpt", summaryModel: "" }, "plan", "chat:7b", known)).toBe("chat:7b");
  });

  it("trusts saved values until the installed and signed-in lists load", () => {
    expect(resolveRole({ planModel: "gone:1b", summaryModel: "" }, "plan", "chat:7b", null)).toBe("gone:1b");
  });

  it("trims a stored value", () => {
    expect(resolveRole({ planModel: " plan:8b ", summaryModel: "" }, "plan", "x", known)).toBe("plan:8b");
  });
});

describe("1.x settings and role models", () => {
  it("loads a 1.x blob without the role keys and keeps its own values", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ modelName: "chat:7b", codeModel: "code:14b", theme: "dark" }));
    const loaded = loadSettings();
    expect(loaded.modelName).toBe("chat:7b");
    expect(loaded.codeModel).toBe("code:14b");
    expect(loaded.theme).toBe("dark");
    expect(loaded.planModel).toBe("");
    expect(loaded.summaryModel).toBe("");
  });

  it("keeps saved role models on the next load", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ modelName: "chat:7b", planModel: "plan:8b", summaryModel: "sum:3b" }));
    const loaded = loadSettings();
    expect(loaded.planModel).toBe("plan:8b");
    expect(loaded.summaryModel).toBe("sum:3b");
  });

  it("applies the Claude and ChatGPT renames to role models", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ planModel: "@claude/default", summaryModel: "@chatgpt/gpt-5.5" }));
    const loaded = loadSettings();
    expect(loaded.planModel).toBe("@claude/opus");
    expect(loaded.summaryModel).toBe("@chatgpt/gpt-6-astra");
  });

  it("resets a role model that is not text to blank", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ planModel: 5, summaryModel: null }));
    const loaded = loadSettings();
    expect(loaded.planModel).toBe("");
    expect(loaded.summaryModel).toBe("");
  });
});
