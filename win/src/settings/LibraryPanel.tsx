import { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui/icons/Icon";
import { Button, ConfirmDialog } from "./Controls";
import { fill } from "../onboarding/text";
import { baseName } from "../files/tree";
import PullProgress from "./PullProgress";
import { ProgressLine } from "../ui/ProgressLine";
import { installedMatch, isEmbedModel, planEmbedModel } from "../embedModel";
import { isActivePull, type ModelManager } from "./useModelManager";
import type { LibraryProgress, LibrarySource } from "../types";
import { swallowed } from "../logger";

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
  const [confirmingSource, setConfirmingSource] = useState<LibrarySource | null>(null);
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
      .catch(swallowed("settings", "the main process already logged this call"));

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
    if (!plan.download) return plan.model;
    if (!(await manager.startPull(plan.download.reference, { immediate: true }))) return null;

    // The file keeps the name the repository gave it, so it is looked up again once it has landed.
    const files = (await window.electronAPI?.gguf?.listModels()) ?? [];
    return installedMatch(plan.download.model, files.map((file) => file.filename));
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
  const embedPull = manager.pulls.find((pull) => isActivePull(pull) && isEmbedModel(pull.name, embedModel));
  const isEmbedPull = Boolean(embedPull);

  const indexed = progress && progress.total > 0 ? progress.current / progress.total : undefined;

  return (
    <div className="space-y-3">
      {sources.length === 0 ? (
        <p className="text-[13px] text-text-secondary">{t("noFoldersIndexed")}</p>
      ) : (
        <div className="divide-y divide-rule rounded-md bg-surface-base shadow-[0_0_0_1px_var(--rule-strong)]">
          {sources.map((source) => (
            <div key={source.id} className="flex items-center gap-3 px-3 py-2.5">
              <Icon name="folder-open" size={16} className="flex-shrink-0 text-text-tertiary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] leading-5 text-text-primary" title={source.path}>
                  {source.path}
                </p>
                <p className="text-[12px] leading-4 tabular-nums text-text-secondary">
                  {source.files} {t("files")} · {source.chunks} {t("passages")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void index(source.path)}
                disabled={Boolean(progress || isEmbedPull)}
                aria-label={t("reindex")}
                title={t("reindex")}
                className="rounded-sm p-2 text-text-secondary outline-none transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Icon name="arrow-clockwise" size={16} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmingSource(source)}
                aria-label={t("remove")}
                title={t("remove")}
                className="rounded-sm p-2 text-text-tertiary outline-none transition-colors hover:bg-surface-raised hover:text-danger focus-visible:ring-2 focus-visible:ring-focus"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmingSource && (
        <ConfirmDialog
          title={fill(t("removeFolderTitle"), { name: baseName(confirmingSource.path) || confirmingSource.path })}
          body={t("removeFolderBody")}
          confirmLabel={t("remove")}
          cancelLabel={t("cancel")}
          onCancel={() => setConfirmingSource(null)}
          onConfirm={() => {
            const id = confirmingSource.id;
            setConfirmingSource(null);
            void remove(id);
          }}
        />
      )}

      {embedPull ? (
        <PullProgress state={embedPull} t={t} />
      ) : progress ? (
        <div className="py-1">
          <div className="flex items-center gap-3 text-[13px] leading-5">
            <span className="min-w-0 flex-1 truncate text-text-primary">{progress.file || t("indexing")}</span>
            {progress.total > 0 && (
              <span className="flex-shrink-0 text-[12px] tabular-nums text-text-secondary">
                {progress.current}/{progress.total}
              </span>
            )}
          </div>
          <ProgressLine className="mt-2" progress={indexed} label={t("indexing")} />
        </div>
      ) : (
        <Button onClick={() => void addFolder()}>
          <Icon name="folder-simple-plus" size={16} />
          {t("addFolder")}
        </Button>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
