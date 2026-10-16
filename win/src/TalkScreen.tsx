import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translations } from "./translations";
import { listInstalledModels } from "./llama";
import { selectableModels } from "./modelKinds";
import Logo from "./Logo";
import { Button } from "./ui/Button";
import { Icon } from "./ui/icons/Icon";
import { Embers } from "./ui/signature/Embers";
import { EMBER_BUDGET } from "./ui/signature/emberBudget";
import { Fuse } from "./ui/signature/Fuse";
import { HearthGlow } from "./ui/signature/HearthGlow";
import TalkCaptions from "./voice/TalkCaptions";
import TalkControls from "./voice/TalkControls";
import { hearthHeat, isMicBlocked } from "./voice/talkHeat";
import { emptyConversationView, openConversation, planFor } from "./voice/conversation";
import { NEURAL_VOICES, isNeuralVoiceAvailable, resolveNeuralVoice } from "./voice/neuralVoice";
import { isSystemVoiceSupported } from "./voice/systemVoice";
import { createEarconPlayer, type Earcon, type EarconPlayer } from "./voice/earcons";
import type { InstalledModel } from "./llama";
import type { Activity, Conversation, ConversationView, StartupStep, Utterance } from "./voice/conversation";
import type { AppSettings } from "./types";

/** Talk: a spoken view of the current chat. It starts on arrival, files every finished turn into
 * the chat, and ending it goes back to that chat's transcript. */

interface TalkScreenProps {
  settings: AppSettings;
  /** The chat so far, read once when the conversation opens. */
  seed: { role: "user" | "assistant"; text: string }[];
  onTurn: (turn: Utterance) => void;
  /** Back to the chat, from End, Cancel or Show chat. */
  onLeave: () => void;
}

type Failure = { kind: "mic" } | { kind: "error"; message: string } | null;


export default function TalkScreen({ settings, seed, onTurn, onLeave }: TalkScreenProps) {
  const t = useCallback(
    (key: string) => translations[settings.language]?.[key] || translations["en"][key] || key,
    [settings.language],
  );

  const [view, setView] = useState<ConversationView>(() => ({ ...emptyConversationView(), stage: "starting" }));
  const [step, setStep] = useState<StartupStep>({ label: "", percent: 0, measured: false });
  const [failure, setFailure] = useState<Failure>(null);
  const [history, setHistory] = useState(false);
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [vram, setVram] = useState<number | null>(() => (window.electronAPI ? null : 0));

  const talkRef = useRef<Conversation | null>(null);
  /** Preparation can take a minute and the user may leave mid-way. The token says whether the
   * session that opens is still the one anyone asked for. */
  const attemptRef = useRef(0);
  const cancelRef = useRef<AbortController | null>(null);
  const seedRef = useRef(seed);
  const onTurnRef = useRef(onTurn);
  const viewRef = useRef(view);
  useEffect(() => {
    onTurnRef.current = onTurn;
    viewRef.current = view;
  });

  const live = view.stage === "live";
  const neuralPossible = isNeuralVoiceAvailable(settings.language);
  const useNeural = settings.voiceEngine !== "system" && neuralPossible;
  const rate = settings.voiceRate || 1;

  // ------------------------------------------------------------ housekeeping

  useEffect(() => {
    listInstalledModels()
      .then((models) => setInstalled(selectableModels(models)))
      .catch(() => setInstalled([]));
    window.electronAPI
      ?.getSystemSpecs()
      .then((specs) => setVram(specs?.vram ?? 0))
      .catch(() => setVram(0));
  }, []);

  useEffect(
    () => () => {
      attemptRef.current++;
      cancelRef.current?.abort();
      talkRef.current?.stop();
    },
    [],
  );

  // ------------------------------------------------------------------ the plan

  const names = useMemo(() => (installed ?? []).map((entry) => entry.name), [installed]);

  const config = useMemo(
    () => ({
      language: settings.language,
      preferredModel: settings.voiceModel,
      chatModel: settings.modelName,
      installed: names,
      vram: vram ?? 0,
      engine:
        settings.voiceEngine === "cloud" && settings.cloudProvider
          ? ("cloud" as const)
          : settings.voiceEngine === "system"
            ? ("system" as const)
            : ("neural" as const),
      cloud: settings.cloudProvider
        ? { provider: settings.cloudProvider, voice: settings.cloudVoice, model: settings.cloudModel || undefined }
        : undefined,
      systemVoice: settings.voiceName,
      neuralVoice: resolveNeuralVoice(settings.neuralVoice),
      rate,
      searchEnabled: settings.webMode !== "off",
      sounds: settings.voiceSounds !== false,
    }),
    [names, rate, settings, vram],
  );

  const plan = useMemo(() => planFor(config), [config]);

  // ------------------------------------------------------------------ actions

  const start = useCallback(async () => {
    const attempt = ++attemptRef.current;
    const cancel = new AbortController();
    cancelRef.current = cancel;

    setFailure(null);
    setView({ ...emptyConversationView(), stage: "starting", model: plan.model });

    try {
      const conversation = await openConversation(
        { ...config, signal: cancel.signal, history: seedRef.current },
        {
          onView: setView,
          onStep: setStep,
          onTurn: (turn) => onTurnRef.current(turn),
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
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      if (name === "AbortError" || attemptRef.current !== attempt) return;
      setFailure(
        isMicBlocked(error)
          ? { kind: "mic" }
          : { kind: "error", message: String((error as { message?: unknown } | null)?.message ?? error) },
      );
      setView({ ...emptyConversationView(), stage: "failed" });
    }
  }, [config, plan.model, t]);

  // Chimes are off unless the user turned them on; the context exists only while one may sound.
  const chimes = useRef<{ context: AudioContext; player: EarconPlayer } | null>(null);
  const chime = useCallback(
    (name: Earcon) => {
      if (!settings.interfaceSounds) return;
      if (!chimes.current) {
        const context = new AudioContext();
        chimes.current = { context, player: createEarconPlayer(context) };
      }
      chimes.current.player.play(name);
    },
    [settings.interfaceSounds],
  );
  useEffect(
    () => () => {
      const held = chimes.current;
      chimes.current = null;
      // The leaving chime is still sounding.
      setTimeout(() => {
        held?.player.dispose();
        void held?.context.close();
      }, 1000);
    },
    [],
  );

  const end = useCallback(() => {
    attemptRef.current++;
    cancelRef.current?.abort();
    talkRef.current?.stop();
    talkRef.current = null;
    chime("ended");
    onLeave();
  }, [onLeave, chime]);

  const toggleMute = useCallback(() => {
    chime(viewRef.current.muted ? "unmute" : "mute");
    talkRef.current?.setMuted(!viewRef.current.muted);
  }, [chime]);

  const wasLive = useRef(false);
  useEffect(() => {
    if (view.stage === "live" && !wasLive.current) chime("ready");
    if (view.stage === "failed") chime("error");
    wasLive.current = view.stage === "live";
  }, [view.stage, chime]);

  // Talk starts on arrival, once it is known what is installed, so the plan never asks for a
  // download of a model that is already on disk.
  const ready = installed !== null && vram !== null;
  const startedRef = useRef(false);
  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [ready, start]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, button, [contenteditable='true']")) return;

      if (event.key === "Escape") {
        event.preventDefault();
        end();
      } else if (event.key === " " && viewRef.current.stage === "live") {
        event.preventDefault();
        toggleMute();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [end, toggleMute]);

  // -------------------------------------------------------------------- ember

  const heat = useCallback(() => {
    const current = viewRef.current;
    return hearthHeat(
      { live: current.stage === "live", muted: current.muted, activity: current.activity },
      talkRef.current?.level() ?? 0,
      performance.now(),
    );
  }, []);
  const generating = live && view.activity !== "listening" && view.activity !== "hearing";

  // --------------------------------------------------------------------- text

  const statusLabel: Record<Activity, string> = {
    listening: t("voiceListening"),
    hearing: t("voiceHearing"),
    thinking: t("voiceThinking"),
    searching: t("voiceSearchingWeb"),
    speaking: t("voiceSpeaking"),
  };

  const status =
    failure?.kind === "mic"
      ? t("micBlocked")
      : view.stage === "starting"
        ? step.label || t("preparingVoice")
        : live
          ? view.muted
            ? t("micMuted")
            : statusLabel[view.activity]
          : "";

  const voiceLabel = view.voice === "cloud"
    ? settings.cloudProvider
    : useNeural
    ? (NEURAL_VOICES.find((voice) => voice.id === resolveNeuralVoice(settings.neuralVoice))?.name ?? t("naturalVoice"))
    : settings.voiceName || t("systemVoice");
  const modelLabel = live ? view.model : plan.source === "sized" ? (plan.tier?.label ?? plan.model) : plan.model;
  const unsupported = !isSystemVoiceSupported() && !neuralPossible;
  const errorText = failure?.kind === "error" ? failure.message : live ? view.error : "";

  // --------------------------------------------------------------------- view

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden bg-surface-canvas">
      <Embers
        heat={heat}
        budget={generating ? EMBER_BUDGET.generating : EMBER_BUDGET.idle}
        className="absolute inset-0 h-full w-full"
      />

      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6">
        <Logo className="h-24 w-24 text-text-primary" />

        <p role="status" className="min-h-5 text-[14px] leading-5 text-text-secondary">
          {status}
        </p>

        {view.stage === "starting" && (
          <div className="w-full max-w-xs">
            <Fuse progress={step.measured ? step.percent / 100 : undefined} label={status} />
          </div>
        )}

        {live && <TalkCaptions turns={view.turns} draft={view.draft} history={history} t={t} />}

        {failure?.kind === "mic" && (
          <p className="max-w-md text-center text-[14px] leading-6 text-text-secondary">
            {t("micBlockedWindows")}
          </p>
        )}

        {errorText && (
          <p className="flex max-w-md items-start gap-2 text-[13px] leading-5 text-danger">
            <Icon name="warning-circle" size={16} className="mt-0.5 flex-shrink-0" />
            <span>{errorText}</span>
          </p>
        )}

        {unsupported && !live && <p className="text-[13px] text-danger">{t("voiceOutputUnavailable")}</p>}

        {view.stage === "failed" && (
          <Button variant="secondary" onClick={() => void start()}>
            {t("retry")}
          </Button>
        )}
      </main>

      <footer className="relative flex flex-shrink-0 flex-col items-center gap-3 pb-8 pt-4">
        {view.stage === "starting" ? (
          // Preparing can mean a download of several gigabytes, so leaving is one click.
          <Button variant="secondary" onClick={end}>
            {t("cancel")}
          </Button>
        ) : (
          <TalkControls
            live={live}
            muted={view.muted}
            history={history}
            canSkip={live && view.activity === "speaking"}
            t={t}
            onMute={toggleMute}
            onEnd={end}
            onHistory={() => setHistory((value) => !value)}
            onSkip={() => talkRef.current?.skip()}
            onShowChat={end}
          />
        )}

        {live && view.fallback && (
          <p role="status" className="text-center text-[12px] text-text-tertiary">
            {t("voiceFellBack")} ({view.fallback})
          </p>
        )}

        {/* Diagnostics: which model answers, which voice, and whether the neural detector and GPU
            synthesis loaded. */}
        {live && (
          <p className="flex flex-wrap items-center justify-center gap-x-2 text-[12px] text-text-tertiary">
            <span>{modelLabel || t("noModelSelected")}</span>
            <span aria-hidden>·</span>
            <span>{voiceLabel}</span>
            {view.detector === "energy" && (
              <>
                <span aria-hidden>·</span>
                <span title={t("basicDetectorHint")}>{t("basicDetector")}</span>
              </>
            )}
            {view.voice === "cloud" && (
              <>
                <span aria-hidden>┬À</span>
                <span title={`${view.cloudChars} ${t("cloudChars")}`}>{t("cloudMarker")}</span>
              </>
            )}
            {view.device && (
              <>
                <span aria-hidden>·</span>
                <span>{view.device === "webgpu" ? "WebGPU" : "WASM"}</span>
              </>
            )}
            {view.replyMs !== null && (
              <>
                <span aria-hidden>·</span>
                <span
                  className="tabular-nums"
                  title={
                    view.stages
                      ? `${t("replyLatencyHint")}
${t("stageTranscribe")} ${view.stages.transcribeMs} ms · ${t("stageToken")} ${view.stages.firstTokenMs} ms · ${t("stageFragment")} ${view.stages.firstFragmentMs} ms · ${t("stageAudio")} ${view.stages.firstAudioMs} ms`
                      : t("replyLatencyHint")
                  }
                >
                  {view.replyMs} ms
                </span>
              </>
            )}
          </p>
        )}
      </footer>

      <HearthGlow lit={live && !view.muted} />
    </div>
  );
}
