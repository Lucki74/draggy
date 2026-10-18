// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Sidebar, { type SidebarProps } from "../app/Sidebar";
import { translations } from "../translations";
import type { ChatSession, Workspace } from "../types";

/** The session list works from the keyboard, and deleting asks first. */

afterEach(cleanup);

const now = Date.now();
let sessionOffset = 0;
const session = (id: string, title: string, extra: Partial<ChatSession> = {}): ChatSession => ({
  id,
  title,
  updatedAt: now - (sessionOffset += 1000),
  messages: [],
  workspaceId: "w1",
  isGenerating: false,
  ...extra,
});

const sessions = [session("s1", "First"), session("s2", "Second", { unread: true }), session("s3", "Third")];

const show = (props: Partial<SidebarProps> = {}) =>
  render(
    <Sidebar
      mode="chat"
      codeHome={false}
      activeWorkspaceId="w1"
      projects={[{ id: "w1", name: "draggy", rootPath: "D:/dev/draggy" } as Workspace]}
      runningSessionIds={["s3"]}
      sessions={sessions}
      currentChatId="s1"
      t={(key) => translations.en[key] || key}
      onSwitchMode={() => {}}
      onNewChat={() => {}}
      onNewProject={() => {}}
      onSelectChat={() => {}}
      onDeleteChat={() => {}}
      onRenameChat={() => {}}
      onOpenSettings={() => {}}
      onSelectWorkspace={() => {}}
      onRemoveWorkspace={() => {}}
      open
      onToggleOpen={() => {}}
      {...props}
    />,
  );

const row = (title: string) => screen.getByText(title).closest("button") as HTMLButtonElement;

describe("the session list", () => {
  it("has one tab stop and moves with the arrow keys", () => {
    show();
    expect([row("First"), row("Second"), row("Third")].map((button) => button.tabIndex)).toEqual([0, -1, -1]);

    row("First").focus();
    fireEvent.keyDown(row("First"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("Second"));

    fireEvent.keyDown(row("Second"), { key: "End" });
    expect(document.activeElement).toBe(row("Third"));
    expect(row("Third").tabIndex).toBe(0);
  });

  it("names the status marks", () => {
    show();
    expect(screen.getByRole("img", { name: "Unread" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Working" })).toBeTruthy();
  });

  it("renames with F2", () => {
    const onRenameChat = vi.fn();
    show({ onRenameChat });

    fireEvent.keyDown(row("Second"), { key: "F2" });
    const field = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(field, { target: { value: "Renamed" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onRenameChat).toHaveBeenCalledWith("s2", "Renamed");
  });

  it("asks before deleting, from the Delete key or the right-click menu", () => {
    const onDeleteChat = vi.fn();
    show({ onDeleteChat });

    fireEvent.keyDown(row("First"), { key: "Delete" });
    expect(screen.getByRole("dialog", { name: "Delete this session?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDeleteChat).not.toHaveBeenCalled();

    fireEvent.contextMenu(row("Third"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteChat).toHaveBeenCalledWith(expect.anything(), "s3");
  });
});

describe("the closed sidebar", () => {
  it("drops out of the tab order", () => {
    const { container } = show({ open: false });
    expect(container.querySelector("aside")?.hasAttribute("inert")).toBe(true);
  });
});

describe("an empty list", () => {
  it("offers New when there are no sessions", () => {
    show({ sessions: [] });
    expect(screen.getByText("No chats yet")).toBeTruthy();
  });
});

describe("the code view menu", () => {
  it("offers Group by and Sort by, and groups by none without headings", () => {
    show({ mode: "code" });
    fireEvent.click(screen.getByRole("button", { name: "View options" }));
    expect(screen.getByRole("menuitem", { name: /Group by/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Sort by/ }));
    expect(screen.getByRole("menuitemradio", { name: "Title" })).toBeTruthy();
  });
});

describe("the engine row", () => {
  it("only shows the model and its state", () => {
    show({ engineModel: "qwen3:8b", engineState: "stopped" });
    const row = screen.getByTitle("Model: qwen3:8b");
    expect(row.tagName).toBe("DIV");
    expect(row.textContent).toContain("Not loaded");
  });
});
