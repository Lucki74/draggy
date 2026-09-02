import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image,
  Presentation,
  RefreshCw,
  Search,
  Trash,
} from "lucide-react";
import { translations } from "./translations";
import { formatSize, groupFiles, kindOf, matchesQuery } from "./fileList";
import type { FileKind } from "./fileList";
import type { AppSettings, CreatedFile } from "./types";

/**
 * Everything the model wrote, read from the folder rather than a list in the
 * app: a file deleted from the desktop simply stops appearing here.
 */

interface CreatedFilesProps {
  settings: AppSettings;
}

const ICONS: Record<FileKind, typeof File> = {
  code: FileCode,
  image: Image,
  sheet: FileSpreadsheet,
  slides: Presentation,
  document: FileText,
  other: File,
};

interface Preview {
  text: string;
  truncated: boolean;
  binary: boolean;
}

export default function CreatedFiles({ settings }: CreatedFilesProps) {
  const t = useCallback(
    (key: string) =>
      translations[settings.language]?.[key] || translations["en"][key] || key,
    [settings.language],
  );

  const [files, setFiles] = useState<CreatedFile[]>([]);
  const [listedAt, setListedAt] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    try {
      const outcome = await window.electronAPI?.listCreatedFiles();
      setFiles(outcome?.files ?? []);
      setError(outcome?.success === false ? (outcome.error ?? "") : "");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      // Captured once per listing rather than read during render, so the day
      // boundaries below stay stable between renders.
      setListedAt(Date.now());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const outcome = await window.electronAPI?.listCreatedFiles().catch(() => null);
      if (cancelled) return;
      setFiles(outcome?.files ?? []);
      setListedAt(Date.now());
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const visible = files.filter((file) => matchesQuery(file.name, query));
    return groupFiles(visible, listedAt || 0);
  }, [files, query, listedAt]);

  const visibleCount = groups.reduce((total, group) => total + group.files.length, 0);

  const togglePreview = async (file: CreatedFile) => {
    if (openPath === file.path) {
      setOpenPath(null);
      setPreview(null);
      return;
    }

    setOpenPath(file.path);
    setPreview(null);

    const outcome = await window.electronAPI?.readCreatedFile(file.path);
    if (!outcome?.success) {
      setPreview({ text: outcome?.error ?? "", truncated: false, binary: true });
      return;
    }

    setPreview({
      text: outcome.text ?? "",
      truncated: Boolean(outcome.truncated),
      binary: Boolean(outcome.binary),
    });
  };

  const remove = async (file: CreatedFile) => {
    const outcome = await window.electronAPI?.deleteCreatedFile(file.path);

    if (!outcome?.success) {
      if (outcome?.error) setError(outcome.error);
      return;
    }

    setFiles((current) => current.filter((entry) => entry.path !== file.path));
    if (openPath === file.path) {
      setOpenPath(null);
      setPreview(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-base)] p-6 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto flex flex-col h-full space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-wider text-[var(--text-main)] uppercase">
            {t("createdFiles")}
          </h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={refresh}
              title={t("refresh")}
              className="p-2 rounded-lg border-2 border-[var(--border-light)] text-[var(--text-main)] hover:bg-[var(--hover-bg)] transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => window.electronAPI?.openCreatedFiles()}
              className="px-3 py-2 rounded-lg border-2 border-[var(--border-light)] text-[var(--text-main)] hover:bg-[var(--hover-bg)] transition-colors flex items-center gap-2 text-xs font-bold"
            >
              <FolderOpen className="w-4 h-4" />
              {t("openFolder")}
            </button>
          </div>
        </div>

        {files.length > 0 && (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchFiles")}
              className="ui-input w-full pl-9"
            />
          </div>
        )}

        {error && <p className="text-xs font-bold text-red-500">{error}</p>}

        {!loading && files.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
            <File className="w-10 h-10 text-[var(--text-muted)] opacity-40" />
            <p className="text-sm font-bold text-[var(--text-main)]">
              {t("noFilesYet")}
            </p>
            <p className="text-xs font-medium text-[var(--text-muted)] max-w-sm">
              {t("noFilesYetHint")}
            </p>
          </div>
        )}

        {files.length > 0 && visibleCount === 0 && (
          <p className="text-sm font-medium text-[var(--text-muted)]">
            {t("noMatchingFiles")}
          </p>
        )}

        <div className="flex flex-col gap-5 pb-6">
          {groups.map(({ group, files: bucket }) => (
            <div key={group} className="flex flex-col gap-2">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {t(group)}
              </h2>

              {bucket.map((file) => {
                const Icon = ICONS[kindOf(file.extension)];
                const isOpen = openPath === file.path;

                return (
                  <div
                    key={file.path}
                    className="border-2 border-[var(--border-light)] rounded-xl overflow-hidden bg-[var(--bg-panel)]"
                  >
                    <div className="flex items-center gap-3 p-3">
                      <button
                        onClick={() => void togglePreview(file)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      >
                        <ChevronRight
                          className={`w-4 h-4 flex-shrink-0 text-[var(--text-muted)] transition-transform ${
                            isOpen ? "rotate-90" : ""
                          }`}
                        />
                        <div className="w-9 h-9 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] flex items-center justify-center flex-shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-bold text-[var(--text-main)] truncate">
                            {file.name}
                          </span>
                          <span className="text-xs font-medium text-[var(--text-muted)]">
                            {formatSize(file.size)} ·{" "}
                            {new Date(file.modified).toLocaleString(
                              settings.language,
                            )}
                          </span>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => window.electronAPI?.openFile(file.path)}
                          title={t("openFile")}
                          className="p-2 rounded-lg text-[var(--text-main)] hover:bg-[var(--hover-bg)] transition-colors"
                        >
                          <FolderOpen className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            window.electronAPI?.revealCreatedFile(file.path)
                          }
                          title={t("showInFolder")}
                          className="p-2 rounded-lg text-[var(--text-main)] hover:bg-[var(--hover-bg)] transition-colors"
                        >
                          <Search className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => void remove(file)}
                          title={t("delete")}
                          className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500 transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t-2 border-[var(--border-light)] bg-[#1e1e1e] max-h-72 overflow-auto">
                        {preview === null ? (
                          <p className="p-4 text-xs font-mono text-gray-400">
                            {t("loading")}
                          </p>
                        ) : preview.binary ? (
                          <p className="p-4 text-xs font-mono text-gray-400">
                            {t("previewUnavailable")}
                          </p>
                        ) : (
                          <pre className="m-0 p-4 font-mono text-[13px] text-gray-300 whitespace-pre-wrap leading-relaxed break-words">
                            {preview.text}
                            {preview.truncated ? `\n\n${t("previewTruncated")}` : ""}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
