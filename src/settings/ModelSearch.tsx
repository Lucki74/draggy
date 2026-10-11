import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/icons/Icon";
import { StatusDot } from "../ui/StatusDot";
import { Badge } from "./Controls";
import InView from "../chat/InView";
import { describeFit, describeSplit, FIT_STATUS } from "../vram";
import type { PullState } from "./useModelManager";
import type { LibraryModel } from "../types";
import { swallowed } from "../logger";

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
  onPick: (reference: string, bytes?: number, capabilities?: string[]) => void;
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
  const [filters, setFilters] = useState<string[]>([]);

  // Every chat model can chat, so that is no filter; the chips are the other abilities in the results,
  // plus any still switched on so it can be switched off again.
  const abilities = useMemo(() => {
    const present = new Set([...results.flatMap((model) => model.capabilities), ...filters]);
    present.delete("completion");
    return Object.keys(CAPABILITY_KEYS).filter((capability) => present.has(capability));
  }, [results, filters]);
  const shown = results.filter((model) => filters.every((filter) => model.capabilities.includes(filter)));
  const toggle = (capability: string) =>
    setFilters((current) =>
      current.includes(capability) ? current.filter((entry) => entry !== capability) : [...current, capability],
    );

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    let cancelled = false;
    const handle = setTimeout(() => {
      setSearching(true);
      api
        .searchModels(query)
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
        .catch(swallowed("settings", "best effort, the screen works without it"));
    }

    return () => {
      cancelled = true;
    };
  }, [expanded, results, sizes]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm bg-surface-base px-3 text-[13px] text-text-primary shadow-[inset_0_0_0_1px_var(--rule-control)] outline-none focus-within:ring-2 focus-within:ring-focus">
          <Icon name="magnifying-glass" size={14} className="flex-shrink-0 text-text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchModelsPlaceholder")}
            aria-label={t("searchModelsPlaceholder")}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-tertiary"
          />
          {searching && <Icon name="circle-notch" size={14} className="flex-shrink-0 animate-spin text-text-tertiary" />}
        </label>
        {trailing}
      </div>

      {abilities.length > 0 && (
        <div role="group" aria-label={t("filterByAbility")} className="flex flex-wrap gap-1.5">
          {abilities.map((capability) => {
            const on = filters.includes(capability);
            return (
              <button
                key={capability}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(capability)}
                className={`h-7 rounded-pill px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
                  on
                    ? "bg-action-bg text-action-fg"
                    : "text-text-secondary shadow-[inset_0_0_0_1px_var(--rule-control)] hover:bg-surface-raised hover:text-text-primary"
                }`}
              >
                {t(CAPABILITY_KEYS[capability])}
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        !searching && <p className="px-1 text-[13px] text-text-secondary">{t("noSearchResults")}</p>
      ) : (
        <div className="max-h-[420px] divide-y divide-rule overflow-y-auto rounded-md shadow-[0_0_0_1px_var(--rule-strong)]">
          {shown.map((model) => {
            const id = modelId(model);
            const open = expanded === id;

            return (
              <InView key={id} estimatedHeight={64} forceRender={open}>
                <div>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : id)}
                    aria-expanded={open}
                    className="w-full px-3 py-2.5 text-start outline-none transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] leading-5 text-text-primary">{model.name}</span>
                      {model.capabilities
                        .filter((capability) => capability !== "completion")
                        .map((capability) => {
                          const key = CAPABILITY_KEYS[capability];
                          return <Badge key={capability}>{key ? t(key) : capability}</Badge>;
                        })}
                      <Icon
                        name="caret-right"
                        size={14}
                        className={`ms-auto flex-shrink-0 text-text-tertiary transition-transform ${open ? "rotate-90" : ""}`}
                      />
                    </span>
                    {model.description && (
                      <span className="mt-0.5 line-clamp-2 block text-[12px] leading-4 text-text-secondary">
                        {model.description}
                      </span>
                    )}
                  </button>

                  {open && (
                    <div className="space-y-0.5 bg-surface-raised/50 px-1.5 py-1.5">
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
                            onPull={() => onPick(reference, sizes[reference], model.capabilities)}
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
      )}
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
  const summary = fit ? describeSplit(fit) : "";

  return (
    <div className="flex items-center gap-3 rounded-sm px-2 py-1.5">
      {fit && fit.tone !== "unknown" ? <StatusDot status={FIT_STATUS[fit.tone]} /> : <StatusDot status="idle" />}
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">{label}</span>
      {fit && (
        <span className="flex-shrink-0 text-[12px] tabular-nums text-text-secondary">
          {fit.sizeGB.toFixed(1)} GB{summary ? ` · ${summary}` : ""}
        </span>
      )}
      {phase ? (
        <span
          role="status"
          aria-label={t(phase === "queued" ? "queuedDownload" : "downloadingModel")}
          title={t(phase === "queued" ? "queuedDownload" : "downloadingModel")}
          className="grid h-7 w-7 flex-shrink-0 place-items-center text-text-secondary"
        >
          {phase === "queued" ? <Icon name="clock" size={14} /> : <Icon name="circle-notch" size={14} className="animate-spin" />}
        </span>
      ) : (
        <Button
          variant={picked ? "primary" : "secondary"}
          size="dense"
          onClick={onPull}
          aria-pressed={picked}
          className="flex-shrink-0"
        >
          {pickLabel ?? t("download")}
        </Button>
      )}
    </div>
  );
}
