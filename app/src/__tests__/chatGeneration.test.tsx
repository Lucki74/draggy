// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { sameGeneration, startingEffort, useChatGeneration } from "../app/useChatGeneration";
import type { ChatSession } from "../types";

// Each chat keeps the model and thinking level it was left on, and gets them back when reopened.

const chat = (id: string, generation?: ChatSession["generation"]): ChatSession => ({
  id,
  title: id,
  messages: [],
  updatedAt: 1,
  isGenerating: false,
  generation,
});

function open(session: ChatSession | undefined, over: Partial<Parameters<typeof useChatGeneration>[0]> = {}) {
  const calls = { applyEffort: vi.fn(), applyModel: vi.fn(), save: vi.fn() };
  const props = {
    ready: true,
    chatId: session?.id ?? "new",
    session,
    mode: "chat" as const,
    allowMaxInChat: true,
    effort: "medium" as const,
    model: "current:8b" as string | null,
    canUseModel: async () => true,
    ...calls,
    ...over,
  };
  const view = renderHook((p: typeof props) => useChatGeneration(p), { initialProps: props });
  return { ...calls, view, props };
}

describe("reopening a chat", () => {
  it("puts back the thinking level and the model it was left on", async () => {
    const { applyEffort, applyModel, save } = open(chat("a", { model: "old:70b", effort: "high" }));

    expect(applyEffort).toHaveBeenCalledWith("high");
    await waitFor(() => expect(applyModel).toHaveBeenCalledWith("old:70b"));
    expect(save).not.toHaveBeenCalled();
  });

  it("restores once per chat, so a later change in the composer is not undone", () => {
    const { applyEffort, view, props } = open(chat("a", { effort: "high" }));
    expect(applyEffort).toHaveBeenCalledTimes(1);

    view.rerender({ ...props, effort: "low" });
    expect(applyEffort).toHaveBeenCalledTimes(1);
  });

  it("restores again when another chat is opened", () => {
    const { applyEffort, view, props } = open(chat("a", { effort: "high" }));
    view.rerender({ ...props, chatId: "b", session: chat("b", { effort: "low" }) });

    expect(applyEffort).toHaveBeenLastCalledWith("low");
  });

  it("skips a model that is gone, and a level the mode does not allow", async () => {
    const { applyEffort, applyModel } = open(chat("a", { model: "gone:1b", effort: "max" }), {
      canUseModel: async () => false,
      allowMaxInChat: false,
    });

    await Promise.resolve();
    expect(applyEffort).not.toHaveBeenCalled();
    expect(applyModel).not.toHaveBeenCalled();
  });

  it("gives a chat that never had settings the ones in use", () => {
    const { save, applyEffort } = open(chat("old"));

    expect(save).toHaveBeenCalledWith("old", { model: "current:8b", effort: "medium" });
    expect(applyEffort).not.toHaveBeenCalled();
  });

  it("waits for a chat to exist before saving anything", () => {
    const { save } = open(undefined);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("where a new chat starts", () => {
  it("follows the rule the user picked", () => {
    expect(startingEffort("defaults", "max", "medium")).toBe("medium");
    expect(startingEffort("last", "max", "medium")).toBe("max");
  });

  it("compares only the model and the level", () => {
    expect(sameGeneration({ model: "a", effort: "low" }, { model: "a", effort: "low" })).toBe(true);
    expect(sameGeneration({ model: "a" }, { model: "b" })).toBe(false);
    expect(sameGeneration(null, undefined)).toBe(true);
  });
});
