/**
 * Timings for the spoken loop, from published guidance rather than taste: a
 * 200-450 ms gap reads as natural, a barge-in must land under 150 ms.
 */

export const SAMPLE_RATE = 16000;

/** Silero VAD v5 consumes exactly 512 samples per call at 16 kHz. */
export const VAD_FRAME = 512;
export const FRAME_MS = (VAD_FRAME / SAMPLE_RATE) * 1000;

export function framesFor(milliseconds: number): number {
  return Math.max(1, Math.round(milliseconds / FRAME_MS));
}

/**
 * Two thresholds, not one: rising through SPEECH_ON opens a turn and falling
 * below SPEECH_OFF closes it, so a wavering voice cannot rattle the machine.
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
 * Transcription starts here, not at the endpoint. A drawn breath throws the
 * result away; a finished sentence is already transcribed when the turn ends.
 */
export const SPECULATE_AT_MS = 260;

/** Live partial transcripts, at most this often, while the user is talking. */
export const PARTIAL_INTERVAL_MS = 700;

/**
 * A partial pass is skipped when the last took longer than this, so a slow
 * machine falls back to one pass instead of building an unclearable backlog.
 */
export const PARTIAL_BUDGET_MS = 1400;

/** Sustained voice required before the assistant stops talking. */
export const BARGE_IN_MS = 240;
export const BARGE_IN_PROB = 0.6;

/**
 * The microphone still hears the assistant through echo-cancellation residue,
 * so a higher probability during output keeps it from interrupting itself.
 */
export const OUTPUT_PROB_BONUS = 0.15;

/** Conversation turns kept in the prompt. */
export const HISTORY_TURNS = 16;

/** Ollama keeps the voice model resident for the length of a conversation. */
export const KEEP_ALIVE = "30m";

export const VOICE_CONTEXT = 4096;
export const VOICE_NUM_PREDICT = 200;

/**
 * Sampling for speech, not prose. Two sentences leave no room to wander back,
 * and a looped clause is audio to sit through rather than text to skim.
 */
export const VOICE_TEMPERATURE = 0.6;
export const VOICE_TOP_P = 0.9;
export const VOICE_REPEAT_PENALTY = 1.15;
