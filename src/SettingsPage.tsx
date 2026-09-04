import { useState, useEffect, useCallback, useRef } from "react";
import {
  Trash2,
  Plus,
  Check,
  Palette,
  Cpu,
  Sliders,
  Globe,
  Database,
  Loader2,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  Library,
  Wrench,
  DownloadCloud,
  FolderPlus,
  RefreshCw,
  FileText,
  AlertTriangle,
  Sparkles,
  Blocks,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import McpPanel from "./settings/McpPanel";
import { Field, Section, Stat, Toggle } from "./settings/Controls";
import { translations, languages } from "./translations";
import {
  PULL_PHASE_KEYS,
  listInstalledModels,
  deleteModel,
  pullModel,
} from "./ollama";
import type { PullPhase } from "./ollama";
import {
  cannotGenerate,
  isEmbeddingModel,
  selectableModels,
} from "./modelKinds";
import type { InstalledModel } from "./ollama";
import { describeFit, describeSplit } from "./vram";
import { planEmbedModel } from "./embedModel";
import {
  DEFAULT_NEURAL_VOICE,
  NEURAL_VOICES,
  isNeuralVoiceAvailable,
} from "./voice/neuralVoice";
import { isSystemVoiceSupported, listVoices } from "./voice/systemVoice";
import type {
  AppSettings,
  LibraryModel,
  LibraryProgress,
  LibrarySource,
  LibraryStats,
  SearchProvider,
  StorageStats,
  UpdaterState,
} from "./types";

const VOICE_SPEEDS = [0.9, 1, 1.1, 1.25];

function variantTags(model: LibraryModel) {
  return model.sizes.length > 0 ? model.sizes : ["latest"];
}

function VariantRow({
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
  const fit = bytes
    ? describeFit({ modelBytes: bytes, vramGB: vram, unifiedMemory })
    : null;

  const colour =
    fit?.tone === "green"
      ? "#22c55e"
      : fit?.tone === "amber"
        ? "#f59e0b"
        : fit?.tone === "red"
          ? "#ef4444"
          : "var(--text-muted)";

  const summary = fit ? describeSplit(fit) : "";

  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[var(--hover-bg)] transition-colors">
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: colour }}
      />
      <span className="text-xs font-bold truncate flex-1 min-w-0">{label}</span>

      {fit && (
        <span className="text-[10px] font-bold text-[var(--text-muted)] flex-shrink-0">
          {fit.sizeGB.toFixed(1)} GB{summary ? " · " + summary : ""}
        </span>
      )}

      <button
        onClick={onPull}
        className="px-3 py-1.5 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] text-[10px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity flex-shrink-0"
      >
        {t("download")}
      </button>
    </div>
  );
}

interface SettingsPageProps {
  settings: AppSettings;
  activeModel: string;
  initialTab: SettingsTab;
  onUpdate: (newSettings: AppSettings) => void;
  onSelectModel: (name: string) => void;
  onClearChats: () => void;
  onLibraryChange?: () => void;
}

export type SettingsTab =
  | "appearance"
  | "models"
  | "library"
  | "tools"
  | "extensions"
  | "personalization"
  | "language"
  | "data"
  | "updates";

const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: "appearance", label: "appearance", icon: Palette },
  { id: "models", label: "models", icon: Cpu },
  { id: "library", label: "library", icon: Library },
  { id: "tools", label: "tools", icon: Wrench },
  { id: "extensions", label: "extensions", icon: Blocks },
  { id: "personalization", label: "personalization", icon: Sliders },
  { id: "language", label: "language", icon: Globe },
  { id: "data", label: "data", icon: Database },
  { id: "updates", label: "updates", icon: DownloadCloud },
];

const formatSize = (bytes: number) =>
  bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "";

export default function SettingsPage({
  settings,
  activeModel,
  initialTab,
  onUpdate,
  onSelectModel,
  onClearChats,
  onLibraryChange,
}: SettingsPageProps) {
  const t = useCallback(
    (key: string) =>
      translations[settings.language]?.[key] || translations["en"][key] || key,
    [settings.language],
  );

  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [pullState, setPullState] = useState<{
    name: string;
    percent: number;
    phase: PullPhase;
  } | null>(null);
  const [modelError, setModelError] = useState("");
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const pullControllerRef = useRef<AbortController | null>(null);

  const [modelsVersion, setModelsVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibraryModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [vram, setVram] = useState(0);
  const [unifiedMemory, setUnifiedMemory] = useState(false);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);

  const [librarySources, setLibrarySources] = useState<LibrarySource[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStats | null>(null);
  const [libraryProgress, setLibraryProgress] = useState<LibraryProgress | null>(null);
  const [libraryError, setLibraryError] = useState("");

  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [updaterState, setUpdaterState] = useState<UpdaterState | null>(null);

  useEffect(() => {
    if (tab !== "models") return;

    let cancelled = false;
    const handle = setTimeout(() => {
      setSearching(true);
      window.electronAPI
        ?.searchModels(query)
        .then((result) => {
          if (cancelled) return;
          setResults(result?.success ? result.models || [] : []);
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
  }, [query, tab]);

  useEffect(() => {
    if (!expanded) return;

    const model = results.find((entry) => entry.name === expanded);
    if (!model) return;

    const tags = variantTags(model);
    let cancelled = false;

    tags.forEach((size) => {
      const reference = `${model.name}:${size}`;
      if (sizes[reference]) return;

      window.electronAPI
        ?.modelSize(model.name, size)
        .then((result) => {
          if (cancelled || !result?.success || !result.bytes) return;
          setSizes((previous) => ({ ...previous, [reference]: result.bytes as number }));
        })
        .catch(() => undefined);
    });

    return () => {
      cancelled = true;
    };
  }, [expanded, results, sizes]);
  const refreshModels = useCallback(
    () => setModelsVersion((version) => version + 1),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    listInstalledModels()
      .then((models) => {
        if (!cancelled) setInstalledModels(models);
      })
      .catch(() => {
        if (!cancelled) setInstalledModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [modelsVersion]);

  useEffect(() => {
    if (!isSystemVoiceSupported()) return;
    const refresh = () => setSystemVoices(listVoices(settings.language));
    refresh();
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [settings.language]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      ?.getSystemSpecs()
      .then((specs) => {
        if (cancelled || !specs) return;
        setVram(specs.vram || 0);
        setUnifiedMemory(Boolean(specs.unifiedMemory));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => pullControllerRef.current?.abort();
  }, []);

  const loadLibrary = useCallback(async () => {
    const api = window.electronAPI?.library;
    if (!api) return null;

    const [list, stats] = await Promise.all([api.list(), api.stats()]);
    return {
      sources: list?.success ? (list.sources ?? []) : [],
      stats: stats?.success ? (stats.stats ?? null) : null,
    };
  }, []);

  const refreshLibrary = useCallback(async () => {
    const data = await loadLibrary();
    if (!data) return;

    setLibrarySources(data.sources);
    setLibraryStats(data.stats);
    onLibraryChange?.();
  }, [loadLibrary, onLibraryChange]);

  useEffect(() => {
    if (tab !== "library") return;

    let cancelled = false;
    loadLibrary()
      .then((data) => {
        if (cancelled || !data) return;
        setLibrarySources(data.sources);
        setLibraryStats(data.stats);
      })
      .catch(() => undefined);

    const stopWatching = window.electronAPI?.library.onProgress(setLibraryProgress);

    return () => {
      cancelled = true;
      stopWatching?.();
    };
  }, [tab, loadLibrary]);


  useEffect(() => {
    if (tab !== "data") return;
    window.electronAPI?.db
      .stats()
      .then((result) => setStorageStats(result?.stats ?? null))
      .catch(() => undefined);
  }, [tab, modelsVersion]);

  useEffect(() => {
    const api = window.electronAPI?.updater;
    if (!api) return;

    api.state().then(setUpdaterState).catch(() => undefined);
    return api.onState(setUpdaterState);
  }, []);

  useEffect(() => {
    if (tab !== "updates" || !settings.autoUpdate) return;
    window.electronAPI?.updater.check({ silent: true }).catch(() => undefined);
  }, [tab, settings.autoUpdate]);

  /**
   * The concrete model indexing will run with, pulling the VRAM-sized rung
   * first if "automatic" has never been fetched on this machine before.
   */
  const resolveEmbedModel = async (): Promise<string | null> => {
    const plan = planEmbedModel({
      override: settings.embedModel,
      installed: installedModels.map((entry) => entry.name),
      vram,
    });

    if (plan.download && !(await startPull(plan.model))) return null;
    return plan.model;
  };

  const addLibraryFolder = async () => {
    const api = window.electronAPI?.library;
    if (!api) return;

    setLibraryError("");
    const picked = await api.pickFolder();
    if (!picked?.success || !picked.path) return;

    const model = await resolveEmbedModel();
    if (!model) {
      setLibraryError(modelError || "Could not prepare the embedding model.");
      return;
    }

    setLibraryProgress({ phase: "indexing", current: 0, total: 0, file: "" });

    const result = await api.index(picked.path, model);
    setLibraryProgress(null);

    if (!result?.success) {
      setLibraryError(result?.error || "Indexing failed.");
    }

    await refreshLibrary();
  };

  const reindexFolder = async (path: string) => {
    const api = window.electronAPI?.library;
    if (!api) return;

    setLibraryError("");

    const model = await resolveEmbedModel();
    if (!model) {
      setLibraryError(modelError || "Could not prepare the embedding model.");
      return;
    }

    setLibraryProgress({ phase: "indexing", current: 0, total: 0, file: "" });

    const result = await api.index(path, model);
    setLibraryProgress(null);

    if (!result?.success) setLibraryError(result?.error || "Indexing failed.");
    await refreshLibrary();
  };

  const removeLibraryFolder = async (id: number) => {
    await window.electronAPI?.library.remove(id);
    await refreshLibrary();
  };

  const startPull = async (name: string): Promise<boolean> => {
    const target = name.trim();
    if (!target || pullState) return false;

    setModelError("");
    setPullState({ name: target, percent: 0, phase: "preparing" });

    const controller = new AbortController();
    pullControllerRef.current = controller;

    try {
      await pullModel(
        target,
        (progress) => {
          setPullState({
            name: target,
            percent: progress.percent,
            phase: progress.phase,
          });
        },
        controller.signal,
      );
      refreshModels();
      return true;
    } catch (err) {
      if (!controller.signal.aborted) {
        setModelError(err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      pullControllerRef.current = null;
      setPullState(null);
    }
  };

  const removeModel = async (name: string) => {
    setModelError("");
    try {
      await deleteModel(name);
      refreshModels();
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err));
    }
  };

  const addInstruction = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onUpdate({
      ...settings,
      customInstructions: [...settings.customInstructions, trimmed],
    });
  };

  const neuralPossible = isNeuralVoiceAvailable(settings.language);
  const useNeuralVoice = settings.voiceEngine === "neural" && neuralPossible;
  const voiceRate = settings.voiceRate || 1;

  const voiceOptions = useNeuralVoice
    ? NEURAL_VOICES.map((voice) => ({
        id: voice.id,
        label: voice.name,
        hint: `${voice.accent} · ${voice.gender}`,
      }))
    : systemVoices.map((voice) => ({
        id: voice.name,
        label: voice.name,
        hint: voice.lang,
      }));

  const selectedVoice = useNeuralVoice
    ? settings.neuralVoice || DEFAULT_NEURAL_VOICE
    : settings.voiceName;

  const pickVoice = (id: string) =>
    onUpdate(
      useNeuralVoice ? { ...settings, neuralVoice: id } : { ...settings, voiceName: id },
    );

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-base)] overflow-hidden">
      <div className="pt-2 drag-region h-6 flex-shrink-0 w-full" />

      <div className="flex-1 flex min-h-0 max-w-5xl w-full mx-auto p-6 gap-6">
        <nav className="w-48 flex-shrink-0 flex flex-col gap-1">
          <h1 className="text-lg font-bold tracking-wider text-[var(--text-main)] uppercase px-3 mb-3">
            {t("settings")}
          </h1>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                tab === id
                  ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)]"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider">
                {t(label)}
              </span>
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 overflow-y-auto pr-1">
          {tab === "appearance" && (
            <Section title={t("appearance")}>
              <Field label={t("themeMode")}>
                <div className="grid grid-cols-2 gap-3">
                  {(["light", "dark"] as const).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => onUpdate({ ...settings, theme })}
                      className={`flex items-center gap-3 p-3 rounded-xl border-[3px] transition-all ${
                        settings.theme === theme
                          ? "border-[var(--text-main)] bg-[var(--hover-bg)]"
                          : "border-[var(--border-light)] hover:bg-[var(--hover-bg)]"
                      }`}
                    >
                      <span
                        className="w-8 h-8 rounded-lg border-2 border-[var(--border-light)] flex-shrink-0"
                        style={{
                          backgroundColor:
                            theme === "light" ? "#e5e5e5" : "#121212",
                        }}
                      />
                      <span className="text-sm font-bold">{t(theme)}</span>
                      {settings.theme === theme && (
                        <Check className="w-4 h-4 ml-auto" />
                      )}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={t("fontSize")}>
                <div className="flex bg-[var(--hover-bg)] rounded-xl p-1.5 border-[3px] border-[var(--border-light)]">
                  {(["sm", "base", "lg"] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => onUpdate({ ...settings, fontSize: size })}
                      className={`flex-1 py-2 font-bold uppercase text-xs rounded-lg transition-all ${
                        settings.fontSize === size
                          ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>
          )}

          {tab === "models" && (
            <Section title={t("models")}>
              <Field label={t("installed")}>
                <div className="space-y-2">
                  {installedModels.length === 0 && (
                    <p className="text-sm font-bold text-[var(--text-muted)]">
                      {t("noModelsFound")}
                    </p>
                  )}
                  {installedModels.map((entry) => {
                    const isActive = entry.name === activeModel;
                    // Still listed, so it can be removed; just not choosable.
                    const cannotChat = cannotGenerate(entry.capabilities);
                    return (
                      <div
                        key={entry.name}
                        className={`flex items-center gap-3 p-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] ${
                          cannotChat ? "opacity-60" : ""
                        }`}
                      >
                        <button
                          onClick={() => onSelectModel(entry.name)}
                          disabled={isActive || cannotChat}
                          title={cannotChat ? t("embeddingOnlyHint") : undefined}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left disabled:cursor-default"
                        >
                          <span className="text-sm font-bold truncate">
                            {entry.name}
                          </span>
                          {entry.parameterSize && (
                            <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] flex-shrink-0">
                              {entry.parameterSize}
                            </span>
                          )}
                          {cannotChat && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--border-light)] text-[var(--text-muted)] flex-shrink-0">
                              {t("embeddingOnly")}
                            </span>
                          )}
                        </button>

                        <span className="text-[11px] font-bold text-[var(--text-muted)] flex-shrink-0">
                          {formatSize(entry.size)}
                        </span>

                        {isActive ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-main)] flex-shrink-0">
                            <Check className="w-3.5 h-3.5" />
                            {t("inUse")}
                          </span>
                        ) : (
                          <button
                            onClick={() => removeModel(entry.name)}
                            title={t("remove")}
                            className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Field>

              <Field label={t("downloadModel")}>
                {pullState ? (
                  <PullProgressBar
                    state={pullState}
                    onCancel={() => pullControllerRef.current?.abort()}
                    t={t}
                  />
                ) : (
                  <>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t("searchModelsPlaceholder")}
                        className="w-full p-3 pl-10 ui-input text-sm font-bold"
                      />
                      {searching && (
                        <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-muted)]" />
                      )}
                    </div>

                    <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto pr-1">
                      {results.length === 0 && !searching && (
                        <p className="text-sm font-bold text-[var(--text-muted)] px-1">
                          {t("noSearchResults")}
                        </p>
                      )}

                      {results.map((model) => {
                        const open = expanded === model.name;
                        return (
                          <div
                            key={model.name}
                            className="rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] overflow-hidden"
                          >
                            <button
                              onClick={() =>
                                setExpanded(open ? null : model.name)
                              }
                              className="w-full text-left p-3 hover:bg-[var(--hover-bg)] transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold truncate">
                                  {model.name}
                                </span>
                                {model.capabilities.map((capability) => (
                                  <span
                                    key={capability}
                                    className="px-1.5 py-0.5 rounded border border-[var(--border-light)] text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex-shrink-0"
                                  >
                                    {capability}
                                  </span>
                                ))}
                                <ChevronRight
                                  className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform ${
                                    open ? "rotate-90" : ""
                                  }`}
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
                                {variantTags(model).map((size) => (
                                  <VariantRow
                                    key={size}
                                    label={`${model.name}:${size}`}
                                    bytes={sizes[`${model.name}:${size}`]}
                                    vram={vram}
                                    unifiedMemory={unifiedMemory}
                                    onPull={() =>
                                      startPull(`${model.name}:${size}`)
                                    }
                                    t={t}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {modelError && (
                  <p className="mt-3 text-xs font-bold text-red-500">
                    {modelError}
                  </p>
                )}
              </Field>
            </Section>
          )}

          {tab === "personalization" && (
            <Section title={t("personalization")}>
              <Field label={t("talkModel")}>
                <ModelSelect
                  value={settings.voiceModel}
                  models={selectableModels(installedModels)}
                  automatic={t("automatic")}
                  onPick={(name) => onUpdate({ ...settings, voiceModel: name })}
                />
              </Field>

              <Field label={t("voiceLabel")}>
                <div className="space-y-2">
                  <OptionSelect
                    value={selectedVoice}
                    options={voiceOptions}
                    onPick={pickVoice}
                  />

                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-light)]">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdate({ ...settings, voiceEngine: "system" })
                        }
                        className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                          !useNeuralVoice
                            ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
                        }`}
                      >
                        {t("systemVoice")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdate({ ...settings, voiceEngine: "neural" })
                        }
                        disabled={!neuralPossible}
                        title={
                          neuralPossible
                            ? t("naturalVoiceHint")
                            : t("naturalVoiceEnglishOnly")
                        }
                        className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          useNeuralVoice
                            ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
                        }`}
                      >
                        <span className="flex items-center justify-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          {t("naturalVoice")}
                        </span>
                      </button>
                    </div>

                    <div
                      className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-light)]"
                      title={t("speed")}
                    >
                      {VOICE_SPEEDS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          onClick={() =>
                            onUpdate({ ...settings, voiceRate: speed })
                          }
                          className={`px-2 py-1.5 rounded-lg text-[11px] font-bold tabular-nums transition-colors ${
                            Math.abs(voiceRate - speed) < 0.01
                              ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                              : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
                          }`}
                        >
                          {speed}×
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </Field>

              <Field label={t("embeddingModel")}>
                <ModelSelect
                  value={settings.embedModel}
                  models={installedModels.filter((entry) =>
                    isEmbeddingModel(entry.capabilities),
                  )}
                  automatic={t("automatic")}
                  onPick={(name) => onUpdate({ ...settings, embedModel: name })}
                />
              </Field>

              <Field label={t("thinkingMode")}>
                <div className="flex bg-[var(--hover-bg)] rounded-xl p-1.5 border-[3px] border-[var(--border-light)]">
                  {(["low", "medium", "high"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() =>
                        onUpdate({ ...settings, thinkingMode: mode })
                      }
                      className={`flex-1 py-2 font-bold uppercase text-xs rounded-lg transition-all ${
                        settings.thinkingMode === mode
                          ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                      }`}
                    >
                      {t(mode)}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={t("customInstructions")}>
                <div className="space-y-2">
                  {settings.customInstructions.map((instruction, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="flex-1 p-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] text-sm font-bold break-words">
                        {instruction}
                      </div>
                      <button
                        onClick={() =>
                          onUpdate({
                            ...settings,
                            customInstructions:
                              settings.customInstructions.filter(
                                (_, i) => i !== idx,
                              ),
                          })
                        }
                        className="p-2 mt-1 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={t("addNewInstruction")}
                      className="flex-1 p-3 ui-input text-sm font-bold"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        addInstruction(e.currentTarget.value);
                        e.currentTarget.value = "";
                      }}
                    />
                    <div className="p-3 ui-box-dark rounded-xl">
                      <Plus className="w-4 h-4 text-white" />
                    </div>
                  </div>
                </div>
              </Field>
            </Section>
          )}

          {tab === "language" && (
            <Section title={t("language")}>
              <div className="grid grid-cols-2 gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() =>
                      onUpdate({ ...settings, language: lang.code })
                    }
                    className={`flex items-center gap-2 px-3 py-2.5 text-sm font-bold rounded-xl border-[3px] transition-all ${
                      settings.language === lang.code
                        ? "border-[var(--text-main)] bg-[var(--hover-bg)]"
                        : "border-[var(--border-light)] hover:bg-[var(--hover-bg)]"
                    }`}
                  >
                    <span className="flex-1 text-left truncate">
                      {lang.name}
                    </span>
                    {settings.language === lang.code && (
                      <Check className="w-4 h-4 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {tab === "library" && (
            <Section title={t("library")}><Field label={t("enableLibrary")}>
                <Toggle
                  checked={settings.libraryEnabled}
                  onChange={(value) => onUpdate({ ...settings, libraryEnabled: value })}
                />
              </Field>

              <Field label={t("indexedFolders")}>
                <div className="space-y-2">
                  {librarySources.length === 0 && (
                    <p className="text-sm font-bold text-[var(--text-muted)]">
                      {t("noFoldersIndexed")}
                    </p>
                  )}

                  {librarySources.map((source) => (
                    <div
                      key={source.id}
                      className="flex items-center gap-3 p-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]"
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
                        onClick={() => reindexFolder(source.path)}
                        disabled={Boolean(libraryProgress)}
                        title={t("reindex")}
                        className="p-2 rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-main)] transition-colors disabled:opacity-40"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeLibraryFolder(source.id)}
                        title={t("remove")}
                        className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  {pullState ? (
                    <PullProgressBar state={pullState} t={t} />
                  ) : libraryProgress ? (
                    <div className="space-y-2 p-4 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                        <span className="text-sm font-bold truncate flex-1 min-w-0">
                          {libraryProgress.file || t("indexing")}
                        </span>
                        <span className="text-[11px] font-bold text-[var(--text-muted)]">
                          {libraryProgress.current}/{libraryProgress.total}
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden bg-[var(--hover-bg)]">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${
                              libraryProgress.total > 0
                                ? (libraryProgress.current / libraryProgress.total) * 100
                                : 0
                            }%`,
                            background: "var(--text-main)",
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={addLibraryFolder}
                      className="flex items-center gap-2 px-5 py-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] hover:bg-[var(--hover-bg)] transition-colors text-sm font-bold uppercase tracking-wider"
                    >
                      <FolderPlus className="w-4 h-4" />
                      {t("addFolder")}
                    </button>
                  )}

                  {libraryError && (
                    <p className="text-xs font-bold text-red-500">{libraryError}</p>
                  )}
                </div>
              </Field>

              {libraryStats && libraryStats.chunks > 0 && (
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {libraryStats.files} {t("files")} · {libraryStats.chunks} {t("passages")} ·{" "}
                  {libraryStats.embedModel}
                </p>
              )}
            </Section>
          )}

          {tab === "tools" && (
            <Section title={t("tools")}>
              <Field label={t("codeExecution")}>
                <Toggle
                  checked={settings.codeExecution}
                  onChange={(value) => onUpdate({ ...settings, codeExecution: value })}
                />

                {settings.codeExecution && (
                  <div className="flex items-start gap-3 p-3 rounded-xl border-[3px] border-amber-500/40 bg-amber-500/5">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
                    <p className="text-[11px] font-medium text-[var(--text-muted)] leading-relaxed">
                      {t("codeExecutionWarning")}
                    </p>
                  </div>
                )}
              </Field>

              <Field label={t("searchProvider")}>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      "auto",
                      "brave-html",
                      "duckduckgo",
                      "startpage",
                      "brave",
                      "searxng",
                    ] as SearchProvider[]
                  ).map((provider) => (
                    <button
                      key={provider}
                      onClick={() => onUpdate({ ...settings, searchProvider: provider })}
                      className={`px-3 py-2.5 text-xs font-bold rounded-xl border-[3px] transition-all ${
                        settings.searchProvider === provider
                          ? "border-[var(--text-main)] bg-[var(--hover-bg)]"
                          : "border-[var(--border-light)] hover:bg-[var(--hover-bg)]"
                      }`}
                    >
                      {t(`provider_${provider.replace(/-/g, "_")}`)}
                    </button>
                  ))}
                </div></Field>

              <Field label={t("searxngUrl")}>
                <input
                  type="text"
                  value={settings.searxngUrl}
                  onChange={(e) => onUpdate({ ...settings, searxngUrl: e.target.value })}
                  placeholder="http://localhost:8080"
                  className="w-full p-3 ui-input text-sm font-bold"
                  spellCheck={false}
                /></Field>

              <Field label={t("braveApiKey")}>
                <input
                  type="password"
                  value={settings.braveApiKey}
                  onChange={(e) => onUpdate({ ...settings, braveApiKey: e.target.value })}
                  placeholder="BSA..."
                  className="w-full p-3 ui-input text-sm font-bold"
                  spellCheck={false}
                /></Field>

              <Field label={t("showMetrics")}>
                <Toggle
                  checked={settings.showMetrics}
                  onChange={(value) => onUpdate({ ...settings, showMetrics: value })}
                />
              </Field>
            </Section>
          )}

          {tab === "extensions" && (
            <Section title={t("extensions")}>
              <McpPanel t={t} />
            </Section>
          )}

          {tab === "updates" && (
            <Section title={t("updates")}>
              <UpdatePanel state={updaterState} settings={settings} onUpdate={onUpdate} t={t} />
            </Section>
          )}

          {tab === "data" && (
            <Section title={t("data")}>
              {storageStats && (
                <Field label={t("storedOnDisk")}>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label={t("conversations")} value={String(storageStats.chats)} />
                    <Stat label={t("messages")} value={String(storageStats.messages)} />
                    <Stat label={t("attachments")} value={String(storageStats.attachments)} />
                    <Stat
                      label={t("attachmentSize")}
                      value={`${(storageStats.attachmentBytes / 1024 ** 2).toFixed(1)} MB`}
                    />
                  </div></Field>
              )}

              <Field label={t("diagnostics")}>
                <button
                  onClick={() => window.electronAPI?.openLogs()}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] hover:bg-[var(--hover-bg)] transition-colors text-sm font-bold uppercase tracking-wider"
                >
                  <FileText className="w-4 h-4" />
                  {t("openLogFolder")}
                </button></Field>

              <div className="inline-flex rounded-xl border-[3px] border-red-500/40 bg-red-500/5 p-4">
                <button
                  onClick={() => setShowConfirmClear(true)}
                  className="px-5 py-2.5 bg-red-500/10 border-2 border-red-500 text-red-500 rounded-xl font-bold uppercase text-xs tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  {t("clearHistory")}
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showConfirmClear && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] p-6 shadow-2xl"
            >
              <h3 className="mb-4 text-lg font-bold text-[var(--text-main)]">
                {t("clearHistory")}
              </h3>
              <p className="mb-8 text-sm font-bold text-[var(--text-muted)]">
                {t("confirmClearHistory")}
              </p>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => setShowConfirmClear(false)}
                  className="rounded-lg bg-[var(--hover-bg)] px-6 py-3 text-sm font-bold uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:bg-[var(--border-light)]"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={() => {
                    setShowConfirmClear(false);
                    onClearChats();
                  }}
                  className="rounded-lg bg-red-500 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-red-600"
                >
                  {t("confirm")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The extensions panel. Turning a server on runs someone else's program with
 * the credentials typed into it, so the panel says so rather than hiding it.
 */
function PullProgressBar({
  state,
  onCancel,
  t,
}: {
  state: { name: string; percent: number; phase: PullPhase };
  onCancel?: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-2 p-4 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)]">
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
        <span className="text-sm font-bold truncate flex-1 min-w-0">{state.name}</span>
        <span className="text-[11px] font-bold text-[var(--text-muted)]">
          {state.phase === "downloading"
            ? `${Math.min(100, Math.max(0, state.percent)).toFixed(0)}%`
            : t(PULL_PHASE_KEYS[state.phase])}
        </span>
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-1 text-[var(--text-muted)] hover:text-red-500 transition-colors"
            title={t("cancel")}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="h-2 rounded-full overflow-hidden bg-[var(--hover-bg)]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(100, Math.max(0, state.percent))}%`,
            background: "var(--text-main)",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Picks an installed model. Whatever is set is always offered, even if missing,
 * or a removed model would be silently swapped the moment this renders.
 */
function ModelSelect({
  value,
  models,
  onPick,
  automatic,
}: {
  value: string;
  models: InstalledModel[];
  onPick: (name: string) => void;
  /** Label for the empty choice. Omitted, there is no empty choice. */
  automatic?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const names = models.map((entry) => entry.name);
  const options = value && !names.includes(value) ? [value, ...names] : names;

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (name: string) => {
    onPick(name);
    setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full p-3 ui-input text-sm font-bold flex items-center gap-2 text-left"
      >
        <span className="flex-1 min-w-0 truncate">
          {value || automatic || "—"}
        </span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-[var(--text-muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 ui-box p-1 flex flex-col gap-0.5 max-h-56 overflow-y-auto">
          {automatic && (
            <ModelOption
              label={automatic}
              selected={value === ""}
              onClick={() => choose("")}
            />
          )}

          {options.length === 0 && !automatic && (
            <p className="px-2 py-1.5 text-xs font-bold text-[var(--text-muted)]">
              —
            </p>
          )}

          {options.map((name) => (
            <ModelOption
              key={name}
              label={name}
              selected={name === value}
              onClick={() => choose(name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
        selected
          ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
          : "hover:bg-[var(--hover-bg)]"
      }`}
    >
      <span className="flex-1 min-w-0 truncate text-xs font-bold">{label}</span>
      {selected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
    </button>
  );
}

/** Picks one of a list of labeled options, such as a voice. */
function OptionSelect({
  value,
  options,
  onPick,
}: {
  value: string;
  options: { id: string; label: string; hint?: string }[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((option) => option.id === value);

  const choose = (id: string) => {
    onPick(id);
    setOpen(false);
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full p-3 ui-input text-sm font-bold flex items-center gap-2 text-left"
      >
        <span className="flex-1 min-w-0 truncate">{selected?.label || "—"}</span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-[var(--text-muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 ui-box p-1 flex flex-col gap-0.5 max-h-56 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs font-bold text-[var(--text-muted)]">
              —
            </p>
          ) : (
            options.map((option) => (
              <button
                key={option.id || "auto"}
                type="button"
                onClick={() => choose(option.id)}
                className={`flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                  option.id === value
                    ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                    : "hover:bg-[var(--hover-bg)]"
                }`}
              >
                <span className="flex-1 min-w-0 truncate text-xs font-bold">
                  {option.label}
                </span>
                {option.hint && (
                  <span className="text-[10px] font-medium opacity-60 flex-shrink-0">
                    {option.hint}
                  </span>
                )}
                {option.id === value && (
                  <Check className="w-3.5 h-3.5 flex-shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function UpdatePanel({
  state,
  settings,
  onUpdate,
  t,
}: {
  state: UpdaterState | null;
  settings: AppSettings;
  onUpdate: (next: AppSettings) => void;
  t: (key: string) => string;
}) {
  const [info, setInfo] = useState<{ version: string; packaged: boolean } | null>(null);

  useEffect(() => {
    window.electronAPI
      ?.appInfo()
      .then((result) => setInfo({ version: result.version, packaged: result.packaged }))
      .catch(() => undefined);
  }, []);

  const status = state?.status ?? "idle";

  return (
    <>
      <Field label={t("currentVersion")}>
        <p className="text-sm font-bold tabular-nums">
          {info ? `v${info.version}` : "…"}
          {info && !info.packaged && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {t("development")}
            </span>
          )}
        </p>
      </Field>

      <Field label={t("automaticUpdates")}>
        <Toggle
          checked={settings.autoUpdate}
          onChange={(value) => onUpdate({ ...settings, autoUpdate: value })}
        />
      </Field>

      <Field label={t("updateStatus")}>
        <div className="p-4 rounded-xl border-[3px] border-[var(--border-light)] bg-[var(--bg-panel)] space-y-3">
          <p className="text-sm font-bold">
            {status === "disabled"
              ? t("updatesUnavailable")
              : status === "checking"
                ? t("checkingForUpdates")
                : status === "available"
                  ? `${t("updateAvailable")} v${state?.version}`
                  : status === "downloading"
                    ? `${t("downloading")} ${Math.min(100, Math.max(0, state?.percent ?? 0))}%`
                    : status === "ready"
                      ? `${t("updateReady")} v${state?.version}`
                      : status === "error"
                        ? state?.error || t("updateFailed")
                        : status === "current"
                          ? t("upToDate")
                          : t("notChecked")}
          </p>

          {status === "downloading" && (
            <div className="h-2 rounded-full overflow-hidden bg-[var(--hover-bg)]">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.max(0, state?.percent ?? 0))}%`,
                  background: "var(--text-main)",
                }}
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => window.electronAPI?.updater.check()}
              disabled={status === "checking" || status === "disabled"}
              className="px-4 py-2 rounded-lg border-2 border-[var(--border-light)] text-xs font-bold uppercase tracking-wider hover:bg-[var(--hover-bg)] transition-colors disabled:opacity-40"
            >
              {t("checkNow")}
            </button>

            {status === "available" && (
              <button
                onClick={() => window.electronAPI?.updater.download()}
                className="px-4 py-2 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
              >
                {t("download")}
              </button>
            )}

            {status === "ready" && (
              <button
                onClick={() => window.electronAPI?.updater.install()}
                className="px-4 py-2 rounded-lg bg-[var(--bg-inverted)] text-[var(--text-inverted)] text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
              >
                {t("restartAndInstall")}
              </button>
            )}
          </div>
        </div>
      </Field>
    </>
  );
}
