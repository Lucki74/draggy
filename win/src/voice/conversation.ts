import { prepareSpeech, transcribeSamples } from "../speech";
import { buildVoicePrompt } from "../prompts";
import { isPlayful, stripCues } from "./vocalSounds";
import { isBackchannel } from "./backchannel";
import { startCapture } from "./capture";
import {
  HISTORY_TURNS,
  PARTIAL_BUDGET_MS,
  PARTIAL_INTERVAL_MS,
  SAMPLE_RATE,
} from "./constants";
import { createGate } from "./gate";
import { createNeuralVoice, isNeuralVoiceAvailable } from "./neuralVoice";
import { createCloudVoice } from "./cloudVoice";
import type { CloudFailure } from "./cloudVoice";
import { generateReply, summariseResults } from "./reply";
import { createSpeaker } from "./speaker";
import { createSystemVoice, isSystemVoiceSupported } from "./systemVoice";
import { planTalkModel, provideTalkModel, warmTalkModel } from "./talkModel";
import { endpointDelay } from "./turnDetector";
import { createDetector } from "./vad";
import type { Capture } from "./capture";
import type { Gate } from "./gate";
import type { Speaker } from "./speaker";
import type { TalkPlan } from "./talkModel";
import { logRendererEvent, logSwallow } from "../logger";
import type { Detector, DetectorKind } from "./vad";
import type { VoiceEngine, VoiceEngineId } from "./voiceEngine";

/** The conversation, arranged around the gap between falling silent and hearing a reply. Every
 * stage overlaps the one before; this file is only the wiring. */

export type Stage = "idle" | "starting" | "live" | "failed";

export type Activity =
  | "listening"
  | "hearing"
  | "thinking"
  | "searching"
  | "speaking";

export interface Utterance {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** The user took the turn back before this one finished. */
  cut?: boolean;
}

export interface ConversationView {
  stage: Stage;
  activity: Activity;
  muted: boolean;
  /** What the user is saying right now, before it becomes a turn. */
  draft: string;
  turns: Utterance[];
  error: string;
  /** The model answering, which is not always the one that was planned. */
  model: string;
  detector: DetectorKind | null;
  voice: VoiceEngineId | null;
  device: "webgpu" | "wasm" | null;
  /** Why the voice dropped to a lower tier, as a short code; empty while it has not. */
  fallback: string;
  /** Characters sent to a cloud voice in this conversation. */
  cloudChars: number;
  /** Silence to first spoken word on the last turn, in milliseconds. */
  replyMs: number | null;
  /** Where that time went on the last turn. Durations only, never text or audio. */
  stages: ReplyStages | null;
}

export interface ReplyStages {
  /** Speech end to transcript ready. */
  transcribeMs: number;
  /** Transcript to the first generated token. */
  firstTokenMs: number;
  /** First token to the first fragment handed to the voice. */
  firstFragmentMs: number;
  /** That fragment to the first audio played. */
  firstAudioMs: number;
}

export interface StartupStep {
  label: string;
  percent: number;
  /** False while the work underway has no measurable size. */
  measured: boolean;
}

export interface ConversationConfig {
  language: string;
  /** The model the user pinned, or empty to size one to the hardware. */
  preferredModel: string;
  /** Answers if the sized model cannot be fetched. */
  chatModel: string;
  installed: string[];
  vram: number;
  engine: VoiceEngineId;
  systemVoice: string;
  neuralVoice: string;
  /** The cloud voice to use when `engine` is "cloud". */
  cloud?: { provider: string; voice: string; model?: string };
  rate: number;
  searchEnabled: boolean;
  /** Breaths, sighs, hums and laughs around the words. */
  sounds: boolean;
  /** Cancels the preparation. Leaving voice mode mid-download must stop the download and release
   * the microphone, not carry both on in the background. */
  signal?: AbortSignal;
  /** The chat this conversation continues, oldest first, so the model knows what came before. */
  history?: { role: "user" | "assistant"; text: string }[];
}

export interface ConversationStrings {
  preparing: string;
  downloadingModel: string;
  warmingUp: string;
  loadingSpeechModel: string;
  loadingNeuralVoice: string;
  lookingItUp: string;
  noVoiceOutput: string;
}

export interface ConversationHooks {
  onView: (view: ConversationView) => void;
  onStep: (step: StartupStep) => void;
  /** A finished turn, once, to be kept in the chat. */
  onTurn?: (turn: Utterance) => void;
  /** Translated, so nothing user-visible is written in this module. */
  strings: ConversationStrings;
}

export interface Conversation {
  stop: () => void;
  setMuted: (muted: boolean) => void;
  /** Drop the reply in progress without ending the conversation. */
  skip: () => void;
  /** Microphone level, read every frame by the interface without a render. */
  level: () => number;
  view: () => ConversationView;
}

/** A long chat message is cut to this many characters before it seeds a spoken conversation. */
const SEED_CHARS = 1200;

/** How often streamed reply text may trigger a render. */
const PAINT_INTERVAL_MS = 80;

export function emptyConversationView(): ConversationView {
  return {
    stage: "idle",
    activity: "listening",
    muted: false,
    draft: "",
    turns: [],
    error: "",
    model: "",
    detector: null,
    voice: null,
    device: null,
    fallback: "",
    cloudChars: 0,
    replyMs: null,
    stages: null,
  };
}

/** What Talk will run, before anything has been downloaded. */
export function planFor(config: ConversationConfig): TalkPlan {
  return planTalkModel({
    override: config.preferredModel,
    installed: config.installed,
    vram: config.vram,
  });
}

interface Answer {
  id: number;
  /** What the model wrote, sound cues included, for the speaker. */
  raw: string;
  /** What was said, as it is shown and kept. */
  spoken: string;
  controller: AbortController;
  filed: boolean;
}

export async function openConversation(
  config: ConversationConfig,
  hooks: ConversationHooks,
): Promise<Conversation> {
  const openedAt = performance.now();
  logRendererEvent("renderer.voice", "INFO", "conversation starting", {
    engine: config.engine,
    language: config.language,
    sounds: config.sounds,
    history: config.history?.length ?? 0,
  });
  let view: ConversationView = { ...emptyConversationView(), stage: "starting" };

  let capture: Capture | null = null;
  let detector: Detector | null = null;
  let engine: VoiceEngine | null = null;
  let speaker: Speaker | null = null;
  let gate: Gate | null = null;

  let closed = false;
  let counter = 0;
  let level = 0;

  /** Which turn the microphone is working on. A transcription that lands after this changes belongs
   * to a turn nobody is waiting for any more. */
  let listening = 0;

  /** The answer being generated, held by identity: a barge-in that turns out to be "mhm" leaves it
   * alone, and generation carries on rather than restarting. */
  let answer: Answer | null = null;

  let speaking = false;
  let history: Utterance[] = (config.history ?? [])
    .filter((turn) => turn.text.trim())
    .slice(-HISTORY_TURNS)
    .map((turn) => ({ id: ++counter, role: turn.role, text: turn.text.slice(0, SEED_CHARS) }));
  view = { ...view, turns: history };

  /** A transcription started during a pause, reused if the turn really ended. */
  let guess: { samples: number; text: Promise<string> } | null = null;
  let partialTimer: ReturnType<typeof setTimeout> | null = null;
  let partialCost = 0;
  let transcribing = false;

  let silenceAt = 0;
  /** Clock marks of the reply in progress, for the stage breakdown. */
  let marks: { transcript: number; token?: number; fragment?: number; audio?: number } | null = null;
  let painted = 0;

  /** Settled during startup, once it is known what could actually be fetched. */
  let answering = "";

  const system = buildVoicePrompt(
    config.searchEnabled,
    // Only Supertonic voices a cue itself; every other engine would have to fake it.
    config.sounds && config.engine === "neural" ? ["laugh"] : [],
  );
  const language = () => config.language || "en";

  const publish = (patch: Partial<ConversationView>) => {
    view = { ...view, ...patch };
    hooks.onView(view);
  };

  const setActivity = (activity: Activity) => {
    if (view.activity !== activity) publish({ activity });
  };

  /** Whatever the conversation is doing when nothing else is going on. */
  const settle = () => {
    if (speaking) setActivity("speaking");
    else if (answer) setActivity("thinking");
    else setActivity("listening");
  };

  // ------------------------------------------------------- live transcription

  const stopPartials = () => {
    if (!partialTimer) return;
    clearTimeout(partialTimer);
    partialTimer = null;
  };

  const schedulePartial = () => {
    stopPartials();
    // A machine that cannot transcribe faster than people talk would spend the
    // whole turn falling further behind, so it stops trying instead.
    if (partialCost > PARTIAL_BUDGET_MS) return;
    partialTimer = setTimeout(() => void runPartial(), PARTIAL_INTERVAL_MS);
  };

  const runPartial = async () => {
    partialTimer = null;

    const samples = gate?.snapshot();
    if (closed || !samples || transcribing) {
      if (!closed && gate?.state().speaking) schedulePartial();
      return;
    }

    const mine = listening;
    const started = performance.now();
    transcribing = true;

    try {
      const text = await transcribeSamples(samples, { language: language() });
      partialCost = performance.now() - started;
      if (closed || mine !== listening) return;

      if (text) {
        publish({ draft: text });
        // What was said last decides how long the pause after it has to be
        // before the turn counts as finished.
        gate?.setEndpointDelay(endpointDelay(text, language()));
      }
    } catch (error) {
      partialCost = Number.POSITIVE_INFINITY;
      logRendererEvent("renderer.voice", "WARN", "live transcription failed", { error, turn: mine });
    } finally {
      transcribing = false;
      if (!closed && gate?.state().speaking) schedulePartial();
    }
  };

  const readTurn = async (samples: Float32Array): Promise<string> => {
    // The tail of a turn is silence, so a speculative pass that already covered
    // every voiced sample gives the same answer a fresh pass would.
    if (guess && samples.length - guess.samples <= SAMPLE_RATE) {
      const pending = guess.text;
      guess = null;
      try {
        return await pending;
      } catch (error) {
        logSwallow("renderer.voice", error, "fall through and transcribe again from scratch");
      }
    }

    guess = null;
    transcribing = true;
    try {
      return await transcribeSamples(samples, { language: language() });
    } finally {
      transcribing = false;
    }
  };

  // ------------------------------------------------------------------ answers

  const file = (turn: Utterance) => {
    history = [...history, turn].slice(-HISTORY_TURNS);
    publish({ turns: history });
    hooks.onTurn?.(turn);
  };

  const wireTurns = () =>
    history.map((turn) => ({
      role: turn.role,
      content: turn.cut
        ? `${turn.text} [cut off here, the user started speaking]`
        : turn.text,
    }));

  /** Ends the answer in flight. Whatever was already said is kept, so the model can see what the
   * user actually heard before they interrupted. */
  const abandon = (interrupted: boolean) => {
    const current = answer;
    if (!current) return;

    answer = null;
    current.controller.abort();
    logRendererEvent("renderer.voice", "DEBUG", "answer abandoned", { interrupted, turn: current.id });

    const said = current.spoken.trim();
    if (!current.filed && said) {
      current.filed = true;
      file({
        id: current.id,
        role: "assistant",
        text: said,
        cut: interrupted || undefined,
      });
    }
  };

  const searchTheWeb = async (query: string): Promise<string> => {
    try {
      const results = (await window.electronAPI?.searchWeb(query)) ?? [];
      return summariseResults(results);
    } catch (error) {
      logRendererEvent("renderer.voice", "WARN", "web search failed", { error });
      return "";
    }
  };

  const publishStages = () => {
    if (!marks || marks.token === undefined || marks.fragment === undefined || marks.audio === undefined) return;
    publish({
      stages: {
        transcribeMs: Math.round(marks.transcript - silenceAt),
        firstTokenMs: Math.round(marks.token - marks.transcript),
        firstFragmentMs: Math.round(marks.fragment - marks.token),
        firstAudioMs: Math.round(marks.audio - marks.fragment),
      },
    });
  };

  /** Whether the latest question joked or laughed, so the voice may laugh back. */
  let playful = false;

  const respond = async (question: string) => {
    const startedAt = performance.now();
    marks = { transcript: startedAt };
    playful = isPlayful(question);
    const current: Answer = {
      id: ++counter,
      raw: "",
      spoken: "",
      controller: new AbortController(),
      filed: false,
    };
    answer = current;
    logRendererEvent("renderer.voice", "INFO", "reply started", { turn: current.id, chars: question.length });

    const mine = () => !closed && answer === current;

    file({ id: ++counter, role: "user", text: question });
    publish({ draft: "" });
    setActivity("thinking");

    let heard = false;

    const paint = () => {
      const now = performance.now();
      if (now - painted < PAINT_INTERVAL_MS) return;
      painted = now;
      publish({
        turns: [
          ...history,
          { id: current.id, role: "assistant" as const, text: current.spoken },
        ],
      });
    };

    try {
      await generateReply(
        {
          model: answering,
          system,
          turns: wireTurns(),
          searchEnabled: config.searchEnabled,
          signal: current.controller.signal,
          search: searchTheWeb,
        },
        {
          onSpeech: (piece) => {
            if (!mine()) return;

            current.raw += piece;
            current.spoken = stripCues(current.raw);
            if (!heard) {
              heard = true;
              publish({ replyMs: Math.round(performance.now() - silenceAt) });
              if (marks) marks.token = performance.now();
            }

            speaker?.push(piece);
            paint();
          },

          onSearch: () => {
            if (!mine()) return;
            setActivity("searching");
            // Said out loud because a silent pause of several seconds reads as
            // a broken assistant rather than a busy one.
            speaker?.say(hooks.strings.lookingItUp);
          },
        },
      );

      if (!mine()) return;

      speaker?.flush();
      answer = null;

      const said = current.spoken.trim();
      logRendererEvent("renderer.voice", "INFO", "reply finished", {
        turn: current.id,
        chars: said.length,
        durMs: Math.round(performance.now() - startedAt),
      });
      if (said) {
        current.filed = true;
        file({ id: current.id, role: "assistant", text: said });
      } else {
        publish({ turns: history });
      }
      settle();
    } catch (error) {
      if (!mine()) return;
      answer = null;
      if (error instanceof Error && error.name === "AbortError") {
        logRendererEvent("renderer.voice", "DEBUG", "reply aborted", { turn: current.id });
        return;
      }
      logRendererEvent("renderer.voice", "ERROR", "reply failed", { error, turn: current.id });
      publish({ error: error instanceof Error ? error.message : String(error) });
      settle();
    }
  };

  // -------------------------------------------------------------------- turns

  /** A burst that turned out not to be a turn: put the answer back as it was. */
  const resume = () => {
    publish({ draft: "" });
    if (speaker?.suspended()) {
      speaker.resume();
      setActivity("speaking");
    } else {
      settle();
    }
  };

  const takeTurn = async (samples: Float32Array) => {
    const mine = ++listening;
    stopPartials();
    silenceAt = performance.now();

    try {
      const text = (await readTurn(samples)).trim();
      if (closed || mine !== listening) return;
      logRendererEvent("renderer.voice", "INFO", "turn transcribed", {
        turn: mine,
        chars: text.length,
        transcribeMs: Math.round(performance.now() - silenceAt),
      });

      // Whisper writes "Thank you." or "[BLANK_AUDIO]" for silence. Both that
      // and an acknowledgement are reasons to carry on rather than answer.
      if (!text || isBackchannel(text, language())) {
        resume();
        return;
      }

      speaker?.cancel();
      abandon(true);

      publish({ error: "" });
      await respond(text);
    } catch (error) {
      if (closed || mine !== listening) return;
      logRendererEvent("renderer.voice", "ERROR", "turn recognition failed", { error, turn: mine });
      publish({
        error: error instanceof Error ? error.message : String(error),
        draft: "",
      });
      settle();
    }
  };

  // ------------------------------------------------------------------ startup

  const guard = () => {
    if (config.signal?.aborted) {
      throw new DOMException("Voice mode was closed", "AbortError");
    }
  };

  const step = (label: string, percent: number, measured: boolean) => {
    guard();
    hooks.onStep({ label, percent, measured });
  };

  try {
    step(hooks.strings.preparing, 0, false);

    gate = createGate({
      onSpeechStart: () => {
        listening++;
        publish({ draft: "" });
        setActivity("hearing");
        // Drop the volume the moment a voice appears. If it turns out to be a
        // cough the level comes straight back up and nothing was lost.
        if (speaking) speaker?.duck(true);
        partialCost = 0;
        schedulePartial();
      },

      onBargeIn: () => {
        if (!speaking && !answer) return;
        logRendererEvent("renderer.voice", "DEBUG", "barge in", { speaking, answering: answer !== null });
        speaker?.duck(false);
        // Stop the audio but keep generating. If this turns out to be "mhm",
        // resuming carries on from the text written since, with no repetition.
        speaker?.suspend();
      },

      onSpeculate: (samples) => {
        if (transcribing) return;
        transcribing = true;
        guess = {
          samples: samples.length,
          text: transcribeSamples(samples, { language: language() }).finally(() => {
            transcribing = false;
          }),
        };
      },

      onSpeechEnd: (samples) => {
        speaker?.duck(false);
        stopPartials();
        setActivity("thinking");
        void takeTurn(samples);
      },

      onDiscard: () => {
        stopPartials();
        speaker?.duck(false);
        resume();
      },
    });

    // The microphone prompt comes first: the only step that fails for a reason
    // the user can act on, and it should not arrive after a download.
    capture = await startCapture({
      onLevel: (value) => {
        level = value;
      },
      onFrame: (frame) => detector?.push(frame),
    });

    detector = await createDetector((frame, probability) => {
      gate?.push(frame, probability, speaking);
    });
    publish({ detector: detector.kind });

    const plan = planFor(config);
    publish({ model: plan.model });

    if (plan.download) {
      step(`${hooks.strings.downloadingModel} ${plan.download.label}`, 0, true);
    }

    const provided = await provideTalkModel(plan, {
      fallback: config.chatModel,
      signal: config.signal,
      onProgress: (progress) =>
        step(
          `${hooks.strings.downloadingModel} ${plan.download?.label ?? progress.model}`,
          progress.percent,
          true,
        ),
    });
    answering = provided.model;
    publish({ model: provided.model });

    // Loading weights takes seconds above a billion parameters, so it runs
    // behind the remaining steps rather than inside the first spoken turn.
    const warming = warmTalkModel(provided.model);

    step(hooks.strings.loadingSpeechModel, 0, true);
    await prepareSpeech(
      (progress) => step(hooks.strings.loadingSpeechModel, progress.percent, true),
      config.language,
    );

    const onSpeakingChange = (active: boolean) => {
      speaking = active;
      if (active && marks && marks.fragment !== undefined && marks.audio === undefined) {
        marks.audio = performance.now();
        publishStages();
      }
      if (active) setActivity("speaking");
      else if (!gate?.state().speaking) settle();
    };

    const makeLocal = async (): Promise<VoiceEngine> => {
      if (isNeuralVoiceAvailable(config.language)) {
        step(hooks.strings.loadingNeuralVoice, 0, true);
        try {
          const neural = await createNeuralVoice(capture!.context, {
            language: config.language,
            voice: config.neuralVoice,
            rate: config.rate,
            onSpeakingChange,
            onProgress: (progress) => step(hooks.strings.loadingNeuralVoice, progress.percent, true),
          });
          publish({ device: neural.device });
          return neural;
        } catch (error) {
          logSwallow("renderer.voice", error, "falls through to the system voice");
        }
      }
      if (!isSystemVoiceSupported()) throw new Error(hooks.strings.noVoiceOutput);
      return createSystemVoice({ language: config.language, voice: config.systemVoice, rate: config.rate, onSpeakingChange });
    };

    const speakerOptions = {
      sounds: config.sounds,
      language: config.language,
      playful: () => playful,
      onFragment: () => {
        if (marks && marks.token !== undefined && marks.fragment === undefined) marks.fragment = performance.now();
      },
    };

    /** A cloud voice that fails mid-reply hands what is left to the best local voice; the next
     * reply stays local, and the notice says why. */
    const dropToLocal = async (failure: CloudFailure) => {
      publish({ fallback: failure.code });
      const retired = speaker;
      const local = await makeLocal();
      if (closed) {
        local.dispose();
        return;
      }
      engine = local;
      speaker = createSpeaker(local, speakerOptions);
      logRendererEvent("renderer.voice", "WARN", "cloud voice dropped to local", {
        code: failure.code,
        remaining: failure.remaining.length,
        engine: local.id,
      });
      publish({ voice: local.id });
      retired?.dispose();
      for (const text of failure.remaining) speaker.say(text);
    };

    if (config.engine === "cloud" && config.cloud) {
      step(hooks.strings.loadingNeuralVoice, 0, true);
      try {
        engine = await createCloudVoice(capture.context, {
          language: config.language,
          voice: config.cloud.voice,
          model: config.cloud.model,
          provider: config.cloud.provider,
          rate: config.rate,
          onSpeakingChange,
          onUsage: (characters) => publish({ cloudChars: characters }),
          onFailure: (failure) => void dropToLocal(failure),
        });
      } catch (error) {
        logRendererEvent("renderer.voice", "WARN", "cloud voice unavailable", { error });
        engine = null;
        publish({ fallback: "unavailable" });
      }
    }

    if (!engine) {
      if (config.engine === "system") {
        if (!isSystemVoiceSupported()) throw new Error(hooks.strings.noVoiceOutput);
        engine = createSystemVoice({ language: config.language, voice: config.systemVoice, rate: config.rate, onSpeakingChange });
      } else {
        engine = await makeLocal();
      }
    }

    logRendererEvent("renderer.voice", "INFO", "speech engine chosen", {
      engine: engine.id,
      requested: config.engine,
      fallback: view.fallback,
    });
    speaker = createSpeaker(engine, speakerOptions);

    step(hooks.strings.warmingUp, 100, false);
    await warming;
    guard();

    logRendererEvent("renderer.voice", "INFO", "conversation live", {
      engine: engine.id,
      device: view.device,
      detector: detector.kind,
      model: provided.model,
      durMs: Math.round(performance.now() - openedAt),
    });
    publish({ stage: "live", activity: "listening", voice: engine.id });
  } catch (error) {
    closed = true;
    const aborted = error instanceof DOMException && error.name === "AbortError";
    logRendererEvent(
      "renderer.voice",
      aborted ? "INFO" : "ERROR",
      aborted ? "conversation cancelled while opening" : "conversation failed to open",
      { error, durMs: Math.round(performance.now() - openedAt) },
    );
    stopPartials();
    capture?.stop();
    detector?.stop();
    engine?.dispose();
    throw error;
  }

  // ----------------------------------------------------------------- controls

  return {
    stop() {
      logRendererEvent("renderer.voice", "INFO", "conversation stopped", { turns: history.length });
      closed = true;
      listening++;
      stopPartials();
      abandon(false);
      speaker?.dispose();
      detector?.stop();
      capture?.stop();
      publish({ stage: "idle", activity: "listening", draft: "" });
    },

    setMuted(muted) {
      logRendererEvent("renderer.voice", "DEBUG", "mute changed", { muted });
      capture?.setMuted(muted);
      gate?.reset();
      detector?.reset();
      if (muted) {
        speaker?.cancel();
        abandon(false);
      }
      publish({ muted, draft: "" });
    },

    skip() {
      speaker?.cancel();
      abandon(false);
      setActivity("listening");
    },

    level: () => level,

    view: () => view,
  };
}
