import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FolderOpen, Loader2, Pencil, Trash2 } from "lucide-react";
import CreatedFiles from "../CreatedFiles";
import FileTree from "./FileTree";
import { baseName, breadcrumbs, joinPath, parentOf } from "./tree";
import { useTranslator } from "../i18n";
import type { AppSettings, DirectoryEntry, Workspace } from "../types";

interface ExplorerProps {
  settings: AppSettings;
  workspace: Workspace;
}

/**
 * The files screen. A plain chat has only what Draggy made, which is the
 * gallery it always had; a project has a folder of the user's, which is a tree
 * and a preview. The two are one screen because "where did that file go" is
 * one question either way.
 */
export default function Explorer({ settings, workspace }: ExplorerProps) {
  const t = useTranslator(settings.language);

  if (!workspace.rootPath) return <CreatedFiles settings={settings} />;

  return (
    <ProjectFiles
      key={workspace.id}
      workspaceId={workspace.id}
      root={workspace.rootPath}
      t={t}
    />
  );
}

function ProjectFiles({
  workspaceId,
  root,
  t,
}: {
  workspaceId: string;
  root: string;
  t: (key: string) => string;
}) {
  const [selected, setSelected] = useState<DirectoryEntry | null>(null);
  const [revision, setRevision] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  /**
   * What was read, and which file it was read from. Carrying the path means the
   * screen can tell a finished read from a stale one without clearing state on
   * every selection, which would paint the old file's text under a new name.
   */
  const [preview, setPreview] = useState<{
    path: string;
    text: string | null;
    error: string | null;
  } | null>(null);

  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI?.files;
    if (!api || !selected) return;

    let cancelled = false;
    const target = selected.path;

    api
      .read(workspaceId, target)
      .then((result) => {
        if (cancelled) return;
        setPreview({
          path: target,
          text: result?.success ? (result.text ?? "") : null,
          error: result?.success ? null : (result?.error ?? null),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPreview({ path: target, text: null, error: t("previewUnavailable") });
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, selected, revision, t]);

  const current = selected && preview?.path === selected.path ? preview : null;

  const changed = useCallback(() => {
    setRevision((count) => count + 1);
    setSelected(null);
    setRenaming(null);
    setConfirming(false);
  }, []);

  const rename = useCallback(
    async (name: string) => {
      const api = window.electronAPI?.files;
      if (!api || !selected || !name.trim() || name === selected.name) {
        setRenaming(null);
        return;
      }

      const target = joinPath(parentOf(selected.path), name.trim());
      const result = await api.move(workspaceId, selected.path, target);

      if (result?.success) changed();
      else setProblem(result?.error ?? null);
    },
    [workspaceId, selected, changed],
  );

  const remove = useCallback(async () => {
    const api = window.electronAPI?.files;
    if (!api || !selected) return;

    const result = await api.remove(workspaceId, selected.path);

    if (result?.success) changed();
    else setProblem(result?.error ?? null);
  }, [workspaceId, selected, changed]);

  const crumbs = selected ? breadcrumbs(root, selected.path) : [];

  return (
    <div className="flex-1 flex min-h-0 bg-[var(--bg-base)]">
      <div
        className="w-64 flex-shrink-0 overflow-y-auto border-r-[3px]"
        style={{ borderColor: "var(--border-light)" }}
      >
        <FileTree
          workspaceId={workspaceId}
          root={root}
          selected={selected?.path ?? null}
          onSelect={setSelected}
          t={t}
          revision={revision}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
            <FolderOpen className="w-10 h-10 opacity-40" />
            <p className="text-sm font-bold tracking-tight">{t("chooseFile")}</p>
          </div>
        ) : (
          <>
            <div
              className="flex items-center gap-2 px-5 py-3 border-b-[3px]"
              style={{ borderColor: "var(--border-light)" }}
            >
              <div className="flex-1 min-w-0">
                {renaming === null ? (
                  <p className="truncate text-sm font-bold tracking-tight">
                    {crumbs.map((crumb, index) => (
                      <span key={crumb.path}>
                        {index > 0 && (
                          <span className="opacity-40 px-1" aria-hidden="true">
                            /
                          </span>
                        )}
                        <span
                          className={
                            index === crumbs.length - 1 ? "" : "text-[var(--text-muted)]"
                          }
                        >
                          {crumb.name}
                        </span>
                      </span>
                    ))}
                  </p>
                ) : (
                  <input
                    autoFocus
                    value={renaming}
                    onChange={(event) => setRenaming(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void rename(renaming);
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => void rename(renaming)}
                    aria-label={t("rename")}
                    className="w-full rounded-lg border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] px-2 py-1 text-sm font-bold outline-none"
                  />
                )}
              </div>

              <button
                onClick={() => setRenaming(baseName(selected.path))}
                title={t("rename")}
                aria-label={t("rename")}
                className="p-2 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <Pencil className="w-4 h-4" />
              </button>

              <button
                onClick={() => window.electronAPI?.openFile?.(selected.path)}
                title={t("openFile")}
                aria-label={t("openFile")}
                className="p-2 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <ExternalLink className="w-4 h-4" />
              </button>

              {confirming ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void remove()}
                    className="rounded-lg border-[3px] border-red-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-500"
                  >
                    {t("confirm")}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    {t("cancel")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  title={t("delete")}
                  aria-label={t("delete")}
                  className="p-2 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--text-muted)] hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto p-5">
              {problem ? (
                <p className="text-sm text-red-500">{problem}</p>
              ) : current === null ? (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("loading")}
                </div>
              ) : current.text !== null ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
                  {current.text}
                </pre>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  {current.error || t("previewUnavailable")}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
