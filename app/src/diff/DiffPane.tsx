import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Menu, type MenuEntry } from "../ui/Menu";
import { changePath } from "../project/gitView";
import { parseDiff, type ParsedFileDiff } from "./diffParser";
import { UnifiedDiffView } from "./UnifiedDiffView";
import { SplitDiffView } from "./SplitDiffView";
import { GitGraph } from "./GitGraph";
import type { GitBranch, GitCommit, GitDiff, GitStatus } from "../types";
import { logSwallow } from "../logger";

export interface DiffPaneProps {
  workspaceId: string;
  rootPath?: string | null;
  initialFile?: string | null;
  gitStatus?: GitStatus | null;
  t: (key: string) => string;
  onOpenFile?: (path: string) => void;
  onClose?: () => void;
  width?: number;
}

/** Split needs room for two columns of code. */
const SPLIT_MIN_WIDTH = 700;

const pathOf = (file: ParsedFileDiff) => (file.deleted ? file.oldPath : file.newPath || file.oldPath);

const extensionOf = (path: string) => {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).slice(0, 4).toUpperCase() : "";
};

function FileRow({
  file,
  open,
  split,
  onToggle,
  onOpen,
  t,
}: {
  file: ParsedFileDiff;
  open: boolean;
  split: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  t: (key: string) => string;
}) {
  const path = pathOf(file);
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const folder = slash > 0 ? path.slice(0, slash) : "";
  // A file with one side has nothing to put beside it.
  const twoSided = split && !file.created && !file.deleted;

  return (
    <div data-testid="review-file" className="border-b border-rule">
      <div className="group flex items-center gap-2 px-3 h-8 text-xs hover:bg-surface-raised/60">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-2 text-start">
          <span className="w-8 flex-shrink-0 text-center font-mono text-[9px] font-semibold text-text-tertiary">{extensionOf(path)}</span>
          <span className={`flex-shrink-0 max-w-[60%] truncate text-text-primary ${file.deleted ? "line-through" : ""}`} title={path}>
            {name}
          </span>
          <span className="flex-1 min-w-0 truncate text-text-tertiary" dir="rtl">
            {folder}
          </span>
          <span className="flex-shrink-0 flex gap-1 font-mono text-[11px] tabular-nums">
            <span className="text-ok">+{file.added}</span>
            <span className="text-danger">-{file.removed}</span>
          </span>
          <Icon name={open ? "caret-down" : "caret-right"} size={12} className="flex-shrink-0 text-text-tertiary" />
        </button>
        {onOpen && !file.deleted && (
          <button
            type="button"
            onClick={onOpen}
            title={t("openFile")}
            aria-label={t("openFile")}
            className="p-0.5 rounded-xs text-text-tertiary hover:text-text-primary opacity-0 group-hover:opacity-100 focus:opacity-100"
          >
            <Icon name="arrow-square-out" size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-rule bg-surface-canvas">
          {file.binary || file.hunks.length === 0 ? (
            <div className="px-4 py-3 text-xs text-text-tertiary">{t("gitNoDiff")}</div>
          ) : twoSided ? (
            <SplitDiffView fileDiff={file} />
          ) : (
            <UnifiedDiffView fileDiff={file} />
          )}
        </div>
      )}
    </div>
  );
}

/** The working changes, or one commit's, as a list of files that open into their diffs, over the graph. */
export function DiffPane({ workspaceId, rootPath, initialFile, gitStatus: initialGitStatus, t, onOpenFile, width = 600 }: DiffPaneProps) {
  const [liveGitStatus, setLiveGitStatus] = useState<GitStatus | null>(null);
  const gitStatus = liveGitStatus ?? initialGitStatus ?? null;

  const [commit, setCommit] = useState<GitCommit | null>(null);
  const [rawDiff, setRawDiff] = useState("");
  const [loading, setLoading] = useState(() => Boolean(window.draggy?.git));
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const [split, setSplit] = useState(false);
  const [hideWhitespace, setHideWhitespace] = useState(false);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [branches, setBranches] = useState<GitBranch[]>([]);

  // The dock's stored width misses a maximized pane, so the pane measures itself.
  const root = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    const node = root.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setMeasured(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const git = window.draggy?.git;
    if (!git) return;
    let live = true;
    const request: Promise<GitDiff> = commit
      ? git.show(workspaceId, commit.hash, hideWhitespace)
      : git.diff(workspaceId, ".", false, true, hideWhitespace);
    request.then(
      (res) => {
        if (!live) return;
        if (res?.success) {
          setRawDiff(res.diff || "");
          setError(null);
        } else setError(res?.error || t("gitNoDiff"));
        setLoading(false);
      },
      (err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [workspaceId, commit, hideWhitespace, reloads, t]);

  useEffect(() => {
    const git = window.draggy?.git;
    if (!git || reloads === 0) return;
    let live = true;
    git.status(workspaceId).then(
      (res) => live && res?.success && setLiveGitStatus(res),
      (err) => logSwallow("diff", err, "keep the last known status"),
    );
    return () => {
      live = false;
    };
  }, [workspaceId, reloads]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloads((n) => n + 1);
  }, []);

  const files = useMemo(() => parseDiff(rawDiff), [rawDiff]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? files.filter((file) => pathOf(file).toLowerCase().includes(needle)) : files;
  }, [files, query]);

  // Until the user opens or closes a file, the one asked for (or the first) starts open.
  const openSet = useMemo(() => {
    if (expanded) return expanded;
    const first = initialFile && files.some((file) => pathOf(file) === initialFile) ? initialFile : files[0] && pathOf(files[0]);
    return new Set(first && !commit ? [first] : []);
  }, [expanded, files, initialFile, commit]);

  const toggle = (path: string) => {
    const next = new Set(openSet);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  const allOpen = shown.length > 0 && shown.every((file) => openSet.has(pathOf(file)));
  const canSplit = (measured || width) >= SPLIT_MIN_WIDTH;

  const showCommit = (next: GitCommit | null) => {
    setCommit(next);
    setExpanded(null);
    setLoading(true);
  };

  const loadBranches = () => {
    window.draggy?.git.branches(workspaceId).then(
      (res) => res?.success && setBranches(res.branches ?? []),
      (err) => logSwallow("diff", err, "the branch menu stays empty"),
    );
  };

  const checkout = async (name: string) => {
    try {
      const res = await window.draggy?.git.checkout(workspaceId, name);
      if (!res?.success) {
        setError(res?.error || t("gitSwitchFailed"));
        return;
      }
      showCommit(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const branch = gitStatus?.detached ? t("gitDetached") : (gitStatus?.branch ?? "HEAD");
  const branchItems: MenuEntry[] =
    branches.length === 0
      ? [{ type: "heading", id: "none", label: t("gitNoBranches") }]
      : branches.map((item) => ({
          id: item.name,
          label: item.name,
          checked: item.current,
          title: item.upstream,
          onSelect: () => {
            if (!item.current) void checkout(item.name);
          },
        }));

  const moreItems: MenuEntry[] = [
    {
      id: "split",
      label: t("reviewSplit"),
      toggle: true,
      checked: split && canSplit,
      disabled: !canSplit,
      onSelect: () => setSplit(!split),
    },
    { id: "whitespace", label: t("reviewHideWhitespace"), toggle: true, checked: hideWhitespace, onSelect: () => setHideWhitespace(!hideWhitespace) },
    { type: "separator", id: "sep" },
    {
      id: "expand",
      label: t(allOpen ? "reviewCollapseAll" : "reviewExpandAll"),
      onSelect: () => setExpanded(new Set(allOpen ? [] : shown.map(pathOf))),
    },
  ];

  const tool = "p-1 rounded-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised";

  return (
    <div ref={root} className="flex flex-col h-full bg-surface-canvas overflow-hidden select-none">
      <div className="min-h-9 px-2 py-1 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule bg-surface-base flex-shrink-0 text-xs">
        <Menu
          label={t("gitSwitchBranch")}
          items={branchItems}
          onOpenChange={(next) => next && loadBranches()}
          trigger={(props) => (
            <button {...props} type="button" title={branch} className="min-w-0 flex items-center gap-1.5 px-1.5 py-0.5 rounded-xs hover:bg-surface-raised">
              <Icon name="git-branch" size={14} className="text-text-secondary flex-shrink-0" />
              <span className="font-semibold text-text-primary truncate">{branch}</span>
              <Icon name="caret-down" size={10} className="text-text-tertiary flex-shrink-0" />
            </button>
          )}
        />
        {(gitStatus?.ahead ?? 0) > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-text-secondary" title={t("gitAhead")}>
            <Icon name="arrow-up" size={12} />
            {gitStatus?.ahead}
          </span>
        )}
        {(gitStatus?.behind ?? 0) > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-text-secondary" title={t("gitBehind")}>
            <Icon name="arrow-down" size={12} />
            {gitStatus?.behind}
          </span>
        )}
        <span className="text-[11px] text-text-tertiary whitespace-nowrap">
          {files.length === 0 ? t("gitClean") : t("gitChangedFiles").replace("{count}", String(files.length))}
        </span>
        <div className="ms-auto flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            aria-pressed={searching}
            onClick={() => {
              setSearching(!searching);
              setQuery("");
            }}
            title={t("search")}
            aria-label={t("search")}
            className={tool}
          >
            <Icon name="magnifying-glass" size={14} />
          </button>
          <Menu
            label={t("more")}
            align="end"
            items={moreItems}
            trigger={(props) => (
              <button {...props} type="button" title={t("more")} aria-label={t("more")} className={tool}>
                <Icon name="dots-three" size={14} />
              </button>
            )}
          />
          <button type="button" onClick={refresh} title={t("refresh")} aria-label={t("refresh")} className={tool}>
            <Icon name="arrow-clockwise" size={14} />
          </button>
        </div>
      </div>

      {searching && (
        <div className="px-2 py-1.5 border-b border-rule bg-surface-base flex-shrink-0">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && (setSearching(false), setQuery(""))}
            placeholder={t("reviewFilter")}
            aria-label={t("reviewFilter")}
            className="w-full h-7 px-2 rounded-xs border border-rule bg-surface-canvas text-xs text-text-primary outline-none focus:border-accent"
          />
        </div>
      )}

      {commit && (
        <div className="px-2 py-1 flex items-center gap-2 border-b border-rule bg-surface-base flex-shrink-0 text-xs">
          <button
            type="button"
            onClick={() => showCommit(null)}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-pill border border-rule text-text-secondary hover:text-text-primary"
          >
            <Icon name="arrow-left" size={12} />
            {t("reviewBack")}
          </button>
          <code className="flex-shrink-0 font-mono text-[11px] text-text-tertiary">{commit.short}</code>
          <span className="flex-1 min-w-0 truncate text-text-primary" title={commit.subject}>
            {commit.subject}
          </span>
        </div>
      )}

      <div data-testid="review-list" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden select-text">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-text-secondary text-xs">
            <Icon name="circle-notch" size={18} className="animate-spin me-2" />
            <span>{t("gitCheckingStatus")}</span>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-danger text-xs">{error}</div>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-text-tertiary text-xs">{t(files.length === 0 ? "gitClean" : "gitNoDiff")}</div>
        ) : (
          shown.map((file) => {
            const path = pathOf(file);
            return (
              <FileRow
                key={path}
                file={file}
                open={openSet.has(path)}
                split={split && canSplit}
                onToggle={() => toggle(path)}
                onOpen={onOpenFile && !commit ? () => onOpenFile(rootPath ? changePath(rootPath, path) : path) : undefined}
                t={t}
              />
            );
          })
        )}
      </div>

      <GitGraph workspaceId={workspaceId} t={t} reloadKey={reloads} selected={commit?.hash ?? null} onSelect={showCommit} />
    </div>
  );
}
export default DiffPane;
