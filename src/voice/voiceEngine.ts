import type { Boundary, ChunkLimits } from "./chunker";
import type { VocalSound } from "./vocalSounds";

export type VoiceEngineId = "system" | "neural" | "cloud";

/** A voice the assistant can speak with. Each engine owns its own queue, so it can overlap
 * generating the next fragment with playing the current one. */
export interface VoiceEngine {
  id: VoiceEngineId;
  /** Queue a fragment. Fragments are spoken in the order they arrive. `boundary` says how it ends,
   * so a mid-sentence cut is voiced as a continuation rather than a full stop. */
  enqueue: (text: string, boundary?: Boundary) => void;
  /** Sounds this engine voices itself when their cue is left in the text (Supertonic's <laugh>). */
  inlineCues?: ReadonlySet<VocalSound>;
  capabilities?: VoiceCapabilities;
  /** Fragment sizes after the first that suit this engine. Short by default. */
  chunking?: ChunkLimits;
  /** Silence immediately and drop anything queued. */
  cancel: () => void;
  /** Lower the volume without stopping. Used the moment the user starts talking, before it is known
   * whether they meant to interrupt. */
  duck: (active: boolean) => void;
  dispose: () => void;
}

/** What an engine can do, so the speaker and the prompt ask for only that. The streaming contract
 * (beginTurn/endTurn) arrives with the first engine that needs it; these are the facts it will read. */
export interface VoiceCapabilities {
  languages: ReadonlySet<string>;
  sampleRate: number;
  /** Takes text a few tokens at a time and starts speaking before the sentence ends. */
  streamingText: boolean;
  /** Uses earlier text or audio of the same turn to keep prosody continuous. */
  conditionsOnContext: boolean;
  /** Cues the model voices itself, mapped to its own tag syntax. */
  nativeCues: ReadonlyMap<VocalSound, string>;
}

export interface EngineOptions {
  language: string;
  voice: string;
  rate: number;
  onSpeakingChange: (speaking: boolean) => void;
}

/** Volume the assistant drops to while it waits to find out if it was interrupted. */
export const DUCK_GAIN = 0.18;
