import { createSentenceChunker, speakableText } from "./chunker";
import { filterCues } from "./vocalSounds";
import type { Boundary, SentenceChunker } from "./chunker";
import type { VoiceEngine, VoiceEngineId } from "./voiceEngine";
import { logRendererEvent } from "../logger";

/** What the assistant says, and when. Text arrives a token at a time and a synthesiser wants
 * clauses, so this cuts at the earliest phrase-shaped point. Sound cues are kept only when the
 * engine voices them itself, and sparingly: people do not laugh in every reply. */

export interface Speaker {
  engineId: VoiceEngineId;
  /** Feed streamed reply text. */
  push: (delta: string) => void;
  /** End of a reply: say whatever is left over. */
  flush: () => void;
  /** Say something at once, ahead of the queue's remaining text. */
  say: (text: string) => void;
  /** Stop talking but keep buffering, the instant a barge-in is detected. If the user only said
   * "mhm", resume() picks up without repeating. */
  suspend: () => void;
  resume: () => void;
  /** Stop talking now and forget the rest. */
  cancel: () => void;
  suspended: () => boolean;
  duck: (active: boolean) => void;
  dispose: () => void;
}

export interface SpeakerOptions {
  /** Cues the voice may perform. Off, every cue is dropped. */
  sounds?: boolean;
  /** Spoken language, for reading numbers and symbols aloud. */
  language?: string;
  /** Called each time a fragment is handed to the voice. */
  onFragment?: () => void;
  /** Whether the person is being playful right now. A laugh is dropped unless it is. */
  playful?: () => boolean;
}

/** A cue is never heard in a conversation's first reply, at most once in a reply, and at most once
 * in this many replies. */
const REPLIES_BETWEEN_CUES = 4;

interface Held {
  text: string;
  boundary: Boundary;
}

export function createSpeaker(engine: VoiceEngine, options: SpeakerOptions = {}): Speaker {
  const chunker: SentenceChunker = createSentenceChunker(options.language, engine.chunking);
  const inline = options.sounds ? (engine.inlineCues ?? new Set()) : new Set<never>();

  let held: Held[] = [];
  let suspended = false;
  let reply = 0;
  let lastCueReply = -REPLIES_BETWEEN_CUES;
  let cueInThisReply = false;

  const cueAllowed = () => reply >= 1 && !cueInThisReply && reply - lastCueReply >= REPLIES_BETWEEN_CUES;

  const deliver = (part: Held) => {
    options.onFragment?.();
    engine.enqueue(part.text, part.boundary);
  };

  const emit = (piece: string, boundary: Boundary) => {
    const text = filterCues(piece, (sound) => {
      if (!inline.has(sound) || !cueAllowed()) return false;
      if (sound === "laugh" && !options.playful?.()) return false;
      cueInThisReply = true;
      lastCueReply = reply;
      return true;
    });
    if (!text) return;
    const part = { text, boundary };
    if (suspended) held.push(part);
    else deliver(part);
  };

  const endReply = () => {
    reply++;
    cueInThisReply = false;
  };

  return {
    engineId: engine.id,

    push(delta) {
      for (const fragment of chunker.pushFragments(delta)) emit(fragment.text, fragment.boundary);
    },

    flush() {
      const rest = chunker.flushFragment();
      if (rest) emit(rest.text, rest.boundary);
      chunker.reset();
      endReply();
    },

    say(text) {
      const piece = speakableText(text, options.language);
      if (piece) emit(piece, "final");
    },

    suspend() {
      logRendererEvent("renderer.voice", "DEBUG", "speaker suspended", { held: held.length, engine: engine.id });
      suspended = true;
      // What the engine already has is abandoned and later text kept, so
      // resuming skips ahead rather than repeating a half-heard sentence.
      held = [];
      engine.cancel();
    },

    resume() {
      logRendererEvent("renderer.voice", "DEBUG", "speaker resumed", { held: held.length });
      suspended = false;
      for (const part of held) deliver(part);
      held = [];
    },

    suspended() {
      return suspended;
    },

    cancel() {
      logRendererEvent("renderer.voice", "DEBUG", "speaker cancelled", { engine: engine.id });
      suspended = false;
      held = [];
      chunker.reset();
      cueInThisReply = false;
      engine.cancel();
    },

    duck(active) {
      engine.duck(active);
    },

    dispose() {
      suspended = false;
      held = [];
      chunker.reset();
      engine.dispose();
    },
  };
}
