import { describe, expect, it } from "vitest";
import {
  closePane,
  createDefaultDockLayout,
  isDockOpen,
  movePane,
  openPane,
  setDockWidth,
  splitPane,
  unsplit,
} from "../app/dockLayout";

describe("dockLayout", () => {
  it("initializes empty layout when no pane is specified", () => {
    const layout = createDefaultDockLayout();
    expect(layout.panes).toEqual([]);
    expect(layout.active).toBeNull();
    expect(layout.width).toBe(500);
    expect(isDockOpen(layout)).toBe(false);
  });

  it("initializes with the file and leaves the plan closed", () => {
    const layout = createDefaultDockLayout({ file: "src/main.ts" });
    expect(layout.panes).toEqual(["file"]);
    expect(layout.active).toBe("file");
    expect(layout.file).toBe("src/main.ts");
    expect(isDockOpen(layout)).toBe(true);
  });

  it("opens a pane and sets it as active", () => {
    const initial = createDefaultDockLayout();
    const withPlan = openPane(initial, "plan");
    expect(withPlan.panes).toEqual(["plan"]);
    expect(withPlan.active).toBe("plan");

    const withFile = openPane(withPlan, "file", { file: "README.md" });
    expect(withFile.panes).toEqual(["plan", "file"]);
    expect(withFile.active).toBe("file");
    expect(withFile.file).toBe("README.md");
  });

  it("does not duplicate an already opened pane", () => {
    const initial = openPane(createDefaultDockLayout(), "plan");
    const reopened = openPane(initial, "plan");
    expect(reopened.panes).toEqual(["plan"]);
    expect(reopened.active).toBe("plan");
  });

  it("closes the active pane and selects the adjacent tab", () => {
    let layout = createDefaultDockLayout();
    layout = openPane(layout, "plan");
    layout = openPane(layout, "file", { file: "index.ts" });
    layout = openPane(layout, "diff");

    expect(layout.panes).toEqual(["plan", "file", "diff"]);
    expect(layout.active).toBe("diff");

    const closedDiff = closePane(layout, "diff");
    expect(closedDiff.panes).toEqual(["plan", "file"]);
    expect(closedDiff.active).toBe("file");

    const closedFile = closePane(closedDiff, "file");
    expect(closedFile.panes).toEqual(["plan"]);
    expect(closedFile.active).toBe("plan");
    expect(closedFile.file).toBeNull();

    const closedLast = closePane(closedFile, "plan");
    expect(closedLast.panes).toEqual([]);
    expect(closedLast.active).toBeNull();
    expect(isDockOpen(closedLast)).toBe(false);
  });

  it("moves pane order on drag", () => {
    let layout = createDefaultDockLayout();
    layout = openPane(layout, "plan");
    layout = openPane(layout, "file");
    layout = openPane(layout, "diff");

    const moved = movePane(layout, 0, 2);
    expect(moved.panes).toEqual(["file", "diff", "plan"]);

    // Out of bounds moves are no-ops
    expect(movePane(layout, -1, 1)).toBe(layout);
    expect(movePane(layout, 0, 5)).toBe(layout);
    expect(movePane(layout, 1, 1)).toBe(layout);
  });

  it("handles splitting and unsplitting panes", () => {
    let layout = createDefaultDockLayout();
    layout = openPane(layout, "plan");
    layout = openPane(layout, "file");

    const split = splitPane(layout, "plan");
    expect(split.split).toBe("plan");
    expect(split.active).toBe("file");

    const unsplitLayout = unsplit(split);
    expect(unsplitLayout.split).toBeNull();

    // Closing split pane clears the split
    const closed = closePane(split, "plan");
    expect(closed.split).toBeNull();
    expect(closed.panes).toEqual(["file"]);
  });

  it("clamps dock width to boundary limits", () => {
    const layout = createDefaultDockLayout({ width: 500 });
    expect(setDockWidth(layout, 100).width).toBe(260);
    expect(setDockWidth(layout, 2000).width).toBe(1200);
    expect(setDockWidth(layout, 650).width).toBe(650);
  });
});
