import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { baseName, joinPath, parentOf, partitionEntries, relativePath } from "./tree";
import { Menu, type MenuEntry } from "../ui/Menu";
import { isCodeFile, isImageFile, isMarkdownFile } from "../canvas/drafts";
import type { DirectoryEntry, GitChange, GitChangeKind, GitStatus } from "../types";
import { swallowed } from "../logger";

interface FileTreeProps {
  workspaceId: string;
  root: string;
  selected: string | null;
  onSelect: (entry: DirectoryEntry) => void;
  t: (key: string) => string;
  /** Bumped by the screen when something on disk changed under it. */
  revision?: number;
  gitStatus?: GitStatus | null;
  onAttachContext?: (path: string) => void;
}

type Loaded = Record<string, DirectoryEntry[]>;

interface ContextMenuState {
  x: number;
  y: number;
  entry: DirectoryEntry;
}

const CHANGE_LETTER: Record<GitChangeKind, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "C",
};

const CHANGE_COLOR: Record<GitChangeKind, string> = {
  modified: "var(--color-text-secondary)",
  added: "var(--ok)",
  deleted: "var(--danger)",
  renamed: "var(--color-text-secondary)",
  untracked: "var(--ok)",
  conflicted: "var(--danger)",
};

function getFileIcon(target: string): "file-image" | "file-code" | "file-text" | "file" {
  if (isImageFile(target)) return "file-image";
  if (isCodeFile(target)) return "file-code";
  const lower = target.toLowerCase();
  if (
    isMarkdownFile(target) ||
    lower.endsWith(".txt") ||
    lower.endsWith(".doc") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".rtf") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".log")
  ) {
    return "file-text";
  }
  return "file";
}

/** The project folder a level at a time. Folders are read when opened, so a deep repository does
 * not spend a second listing files nobody asked for. */
export default function FileTree({
  workspaceId,
  root,
  selected,
  onSelect,
  t,
  revision = 0,
  gitStatus,
  onAttachContext,
}: FileTreeProps) {
  /** Folders already read, stamped with the disk revision they match. A stamp avoids clearing the
   * cache, which would be a write during render. */
  const [cache, setCache] = useState<{ revision: number; dirs: Loaded }>({
    revision,
    dirs: {},
  });

  const loaded = cache.revision === revision ? cache.dirs : {};

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set([root]));
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [showFolded, setShowFolded] = useState<ReadonlySet<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const sameOrInside = (folder: string, path: string) => {
    const norm = (v: string) => v.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const f = norm(folder);
    const p = norm(path);
    return f === p || f.startsWith(`${p}/`);
  };

  const moveInto = async (source: string, folder: string) => {
    const api = window.electronAPI?.files;
    if (!api || sameOrInside(folder, source) || parentOf(source) === folder.replace(/[\\/]+$/, "")) return;
    const result = await api.move(workspaceId, source, joinPath(folder, baseName(source)));
    if (result?.success) {
      setOpen((prev) => new Set(prev).add(folder));
    }
  };

  const removeEntry = async (entry: DirectoryEntry) => {
    const api = window.electronAPI?.files;
    if (!api) return;
    const message = `${t("deleteFileTitle").replace("{name}", entry.name)}\n${t("deleteFileBody")}`;
    if (!window.confirm(message)) return;
    await api.remove(workspaceId, entry.path);
  };

  const gitChangeMap = useMemo(() => {
    const map = new Map<string, GitChange>();
    if (gitStatus?.files) {
      for (const f of gitStatus.files) {
        map.set(f.path.replace(/\\/g, "/").toLowerCase(), f);
      }
    }
    return map;
  }, [gitStatus]);

  const pathMenu = (entry: DirectoryEntry): MenuEntry[] => {
    const path = entry.path;
    return [
    ...(onAttachContext
      ? [
          {
            id: "attach",
            label: t("attachAsContext"),
            icon: <Icon name="file-arrow-up" size={14} />,
            onSelect: () => onAttachContext(path),
          },
        ]
      : []),
    {
      id: "editor",
      label: t("openInEditor"),
      icon: <Icon name="arrow-square-out" size={14} />,
      onSelect: () => void window.electronAPI?.files?.open?.(workspaceId, path),
    },
    {
      id: "reveal",
      label: t("revealInFileManager"),
      icon: <Icon name="folder-simple" size={14} />,
      onSelect: () => void window.electronAPI?.files?.reveal?.(workspaceId, path),
    },
    {
      id: "copy",
      label: t("copyPath"),
      icon: <Icon name="copy" size={14} />,
      onSelect: () => void navigator.clipboard?.writeText(path),
    },
    {
      id: "delete",
      label: t("delete"),
      icon: <Icon name="trash" size={14} />,
      onSelect: () => void removeEntry(entry),
    },
  ];
  };

  const load = useCallback(
    async (folder: string) => {
      const api = window.electronAPI?.files;
      if (!api) return;

      const result = await api.list(workspaceId, folder).catch(swallowed("files", "the main process already logged this call"));

      if (!result?.success || !result.entries) {
        setFailed((prev) => new Set(prev).add(folder));
        return;
      }

      setCache((prev) => ({
        revision,
        dirs: {
          ...(prev.revision === revision ? prev.dirs : {}),
          [folder]: result.entries as DirectoryEntry[],
        },
      }));
    },
    [workspaceId, revision],
  );

  // Reloads all open folders when the disk changed, since `load` is rebuilt per revision.
  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      for (const folder of open) {
        void load(folder);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, load]);

  // Listens directly to file changes so the tree updates in real time.
  useEffect(() => {
    const api = window.electronAPI?.files;
    if (!api) return;

    const stop = api.onChanged?.((change: { workspaceId?: string }) => {
      if (change.workspaceId && change.workspaceId !== workspaceId) return;
      for (const folder of open) {
        void load(folder);
      }
    });

    return () => {
      stop?.();
    };
  }, [workspaceId, open, load]);

  const toggle = (folder: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
        if (!loaded[folder]) void load(folder);
      }
      return next;
    });
  };

  const renderLevel = (folder: string, depth: number) => {
    const entries = loaded[folder];

    if (!entries) {
      return (
        <div
          className="flex items-center gap-2 h-7 text-xs text-text-tertiary"
          style={{ paddingInlineStart: depth * 12 + 8 }}
        >
          {failed.has(folder) ? (
            t("emptyFolder")
          ) : (
            <>
              <Icon name="circle-notch" size={14} className="animate-spin" />
              <span>{t("loading")}</span>
            </>
          )}
        </div>
      );
    }

    const { shown, folded } = partitionEntries(entries);
    const visible = showFolded.has(folder) ? [...shown, ...folded] : shown;

    if (visible.length === 0 && folded.length === 0) {
      return (
        <div
          className="flex items-center h-7 text-xs text-text-tertiary opacity-70"
          style={{ paddingInlineStart: depth * 12 + 8 }}
        >
          {t("emptyFolder")}
        </div>
      );
    }

    return (
      <>
        {visible.map((entry) => {
          const isOpen = open.has(entry.path);
          const gitChange = entry.isDirectory
            ? undefined
            : gitChangeMap.get(relativePath(root, entry.path).toLowerCase());

          return (
            <div key={entry.path} className="flex flex-col render-viewport-only">
              <button
                onClick={() =>
                  entry.isDirectory ? toggle(entry.path) : onSelect(entry)
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ x: e.clientX, y: e.clientY, entry });
                }}
                title={entry.name}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", entry.path);
                  e.dataTransfer.effectAllowed = "move";
                  setDragging(entry.path);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                onDragOver={(e) => {
                  if (!dragging) return;
                  const folder = entry.isDirectory ? entry.path : parentOf(entry.path);
                  if (sameOrInside(folder, dragging)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDropTarget(folder);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const folder = entry.isDirectory ? entry.path : parentOf(entry.path);
                  const source = dragging;
                  setDragging(null);
                  setDropTarget(null);
                  if (source) void moveInto(source, folder);
                }}
                aria-current={selected === entry.path}
                className={`flex w-full items-center gap-1.5 h-7 pe-2 text-start text-xs transition-colors cursor-pointer select-none ${
                  selected === entry.path
                    ? "bg-surface-raised font-semibold text-text-primary"
                    : entry.isDirectory && dropTarget === entry.path
                      ? "bg-surface-raised text-text-primary ring-1 ring-inset ring-rule"
                      : "text-text-secondary hover:bg-surface-raised hover:text-text-primary"
                }`}
                style={{ paddingInlineStart: depth * 12 + 8 }}
              >
                {entry.isDirectory ? (
                  <Icon
                    name={isOpen ? "caret-down" : "caret-right"}
                    size={14}
                    mirrored
                    className="flex-shrink-0 text-text-tertiary"
                  />
                ) : (
                  <span className="w-3.5 flex-shrink-0" />
                )}

                <Icon
                  name={entry.isDirectory ? (isOpen ? "folder-open" : "folder-simple") : getFileIcon(entry.path)}
                  size={16}
                  className="flex-shrink-0 text-text-secondary"
                />

                <span className="truncate flex-1 min-w-0">{entry.name}</span>

                {gitChange && (
                  <span
                    className="ms-auto pe-1 text-[10px] font-semibold font-mono flex-shrink-0"
                    style={{ color: CHANGE_COLOR[gitChange.kind] }}
                    title={t(`gitKind${gitChange.kind[0].toUpperCase()}${gitChange.kind.slice(1)}`)}
                  >
                    <span aria-hidden="true">{CHANGE_LETTER[gitChange.kind]}</span>
                    <span className="sr-only">{t(`gitKind${gitChange.kind[0].toUpperCase()}${gitChange.kind.slice(1)}`)}</span>
                  </span>
                )}
              </button>

              {entry.isDirectory && isOpen && renderLevel(entry.path, depth + 1)}
            </div>
          );
        })}

        {folded.length > 0 && !showFolded.has(folder) && (
          <button
            onClick={() => setShowFolded((prev) => new Set(prev).add(folder))}
            // Folders like .git and node_modules: counted, not listed, until asked for.
            title={folded.map((entry) => entry.name).join(", ")}
            className="flex w-full items-center gap-1.5 h-7 pe-2 text-start text-[11px] text-text-tertiary hover:bg-surface-raised hover:text-text-primary cursor-pointer select-none"
            style={{ paddingInlineStart: depth * 12 + 8 }}
          >
            <span className="w-3.5 flex-shrink-0" />
            <Icon name="eye-slash" size={14} className="flex-shrink-0 text-text-tertiary" />
            <span className="truncate">{t("hiddenEntries").replace("{count}", String(folded.length))}</span>
          </button>
        )}
      </>
    );
  };

  return (
    <div className="py-1">
      <button
        onClick={() => toggle(root)}
        onDragOver={(e) => {
          if (!dragging || sameOrInside(root, dragging)) return;
          e.preventDefault();
          setDropTarget(root);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const source = dragging;
          setDragging(null);
          setDropTarget(null);
          if (source) void moveInto(source, root);
        }}
        className="flex w-full items-center gap-1.5 px-2 h-7 text-start text-xs font-semibold text-text-primary hover:bg-surface-raised cursor-pointer select-none"
      >
        <Icon
          name={open.has(root) ? "caret-down" : "caret-right"}
          size={14}
          mirrored
          className="text-text-tertiary flex-shrink-0"
        />
        <Icon
          name={open.has(root) ? "folder-open" : "folder-simple"}
          size={16}
          className="text-text-secondary flex-shrink-0"
        />
        <span className="truncate">{joinPath("", root).split(/[\\/]/).pop()}</span>
      </button>

      {open.has(root) && renderLevel(root, 1)}

      {contextMenu && (
        <Menu
          open
          onOpenChange={(next) => !next && setContextMenu(null)}
          label={contextMenu.entry.name}
          trigger={(props) => (
            // The menu opens where the pointer was, so its anchor is a point there.
            <button
              {...props}
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="fixed size-0 opacity-0 pointer-events-none"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            />
          )}
          items={pathMenu(contextMenu.entry)}
        />
      )}
    </div>
  );
}
