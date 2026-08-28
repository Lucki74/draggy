import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Captions,
  CaptionsOff,
  Check,
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  SkipForward,
  X,
} from "lucide-react";
import { translations } from "./translations";
import { listInstalledModels } from "./ollama";
import { selectableVoiceModels } from "./modelKinds";
import Orb from "./voice/Orb";
import {
  emptyConversationView,
  openConversation,
  planFor,
} from "./voice/conversation";
import {
  DEFAULT_NEURAL_VOICE,
  NEURAL_VOICES,
  isNeuralVoiceAvailable,
} from "./voice/neuralVoice";
import { isSystemVoiceSupported, listVoices } from "./voice/systemVoice";
import type { InstalledModel } from "./ollama";
import type {
  Activity,
  Conversation,
  ConversationView,
  StartupStep,
} from "./voice/conversation";
import type { VoiceEngineId } from "./voice/voiceEngine";
import type { AppSettings } from "./types";

/**
 * Voice mode.
 *
 * The screen has three shapes and never more than one at a time: a set-up panel
 * before the conversation, a progress bar while it is being prepared, and the
 * conversation itself, which is the orb, one line of status and one line of
 * what was just said. Everything that is not one of those three is a control at
 * the bottom edge, out of the way of the thing being looked at.
 */

interface TalkScreenProps {
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

const SPEEDS = [0.9, 1, 1.1, 1.25];

/** The dropdown value that means "size a model to this machine". */
const AUTOMATIC = "";

export default function TalkScreen({
  settings,
  onUpdateSettings,
}: TalkScreenProps) {
  const t = useCallback(
    (key: string) =>
      translations[settings.language]?.[key] || translations["en"][key] || key,
    [settings.language],
  );

  const [view, setView] = useState<ConversationView>(emptyConversationView);
  const [step, setStep] = useState<StartupStep>({
    label: "",
    percent: 0,
    measured: false,
  });
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState("");
  const [captions, setCaptions] = useState(false);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [vram, setVram] = useState(0);
  const [openMenu, setOpenMenu] = useState<"model" | "voice" | null>(null);

  const talkRef = useRef<Conversation | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Preparation can take a minute when a model has to be fetched, and the user
   * is free to leave in the middle of it. The token says whether the session
   * that eventually opens is still the one anybody asked for.
   */
  const attemptRef = useRef(0);
  const cancelRef = useRef<AbortController | null>(null);

  const live = view.stage === "live";
  const neuralPossible = isNeuralVoiceAvailable(settings.language);
  const useNeural = settings.voiceEngine === "neural" && neuralPossible;
  const rate = settings.voiceRate || 1;

  // ------------------------------------------------------------ housekeeping

  const refreshModels = useCallback(() => {
    listInstalledModels()
      .then((models) => setInstalled(selectableVoiceModels(models)))
      .catch(() => setInstalled([]));
  }, []);

  useEffect(() => {
    refreshModels();

    window.electronAPI
      ?.getSystemSpecs()
      .then((specs) => setVram(specs?.vram ?? 0))
      .catch(() => setVram(0));
  }, [refreshModels]);

  useEffect(() => {
    if (!isSystemVoiceSupported()) return;
    const refresh = () => setSystemVoices(listVoices(settings.language));
    refresh();
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [settings.language]);

  useEffect(
    () => () => {
      attemptRef.current++;
      cancelRef.current?.abort();
      talkRef.current?.stop();
    },
    [],
  );

  useEffect(() => {
    if (captions) transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [view.turns, captions]);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openMenu]);

  // ------------------------------------------------------------------ the plan

  const names = useMemo(() => installed.map((entry) => entry.name), [installed]);

  /** What will answer, and what has to be fetched first, before starting. */
  const plan = useMemo(
    () =>
      planFor({
        language: settings.language,
        preferredModel: settings.voiceModel,
        chatModel: settings.modelName,
        installed: names,
        vram,
        engine: settings.voiceEngine === "neural" ? "neural" : "system",
        systemVoice: settings.voiceName,
        neuralVoice: settings.neuralVoice || DEFAULT_NEURAL_VOICE,
        rate,
        searchEnabled: settings.webMode !== "off",
      }),
    [names, rate, settings, vram],
  );

  // ------------------------------------------------------------------ actions

  const level = useCallback(() => talkRef.current?.level() ?? 0, []);

  const stop = useCallback(() => {
    attemptRef.current++;
    cancelRef.current?.abort();
    talkRef.current?.stop();
    talkRef.current = null;
    setStarting(false);
    setView(emptyConversationView());
    setStep({ label: "", percent: 0, measured: false });
    // A model may have been fetched since the list was last read.
    refreshModels();
  }, [refreshModels]);

  const start = useCallback(async () => {
    const attempt = ++attemptRef.current;
    const cancel = new AbortController();
    cancelRef.current = cancel;

    setFailure("");
    setStarting(true);
    setView({ ...emptyConversationView(), stage: "starting", model: plan.model });

    try {
      const conversation = await openConversation(
        {
          signal: cancel.signal,
          language: settings.language,
          preferredModel: settings.voiceModel,
          chatModel: settings.modelName,
          installed: names,
          vram,
          engine: settings.voiceEngine === "neural" ? "neural" : "system",
          systemVoice: settings.voiceName,
          neuralVoice: settings.neuralVoice || DEFAULT_NEURAL_VOICE,
          rate,
          searchEnabled: settings.webMode !== "off",
        },
        {
          onView: setView,
          onStep: setStep,
          strings: {
            preparing: t("preparingVoice"),
            downloadingModel: t("downloadingVoiceModel"),
            warmingUp: t("warmingUpModel"),
            loadingSpeechModel: t("loadingSpeechModel"),
            loadingNeuralVoice: t("loadingNeuralVoice"),
            lookingItUp: t("lookingItUp"),
            noVoiceOutput: t("voiceOutputUnavailable"),
          },
        },
      );

      // Somebody left, or started again, while this one was being prepared.
      if (attemptRef.current !== attempt) {
        conversation.stop();
        return;
      }

      talkRef.current = conversation;
      refreshModels();
    } catch (error) {
      const cancelled =
        (error instanceof Error && error.name === "AbortError") ||
        attemptRef.current !== attempt;

      if (cancelled) {
        setView(emptyConversationView());
        return;
      }

      setFailure(error instanceof Error ? error.message : String(error));
      setView({ ...emptyConversationView(), stage: "failed" });
    } finally {
      if (attemptRef.current === attempt) setStarting(false);
    }
  }, [names, plan.model, rate, refreshModels, settings, t, vram]);

  const toggleMute = useCallback(() => {
    talkRef.current?.setMuted(!view.muted);
  }, [view.muted]);

  useEffect(() => {
    if (!live) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      const key = event.key.toLowerCase();
      if (key === "escape") {
        event.preventDefault();
        stop();
      } else if (key === "m") {
        event.preventDefault();
        toggleMute();
      } else if (key === "c") {
        event.preventDefault();
        setCaptions((value) => !value);
      } else if (key === " ") {
        event.preventDefault();
        talkRef.current?.skip();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [live, stop, toggleMute]);

  // --------------------------------------------------------------------- text

  const statusLabel: Record<Activity, string> = useMemo(
    () => ({
      listening: t("voiceListening"),
      hearing: t("voiceHearing"),
      thinking: t("voiceThinking"),
      searching: t("voiceSearchingWeb"),
      speaking: t("voiceSpeaking"),
    }),
    [t],
  );

  const lastReply = [...view.turns]
    .reverse()
    .find((turn) => turn.role === "assistant");

  const caption = view.draft
    ? { text: view.draft, mine: true }
    : lastReply
      ? { text: lastReply.text, mine: false }
      : null;

  const error = failure || view.error;

  const voiceLabel = useNeural
    ? (NEURAL_VOICES.find(
        (voice) => voice.id === (settings.neuralVoice || DEFAULT_NEURAL_VOICE),
      )?.name ?? t("naturalVoice"))
    : settings.voiceName || t("systemVoice");

  const modelLabel = live
    ? view.model
    : plan.source === "sized"
      ? (plan.tier?.label ?? plan.model)
      : plan.model;

  // --------------------------------------------------------------------- view

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg-base)]">
      <div className="pt-2 drag-region h-6 flex-shrink-0 w-full" />

      <main className="flex-1 flex flex-col items-center justify-center gap-7 px-6 min-h-0">
        <Orb
          activity={view.activity}
          muted={view.muted}
          live={live}
          level={level}
        />

        {(view.stage === "idle" || view.stage === "failed") && (
          <SetupPanel
            t={t}
            settings={settings}
            models={installed}
            systemVoices={systemVoices}
            neuralPossible={neuralPossible}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
            menuRef={menuRef}
            autoLabel={plan.tier?.label ?? plan.model}
            onUpdateSettings={onUpdateSettings}
          />
        )}

        {view.stage === "starting" && (
          <div className="w-full max-w-xs flex flex-col items-center gap-3">
            <p className="text-sm font-bold text-[var(--text-main)] text-center">
              {step.label || t("preparingVoice")}
            </p>
            <ProgressBar percent={step.percent} measured={step.measured} />
            <p className="text-[11px] font-medium text-[var(--text-muted)] text-center">
              {t("firstRunOnly")}
            </p>
          </div>
        )}

        {live && (
          <div className="flex flex-col items-center gap-5 w-full max-w-2xl min-h-[104px]">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                {view.muted ? t("micMuted") : statusLabel[view.activity]}
              </span>
              {view.replyMs !== null && !view.muted && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[var(--hover-bg)] text-[var(--text-muted)] tabular-nums"
                  title={t("replyLatencyHint")}
                >
                  {view.replyMs} ms
                </span>
              )}
            </div>

            <AnimatePresence mode="wait">
              {caption && !captions && (
                <motion.p
                  key={`${caption.mine ? "u" : "a"}-${caption.text.slice(0, 24)}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className={`text-center leading-relaxed max-w-xl px-4 ${
                    caption.mine
                      ? "text-sm font-medium text-[var(--text-muted)] italic"
                      : "text-lg font-medium text-[var(--text-main)]"
                  }`}
                >
                  {caption.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs font-bold text-red-500 max-w-md text-center">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}
      </main>

      <AnimatePresence>
        {live && captions && (
          <motion.div
            key="transcript"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="w-full flex-shrink-0 overflow-hidden"
          >
            <div className="mx-auto w-full max-w-2xl px-6 pb-2 max-h-56 overflow-y-auto flex flex-col gap-2">
              {view.turns.map((turn) => (
                <div
                  key={turn.id}
                  className={`px-4 py-2.5 rounded-2xl text-sm font-medium max-w-[85%] ${
                    turn.role === "user"
                      ? "self-end bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                      : "self-start bg-[var(--bg-panel)] border border-[var(--border-light)] text-[var(--text-main)]"
                  }`}
                >
                  {turn.text}
                  {turn.cut && <span className="opacity-50"> {t("interrupted")}</span>}
                </div>
              ))}
              {view.draft && (
                <div className="self-end px-4 py-2.5 rounded-2xl text-sm font-medium max-w-[85%] border border-dashed border-[var(--border-light)] text-[var(--text-muted)] italic">
                  {view.draft}
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="flex-shrink-0 pb-9 pt-4 flex flex-col items-center gap-4">
        {live ? (
          <div className="flex items-center gap-3">
            <RoundButton
              onClick={toggleMute}
              active={view.muted}
              label={view.muted ? t("unmuteMic") : t("muteMic")}
            >
              {view.muted ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </RoundButton>

            <RoundButton
              onClick={() => setCaptions((value) => !value)}
              active={captions}
              label={t("transcript")}
            >
              {captions ? (
                <Captions className="w-5 h-5" />
              ) : (
                <CaptionsOff className="w-5 h-5" />
              )}
            </RoundButton>

            <RoundButton
              onClick={() => talkRef.current?.skip()}
              disabled={view.activity !== "speaking"}
              label={t("skipReply")}
            >
              <SkipForward className="w-5 h-5" />
            </RoundButton>

            <button
              onClick={stop}
              className="w-14 h-14 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors"
              title={t("endConversation")}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        ) : view.stage === "starting" ? (
          // Preparing can mean a download of several gigabytes, so leaving has
          // to be one click away rather than a matter of navigating out.
          <button
            onClick={stop}
            className="px-9 py-4 rounded-full font-bold uppercase text-xs tracking-[0.15em] bg-[var(--bg-panel)] border border-[var(--border-light)] text-[var(--text-main)] hover:bg-[var(--hover-bg)] transition-colors flex items-center gap-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("cancel")}
          </button>
        ) : (
          <button
            onClick={start}
            disabled={starting || (!isSystemVoiceSupported() && !neuralPossible)}
            className="px-9 py-4 rounded-full font-bold uppercase text-xs tracking-[0.15em] bg-[var(--bg-inverted)] text-[var(--text-inverted)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center gap-2"
          >
            {starting && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("startConversation")}
          </button>
        )}

        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] opacity-60">
            <span>{modelLabel || t("noModelSelected")}</span>
            <span>·</span>
            <span>{voiceLabel}</span>
            {live && view.detector === "energy" && (
              <>
                <span>·</span>
                <span title={t("basicDetectorHint")}>{t("basicDetector")}</span>
              </>
            )}
            {live && view.device && (
              <>
                <span>·</span>
                <span>{view.device}</span>
              </>
            )}
          </div>

          {!live && plan.download && (
            <p className="text-[10px] font-medium text-[var(--text-muted)] opacity-60">
              {t("firstRunDownload")} · ~{plan.download.downloadGB} GB
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}

// -------------------------------------------------------------------- pieces

function ProgressBar({
  percent,
  measured,
}: {
  percent: number;
  measured: boolean;
}) {
  return (
    <div className="w-full h-1.5 rounded-full overflow-hidden bg-[var(--hover-bg)]">
      {measured ? (
        <motion.div
          className="h-full rounded-full bg-[var(--text-main)]"
          animate={{ width: `${Math.min(100, percent)}%` }}
          transition={{ duration: 0.3 }}
        />
      ) : (
        // Work with no measurable size says so by sliding rather than by
        // sitting at a percentage nobody computed.
        <motion.div
          className="h-full w-1/3 rounded-full bg-[var(--text-main)]"
          animate={{ x: ["-100%", "300%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}

interface SetupPanelProps {
  t: (key: string) => string;
  settings: AppSettings;
  models: InstalledModel[];
  systemVoices: SpeechSynthesisVoice[];
  neuralPossible: boolean;
  openMenu: "model" | "voice" | null;
  setOpenMenu: (menu: "model" | "voice" | null) => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  /** The model automatic sizing would pick on this machine. */
  autoLabel: string;
  onUpdateSettings: (settings: AppSettings) => void;
}

function SetupPanel({
  t,
  settings,
  models,
  systemVoices,
  neuralPossible,
  openMenu,
  setOpenMenu,
  menuRef,
  autoLabel,
  onUpdateSettings,
}: SetupPanelProps) {
  const useNeural = settings.voiceEngine === "neural" && neuralPossible;
  const rate = settings.voiceRate || 1;

  const modelOptions = [
    { id: AUTOMATIC, label: t("automatic"), hint: autoLabel },
    ...models.map((entry) => ({
      id: entry.name,
      label: entry.name,
      hint: entry.parameterSize,
    })),
  ];

  const voiceOptions = useNeural
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

  const selectedVoice = useNeural
    ? settings.neuralVoice || DEFAULT_NEURAL_VOICE
    : settings.voiceName;

  const pickVoice = (id: string) => {
    onUpdateSettings(
      useNeural ? { ...settings, neuralVoice: id } : { ...settings, voiceName: id },
    );
    setOpenMenu(null);
  };

  const setEngine = (engine: VoiceEngineId) => {
    onUpdateSettings({ ...settings, voiceEngine: engine });
    setOpenMenu(null);
  };

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md" ref={menuRef}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-main)]">
          {t("talk")}
        </h1>
        <p className="text-sm font-medium text-[var(--text-muted)] leading-relaxed max-w-sm">
          {t("talkIntro")}
        </p>
      </div>

      <div className="w-full flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Dropdown
            open={openMenu === "model"}
            onToggle={() => setOpenMenu(openMenu === "model" ? null : "model")}
            label={t("model")}
            value={settings.voiceModel || t("automatic")}
            note={settings.voiceModel ? "" : t("sizedToGpu")}
            options={modelOptions}
            selected={settings.voiceModel}
            onPick={(id) => {
              onUpdateSettings({ ...settings, voiceModel: id });
              setOpenMenu(null);
            }}
          />

          <Dropdown
            open={openMenu === "voice"}
            onToggle={() => setOpenMenu(openMenu === "voice" ? null : "voice")}
            label={t("voiceLabel")}
            value={
              voiceOptions.find((option) => option.id === selectedVoice)?.label ||
              t("systemVoice")
            }
            options={voiceOptions}
            selected={selectedVoice}
            onPick={pickVoice}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-light)]">
            <Tab
              active={!useNeural}
              onClick={() => setEngine("system")}
              label={t("systemVoice")}
            />
            <Tab
              active={useNeural}
              onClick={() => setEngine("neural")}
              disabled={!neuralPossible}
              title={
                neuralPossible ? t("naturalVoiceHint") : t("naturalVoiceEnglishOnly")
              }
              label={
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  {t("naturalVoice")}
                </span>
              }
            />
          </div>

          <div
            className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-light)]"
            title={t("speed")}
          >
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => onUpdateSettings({ ...settings, voiceRate: speed })}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-bold tabular-nums transition-colors ${
                  Math.abs(rate - speed) < 0.01
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
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
          : "text-[var(--text-muted)] hover:bg-[var(--hover-bg)]"
      }`}
    >
      {label}
    </button>
  );
}

interface DropdownProps {
  open: boolean;
  onToggle: () => void;
  label: string;
  value: string;
  /** Shown beside the value, for a choice that resolves to something else. */
  note?: string;
  options: { id: string; label: string; hint?: string }[];
  selected: string;
  onPick: (id: string) => void;
}

function Dropdown({
  open,
  onToggle,
  label,
  value,
  note,
  options,
  selected,
  onPick,
}: DropdownProps) {
  return (
    <div className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-light)] hover:bg-[var(--hover-bg)] transition-colors text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {note || label}
          </span>
          <span className="block truncate text-[12px] font-bold text-[var(--text-main)]">
            {value}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-[var(--text-muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full mt-1 left-0 right-0 ui-box p-1 z-50 flex flex-col gap-0.5 max-h-56 overflow-y-auto"
          >
            {options.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] font-bold text-[var(--text-muted)]">
                —
              </p>
            ) : (
              options.map((option) => (
                <button
                  key={option.id || "auto"}
                  type="button"
                  onClick={() => onPick(option.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                    option.id === selected
                      ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)]"
                      : "hover:bg-[var(--hover-bg)]"
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate text-[11px] font-bold">
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="text-[10px] font-medium opacity-60 flex-shrink-0">
                      {option.hint}
                    </span>
                  )}
                  {option.id === selected && (
                    <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RoundButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`w-12 h-12 rounded-full flex items-center justify-center border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? "bg-[var(--bg-inverted)] text-[var(--text-inverted)] border-transparent"
          : "bg-[var(--bg-panel)] border-[var(--border-light)] text-[var(--text-main)] hover:bg-[var(--hover-bg)]"
      }`}
    >
      {children}
    </button>
  );
}
