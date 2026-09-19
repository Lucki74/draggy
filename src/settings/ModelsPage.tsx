import { useEffect, useState } from "react";
import { ChevronRight, Clock, Loader2, PowerOff, Search, Trash2 } from "lucide-react";
import { Block, Group, Page, Row, Select } from "./Controls";
import InView from "../chat/InView";
import CompactLimitField from "./CompactLimitField";
import DownloadsMenu from "./DownloadsMenu";
import { cannotGenerate, isEmbeddingModel } from "../modelKinds";
import { describeFit, describeSplit } from "../vram";
import { CONTEXT_BUCKETS, displayModelName } from "../llama";
import type { ModelManager, PullState } from "./useModelManager";
import type { AppSettings, LibraryModel } from "../types";
import type { SettingsTab } from "./pages";

interface ModelsPageProps {
  manager: ModelManager;
  settings: AppSettings;
  /** The model Chat is running. */
  chatModel: string;
  onUpdate: (patch: Partial<AppSettings>) => void;
  /** Navigates to another settings tab, used for the chat/code preference shortcuts. */
  onNavigate: (tab: SettingsTab) => void;
  t: (key: string) => string;
}

const formatSize = (bytes: number) => (bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "");

function variantTags(model: LibraryModel) {
  return model.sizes.length > 0 ? model.sizes : ["latest"];
}

/** Titles repeat across repos, so downloads and sizes are addressed by repo when there is one. */
const modelId = (model: LibraryModel) => model.repo ?? model.name;

const FIT_COLOURS = { green: "#22c55e", amber: "#f59e0b", red: "#ef4444" } as const;

const CAPABILITY_KEYS: Record<string, string> = {
  tools: "capabilityTools",
  thinking: "capabilityThinking",
  embedding: "capabilityEmbedding",
  reranking: "capabilityReranking",
  "image-generation": "capabilityImageGeneration",
  "video-generation": "capabilityVideoGeneration",
  "3d-generation": "capability3dGeneration",
  "speech-recognition": "capabilitySpeechRecognition",
  "text-to-speech": "capabilityTextToSpeech",
  "audio-generation": "capabilityAudioGeneration",
  "audio-processing": "capabilityAudioProcessing",
  "image-analysis": "capabilityImageAnalysis",
  "video-analysis": "capabilityVideoAnalysis",
  translation: "capabilityTranslation",
  summarization: "capabilitySummarization",
  "question-answering": "capabilityQuestionAnswering",
  "fill-mask": "capabilityFillMask",
  "text-classification": "capabilityTextClassification",
  "time-series": "capabilityTimeSeries",
  tabular: "capabilityTabular",
  robotics: "capabilityRobotics",
  graph: "capabilityGraph",
  other: "capabilityOther",
  vision: "capabilityVision",
};

/** What is installed, what can be downloaded, and the two models that serve everything else: the
 * one that indexes documents, and when a conversation gets folded. */
export default function ModelsPage({ manager, settings, chatModel, onUpdate, onNavigate, t }: ModelsPageProps) {
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
    const model = results.find((entry) => modelId(entry) === expanded);
    if (!model) return;

    let cancelled = false;
    for (const size of variantTags(model)) {
      const reference = `${modelId(model)}:${size}`;
      if (sizes[reference]) continue;

      window.electronAPI
        ?.modelSize(modelId(model), size)
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

  const contextSizeOptions = [
    { id: "", label: t("automatic") },
    { id: "max", label: t("maxContext") },
    ...CONTEXT_BUCKETS.map((n) => ({ id: String(n), label: `${(n / 1024).toFixed(0)}k` })),
  ];

  return (
    <Page title={t("models")} description={t("modelsHint")}>
      <Group title={t("installed")}>
        {/* The model each mode runs is picked on its own page, so these jump straight there. */}
        <div className="px-4 py-2.5 flex items-center gap-3 bg-[var(--hover-bg)]/40">
          <span className="text-[11px] font-bold text-[var(--text-muted)]">{t("chooseModel")}</span>
          <div className="flex items-center gap-2">
            {(["chat", "code"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onNavigate(tab)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--text-main)] bg-[var(--bg-base)] border border-[var(--border-light)] hover:bg-[var(--hover-bg)] hover:border-[var(--text-muted)] transition-all shadow-xs"
              >
                {t(tab === "chat" ? "chatMode" : "codeMode")}
                <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
              </button>
            ))}
          </div>
        </div>

        {manager.installed.length === 0 ? (
          <Row label={t("noModelsFound")} />
        ) : (
          manager.installed.map((entry) => {
            const usedBy = [
              entry.name === chatModel ? t("chatMode") : null,
              entry.name === codeModel ? t("codeMode") : null,
            ].filter((label): label is string => Boolean(label));

            const isLoaded = manager.loaded.includes(entry.name) ||
              manager.loaded.some((n) => n.split(":")[0] === entry.name.split(":")[0]);

            return (
              <div key={entry.name} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span className="truncate">{displayModelName(entry.name)}</span>
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

                {isLoaded && (
                  <button
                    type="button"
                    onClick={() => void manager.unload(entry.name)}
                    aria-label={`${t("unloadModel")} ${displayModelName(entry.name)}`}
                    title={t("unloadModel")}
                    className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] transition-colors"
                  >
                    <PowerOff className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void manager.remove(entry.name)}
                  disabled={usedBy.length > 0}
                  aria-label={`${t("remove")} ${displayModelName(entry.name)}`}
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
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
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
              <DownloadsMenu pulls={manager.pulls} onCancel={manager.cancelPull} t={t} />
            </div>

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {results.length === 0 && !searching && (
                <p className="px-1 text-sm font-bold text-[var(--text-muted)]">{t("noSearchResults")}</p>
              )}

              {results.map((model) => {
                const id = modelId(model);
                const open = expanded === id;

                return (
                  <InView key={id} estimatedHeight={72} forceRender={open}>
                    <div
                      className="rounded-xl border-2 border-[var(--border-light)] bg-[var(--bg-base)] overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : id)}
                        aria-expanded={open}
                        className="w-full text-left p-3 hover:bg-[var(--hover-bg)] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[var(--text-main)] truncate">{model.name}</span>
                          {/* Every chat model can chat, so that says nothing; a model that cannot shows what it is. */}
                          {model.capabilities
                            .filter((capability) => capability !== "completion")
                            .map((capability) => {
                              const key = CAPABILITY_KEYS[capability];
                              return <Badge key={capability}>{key ? t(key) : capability}</Badge>;
                            })}
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
                            const reference = `${id}:${size}`;
                            return (
                              <Variant
                                key={size}
                                label={reference}
                                bytes={sizes[reference]}
                                vram={manager.vram}
                                unifiedMemory={manager.unifiedMemory}
                                phase={manager.pulls.find((pull) => pull.name === reference)?.phase}
                                onPull={() => void manager.startPull(reference)}
                                t={t}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </InView>
                );
              })}
            </div>
          </div>

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
                .map((entry) => ({ id: entry.name, label: displayModelName(entry.name) })),
            ]}
            onChange={(embedModel) => onUpdate({ embedModel })}
          />
        </Row>
      </Group>

      <Group title={t("contextGroup")}>
        <Row label={t("fixedContextSize")} description={t("fixedContextSizeHint")}>
          <Select
            label={t("fixedContextSize")}
            value={settings.fixedContextSize ? String(settings.fixedContextSize) : ""}
            options={contextSizeOptions}
            onChange={(value) =>
              onUpdate({
                fixedContextSize: value === "max" ? "max" : value ? Number(value) : null,
              })
            }
          />
        </Row>
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
  phase,
  onPull,
  t,
}: {
  label: string;
  bytes?: number;
  vram: number;
  unifiedMemory: boolean;
  /** Set while this variant is already downloading or waiting in the queue. */
  phase?: PullState["phase"];
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
      {phase ? (
        <span
          role="status"
          aria-label={t(phase === "queued" ? "queuedDownload" : "downloadingModel")}
          title={t(phase === "queued" ? "queuedDownload" : "downloadingModel")}
          className="px-3 py-1.5 flex-shrink-0 text-[var(--text-muted)]"
        >
          {phase === "queued" ? <Clock className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        </span>
      ) : (
        <button
          type="button"
          onClick={onPull}
          className="px-3 py-1.5 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity flex-shrink-0"
        >
          {t("download")}
        </button>
      )}
    </div>
  );
}
