/**
 * Timings for the spoken conversation loop.
 *
 * The numbers come from published guidance for production voice agents rather
 * than from taste: a turn-taking gap of 200-450 ms reads as natural, a barge-in
 * has to be handled end to end in under 150 ms, and a sustained-voice guard of
 * 200-300 ms is what stops a cough or a keyboard from cutting the assistant off
 * mid-sentence.
 */

export const SAMPLE_RATE = 16000;

/** Silero VAD v5 consumes exactly 512 samples per call at 16 kHz. */
export const VAD_FRAME = 512;
export const FRAME_MS = (VAD_FRAME / SAMPLE_RATE) * 1000;

export function framesFor(milliseconds: number): number {
  return Math.max(1, Math.round(milliseconds / FRAME_MS));
}

/**
 * Speech probability uses two thresholds instead of one. Rising through
 * SPEECH_ON opens a turn and falling below SPEECH_OFF closes it, so a voice
 * hovering around a single threshold cannot rattle the state machine.
 */
export const SPEECH_ON = 0.5;
export const SPEECH_OFF = 0.35;

/** Audio kept from before the onset, so the first phoneme is never clipped. */
export const PREROLL_MS = 320;

/** Bursts shorter than this are noise, not speech. */
export const MIN_SPEECH_MS = 200;

/** A single turn is cut off here even if the speaker never pauses. */
export const MAX_SPEECH_MS = 30000;

/**
 * How long to wait, after the voice stops, before the turn is handed to the
 * model. The turn detector picks one of these from what was actually said.
 */
export const ENDPOINT_FAST_MS = 460;
export const ENDPOINT_BASE_MS = 700;
export const ENDPOINT_SLOW_MS = 1150;

/**
 * Transcription starts here rather than at the endpoint. If the speaker turns
 * out to have only drawn breath the result is thrown away, and if they really
 * had finished the text is already waiting when the endpoint arrives.
 */
export const SPECULATE_AT_MS = 260;

/** Live partial transcripts, at most this often, while the user is talking. */
export const PARTIAL_INTERVAL_MS = 700;

/**
 * A partial pass is skipped when the previous one took longer than this, so a
 * slow machine falls back to a single pass at the endpoint instead of building
 * a backlog it can never clear.
 */
export const PARTIAL_BUDGET_MS = 1400;

/** Sustained voice required before the assistant stops talking. */
export const BARGE_IN_MS = 240;
export const BARGE_IN_PROB = 0.6;

/** Quiet required after a barge-in before the assistant may speak again. */
export const RESUME_GUARD_MS = 300;

/**
 * While the assistant is speaking, the microphone still hears it through echo
 * cancellation residue. Requiring a higher probability during output keeps the
 * assistant from interrupting itself.
 */
export const OUTPUT_PROB_BONUS = 0.15;

/** Conversation turns kept in the prompt. */
export const HISTORY_TURNS = 16;

/** Ollama keeps the voice model resident for the length of a conversation. */
export const KEEP_ALIVE = "30m";

export const VOICE_CONTEXT = 4096;
export const VOICE_NUM_PREDICT = 200;

/**
 * Sampling for speech rather than for prose.
 *
 * A spoken answer is two sentences long, so there is no room for a model to
 * wander back to the point; slightly tighter sampling than the chat default
 * keeps the first sentence on target. The repeat penalty matters more here than
 * it does in writing, because a small model that loops a clause produces audio
 * the user has to sit through rather than a paragraph they can skim past.
 */
export const VOICE_TEMPERATURE = 0.6;
export const VOICE_TOP_P = 0.9;
export const VOICE_REPEAT_PENALTY = 1.15;
