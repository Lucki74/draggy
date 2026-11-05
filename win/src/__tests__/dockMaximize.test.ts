import { describe, expect, it } from "vitest";
import { createDefaultDockLayout, isPaneMaximized, openPane, togglePaneMaximized } from "../app/dockLayout";

/** Maximize state is kept per tab: toggling one tab leaves the others at their own state. */

describe("dock tab maximize", () => {
  it("toggles one tab without touching another", () => {
    let layout = createDefaultDockLayout({ file: "a.ts" });
    layout = openPane(layout, "browser");

    layout = togglePaneMaximized(layout, "browser");
    expect(isPaneMaximized(layout, "browser")).toBe(true);
    expect(isPaneMaximized(layout, "file:a.ts")).toBe(false);

    layout = togglePaneMaximized(layout, "file:a.ts");
    layout = togglePaneMaximized(layout, "browser");
    expect(isPaneMaximized(layout, "browser")).toBe(false);
    expect(isPaneMaximized(layout, "file:a.ts")).toBe(true);
  });

  it("does not change the tab order or active tab", () => {
    const layout = openPane(createDefaultDockLayout({ file: "a.ts" }), "diff");
    const next = togglePaneMaximized(layout, "diff");
    expect(next.panes).toEqual(layout.panes);
    expect(next.active).toBe(layout.active);
  });
});
