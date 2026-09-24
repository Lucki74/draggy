import { createSentenceChunker, speakableText } from "./chunker";
import { createBreathing, splitCues } from "./vocalSounds";
import type { SentenceChunker } from "./chunker";
import type { Segment } from "./vocalSounds";
import type { VoiceEngine, VoiceEngineId } from "./voiceEngine";

/** What the assistant says, and when. Text arrives a token at a time and a synthesiser wants
 * clauses, so this cuts at the earliest phrase-shaped point. Sound cues in the text become sounds
 * in the same order, and breaths are added where a speaker would take them. */

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
  /** Breaths, sighs, hums and laughs. Off, every cue is dropped and nothing is added. */
  sounds?: boolean;
  random?: () => number;
}

export function createSpeaker(engine: VoiceEngine, options: SpeakerOptions = {}): Speaker {
  const chunker: SentenceChunker = createSentenceChunker();
  const soundsOn = Boolean(options.sounds && engine.playSound);
  const inline = soundsOn ? (engine.inlineCues ?? new Set()) : new Set<never>();
  const breathing = createBreathing(options.random);

  let held: Segment[] = [];
  let suspended = false;

  const deliver = (segment: Segment) => {
    if (segment.kind === "sound") engine.playSound?.(segment.sound);
    else engine.enqueue(segment.text);
  };

  const emit = (piece: string) => {
    for (const segment of splitCues(piece, inline)) {
      if (!soundsOn && segment.kind === "sound") continue;
      const withBreath: Segment[] =
        soundsOn && breathing.before(segment) ? [{ kind: "sound", sound: "breath" }, segment] : [segment];
      for (const part of withBreath) {
        if (suspended) held.push(part);
        else deliver(part);
      }
    }
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
      breathing.reset();
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
      for (const segment of held) deliver(segment);
      held = [];
    },

    suspended() {
      return suspended;
    },

    cancel() {
      suspended = false;
      held = [];
      chunker.reset();
      breathing.reset();
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
