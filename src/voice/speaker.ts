import { createSentenceChunker, speakableText } from "./chunker";
import type { SentenceChunker } from "./chunker";
import type { VoiceEngine, VoiceEngineId } from "./voiceEngine";

/**
 * What the assistant says, and when.
 *
 * Generated text arrives a token at a time; a synthesiser wants whole clauses.
 * This sits between them, cutting the stream at the earliest point that still
 * sounds like a phrase and handing it straight to whichever engine is running.
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
   * Stop talking but keep buffering the reply. Used the instant a barge-in is
   * detected, before it is known whether the user actually took the turn: if it
   * turns out they only said "mhm", resume() picks up without repeating.
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
      // Whatever was already handed to the engine is abandoned; anything
      // generated from here on is kept, so resuming skips ahead instead of
      // repeating a sentence the user already heard the start of.
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
