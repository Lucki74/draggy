import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Icon, IconButton, type IconName } from "./ui";
import { translations } from "./translations";
import { formatSize, groupFiles, kindOf, matchesQuery } from "./fileList";
import type { FileKind } from "./fileList";
import type { AppSettings, CreatedFile } from "./types";
import { FilePreview } from "./chat/FilePreview";
import { swallowed } from "./logger";

/** Everything the model wrote, read from the folder rather than a list in the app: a file deleted
 * from the desktop simply stops appearing here. */

interface CreatedFilesProps {
  settings: AppSettings;
}

const ICONS: Record<FileKind, IconName> = {
  code: "file-code",
  image: "file-image",
  sheet: "table",
  slides: "presentation",
  document: "file-text",
  other: "file",
};

// The draggy://images/ protocol serves exactly these types from the created-files folder.
const PICTURE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

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
  const [brokenPicture, setBrokenPicture] = useState<string | null>(null);

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
      const outcome = await window.electronAPI?.listCreatedFiles().catch(swallowed("app", "the main process already logged this call", null));
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
    setBrokenPicture(null);
    if (PICTURE_EXTENSIONS.has(file.extension)) return;

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
    <div className="flex-1 flex flex-col h-full bg-surface-canvas px-6 py-8 overflow-y-auto">
      <div className="max-w-[760px] w-full mx-auto flex flex-col h-full gap-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[22px] font-semibold text-text-primary">{t("createdFiles")}</h1>
          <div className="flex items-center gap-1 flex-shrink-0">
            <IconButton
              name={loading ? "circle-notch" : "arrow-clockwise"}
              label={t("refresh")}
              className={loading ? "[&_svg]:animate-spin" : ""}
              onClick={refresh}
            />
            <Button variant="secondary" size="dense" icon={<Icon name="folder-open" size={16} />} onClick={() => window.electronAPI?.openCreatedFiles()}>
              {t("openFolder")}
            </Button>
          </div>
        </div>

        {files.length > 0 && (
          <div className="relative">
            <Icon
              name="magnifying-glass"
              size={16}
              className="absolute start-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchFiles")}
              aria-label={t("searchFiles")}
              className="h-8 w-full rounded-sm bg-surface-base ps-9 pe-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}

        {!loading && files.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-[15px] font-medium text-text-primary">{t("noFilesYet")}</p>
            <p className="text-[13px] text-text-secondary max-w-sm">{t("noFilesYetHint")}</p>
          </div>
        )}

        {files.length > 0 && visibleCount === 0 && (
          <p className="text-[13px] text-text-secondary">{t("noMatchingFiles")}</p>
        )}

        <div className="flex flex-col gap-6 pb-6">
          {groups.map(({ group, files: bucket }) => (
            <section key={group} className="flex flex-col">
              <h2 className="mb-1 text-[12px] font-medium text-text-tertiary">{t(group)}</h2>

              {bucket.map((file) => {
                const isOpen = openPath === file.path;

                return (
                  <div key={file.path} className="group/file border-b border-rule last:border-b-0">
                    <div className="flex items-center gap-2 min-h-12">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => void togglePreview(file)}
                        className="flex items-center gap-3 flex-1 min-w-0 py-2 text-start rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        <Icon
                          name="caret-right"
                          size={12}
                          mirrored
                          className={`flex-shrink-0 text-text-tertiary transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                        <Icon name={ICONS[kindOf(file.extension)]} size={20} className="flex-shrink-0 text-text-secondary" />
                        <span className="flex flex-col min-w-0">
                          <span className="text-[14px] text-text-primary truncate">{file.name}</span>
                          <span className="text-[12px] text-text-secondary tabular-nums">
                            {formatSize(file.size)} · {new Date(file.modified).toLocaleString(settings.language)}
                          </span>
                        </span>
                      </button>

                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100 transition-opacity">
                        <IconButton
                          name="arrow-square-out"
                          size="dense"
                          label={t("openFile")}
                          onClick={() => window.electronAPI?.openFile(file.path)}
                        />
                        <IconButton
                          name="folder-open"
                          size="dense"
                          label={t("showInFolder")}
                          onClick={() => window.electronAPI?.revealCreatedFile(file.path)}
                        />
                        <IconButton
                          name="trash"
                          size="dense"
                          variant="danger"
                          label={t("delete")}
                          onClick={() => void remove(file)}
                        />
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mb-3 rounded-sm border border-rule bg-surface-base max-h-80 overflow-auto">
                        {PICTURE_EXTENSIONS.has(file.extension) ? (
                          brokenPicture === file.path ? (
                            <p className="p-4 text-[13px] text-text-secondary">{t("previewUnavailable")}</p>
                          ) : (
                            <img
                              src={`draggy://images/${encodeURIComponent(file.name)}`}
                              alt={file.name}
                              className="block max-w-full mx-auto"
                              onError={() => setBrokenPicture(file.path)}
                            />
                          )
                        ) : preview === null ? (
                          <p className="p-4 text-[13px] text-text-secondary">{t("loading")}</p>
                        ) : preview.binary ? (
                          <p className="p-4 text-[13px] text-text-secondary">{t("previewUnavailable")}</p>
                        ) : (
                          <div>
                            <FilePreview filename={file.name} content={preview.text} t={t} />
                            {preview.truncated && (
                              <p className="px-4 py-2 text-[12px] text-text-secondary border-t border-rule">
                                {t("previewTruncated")}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}