import { prepareSpeech, transcribeSamples } from "../speech";
import { buildVoicePrompt } from "../prompts";
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
import type { Detector, DetectorKind } from "./vad";
import type { VoiceEngine, VoiceEngineId } from "./voiceEngine";

/**
 * The conversation, arranged around the gap between falling silent and hearing
 * a reply. Every stage overlaps the one before; this file is only the wiring.
 */

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
  /** Silence to first spoken word on the last turn, in milliseconds. */
  replyMs: number | null;
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
  rate: number;
  searchEnabled: boolean;
  /**
   * Cancels the preparation. Leaving voice mode mid-download must stop the
   * download and release the microphone, not carry both on in the background.
   */
  signal?: AbortSignal;
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
    replyMs: null,
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
  spoken: string;
  controller: AbortController;
  filed: boolean;
}

export async function openConversation(
  config: ConversationConfig,
  hooks: ConversationHooks,
): Promise<Conversation> {
  let view: ConversationView = { ...emptyConversationView(), stage: "starting" };

  let capture: Capture | null = null;
  let detector: Detector | null = null;
  let engine: VoiceEngine | null = null;
  let speaker: Speaker | null = null;
  let gate: Gate | null = null;

  let closed = false;
  let counter = 0;
  let level = 0;

  /**
   * Which turn the microphone is working on. A transcription that lands after
   * this changes belongs to a turn nobody is waiting for any more.
   */
  let listening = 0;

  /**
   * The answer being generated, held by identity: a barge-in that turns out to
   * be "mhm" leaves it alone, and generation carries on rather than restarting.
   */
  let answer: Answer | null = null;

  let speaking = false;
  let history: Utterance[] = [];

  /** A transcription started during a pause, reused if the turn really ended. */
  let guess: { samples: number; text: Promise<string> } | null = null;
  let partialTimer: ReturnType<typeof setTimeout> | null = null;
  let partialCost = 0;
  let transcribing = false;

  let silenceAt = 0;
  let painted = 0;

  /** Settled during startup, once it is known what could actually be fetched. */
  let answering = "";

  const system = buildVoicePrompt(config.searchEnabled);
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
    } catch {
      partialCost = Number.POSITIVE_INFINITY;
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
      } catch {
        /* fall through and transcribe again from scratch */
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
  };

  const wireTurns = () =>
    history.map((turn) => ({
      role: turn.role,
      content: turn.cut
        ? `${turn.text} [cut off here — the user started speaking]`
        : turn.text,
    }));

  /**
   * Ends the answer in flight. Whatever was already said is kept, so the model
   * can see what the user actually heard before they interrupted.
   */
  const abandon = (interrupted: boolean) => {
    const current = answer;
    if (!current) return;

    answer = null;
    current.controller.abort();

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
    } catch {
      return "";
    }
  };

  const respond = async (question: string) => {
    const current: Answer = {
      id: ++counter,
      spoken: "",
      controller: new AbortController(),
      filed: false,
    };
    answer = current;

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

            current.spoken += piece;
            if (!heard) {
              heard = true;
              publish({ replyMs: Math.round(performance.now() - silenceAt) });
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
      if (error instanceof Error && error.name === "AbortError") return;
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
    await prepareSpeech((progress) =>
      step(hooks.strings.loadingSpeechModel, progress.percent, true),
    );

    const onSpeakingChange = (active: boolean) => {
      speaking = active;
      if (active) setActivity("speaking");
      else if (!gate?.state().speaking) settle();
    };

    if (config.engine === "neural" && isNeuralVoiceAvailable(config.language)) {
      step(hooks.strings.loadingNeuralVoice, 0, true);
      try {
        const neural = await createNeuralVoice(capture.context, {
          language: config.language,
          voice: config.neuralVoice,
          rate: config.rate,
          onSpeakingChange,
          onProgress: (progress) =>
            step(hooks.strings.loadingNeuralVoice, progress.percent, true),
        });
        engine = neural;
        publish({ device: neural.device });
      } catch {
        // A neural voice that will not load is not a reason to lose the
        // conversation; the system voice takes over.
        engine = null;
      }
    }

    if (!engine) {
      if (!isSystemVoiceSupported()) throw new Error(hooks.strings.noVoiceOutput);
      engine = createSystemVoice({
        language: config.language,
        voice: config.systemVoice,
        rate: config.rate,
        onSpeakingChange,
      });
    }

    speaker = createSpeaker(engine);

    step(hooks.strings.warmingUp, 100, false);
    await warming;
    guard();

    publish({ stage: "live", activity: "listening", voice: engine.id });
  } catch (error) {
    closed = true;
    stopPartials();
    capture?.stop();
    detector?.stop();
    engine?.dispose();
    throw error;
  }

  // ----------------------------------------------------------------- controls

  return {
    stop() {
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
