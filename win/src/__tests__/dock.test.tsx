// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dock } from "../ui/dock/Dock";
import { PaneHeader } from "../ui/dock/PaneHeader";
import { translations } from "../translations";
import type { DockLayout } from "../app/dockLayout";

afterEach(cleanup);

const t = (key: string) => translations.en[key] || key;

describe("PaneHeader", () => {
  it("renders title, actions and close button", () => {
    const onClose = vi.fn();
    render(
      <PaneHeader
        title="index.ts"
        icon="file-code"
        actions={<button type="button">Save</button>}
        onClose={onClose}
        closeLabel="Close pane"
      />,
    );

    expect(screen.getByText("index.ts")).toBeTruthy();
    expect(screen.getByText("Save")).toBeTruthy();
    const closeBtn = screen.getByRole("button", { name: "Close pane" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Dock", () => {
  const baseLayout: DockLayout = {
    panes: ["plan", "file"],
    active: "file",
    width: 450,
    file: "main.ts",
    split: null,
  };

  it("renders tabs and the active pane content", () => {
    const onSelectPane = vi.fn();
    const onClosePane = vi.fn();
    const onMovePane = vi.fn();

    render(
      <Dock
        layout={baseLayout}
        width={450}
        t={t}
        paneTitles={{ plan: "Plan", file: "main.ts" }}
        renderPane={(pane) => <div data-testid={`pane-${pane}`}>Content of {pane}</div>}
        onSelectPane={onSelectPane}
        onClosePane={onClosePane}
        onMovePane={onMovePane}
      />,
    );

    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("main.ts")).toBeTruthy();
    expect(screen.getByTestId("pane-file")).toBeTruthy();
    expect(screen.queryByTestId("pane-plan")).toBeNull();

    // Selecting tab switches pane
    fireEvent.click(screen.getByText("Plan"));
    expect(onSelectPane).toHaveBeenCalledWith("plan");
  });

  it("closes active pane when Ctrl+\\ is pressed", () => {
    const onClosePane = vi.fn();
    render(
      <Dock
        layout={baseLayout}
        width={450}
        t={t}
        paneTitles={{ plan: "Plan", file: "main.ts" }}
        renderPane={(pane) => <div>{pane}</div>}
        onSelectPane={() => {}}
        onClosePane={onClosePane}
        onMovePane={() => {}}
      />,
    );

    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(onClosePane).toHaveBeenCalledWith("file");
  });

  it("renders split view when split pane is defined", () => {
    const splitLayout: DockLayout = {
      ...baseLayout,
      split: "plan",
    };

    render(
      <Dock
        layout={splitLayout}
        width={450}
        t={t}
        paneTitles={{ plan: "Plan", file: "main.ts" }}
        renderPane={(pane) => <div data-testid={`split-${pane}`}>{pane}</div>}
        onSelectPane={() => {}}
        onClosePane={() => {}}
        onMovePane={() => {}}
      />,
    );

    expect(screen.getByTestId("split-file")).toBeTruthy();
    expect(screen.getByTestId("split-plan")).toBeTruthy();
  });

  it("renders as overlay when isOverlay is true", () => {
    const { container } = render(
      <Dock
        layout={baseLayout}
        width={450}
        t={t}
        isOverlay
        renderPane={(pane) => <div>{pane}</div>}
        onSelectPane={() => {}}
        onClosePane={() => {}}
        onMovePane={() => {}}
      />,
    );

    const dockEl = container.querySelector('[data-region="dock"]');
    expect(dockEl).toBeTruthy();
    expect(dockEl?.className).toContain("absolute");
  });

  it("returns null if no panes are present", () => {
    const { container } = render(
      <Dock
        layout={{ panes: [], active: null, width: 450 }}
        width={450}
        t={t}
        renderPane={() => null}
        onSelectPane={() => {}}
        onClosePane={() => {}}
        onMovePane={() => {}}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders diff tab and active diff pane", () => {
    const diffLayout: DockLayout = {
      panes: ["diff"],
      active: "diff",
      width: 500,
      diffFile: "src/index.ts",
    };

    render(
      <Dock
        layout={diffLayout}
        width={500}
        t={t}
        paneTitles={{ diff: "Diff" }}
        renderPane={(pane) => <div data-testid={`pane-${pane}`}>Diff content</div>}
        onSelectPane={() => {}}
        onClosePane={() => {}}
        onMovePane={() => {}}
      />,
    );

    expect(screen.getByText("Diff")).toBeTruthy();
    expect(screen.getByTestId("pane-diff")).toBeTruthy();
  });

  it("exposes semantic tab roles and supports arrow key roving navigation", () => {
    const onSelectPane = vi.fn();
    render(
      <Dock
        layout={baseLayout}
        width={450}
        t={t}
        paneTitles={{ plan: "Plan", file: "main.ts" }}
        renderPane={(pane) => <div>{pane}</div>}
        onSelectPane={onSelectPane}
        onClosePane={() => {}}
        onMovePane={() => {}}
      />,
    );

    const tablist = screen.getByRole("tablist", { name: "Panes" });
    expect(tablist).toBeTruthy();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);

    const planTab = screen.getByRole("tab", { name: "Plan" });
    const fileTab = screen.getByRole("tab", { name: "main.ts" });

    expect(fileTab.getAttribute("aria-selected")).toBe("true");
    expect(fileTab.getAttribute("tabindex")).toBe("0");
    expect(planTab.getAttribute("aria-selected")).toBe("false");
    expect(planTab.getAttribute("tabindex")).toBe("-1");

    // ArrowRight from fileTab (index 1) wraps to planTab (index 0)
    fireEvent.keyDown(fileTab, { key: "ArrowRight" });
    expect(onSelectPane).toHaveBeenCalledWith("plan");

    // ArrowLeft from planTab (index 0) wraps to fileTab (index 1)
    fireEvent.keyDown(planTab, { key: "ArrowLeft" });
    expect(onSelectPane).toHaveBeenCalledWith("file");
  });
});

