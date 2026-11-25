// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ShortcutsSheet } from "../ui/ShortcutsSheet";
import { CommandPalette, type PaletteItem } from "../ui/CommandPalette";
import { translations } from "../translations";

const t = (key: string) => translations.en[key] || key;

afterEach(cleanup);

describe("ShortcutsSheet", () => {
  it("renders when open and closes on close button", () => {
    const onClose = vi.fn();
    const { rerender } = render(<ShortcutsSheet open={false} onClose={onClose} t={t} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<ShortcutsSheet open onClose={onClose} t={t} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(t("keyboardShortcuts")).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(t("commandPalette"))).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: t("closeDialog") }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("CommandPalette", () => {
  const items: PaletteItem[] = [
    { id: "new-chat", label: "New discussion", category: "Actions", shortcut: "Ctrl+N", onSelect: vi.fn() },
    { id: "files", label: "Files", category: "Panes", shortcut: "Ctrl+Shift+F", onSelect: vi.fn() },
    { id: "diff", label: "Diff", category: "Panes", shortcut: "Ctrl+Shift+D", onSelect: vi.fn() },
  ];

  it("renders and filters items by typed query", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} items={items} t={t} />);

    expect(screen.getByText("New discussion")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.getByText("Diff")).toBeTruthy();

    const input = screen.getByRole("textbox", { name: t("commandPalettePlaceholder") });
    fireEvent.change(input, { target: { value: "files" } });

    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.queryByText("Diff")).toBeNull();
    expect(screen.queryByText("New discussion")).toBeNull();
  });

  it("selects and executes an item on click", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        items={[{ id: "1", label: "Run test", category: "Actions", onSelect }]}
        t={t}
      />,
    );

    fireEvent.click(screen.getByText("Run test"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows empty state when no commands match", () => {
    render(<CommandPalette open onClose={vi.fn()} items={items} initialQuery="xyznotfound" t={t} />);
    expect(screen.getByText(t("noCommandsFound"))).toBeTruthy();
  });
});

describe("Sidebar palette trigger", () => {
  it("renders palette button in search row and opens palette", async () => {
    const { Sidebar } = await import("../app/Sidebar");
    const onOpenPalette = vi.fn();
    render(
      <Sidebar
        mode="chat"
        codeHome={false}
        activeWorkspaceId="w1"
        projects={[]}
        runningSessionIds={[]}
        sessions={[]}
        t={t}
        onSwitchMode={vi.fn()}
        onNewChat={vi.fn()}
        onNewProject={vi.fn()}
        onSelectChat={vi.fn()}
        onDeleteChat={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onRemoveWorkspace={vi.fn()}
        open={true}
        onToggleOpen={vi.fn()}
        onOpenPalette={onOpenPalette}
      />,
    );
    const trigger = screen.getByRole("button", { name: new RegExp(`^${t("search")}`) });
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });
});
