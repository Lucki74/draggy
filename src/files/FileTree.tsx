import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, Loader2 } from "lucide-react";
import { joinPath, partitionEntries } from "./tree";
import type { DirectoryEntry } from "../types";

interface FileTreeProps {
  workspaceId: string;
  root: string;
  selected: string | null;
  onSelect: (entry: DirectoryEntry) => void;
  t: (key: string) => string;
  /** Bumped by the screen when something on disk changed under it. */
  revision?: number;
}

type Loaded = Record<string, DirectoryEntry[]>;

/**
 * The project folder, a level at a time. Folders are read when they are opened
 * rather than up front: a repository with a deep tree would otherwise spend the
 * first second of the screen listing files nobody asked for.
 */
export default function FileTree({
  workspaceId,
  root,
  selected,
  onSelect,
  t,
  revision = 0,
}: FileTreeProps) {
  /**
   * Folders already read, stamped with the state of the disk they were read
   * for. Stamping rather than clearing: emptying the cache when something
   * changes would be a write during render's own effect, and the stamp says the
   * same thing without one.
   */
  const [cache, setCache] = useState<{ revision: number; dirs: Loaded }>({
    revision,
    dirs: {},
  });

  const loaded = cache.revision === revision ? cache.dirs : {};

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set([root]));
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [showFolded, setShowFolded] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(
    async (folder: string) => {
      const api = window.electronAPI?.files;
      if (!api) return;

      const result = await api.list(workspaceId, folder).catch(() => undefined);

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

  // The root again whenever the disk changed under it: `load` is rebuilt with
  // the new revision, so this runs itself. Queued rather than called straight
  // from the effect: the listing is a round trip to the main process, and
  // nothing it sets belongs to this render.
  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) void load(root);
    });

    return () => {
      cancelled = true;
    };
  }, [root, load]);

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
          className="flex items-center gap-2 py-1 text-xs text-[var(--text-muted)]"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          {failed.has(folder) ? (
            t("emptyFolder")
          ) : (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              {t("loading")}
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
          className="py-1 text-xs text-[var(--text-muted)] opacity-70"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          {t("emptyFolder")}
        </div>
      );
    }

    return (
      <>
        {visible.map((entry) => {
          const isOpen = open.has(entry.path);

          return (
            <div key={entry.path}>
              <button
                onClick={() =>
                  entry.isDirectory ? toggle(entry.path) : onSelect(entry)
                }
                title={entry.name}
                aria-current={selected === entry.path}
                className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs transition-colors ${
                  selected === entry.path
                    ? "bg-[var(--hover-bg)] font-bold"
                    : "hover:bg-[var(--hover-bg)]"
                }`}
                style={{ paddingLeft: depth * 12 + 8 }}
              >
                {entry.isDirectory ? (
                  isOpen ? (
                    <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
                  ) : (
                    <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-60" />
                  )
                ) : (
                  <span className="w-3 flex-shrink-0" />
                )}

                {entry.isDirectory ? (
                  <Folder className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                ) : (
                  <File className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                )}

                <span className="truncate">{entry.name}</span>
              </button>

              {entry.isDirectory && isOpen && renderLevel(entry.path, depth + 1)}
            </div>
          );
        })}

        {folded.length > 0 && !showFolded.has(folder) && (
          <button
            onClick={() => setShowFolded((prev) => new Set(prev).add(folder))}
            className="py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-main)]"
            style={{ paddingLeft: depth * 12 + 8 }}
          >
            {`+${folded.length}`}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="py-2">
      <button
        onClick={() => toggle(root)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs font-bold"
      >
        {open.has(root) ? (
          <ChevronDown className="w-3 h-3 opacity-60" />
        ) : (
          <ChevronRight className="w-3 h-3 opacity-60" />
        )}
        <Folder className="w-3.5 h-3.5 opacity-70" />
        <span className="truncate">{joinPath("", root).split(/[\\/]/).pop()}</span>
      </button>

      {open.has(root) && renderLevel(root, 1)}
    </div>
  );
}
