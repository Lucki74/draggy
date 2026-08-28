import {
  BARGE_IN_MS,
  BARGE_IN_PROB,
  ENDPOINT_BASE_MS,
  FRAME_MS,
  MAX_SPEECH_MS,
  MIN_SPEECH_MS,
  OUTPUT_PROB_BONUS,
  PREROLL_MS,
  SPECULATE_AT_MS,
  SPEECH_OFF,
  SPEECH_ON,
  framesFor,
} from "./constants";

/**
 * Turns a stream of speech probabilities into conversation events.
 *
 * Everything here is a pure function of the frames pushed in, so the whole
 * turn-taking policy can be tested without a microphone.
 */

export interface GateEvents {
  /** The user has started talking. */
  onSpeechStart: () => void;
  /**
   * A pause long enough to be worth transcribing, but not yet long enough to
   * count as the end of the turn. Transcribing here and discarding the result
   * if talking resumes is what removes the wait at the endpoint.
   */
  onSpeculate: (samples: Float32Array) => void;
  /** The turn is over. */
  onSpeechEnd: (samples: Float32Array, durationMs: number) => void;
  /** Sustained speech while the assistant was talking. */
  onBargeIn: () => void;
  /** A burst too short to be speech. */
  onDiscard: () => void;
}

export interface GateState {
  speaking: boolean;
  silenceMs: number;
  speechMs: number;
  endpointMs: number;
}

export interface Gate {
  push: (frame: Float32Array, probability: number, outputActive: boolean) => void;
  /** Set from the live transcript by the turn detector, between frames. */
  setEndpointDelay: (milliseconds: number) => void;
  /** Everything captured in the current turn so far, for live captions. */
  snapshot: () => Float32Array | null;
  reset: () => void;
  state: () => GateState;
}

export function createGate(events: GateEvents): Gate {
  const prerollFrames = framesFor(PREROLL_MS);
  const minSpeechFrames = framesFor(MIN_SPEECH_MS);
  const maxSpeechFrames = framesFor(MAX_SPEECH_MS);
  const speculateFrames = framesFor(SPECULATE_AT_MS);
  const bargeInFrames = framesFor(BARGE_IN_MS);

  let preroll: Float32Array[] = [];
  let captured: Float32Array[] = [];

  let speaking = false;
  let voicedFrames = 0;
  let silenceFrames = 0;
  let sustainedFrames = 0;
  let bargedIn = false;
  let speculated = false;

  let endpointFrames = framesFor(ENDPOINT_BASE_MS);

  const merge = (frames: Float32Array[]): Float32Array => {
    let length = 0;
    for (const frame of frames) length += frame.length;

    const merged = new Float32Array(length);
    let offset = 0;
    for (const frame of frames) {
      merged.set(frame, offset);
      offset += frame.length;
    }
    return merged;
  };

  const clear = () => {
    speaking = false;
    voicedFrames = 0;
    silenceFrames = 0;
    sustainedFrames = 0;
    bargedIn = false;
    speculated = false;
    captured = [];
  };

  const close = () => {
    const frames = captured;
    const voiced = voicedFrames;
    clear();

    if (voiced < minSpeechFrames) {
      events.onDiscard();
      return;
    }

    events.onSpeechEnd(merge(frames), frames.length * FRAME_MS);
  };

  return {
    push(frame, probability, outputActive) {
      // Echo cancellation leaks some of the assistant's own voice back into the
      // microphone. Asking for more confidence while it is talking is what
      // keeps it from answering itself.
      const onset = outputActive ? SPEECH_ON + OUTPUT_PROB_BONUS : SPEECH_ON;
      const voiced = speaking ? probability >= SPEECH_OFF : probability >= onset;

      if (!speaking) {
        preroll.push(frame);
        if (preroll.length > prerollFrames) preroll.shift();

        if (!voiced) {
          sustainedFrames = 0;
          return;
        }

        speaking = true;
        voicedFrames = 1;
        silenceFrames = 0;
        speculated = false;
        bargedIn = false;
        captured = [...preroll, frame];
        preroll = [];
        events.onSpeechStart();
      } else {
        captured.push(frame);
        if (voiced) {
          voicedFrames++;
          silenceFrames = 0;
          speculated = false;
        } else {
          silenceFrames++;
        }
      }

      // A cough or a chair scrape clears this counter long before it fires; only
      // a real run of speech survives to interrupt the assistant.
      if (outputActive && !bargedIn) {
        if (probability >= BARGE_IN_PROB) {
          sustainedFrames++;
          if (sustainedFrames >= bargeInFrames) {
            bargedIn = true;
            events.onBargeIn();
          }
        } else {
          sustainedFrames = 0;
        }
      }

      if (captured.length >= maxSpeechFrames) {
        close();
        return;
      }

      if (silenceFrames === speculateFrames && !speculated) {
        speculated = true;
        if (voicedFrames >= minSpeechFrames) events.onSpeculate(merge(captured));
      }

      if (silenceFrames >= endpointFrames) close();
    },

    setEndpointDelay(milliseconds) {
      endpointFrames = framesFor(milliseconds);
    },

    snapshot() {
      if (!speaking || voicedFrames < minSpeechFrames) return null;
      return merge(captured);
    },

    reset() {
      clear();
      preroll = [];
      endpointFrames = framesFor(ENDPOINT_BASE_MS);
    },

    state() {
      return {
        speaking,
        silenceMs: silenceFrames * FRAME_MS,
        speechMs: captured.length * FRAME_MS,
        endpointMs: endpointFrames * FRAME_MS,
      };
    },
  };
}
