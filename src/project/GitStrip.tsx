import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, GitBranch, Loader2 } from "lucide-react";
import UnifiedDiff from "../chat/UnifiedDiff";
import { CHANGE_COLOR, CHANGE_LETTER, changePath } from "./gitView";
import type { GitChange, GitStatus } from "../types";

interface GitStripProps {
  status: GitStatus;
  workspaceId: string;
  root: string;
  t: (key: string) => string;
  /** Opens a changed file, in the canvas. */
  onOpenFile: (path: string) => void;
}

/**
 * Where the project's repository stands, at the foot of the file tree: the
 * branch, how far it is from its upstream, and what changed. Opened, it lists
 * the changed files, each with its diff a click away. Committing stays in the
 * user's own git; there is deliberately no button for it here.
 */
export default function GitStrip({ status, workspaceId, root, t, onOpenFile }: GitStripProps) {
  const [open, setOpen] = useState(false);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const files = status.files ?? [];
  const branch = status.detached ? t("gitDetached") : (status.branch ?? "HEAD");

  const toggleDiff = async (change: GitChange) => {
    if (diffFor === change.path) {
      setDiffFor(null);
      return;
    }

    setDiffFor(change.path);
    setLoading(true);

    try {
      const result = await window.electronAPI?.git?.diff(
        workspaceId,
        change.path,
        change.staged && !change.unstaged,
      );
      setDiff({
        path: change.path,
        text: result?.success ? result.diff || "" : result?.error || "",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t-[3px] border-[var(--border-light)] text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-[var(--hover-bg)] transition-colors"
      >
        <GitBranch className="w-3.5 h-3.5 flex-shrink-0 text-[var(--text-muted)]" />
        <span className="min-w-0 truncate font-bold" title={branch}>
          {branch}
        </span>

        {(status.ahead ?? 0) > 0 && (
          <span className="flex items-center text-[10px] text-[var(--text-muted)]" title={t("gitAhead")}>
            <ArrowUp className="w-3 h-3" />
            {status.ahead}
          </span>
        )}
        {(status.behind ?? 0) > 0 && (
          <span className="flex items-center text-[10px] text-[var(--text-muted)]" title={t("gitBehind")}>
            <ArrowDown className="w-3 h-3" />
            {status.behind}
          </span>
        )}

        <span className="ml-auto flex-shrink-0 text-[10px] text-[var(--text-muted)]">
          {files.length === 0
            ? t("gitClean")
            : t("gitChangedFiles").replace("{count}", String(files.length))}
        </span>
        {files.length > 0 && (
          <ChevronRight
            className={`w-3 h-3 flex-shrink-0 text-[var(--text-muted)] transition-transform ${
              open ? "-rotate-90" : ""
            }`}
          />
        )}
      </button>

      {open && files.length > 0 && (
        <ul className="max-h-72 overflow-y-auto pb-1">
          {files.map((change) => (
            <li key={`${change.kind}:${change.path}`}>
              <div className="group flex items-center gap-1.5 px-3 py-1 hover:bg-[var(--hover-bg)]">
                <span
                  className="w-3 flex-shrink-0 text-center text-[10px] font-bold"
                  style={{ color: CHANGE_COLOR[change.kind] }}
                  title={t(`gitKind_${change.kind}`)}
                >
                  {CHANGE_LETTER[change.kind]}
                </span>

                <button
                  type="button"
                  onClick={() => change.kind !== "deleted" && onOpenFile(changePath(root, change.path))}
                  disabled={change.kind === "deleted"}
                  title={change.path}
                  className="min-w-0 flex-1 truncate text-left disabled:line-through disabled:opacity-60"
                >
                  {change.path}
                </button>

                {change.kind !== "untracked" && (
                  <button
                    type="button"
                    onClick={() => void toggleDiff(change)}
                    aria-expanded={diffFor === change.path}
                    className="flex-shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[var(--text-main)]"
                  >
                    {t("gitShowDiff")}
                  </button>
                )}
              </div>

              {diffFor === change.path && (
                <div className="px-2 pb-2">
                  {loading || diff?.path !== change.path ? (
                    <Loader2 className="mx-auto my-2 w-4 h-4 animate-spin text-[var(--text-muted)]" />
                  ) : diff.text ? (
                    <UnifiedDiff diff={diff.text} maxHeight={240} />
                  ) : (
                    <p className="px-1 text-[10px] text-[var(--text-muted)]">{t("gitNoDiff")}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
