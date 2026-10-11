// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Transcript } from "../chat/Transcript";
import { JUMP_LIST_MIN_PROMPTS } from "../chat/PromptJumpList";
import { translations } from "../translations";
import type { AppSettings, ChatSession } from "../types";

/** Past twenty prompts, the transcript's end edge lists them, and each one jumps to its turn. */

afterEach(cleanup);

const t = (key: string) => translations.en[key] || key;

const session = (turns: number): ChatSession => ({
  id: "c",
  title: "Long",
  updatedAt: 0,
  isGenerating: false,
  messages: Array.from({ length: turns }, (_, index) => [
    { id: `u${index}`, role: "user" as const, content: `Question ${index + 1}` },
    { id: `a${index}`, role: "assistant" as const, content: `Answer ${index + 1}` },
  ]).flat(),
});

const show = (turns: number) =>
  render(
    <Transcript
      chat={session(turns)}
      copiedIndex={null}
      settings={{ language: "en" } as AppSettings}
      onRegenerate={() => {}}
      onSwitchVersion={() => {}}
      onEditMessage={() => {}}
      copyToClipboard={async () => {}}
      t={t}
    />,
  );

describe("the prompt jump list", () => {
  it("stays out of a short session", () => {
    show(JUMP_LIST_MIN_PROMPTS - 1);
    expect(screen.queryByRole("navigation", { name: "Your prompts" })).toBeNull();
  });

  it("lists every prompt and scrolls to the one picked", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollTo = scrolled as unknown as typeof Element.prototype.scrollTo;
    show(JUMP_LIST_MIN_PROMPTS);

    const list = screen.getByRole("navigation", { name: "Your prompts" });
    const ticks = list.querySelectorAll("button");
    expect(ticks).toHaveLength(JUMP_LIST_MIN_PROMPTS);
    expect(ticks[JUMP_LIST_MIN_PROMPTS - 1].getAttribute("aria-current")).toBe("location");

    fireEvent.click(screen.getByRole("button", { name: "3. Question 3" }));
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    expect(ticks[2].getAttribute("aria-current")).toBe("location");
  });
});
