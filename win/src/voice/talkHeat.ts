import type { Activity } from "./conversation";

/** How hot the hearth burns. Listening follows the microphone, thinking is a slow dim burn, and
 * speaking holds a steady pace, since there is no meter on the voice going out (S12.9). */

const SPEAK_MS = 1600;

export interface HearthState {
  live: boolean;
  muted: boolean;
  activity: Activity;
}

export function hearthHeat(state: HearthState, micLevel: number, now: number): number {
  if (!state.live) return 0.12;
  if (state.activity === "thinking" || state.activity === "searching") return 0.14;
  if (state.activity === "speaking") return 0.55 + 0.15 * Math.sin((now / SPEAK_MS) * Math.PI * 2);
  if (state.muted) return 0.06;
  // The microphone reads 0 to about 0.5; a quiet room still smoulders.
  return 0.18 + Math.min(0.82, micLevel * 6);
}

/** The operating system refused the microphone, rather than the hardware failing. */
export function isMicBlocked(error: unknown): boolean {
  // A DOMException is not an Error everywhere, so read the fields instead of the prototype.
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    (typeof message === "string" && /permission (denied|dismissed)/i.test(message))
  );
}
