// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComposerQueueContext, type ComposerQueue } from "../chat/Composer";
import { ComposerPreview } from "../ui/gallery/ComposerPreview";

afterEach(cleanup);

function queueFixture(): ComposerQueue {
  return {
    chatId: "preview",
    queue: [
      { id: "a", content: "first note" },
      { id: "b", content: "second note" },
    ],
    enqueue: vi.fn(),
    steer: vi.fn(),
    sendNow: vi.fn(),
    editQueued: vi.fn(),
    removeQueued: vi.fn(),
    moveQueued: vi.fn(),
    sendQueuedNow: vi.fn(),
  };
}

function field(): HTMLTextAreaElement {
  const node = document.querySelector<HTMLTextAreaElement>("form textarea");
  if (!node) throw new Error("composer field missing");
  return node;
}

describe("Composer while a reply generates", () => {
  it("Enter queues the text instead of stopping", () => {
    const queue = queueFixture();
    const onSendMessage = vi.fn();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating onSendMessage={onSendMessage} />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.change(field(), { target: { value: "next thing" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(queue.enqueue).toHaveBeenCalledWith("next thing", expect.any(Array));
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(field().value).toBe("");
  });

  it("Ctrl+Enter with attached files falls back to the queue, since a steer note carries none", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.change(field(), { target: { value: "look at this" } });
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });

    expect(queue.steer).not.toHaveBeenCalled();
    expect(queue.enqueue).toHaveBeenCalledWith("look at this", [{ name: "screenshot.png", type: "image/png" }]);
  });

  it("Ctrl+Shift+Enter sends now with its attachments", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.change(field(), { target: { value: "right now" } });
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true, shiftKey: true });

    expect(queue.sendNow).toHaveBeenCalledWith("right now", [{ name: "screenshot.png", type: "image/png" }]);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("keeps the Stop button and shows the queue hint", () => {
    render(
      <ComposerQueueContext.Provider value={queueFixture()}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    expect(screen.getByRole("button", { name: /^Stop/ })).toBeTruthy();
    expect(screen.getByText(/Enter queues/)).toBeTruthy();
  });

  it("renders each queued message with its controls", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    expect(screen.getByText("first note")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    expect(queue.moveQueued).toHaveBeenCalledWith("a", 1);
    fireEvent.click(screen.getAllByRole("button", { name: "Send now" })[1]);
    expect(queue.sendQueuedNow).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getAllByRole("button", { name: "Remove from queue" })[1]);
    expect(queue.removeQueued).toHaveBeenCalledWith("b");
  });
});

describe("Composer queue editing", () => {
  it("ArrowUp in an empty composer edits the last queued message, Enter saves", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.keyDown(field(), { key: "ArrowUp" });
    const editor = screen.getByRole("textbox", { name: "Edit" }) as HTMLTextAreaElement;
    expect(editor.value).toBe("second note");

    fireEvent.change(editor, { target: { value: "reworded" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(queue.editQueued).toHaveBeenCalledWith("b", "reworded");
    expect(screen.queryByRole("textbox", { name: "Edit" })).toBeNull();
  });

  it("Escape cancels an edit without saving", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const editor = screen.getByRole("textbox", { name: "Edit" });
    fireEvent.change(editor, { target: { value: "discarded" } });
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(queue.editQueued).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Edit" })).toBeNull();
    expect(screen.getByText("first note")).toBeTruthy();
  });

  it("ignores a queue bound to another chat", () => {
    render(
      <ComposerQueueContext.Provider value={{ ...queueFixture(), chatId: "elsewhere" }}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    expect(screen.queryByText("first note")).toBeNull();
    expect(screen.queryByText(/Enter queues/)).toBeNull();
  });
});
