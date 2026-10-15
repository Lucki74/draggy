export type PaneId = "plan" | "file" | "files" | "diff" | "browser" | "usage";

export interface DockLayout {
  panes: PaneId[];
  active: PaneId | null;
  width: number;
  file?: string | null;
  diffFile?: string | null;
  split?: PaneId | null;
}

const MIN_DOCK_WIDTH = 260;
const MAX_DOCK_WIDTH = 1200;
const DEFAULT_DOCK_WIDTH = 500;

/** Pure calculations over the dock's tab and split state. */
export function createDefaultDockLayout(options?: {
  width?: number;
  file?: string | null;
  diffFile?: string | null;
}): DockLayout {
  const panes: PaneId[] = [];
  if (options?.file) panes.push("file");
  const active = options?.file ? "file" : null;
  return {
    panes,
    active,
    width: options?.width ?? DEFAULT_DOCK_WIDTH,
    file: options?.file ?? null,
    diffFile: options?.diffFile ?? null,
    split: null,
  };
}

/** Opens a pane in the dock, activating it and updating its target file. */
export function openPane(
  layout: DockLayout,
  pane: PaneId,
  options?: { file?: string | null; diffFile?: string | null; split?: boolean },
): DockLayout {
  const exists = layout.panes.includes(pane);
  const nextPanes = exists ? layout.panes : [...layout.panes, pane];
  const file = options?.file !== undefined ? options.file : layout.file;
  const diffFile = options?.diffFile !== undefined ? options.diffFile : layout.diffFile;
  if (options?.split && layout.active && layout.active !== pane) {
    return { ...layout, panes: nextPanes, split: pane, file, diffFile };
  }
  return {
    ...layout,
    panes: nextPanes,
    active: pane,
    split: layout.split === pane ? null : layout.split,
    file,
    diffFile,
  };
}

/** Closes a pane, transferring active focus to an adjacent tab if open. */
export function closePane(layout: DockLayout, pane: PaneId): DockLayout {
  const idx = layout.panes.indexOf(pane);
  if (idx === -1) return layout;
  const nextPanes = layout.panes.filter((p) => p !== pane);
  let nextActive = layout.active;
  if (layout.active === pane) {
    nextActive = nextPanes[idx] ?? nextPanes[idx - 1] ?? null;
  }
  const nextSplit = layout.split === pane ? null : layout.split;
  const nextFile = pane === "file" ? null : layout.file;
  const nextDiffFile = pane === "diff" ? null : layout.diffFile;
  return {
    ...layout,
    panes: nextPanes,
    active: nextActive,
    split: nextSplit,
    file: nextFile,
    diffFile: nextDiffFile,
  };
}

/** Reorders tabs in the strip when dragged. */
export function movePane(
  layout: DockLayout,
  fromIndex: number,
  toIndex: number,
): DockLayout {
  if (
    fromIndex < 0 ||
    fromIndex >= layout.panes.length ||
    toIndex < 0 ||
    toIndex >= layout.panes.length ||
    fromIndex === toIndex
  ) {
    return layout;
  }
  const nextPanes = [...layout.panes];
  const [removed] = nextPanes.splice(fromIndex, 1);
  nextPanes.splice(toIndex, 0, removed);
  return { ...layout, panes: nextPanes };
}

/** Splits the dock vertically so two panes are visible simultaneously. */
export function splitPane(layout: DockLayout, pane: PaneId): DockLayout {
  if (!layout.panes.includes(pane) || layout.active === pane) return layout;
  return { ...layout, split: pane };
}

/** Collapses split mode back to a single tabbed pane. */
export function unsplit(layout: DockLayout): DockLayout {
  return layout.split ? { ...layout, split: null } : layout;
}

/** Clamps dock width within bounded minimum and maximum dimensions. */
export function setDockWidth(layout: DockLayout, width: number): DockLayout {
  const clamped = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.round(width)));
  return clamped === layout.width ? layout : { ...layout, width: clamped };
}



/** Returns true when the dock contains at least one open pane. */
export function isDockOpen(layout: DockLayout): boolean {
  return layout.panes.length > 0 && layout.active !== null;
}
