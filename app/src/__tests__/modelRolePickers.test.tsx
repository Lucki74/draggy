// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ModelsPage from "../settings/ModelsPage";
import type { ModelManager } from "../settings/useModelManager";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import { clearFakeDraggyApi, installFakeDraggyApi } from "./helpers/draggyApi";

const t = (key: string) => translations.en[key] || key;

const manager: ModelManager = {
  installed: [],
  loaded: [],
  refresh: vi.fn(),
  pulls: [],
  startPull: vi.fn(async () => true),
  cancelPull: vi.fn(),
  remove: vi.fn(async () => true),
  unload: vi.fn(async () => undefined),
  error: "",
  vram: 0,
  unifiedMemory: false,
};

beforeEach(() => {
  installFakeDraggyApi();
  (window as unknown as { draggy: Record<string, unknown> }).draggy.searchModels = async () => ({ success: true, models: [] });
});

afterEach(() => {
  cleanup();
  clearFakeDraggyApi();
});

describe("model role pickers", () => {
  it("shows both role rows with the same-as-chat choice when no role is set", () => {
    const onUpdate = vi.fn();
    render(<ModelsPage manager={manager} settings={defaultSettings} chatModel="" onUpdate={onUpdate} t={t} />);
    expect(screen.getByText(t("modelRoles"))).toBeTruthy();
    expect(screen.getByText(t("planModel"))).toBeTruthy();
    expect(screen.getByText(t("summaryModel"))).toBeTruthy();
    expect(screen.getByText(t("planModelHint"))).toBeTruthy();
    expect(screen.getAllByText(t("sameAsActiveModel")).length).toBeGreaterThan(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("renders with a saved role model without changing settings", () => {
    const onUpdate = vi.fn();
    const settings = { ...defaultSettings, planModel: "plan:8b", summaryModel: "sum:3b" };
    render(<ModelsPage manager={manager} settings={settings} chatModel="chat:7b" onUpdate={onUpdate} t={t} />);
    expect(screen.getByText(t("summaryModelHint"))).toBeTruthy();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("keeps a saved role model that is gone visible as unavailable", () => {
    const settings = { ...defaultSettings, planModel: "gone:1b" };
    render(<ModelsPage manager={manager} settings={settings} chatModel="chat:7b" onUpdate={vi.fn()} t={t} />);
    expect(screen.getByText("gone:1b (unavailable)")).toBeTruthy();
  });
});
