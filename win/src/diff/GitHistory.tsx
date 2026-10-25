import { useEffect, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import type { GitBranch, GitCommit } from "../types";
import { logSwallow } from "../logger";

export type HistoryView = "history" | "branches";

interface GitHistoryProps {
  workspaceId: string;
  view: HistoryView;
  t: (key: string) => string;
  /** Called after a checkout so the changed-file list can refresh. */
  onChanged?: () => void;
}

/** Recent commits or local branches of the workspace repository, read through the git bridge. */
export function GitHistory({ workspaceId, view, t, onChanged }: GitHistoryProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [reloads, setReloads] = useState(0);

  // The pane is keyed by view, so each view starts out loading.
  useEffect(() => {
    const git = window.electronAPI?.git;
    if (!git) return;
    let live = true;
    const done = (fn: () => void) => {
      if (!live) return;
      fn();
      setLoading(false);
    };
    if (view === "history") {
      git.log(workspaceId, 50).then(
        (res) => done(() => (res?.success ? setCommits(res.commits ?? []) : setError(res?.error || t("gitNoCommits")))),
        (err) => done(() => setError(err instanceof Error ? err.message : String(err))),
      );
    } else {
      git.branches(workspaceId).then(
        (res) => done(() => (res?.success ? setBranches(res.branches ?? []) : setError(res?.error || t("gitNoBranches")))),
        (err) => done(() => setError(err instanceof Error ? err.message : String(err))),
      );
    }
    return () => {
      live = false;
    };
  }, [workspaceId, view, t, reloads]);

  const switchTo = async (name: string) => {
    try {
      const res = await window.electronAPI?.git.checkout(workspaceId, name);
      if (!res?.success) {
        setError(res?.error || t("gitSwitchFailed"));
        return;
      }
      setError(null);
      onChanged?.();
      setReloads((n) => n + 1);
    } catch (err) {
      logSwallow("diff", err, "checkout failure is shown in the pane");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-text-secondary text-xs">
        <Icon name="circle-notch" size={18} className="animate-spin me-2" />
      </div>
    );
  }
  if (error) return <div className="p-6 text-center text-danger text-xs">{error}</div>;

  if (view === "history") {
    if (commits.length === 0) {
      return <div className="p-6 text-center text-text-tertiary text-xs">{t("gitNoCommits")}</div>;
    }
    return (
      <ul className="py-1 text-xs">
        {commits.map((c) => (
          <li key={c.hash} className="flex items-baseline gap-3 px-4 py-1.5 border-b border-rule">
            <code className="font-mono text-[11px] text-text-tertiary flex-shrink-0">{c.short}</code>
            <span className="flex-1 min-w-0 truncate text-text-primary" title={c.subject}>
              {c.subject}
            </span>
            <span className="text-text-tertiary flex-shrink-0">{c.author}</span>
            <span className="text-text-tertiary flex-shrink-0">{c.date}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (branches.length === 0) {
    return <div className="p-6 text-center text-text-tertiary text-xs">{t("gitNoBranches")}</div>;
  }
  return (
    <ul className="py-1 text-xs">
      {branches.map((b) => (
        <li key={b.name} className="flex items-center gap-3 px-4 py-1.5 border-b border-rule">
          <Icon name={b.current ? "check" : "git-branch"} size={12} />
          <span className="flex-1 min-w-0 truncate text-text-primary">{b.name}</span>
          {b.upstream && <span className="text-text-tertiary truncate">{b.upstream}</span>}
          {!b.current && (
            <button
              type="button"
              onClick={() => void switchTo(b.name)}
              className="px-2 py-0.5 rounded-xs border border-rule text-text-secondary hover:text-text-primary text-[11px]"
            >
              {t("gitSwitchBranch")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
