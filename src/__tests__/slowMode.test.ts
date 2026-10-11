// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { colibriEngine, isSlowModel, NOTIFY_AFTER_MS, shouldNotify, SLOW_TOOL_LOOPS, thinkingAllowed, toolLoopLimit } from "../slowMode";

const install = (slow: boolean, type = "colibri") => {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    providers: { list: vi.fn(async () => [{ id: "c1", type }]) },
    colibri: { status: vi.fn(async () => ({ engine: { slow } })) },
  };
};

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("slow model mode", () => {
  it("caps tool rounds only for slow models", () => {
    expect(toolLoopLimit(true, 75)).toBe(SLOW_TOOL_LOOPS);
    expect(toolLoopLimit(false, 75)).toBe(75);
  });

  it("keeps thinking off on a slow model until the setting turns it on", () => {
    expect(thinkingAllowed(true, { slowModelThinking: false })).toBe(false);
    expect(thinkingAllowed(true, { slowModelThinking: true })).toBe(true);
    expect(thinkingAllowed(false, { slowModelThinking: false })).toBe(true);
  });

  it("notifies only after a long slow turn", () => {
    expect(shouldNotify(true, NOTIFY_AFTER_MS)).toBe(true);
    expect(shouldNotify(true, NOTIFY_AFTER_MS - 1)).toBe(false);
    expect(shouldNotify(false, NOTIFY_AFTER_MS * 10)).toBe(false);
  });

  it("recognises a slow colibri model by its provider instance and the engine plan", async () => {
    install(true);
    expect(await isSlowModel("@c1/qwen")).toBe(true);
    install(false);
    expect(await isSlowModel("@c1/qwen")).toBe(false);
    install(true, "ollama");
    expect(await isSlowModel("@c1/qwen")).toBe(false);
    expect(await isSlowModel("local.gguf")).toBe(false);
    install(false);
    expect(await colibriEngine("@c1/qwen")).toEqual({ colibri: true, slow: false });
    install(false, "ollama");
    expect(await colibriEngine("@c1/qwen")).toEqual({ colibri: false, slow: false });
  });
});
