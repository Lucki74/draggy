import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Search, Trash2 } from "lucide-react";
import { Block, Group, Page, Row, Select } from "./Controls";
import CompactLimitField from "./CompactLimitField";
import PullProgress from "./PullProgress";
import { cannotGenerate, isEmbeddingModel } from "../modelKinds";
import { describeFit, describeSplit } from "../vram";
import type { ModelManager } from "./useModelManager";
import type { AppSettings, LibraryModel } from "../types";

interface ModelsPageProps {
  manager: ModelManager;
  settings: AppSettings;
  /** The model Chat is running. */
  chatModel: string;
  onUpdate: (patch: Partial<AppSettings>) => void;
  t: (key: string) => string;
}

const formatSize = (bytes: number) => (bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "");

function variantTags(model: LibraryModel) {
  return model.sizes.length > 0 ? model.sizes : ["latest"];
}

const FIT_COLOURS = { green: "#22c55e", amber: "#f59e0b", red: "#ef4444" } as const;

/** What is installed, what can be downloaded, and the two models that serve everything else: the
 * one that indexes documents, and when a conversation gets folded. */
export default function ModelsPage({ manager, settings, chatModel, onUpdate, t }: ModelsPageProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibraryModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      setSearching(true);
      window.electronAPI
        ?.searchModels(query)
        .then((result) => {
          if (!cancelled) setResults(result?.success ? result.models || [] : []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  useEffect(() => {
    const model = results.find((entry) => entry.name === expanded);
    if (!model) return;

    let cancelled = false;
    for (const size of variantTags(model)) {
      const reference = `${model.name}:${size}`;
      if (sizes[reference]) continue;

      window.electronAPI
        ?.modelSize(model.name, size)
        .then((result) => {
          if (cancelled || !result?.success || !result.bytes) return;
          setSizes((previous) => ({ ...previous, [reference]: result.bytes as number }));
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [expanded, results, sizes]);

  const codeModel = settings.codeModel || chatModel;

  return (
    <Page title={t("models")} description={t("modelsHint")}>
      <Group title={t("installed")}>
        {manager.installed.length === 0 ? (
          <Row label={t("noModelsFound")} />
        ) : (
          manager.installed.map((entry) => {
            const usedBy = [
              entry.name === chatModel ? t("chatMode") : null,
              entry.name === codeModel ? t("codeMode") : null,
            ].filter((label): label is string => Boolean(label));

            return (
              <div key={entry.name} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span className="truncate">{entry.name}</span>
                    {entry.parameterSize && (
                      <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] flex-shrink-0">
                        {entry.parameterSize}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-[var(--text-muted)]">
                    {formatSize(entry.size)}
                    {cannotGenerate(entry.capabilities) && (
                      <Badge title={t("embeddingOnlyHint")}>{t("embeddingOnly")}</Badge>
                    )}
                    {usedBy.map((label) => (
                      <Badge key={label} strong>
                        {label}
                      </Badge>
                    ))}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void manager.remove(entry.name)}
                  disabled={usedBy.length > 0}
                  aria-label={`${t("remove")} ${entry.name}`}
                  title={usedBy.length > 0 ? t("inUse") : t("remove")}
                  className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </Group>

      <Group title={t("downloadModel")}>
        <Block>
          {manager.pull ? (
            <PullProgress state={manager.pull} onCancel={manager.cancelPull} t={t} />
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchModelsPlaceholder")}
                  aria-label={t("searchModelsPlaceholder")}
                  className="w-full p-2.5 pl-10 ui-input text-sm font-bold"
                />
                {searching && (
                  <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />
                )}
              </div>

              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {results.length === 0 && !searching && (
                  <p className="px-1 text-sm font-bold text-[var(--text-muted)]">{t("noSearchResults")}</p>
                )}

                {results.map((model) => {
                  const open = expanded === model.name;

                  return (
                    <div
                      key={model.name}
                      className="rounded-xl border-2 border-[var(--border-light)] bg-[var(--bg-base)] overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : model.name)}
                        aria-expanded={open}
                        className="w-full text-left p-3 hover:bg-[var(--hover-bg)] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold truncate">{model.name}</span>
                          {model.capabilities.map((capability) => (
                            <Badge key={capability}>{capability}</Badge>
                          ))}
                          <ChevronRight
                            className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                          />
                        </div>
                        {model.description && (
                          <p className="mt-1 text-xs font-medium text-[var(--text-muted)] line-clamp-2">
                            {model.description}
                          </p>
                        )}
                      </button>

                      {open && (
                        <div className="border-t-2 border-[var(--border-light)] p-2 space-y-1">
                          {variantTags(model).map((size) => {
                            const reference = `${model.name}:${size}`;
                            return (
                              <Variant
                                key={size}
                                label={reference}
                                bytes={sizes[reference]}
                                vram={manager.vram}
                                unifiedMemory={manager.unifiedMemory}
                                onPull={() => void manager.startPull(reference)}
                                t={t}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {manager.error && <p className="mt-3 text-xs font-bold text-red-500">{manager.error}</p>}
        </Block>
      </Group>

      <Group title={t("library")}>
        <Row label={t("embeddingModel")} description={t("embeddingModelHint")}>
          <Select
            label={t("embeddingModel")}
            value={settings.embedModel}
            options={[
              { id: "", label: t("automatic") },
              ...manager.installed
                .filter((entry) => isEmbeddingModel(entry.capabilities))
                .map((entry) => ({ id: entry.name, label: entry.name })),
            ]}
            onChange={(embedModel) => onUpdate({ embedModel })}
          />
        </Row>
      </Group>

      <Group title={t("contextGroup")}>
        <Block>
          <p className="mb-3 text-sm font-bold text-[var(--text-main)]">{t("compactLimitSetting")}</p>
          <CompactLimitField
            key={String(settings.compactLimit)}
            limit={settings.compactLimit ?? null}
            onChange={(compactLimit) => onUpdate({ compactLimit })}
            t={t}
          />
        </Block>
      </Group>
    </Page>
  );
}

function Badge({
  children,
  strong,
  title,
}: {
  children: React.ReactNode;
  strong?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0 ${
        strong
          ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
          : "border border-[var(--border-light)] text-[var(--text-muted)]"
      }`}
    >
      {children}
    </span>
  );
}

function Variant({
  label,
  bytes,
  vram,
  unifiedMemory,
  onPull,
  t,
}: {
  label: string;
  bytes?: number;
  vram: number;
  unifiedMemory: boolean;
  onPull: () => void;
  t: (key: string) => string;
}) {
  const fit = bytes ? describeFit({ modelBytes: bytes, vramGB: vram, unifiedMemory }) : null;
  const colour = fit ? FIT_COLOURS[fit.tone as keyof typeof FIT_COLOURS] : "var(--text-muted)";
  const summary = fit ? describeSplit(fit) : "";

  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
      <span className="text-xs font-bold truncate flex-1 min-w-0">{label}</span>
      {fit && (
        <span className="text-[10px] font-bold text-[var(--text-muted)] flex-shrink-0">
          {fit.sizeGB.toFixed(1)} GB{summary ? ` · ${summary}` : ""}
        </span>
      )}
      <button
        type="button"
        onClick={onPull}
        className="px-3 py-1.5 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity flex-shrink-0"
      >
        {t("download")}
      </button>
    </div>
  );
}
