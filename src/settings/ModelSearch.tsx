import { useEffect, useState } from "react";
import { ChevronRight, Clock, Loader2, Search } from "lucide-react";
import { Badge } from "./Controls";
import InView from "../chat/InView";
import { describeFit, describeSplit, FIT_COLOURS } from "../vram";
import type { PullState } from "./useModelManager";
import type { LibraryModel } from "../types";

/** Hugging Face search with each variant's size and fit, shared by the Models page and the
 * first-run setup so neither keeps its own copy. */

function variantTags(model: LibraryModel) {
  return model.sizes.length > 0 ? model.sizes : ["latest"];
}

/** Titles repeat across repos, so downloads and sizes are addressed by repo when there is one. */
const modelId = (model: LibraryModel) => model.repo ?? model.name;

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

interface ModelSearchProps {
  vram: number;
  unifiedMemory: boolean;
  /** Set for a variant already downloading or waiting in the queue. */
  phaseFor: (reference: string) => PullState["phase"] | undefined;
  onPick: (reference: string, bytes?: number) => void;
  /** Beside the search field, like the Models page's downloads menu. */
  trailing?: React.ReactNode;
  /** The variant chosen in the setup, marked as pressed; the Models page leaves it unset. */
  picked?: string;
  pickLabel?: string;
  t: (key: string) => string;
}

export default function ModelSearch({ vram, unifiedMemory, phaseFor, onPick, trailing, picked, pickLabel, t }: ModelSearchProps) {
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

  return (
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
        {trailing}
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
                          vram={vram}
                          unifiedMemory={unifiedMemory}
                          phase={phaseFor(reference)}
                          picked={picked === undefined ? undefined : picked === reference}
                          pickLabel={pickLabel}
                          onPull={() => onPick(reference, sizes[reference])}
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
  );
}

function Variant({
  label,
  bytes,
  vram,
  unifiedMemory,
  phase,
  picked,
  pickLabel,
  onPull,
  t,
}: {
  label: string;
  bytes?: number;
  vram: number;
  unifiedMemory: boolean;
  /** Set while this variant is already downloading or waiting in the queue. */
  phase?: PullState["phase"];
  picked?: boolean;
  pickLabel?: string;
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
          aria-pressed={picked}
          className={`px-3 py-1.5 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity flex-shrink-0 ${
            picked ? "ring-2 ring-offset-2 ring-[var(--text-main)] ring-offset-[var(--bg-base)]" : ""
          }`}
        >
          {pickLabel ?? t("download")}
        </button>
      )}
    </div>
  );
}
