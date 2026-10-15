// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog, Menu, Popover } from "../ui";

afterEach(cleanup);

function renderMenu(onPick = vi.fn()) {
    render(
        <Menu
            label="Mode"
            trigger={(props) => (
                <button type="button" {...props}>
                    Mode
                </button>
            )}
            items={[
                { type: "heading", id: "h", label: "Modes" },
                { id: "ask", label: "Ask", checked: false, onSelect: () => onPick("ask") },
                { id: "edit", label: "Accept edits", checked: true, onSelect: () => onPick("edit") },
                { type: "separator", id: "s" },
                { id: "off", label: "Off", disabled: true, onSelect: () => onPick("off") },
                { id: "plan", label: "Plan", checked: false, onSelect: () => onPick("plan") },
            ]}
        />,
    );
    return onPick;
}

describe("Menu", () => {
    it("opens on the checked choice and moves with arrow keys, skipping disabled items", () => {
        const onPick = renderMenu();
        const trigger = screen.getByRole("button", { name: "Mode" });
        fireEvent.click(trigger);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        const menu = screen.getByRole("menu", { name: "Mode" });
        expect(document.activeElement?.textContent).toContain("Accept edits");
        fireEvent.keyDown(menu, { key: "ArrowDown" });
        expect(document.activeElement?.textContent).toContain("Plan");
        fireEvent.keyDown(menu, { key: "ArrowDown" });
        expect(document.activeElement?.textContent).toContain("Ask");
        fireEvent.keyDown(menu, { key: "Enter" });
        fireEvent.click(document.activeElement as HTMLElement);
        expect(onPick).toHaveBeenCalledWith("ask");
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it("picks by digit and marks radio choices", () => {
        const onPick = renderMenu();
        fireEvent.click(screen.getByRole("button", { name: "Mode" }));
        const radios = screen.getAllByRole("menuitemradio");
        expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
        fireEvent.keyDown(screen.getByRole("menu"), { key: "3" });
        expect(onPick).toHaveBeenCalledWith("plan");
    });

    it("closes on Escape and returns focus to the trigger", () => {
        renderMenu();
        const trigger = screen.getByRole("button", { name: "Mode" });
        fireEvent.click(trigger);
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it("closes on a press outside", () => {
        renderMenu();
        fireEvent.click(screen.getByRole("button", { name: "Mode" }));
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole("menu")).toBeNull();
    });
});

describe("Popover", () => {
    it("renders its panel and hands children a close function", () => {
        render(
            <Popover
                label="Context"
                trigger={(props) => (
                    <button type="button" {...props}>
                        Usage
                    </button>
                )}
            >
                {(close) => (
                    <button type="button" onClick={close}>
                        Done
                    </button>
                )}
            </Popover>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Usage" }));
        expect(screen.getByRole("dialog", { name: "Context" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Done" }));
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

function DialogHarness() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Delete
            </button>
            <Dialog
                open={open}
                onClose={() => setOpen(false)}
                title="Delete “Fix the crash”?"
                description="This cannot be undone."
                closeLabel="Close"
                actions={
                    <>
                        <button type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </button>
                        <button type="button" data-autofocus>
                            Confirm
                        </button>
                    </>
                }
            />
        </>
    );
}

describe("Dialog", () => {
    it("moves focus in, traps Tab, closes on Escape and returns focus", () => {
        render(<DialogHarness />);
        const opener = screen.getByRole("button", { name: "Delete" });
        opener.focus();
        fireEvent.click(opener);
        const dialog = screen.getByRole("dialog", { name: "Delete “Fix the crash”?" });
        expect(dialog.getAttribute("aria-modal")).toBe("true");
        expect(document.activeElement?.textContent).toBe("Confirm");
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
        fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(opener);
    });
});
