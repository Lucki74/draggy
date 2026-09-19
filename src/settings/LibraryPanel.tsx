import { useCallback, useEffect, useState } from "react";
import { FileText, FolderPlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "./Controls";
import PullProgress from "./PullProgress";
import { isEmbedModel, planEmbedModel } from "../embedModel";
import type { ModelManager } from "./useModelManager";
import type { LibraryProgress, LibrarySource } from "../types";

interface LibraryPanelProps {
  /** Whose folders these are: Chat's, or one project's. Neither sees the other's. */
  workspaceId: string;
  manager: ModelManager;
  embedModel: string;
  onChange?: () => void;
  t: (key: string) => string;
}

/** The folders a workspace has indexed, with adding, reindexing and removing. Indexing fetches the
 * embedding model first if "automatic" has never been downloaded here. */
export default function LibraryPanel({ workspaceId, manager, embedModel, onChange, t }: LibraryPanelProps) {
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [progress, setProgress] = useState<LibraryProgress | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  const api = window.electronAPI?.library;

  useEffect(() => {
    if (!api) return;

    let current = true;
    api
      .list(workspaceId)
      .then((result) => {
        if (current) setSources(result?.success ? (result.sources ?? []) : []);
      })
      .catch(() => undefined);

    const stop = api.onProgress(setProgress);
    return () => {
      current = false;
      stop?.();
    };
  }, [api, workspaceId, revision]);

  const changed = useCallback(() => {
    setRevision((count) => count + 1);
    onChange?.();
  }, [onChange]);

  const resolveModel = async (): Promise<string | null> => {
    const plan = planEmbedModel({
      override: embedModel,
      installed: manager.installed.map((entry) => entry.name),
      vram: manager.vram,
    });
    if (plan.download && !(await manager.startPull(plan.model, { immediate: true }))) return null;
    return plan.model;
  };

  const index = async (path: string) => {
    if (!api) return;

    setError("");
    const model = await resolveModel();
    if (!model) {
      setError(manager.error || t("embedModelFailed"));
      return;
    }

    setProgress({ phase: "indexing", current: 0, total: 0, file: "" });
    const result = await api.index(path, model, workspaceId);
    setProgress(null);

    if (!result?.success) setError(result?.error || t("indexingFailed"));
    changed();
  };

  const addFolder = async () => {
    const picked = await api?.pickFolder();
    if (picked?.success && picked.path) await index(picked.path);
  };

  const remove = async (id: number) => {
    await api?.remove(id);
    changed();
  };

  if (!api) return null;

  // A chat model downloading on the Models tab shares this manager and must not take over here.
  const embedPull = manager.pulls.find((pull) => isEmbedModel(pull.name, embedModel));
  const isEmbedPull = Boolean(embedPull);

  return (
    <div className="space-y-2">
      {sources.length === 0 && (
        <p className="text-sm font-bold text-[var(--text-muted)]">{t("noFoldersIndexed")}</p>
      )}

      {sources.map((source) => (
        <div
          key={source.id}
          className="flex items-center gap-3 rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-base)] px-3 py-2"
        >
          <FileText className="w-4 h-4 flex-shrink-0 opacity-60" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" title={source.path}>
              {source.path}
            </p>
            <p className="text-[11px] font-bold text-[var(--text-muted)]">
              {source.files} {t("files")} · {source.chunks} {t("passages")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void index(source.path)}
            disabled={Boolean(progress || isEmbedPull)}
            aria-label={t("reindex")}
            title={t("reindex")}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)] transition-colors disabled:opacity-40"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => void remove(source.id)}
            aria-label={t("remove")}
            title={t("remove")}
            className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      {embedPull ? (
        <PullProgress state={embedPull} t={t} />
      ) : progress ? (
        <div className="space-y-2 rounded-lg border-2 border-[var(--border-light)] bg-[var(--bg-base)] p-3">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <span className="text-sm font-bold truncate flex-1 min-w-0">
              {progress.file || t("indexing")}
            </span>
            <span className="text-[11px] font-bold text-[var(--text-muted)]">
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-[var(--hover-bg)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                background: "var(--text-main)",
              }}
            />
          </div>
        </div>
      ) : (
        <Button onClick={() => void addFolder()}>
          <FolderPlus className="w-4 h-4" />
          {t("addFolder")}
        </Button>
      )}

      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
    </div>
  );
}
