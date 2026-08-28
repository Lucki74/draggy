export type VoiceEngineId = "system" | "neural";

/**
 * A voice the assistant can speak with. Each engine owns its own queue, so it
 * can overlap generating the next fragment with playing the current one.
 */
export interface VoiceEngine {
  id: VoiceEngineId;
  /** Queue a fragment. Fragments are spoken in the order they arrive. */
  enqueue: (text: string) => void;
  /** Silence immediately and drop anything queued. */
  cancel: () => void;
  /**
   * Lower the volume without stopping. Used the moment the user starts talking,
   * before it is known whether they meant to interrupt.
   */
  duck: (active: boolean) => void;
  dispose: () => void;
}

export interface EngineOptions {
  language: string;
  voice: string;
  rate: number;
  onSpeakingChange: (speaking: boolean) => void;
}

/** Volume the assistant drops to while it waits to find out if it was interrupted. */
export const DUCK_GAIN = 0.18;
