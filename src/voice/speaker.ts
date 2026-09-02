import { createSentenceChunker, speakableText } from "./chunker";
import type { SentenceChunker } from "./chunker";
import type { VoiceEngine, VoiceEngineId } from "./voiceEngine";

/**
 * What the assistant says, and when. Text arrives a token at a time and a
 * synthesiser wants clauses, so this cuts at the earliest phrase-shaped point.
 */

export interface Speaker {
  engineId: VoiceEngineId;
  /** Feed streamed reply text. */
  push: (delta: string) => void;
  /** End of a reply: say whatever is left over. */
  flush: () => void;
  /** Say something at once, ahead of the queue's remaining text. */
  say: (text: string) => void;
  /**
   * Stop talking but keep buffering, the instant a barge-in is detected. If
   * the user only said "mhm", resume() picks up without repeating.
   */
  suspend: () => void;
  resume: () => void;
  /** Stop talking now and forget the rest. */
  cancel: () => void;
  suspended: () => boolean;
  duck: (active: boolean) => void;
  dispose: () => void;
}

export function createSpeaker(engine: VoiceEngine): Speaker {
  const chunker: SentenceChunker = createSentenceChunker();

  let held: string[] = [];
  let suspended = false;

  const emit = (piece: string) => {
    if (suspended) held.push(piece);
    else engine.enqueue(piece);
  };

  return {
    engineId: engine.id,

    push(delta) {
      for (const piece of chunker.push(delta)) emit(piece);
    },

    flush() {
      const rest = chunker.flush();
      if (rest) emit(rest);
      chunker.reset();
    },

    say(text) {
      const piece = speakableText(text);
      if (piece) emit(piece);
    },

    suspend() {
      suspended = true;
      // What the engine already has is abandoned and later text kept, so
      // resuming skips ahead rather than repeating a half-heard sentence.
      held = [];
      engine.cancel();
    },

    resume() {
      suspended = false;
      for (const piece of held) engine.enqueue(piece);
      held = [];
    },

    suspended() {
      return suspended;
    },

    cancel() {
      suspended = false;
      held = [];
      chunker.reset();
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
