// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ChatHistory from "../ChatHistory";
import type { AppSettings, ChatSession } from "../types";

/** The row actions: exporting a conversation, and deleting one. */

const settings = { language: "en" } as unknown as AppSettings;

const chat: ChatSession = {
  id: "chat-1",
  title: "Tax questions",
  messages: [
    { id: "a", role: "user", content: "hello" },
    { id: "b", role: "assistant", content: "hi there" },
  ],
  updatedAt: 0,
  isGenerating: false,
};

function renderHistory(overrides: Partial<React.ComponentProps<typeof ChatHistory>> = {}) {
  const onExportChat = vi.fn();
  const onDeleteChat = vi.fn();
  const onSelectChat = vi.fn();

  render(
    <ChatHistory
      sessions={[chat]}
      onSelectChat={onSelectChat}
      onDeleteChat={onDeleteChat}
      onExportChat={onExportChat}
      settings={settings}
      {...overrides}
    />,
  );

  return { onExportChat, onDeleteChat, onSelectChat };
}

describe("the chat list", () => {
  afterEach(cleanup);

  it("offers an export on every conversation", () => {
    renderHistory();
    expect(screen.getByRole("button", { name: "Export as Markdown" })).toBeTruthy();
  });

  it("exports the row it was clicked on", () => {
    const { onExportChat } = renderHistory();

    screen.getByRole("button", { name: "Export as Markdown" }).click();

    expect(onExportChat).toHaveBeenCalledTimes(1);
    expect(onExportChat.mock.calls[0][1]).toBe("chat-1");
  });

  it("does not open the conversation it exports", () => {
    // Both buttons sit inside the row, which is itself clickable.
    const { onSelectChat, onExportChat } = renderHistory();

    screen.getByRole("button", { name: "Export as Markdown" }).click();

    expect(onExportChat).toHaveBeenCalled();
    expect(onSelectChat).not.toHaveBeenCalled();
  });

  it("keeps delete separate from export", () => {
    const { onDeleteChat, onExportChat } = renderHistory();

    screen.getByRole("button", { name: "Delete" }).click();

    expect(onDeleteChat).toHaveBeenCalledTimes(1);
    expect(onExportChat).not.toHaveBeenCalled();
  });
});
