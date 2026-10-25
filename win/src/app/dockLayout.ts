/** One tab per open file is `file:<path>`; the bare "file" is the single-file tab older layouts saved.
 * One tab per shell is `terminal:<session id>`. */
export type PaneId = "plan" | "file" | `file:${string}` | "files" | "diff" | "browser" | "usage" | `terminal:${string}`;

export function terminalPane(sessionId: string): PaneId {
  return `terminal:${sessionId}`;
}

/** The shell session a tab shows, or null when the tab is not a shell. */
export function terminalIdOf(pane: string): string | null {
  return pane.startsWith("terminal:") ? pane.slice(9) : null;
}

export function filePane(path: string): PaneId {
  return `file:${path}`;
}

/** The file a tab shows, or null when the tab is not a file. */
export function filePathOf(pane: PaneId): string | null {
  return pane.startsWith("file:") ? pane.slice(5) : null;
}

function isFilePane(pane: PaneId): boolean {
  return pane === "file" || pane.startsWith("file:");
}

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
  if (options?.file) panes.push(filePane(options.file));
  const active = options?.file ? filePane(options.file) : null;
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

/** Opens a file in its own tab beside the others, or brings its tab forward when it is already open. */
export function openFilePane(layout: DockLayout, path: string): DockLayout {
  return openPane(layout, filePane(path), { file: path });
}

/** A file that moved or was renamed keeps its tab and its place in the strip. */
export function renameFilePane(layout: DockLayout, from: string, to: string): DockLayout {
  const oldId = filePane(from);
  const newId = filePane(to);
  if (oldId === newId || !layout.panes.includes(oldId)) return layout;
  const swap = (pane: PaneId | null | undefined) => (pane === oldId ? newId : pane);
  const panes = layout.panes.map((pane) => swap(pane) as PaneId).filter((pane, at, all) => all.indexOf(pane) === at);
  return { ...layout, panes, active: swap(layout.active) ?? null, split: swap(layout.split) ?? null, file: layout.file === from ? to : layout.file };
}

/** Older layouts held one "file" tab and a path beside it: turn that into a tab named after its file. */
export function migrateFilePane(layout: DockLayout): DockLayout {
  if (!layout.panes.includes("file")) return layout;
  const path = layout.file ?? null;
  const swap = (pane: PaneId | null | undefined) => (pane === "file" ? (path ? filePane(path) : null) : pane);
  const panes = layout.panes
    .map((pane) => swap(pane))
    .filter((pane, at, all): pane is PaneId => pane !== null && pane !== undefined && all.indexOf(pane) === at);
  return { ...layout, panes, active: swap(layout.active) ?? panes[0] ?? null, split: swap(layout.split) ?? null };
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
  const lastFile = [...nextPanes].reverse().map(filePathOf).find((path) => path !== null) ?? null;
  const nextFile = isFilePane(pane) ? lastFile : layout.file;
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
