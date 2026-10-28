// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Transcript } from "../chat/Transcript";
import { ComposerQueueContext, type ComposerQueue } from "../chat/Composer";
import { defaultSettings } from "../app/settings";
import { translations } from "../translations";
import type { ChatSession, SearchStep } from "../types";

/** Scrolling up while the turn waits on an approval must not lose the question. */

const t = (key: string) => translations.en[key] || key;

const approval: SearchStep = {
  id: "step-1",
  type: "approval",
  content: "Needs your approval",
  isComplete: false,
  approval: { id: "step-1", tool: "write_file", target: "notes.md", reason: "Writes a file." },
};

const chatWith = (steps: SearchStep[]): ChatSession =>
  ({
    id: "c1",
    title: "Chat",
    isGenerating: true,
    messages: [
      { id: "u1", role: "user", content: "Write the notes." },
      { id: "a1", role: "assistant", content: "", steps },
    ],
  }) as unknown as ChatSession;

const renderTranscript = (chat: ChatSession) =>
  render(
    <Transcript
      chat={chat}
      copiedIndex={null}
      settings={defaultSettings}
      onRegenerate={vi.fn()}
      onSwitchVersion={vi.fn()}
      onEditMessage={vi.fn()}
      onApproval={vi.fn()}
      copyToClipboard={vi.fn()}
      t={t}
    />,
  );

const scrollUp = (container: HTMLElement) =>
  fireEvent.wheel(container.querySelector(".overflow-y-auto")!, { deltaY: -100 });

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe("scrolling away from the latest turn", () => {
  it("offers a way back to the latest message", () => {
    const { container } = renderTranscript(chatWith([]));
    scrollUp(container);

    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeTruthy();
  });

  it("keeps a waiting approval in reach instead", () => {
    const { container } = renderTranscript(chatWith([approval]));
    scrollUp(container);

    expect(screen.getByRole("status").textContent).toContain("Needs your approval");
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Allow once" }));
  });

  it("drops the bar once the approval is answered", () => {
    const { container } = renderTranscript(chatWith([{ ...approval, answer: "once" }]));
    scrollUp(container);

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("marks scrolled away on scroll up event without pointer dragging", () => {
    const { container } = renderTranscript(chatWith([]));
    const scroller = container.querySelector(".overflow-y-auto") as HTMLDivElement;

    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 600, writable: true, configurable: true });

    fireEvent.scroll(scroller);

    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);

    const jumpBtn = screen.getByRole("button", { name: "Jump to latest" });
    expect(jumpBtn).toBeTruthy();

    fireEvent.click(jumpBtn);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("resets scroll position and jump button when switching chat sessions", () => {
    const { container, rerender } = renderTranscript(chatWith([]));
    scrollUp(container);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeTruthy();

    const otherChat = { ...chatWith([]), id: "c2" };
    rerender(
      <Transcript
        chat={otherChat}
        copiedIndex={null}
        settings={defaultSettings}
        onRegenerate={vi.fn()}
        onSwitchVersion={vi.fn()}
        onEditMessage={vi.fn()}
        onApproval={vi.fn()}
        copyToClipboard={vi.fn()}
        t={t}
      />,
    );

    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });
});

describe("a note added before the next turn", () => {
  const queueWith = (pendingSteers: string[], chatId = "c1"): ComposerQueue =>
    ({ chatId, queue: [], pendingSteers }) as unknown as ComposerQueue;

  const renderWith = (queue: ComposerQueue, chat = chatWith([])) =>
    render(
      <ComposerQueueContext.Provider value={queue}>
        <Transcript
          chat={chat}
          copiedIndex={null}
          settings={defaultSettings}
          onRegenerate={vi.fn()}
          onSwitchVersion={vi.fn()}
          onEditMessage={vi.fn()}
          onApproval={vi.fn()}
          copyToClipboard={vi.fn()}
          t={t}
        />
      </ComposerQueueContext.Provider>,
    );

  it("shows in the transcript as sent while the turn runs", () => {
    renderWith(queueWith(["use tabs"]));

    const note = screen.getByText("use tabs").parentElement!;
    expect(note.textContent).toContain("You added");
    expect(note.textContent).toContain("before the next turn");
  });

  it("stays out of another chat and out of a finished turn", () => {
    renderWith(queueWith(["use tabs"], "elsewhere"));
    expect(screen.queryByText("use tabs")).toBeNull();
    cleanup();

    renderWith(queueWith(["use tabs"]), { ...chatWith([]), isGenerating: false });
    expect(screen.queryByText("use tabs")).toBeNull();
  });
});
