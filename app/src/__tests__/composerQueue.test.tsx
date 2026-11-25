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
  it("Enter hands the text to the running turn instead of stopping", () => {
    const queue = queueFixture();
    const onSendMessage = vi.fn();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating attachedFiles={[]} onSendMessage={onSendMessage} />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.change(field(), { target: { value: "next thing" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(queue.steer).toHaveBeenCalledWith("next thing");
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(field().value).toBe("");
  });

  it("Ctrl+Enter queues the text for after the turn", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating attachedFiles={[]} />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.change(field(), { target: { value: "later thing" } });
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });

    expect(queue.enqueue).toHaveBeenCalledWith("later thing", []);
    expect(queue.steer).not.toHaveBeenCalled();
  });

  it("Enter with attached files falls back to the queue, since a steer note carries none", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.change(field(), { target: { value: "look at this" } });
    fireEvent.keyDown(field(), { key: "Enter" });

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

  it("keeps the Stop button and names the three keys", () => {
    render(
      <ComposerQueueContext.Provider value={queueFixture()}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    expect(screen.getByRole("button", { name: /^Stop/ })).toBeTruthy();
    expect(screen.getByText("Ctrl+Shift+Enter").parentElement?.textContent).toContain("send now");
    expect(screen.getByText("Ctrl+Enter").parentElement?.textContent).toContain("queue");
    expect(screen.getByText("Enter").parentElement?.textContent).toContain("next turn");
  });

  it("renders each queued message with its controls", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    expect(screen.getByText("first note")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Send now" })[1]);
    expect(queue.sendQueuedNow).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getAllByRole("button", { name: "Remove from queue" })[1]);
    expect(queue.removeQueued).toHaveBeenCalledWith("b");
  });
});

describe("Queue card", () => {
  it("Alt+ArrowDown on a focused row moves it one place", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    const row = screen.getByText("first note").closest("li") as HTMLElement;
    fireEvent.keyDown(row, { key: "ArrowDown", altKey: true });

    expect(queue.moveQueued).toHaveBeenCalledWith("a", 1);
  });

  it("dropping a row on another moves it by the distance between them", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    const first = screen.getByText("first note").closest("li") as HTMLElement;
    const second = screen.getByText("second note").closest("li") as HTMLElement;
    fireEvent.dragStart(first);
    fireEvent.drop(second);

    expect(queue.moveQueued).toHaveBeenCalledWith("a", 1);
  });

  it("Clear removes every queued message", () => {
    const queue = queueFixture();
    render(
      <ComposerQueueContext.Provider value={queue}>
        <ComposerPreview generating />
      </ComposerQueueContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(queue.removeQueued).toHaveBeenCalledWith("a");
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
    expect(screen.queryByText("Ctrl+Enter")).toBeNull();
  });
});
