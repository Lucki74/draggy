// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const slow = vi.hoisted(() => ({ models: new Set<string>() }));
vi.mock("../slowMode", () => ({ isSlowModel: async (model: string) => slow.models.has(model) }));

const { useSlowModel } = await import("../chat/useSlowModel");

describe("useSlowModel", () => {
  beforeEach(() => slow.models.clear());

  it("turns on for a slow model and off again when the model changes", async () => {
    slow.models.add("@colibri/glm");
    const { result, rerender } = renderHook(({ model }) => useSlowModel(model), { initialProps: { model: "@colibri/glm" } });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ model: "qwen3:8b" });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("stays off with no model", async () => {
    const { result } = renderHook(() => useSlowModel(""));
    await Promise.resolve();
    expect(result.current).toBe(false);
  });
});
