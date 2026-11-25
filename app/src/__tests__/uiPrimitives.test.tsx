// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
    Button,
    Chip,
    EmberCaret,
    EmptyState,
    Fuse,
    IconButton,
    Kbd,
    SegmentedControl,
    Skeleton,
    Spark,
    StatusDot,
} from "../ui";

describe("Button primitive", () => {
    it("renders primary variant with label and handles click", () => {
        const handleClick = vi.fn();
        render(<Button onClick={handleClick}>Continue</Button>);
        const btn = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
        expect(btn).toBeTruthy();
        expect(btn.className).toContain("bg-action-bg");
        fireEvent.click(btn);
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("renders secondary and danger variants", () => {
        const { rerender } = render(<Button variant="secondary">Cancel</Button>);
        expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("border-rule-control");

        rerender(<Button variant="danger">Deny</Button>);
        expect(screen.getByRole("button", { name: "Deny" }).className).toContain("text-danger");
    });

    it("displays loading spinner and marks aria-busy when loading", () => {
        render(<Button loading>Saving</Button>);
        const btn = screen.getByRole("button", { name: "Saving" }) as HTMLButtonElement;
        expect(btn.getAttribute("aria-busy")).toBe("true");
        expect(btn.disabled).toBe(true);
    });
});

describe("IconButton primitive", () => {
    it("enforces accessible label and includes shortcut metadata", () => {
        render(<IconButton name="magnifying-glass" label="Search" shortcut="Ctrl+K" />);
        const btn = screen.getByRole("button", { name: "Search (Ctrl+K)" });
        expect(btn).toBeTruthy();
        expect(btn.getAttribute("title")).toBe("Search (Ctrl+K)");
    });

    it("respects disabled state", () => {
        const handleClick = vi.fn();
        render(<IconButton name="trash" label="Delete" disabled onClick={handleClick} />);
        const btn = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        fireEvent.click(btn);
        expect(handleClick).not.toHaveBeenCalled();
    });
});

describe("Chip primitive", () => {
    it("renders label, count, and dropdown indicator", () => {
        render(<Chip label="Files" count={5} dropdown />);
        const chip = screen.getByRole("button", { name: /Files/ });
        expect(chip).toBeTruthy();
        expect(screen.getByText("5")).toBeTruthy();
    });

    it("handles selection and remove callbacks", () => {
        const handleDelete = vi.fn();
        render(<Chip label="React" selected onDelete={handleDelete} />);
        const chip = screen.getByRole("button", { name: /React/ });
        expect(chip.getAttribute("aria-pressed")).toBe("true");

        const removeBtn = screen.getByRole("button", { name: "Remove" });
        fireEvent.click(removeBtn);
        expect(handleDelete).toHaveBeenCalledTimes(1);
    });
});

describe("SegmentedControl primitive", () => {
    it("renders radio group and responds to arrow navigation", () => {
        const handleChange = vi.fn();
        const options = [
            { value: "chat", label: "Chat" },
            { value: "code", label: "Code" },
        ];

        render(<SegmentedControl options={options} value="chat" onChange={handleChange} ariaLabel="Mode" />);
        const group = screen.getByRole("radiogroup", { name: "Mode" });
        expect(group).toBeTruthy();

        const chatRadio = screen.getByRole("radio", { name: "Chat" });
        expect(chatRadio.getAttribute("aria-checked")).toBe("true");

        fireEvent.keyDown(chatRadio, { key: "ArrowRight" });
        expect(handleChange).toHaveBeenCalledWith("code");
    });
});

describe("StatusDot and Kbd primitives", () => {
    it("renders status dot with appropriate role and label", () => {
        render(<StatusDot status="ok" label="Ready" />);
        const dot = screen.getByRole("status", { name: "Ready" });
        expect(dot).toBeTruthy();
        expect(dot.className).toContain("bg-ok");
    });

    it("renders kbd shortcut hint", () => {
        render(<Kbd>Esc</Kbd>);
        expect(screen.getByText("Esc").tagName.toLowerCase()).toBe("kbd");
    });
});

describe("Signature ember primitives", () => {
    it("renders spark with status role when labeled", () => {
        const { container, rerender } = render(<Spark label="Working" />);
        expect(screen.getByRole("status", { name: "Working" })).toBeTruthy();

        rerender(<Spark />);
        expect(container.querySelector(".spark-dot")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("renders ember caret with aria-hidden", () => {
        const { container } = render(<EmberCaret />);
        expect(container.querySelector(".ember-caret")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("renders fuse progressbar in indeterminate and determinate modes", () => {
        const { rerender } = render(<Fuse label="Loading model" />);
        const progress = screen.getByRole("progressbar", { name: "Loading model" });
        expect(progress).toBeTruthy();
        expect(progress.querySelector(".fuse-indeterminate-head")).toBeTruthy();

        rerender(<Fuse progress={0.42} label="Loading model" />);
        expect(progress.getAttribute("aria-valuenow")).toBe("42");
        expect(progress.querySelector(".fuse-determinate")).toBeTruthy();
    });

    it("renders skeleton placeholder with aria-hidden", () => {
        const { container } = render(<Skeleton className="h-4 w-32" />);
        const el = container.firstElementChild;
        expect(el?.getAttribute("aria-hidden")).toBe("true");
        expect(el?.classList.contains("animate-pulse")).toBe(true);
    });

    it("renders empty state with message and optional action", () => {
        const handleAction = vi.fn();
        const { container, rerender } = render(<EmptyState message="No items found" />);
        expect(screen.getByText("No items found")).toBeTruthy();
        expect(container.querySelector("button")).toBeNull();

        rerender(
            <EmptyState
                message="No items found"
                actionLabel="Create one"
                onAction={handleAction}
            />
        );
        const button = container.querySelector("button");
        expect(button).toBeTruthy();
        fireEvent.click(button!);
        expect(handleAction).toHaveBeenCalledTimes(1);
    });
});

