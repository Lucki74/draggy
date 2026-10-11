import { providerOf } from "./ai/providers";
import type { AppSettings } from "./types";

/** Tool rounds one turn may take on a slow model; each round is a full pass at under 3 tokens per second. */
export const SLOW_TOOL_LOOPS = 6;
/** A turn must run this long before a finished answer is worth a system notification. */
export const NOTIFY_AFTER_MS = 30_000;

/**
 * Whether `model` is served by a colibri engine, and whether Draggy's plan for it predicts under
 * 3 tokens per second. A colibri server started by hand has no plan, so it is never called slow.
 */
export async function colibriEngine(model: string): Promise<{ colibri: boolean; slow: boolean }> {
  const none = { colibri: false, slow: false };
  const instanceId = providerOf(model);
  const api = typeof window === "undefined" ? undefined : window.electronAPI;
  if (!instanceId || !api?.colibri || !api.providers) return none;
  try {
    const [instances, status] = await Promise.all([api.providers.list(), api.colibri.status()]);
    if (!instances.some((instance) => instance.id === instanceId && instance.type === "colibri")) return none;
    return { colibri: true, slow: Boolean(status.engine.slow) };
  } catch {
    return none;
  }
}

export async function isSlowModel(model: string): Promise<boolean> {
  return (await colibriEngine(model)).slow;
}

export function toolLoopLimit(slow: boolean, normal: number): number {
  return slow ? Math.min(SLOW_TOOL_LOOPS, normal) : normal;
}

/** Thinking multiplies the wait, so a slow model keeps it off until the user turns it on. */
export function thinkingAllowed(slow: boolean, settings: Pick<AppSettings, "slowModelThinking">): boolean {
  return !slow || Boolean(settings.slowModelThinking);
}

export function shouldNotify(slow: boolean, elapsedMs: number): boolean {
  return slow && elapsedMs >= NOTIFY_AFTER_MS;
}
