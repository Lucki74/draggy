import { useEffect, useSyncExternalStore } from "react";
import type { VideoIndexState } from "../types";
import { logSwallow } from "../logger";

/** One shared view of every video's index state, fed by the progress event, so each chip and tool sees the same. */
const states = new Map<string, VideoIndexState>();
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function publish(state: VideoIndexState) {
  states.set(state.hash, state);
  for (const listener of listeners) listener();
}

function ensureSubscribed() {
  if (unsubscribe || !window.draggy?.video) return;
  unsubscribe = window.draggy.video.onIndexProgress(publish);
}

export function videoIndexState(hash: string): VideoIndexState | undefined {
  return states.get(hash);
}

/** Asks the backend once for a state this window has not heard about, such as a chat reopened after a restart. */
export async function refreshVideoState(hash: string): Promise<VideoIndexState | undefined> {
  ensureSubscribed();
  const reply = await window.draggy?.video.indexStatus(hash);
  if (reply?.success) publish(reply.state);
  return states.get(hash);
}

/** Starts indexing (deduplicated by the backend) and records the state it answers with. */
export async function startVideoIndex(hash: string): Promise<void> {
  ensureSubscribed();
  try {
    const reply = await window.draggy?.video.index(hash);
    if (reply?.success) publish(reply.state);
    else if (reply) publish({ hash, status: "failed", code: reply.code ?? "E_INDEX", error: reply.error });
  } catch (error) {
    logSwallow("video.index", error, "the index request failed; the chip offers a retry");
    publish({ hash, status: "failed", code: "E_INDEX", error: String(error) });
  }
}

/** Waits until the index is ready or failed, up to `timeoutMs`. Answers the last state seen. */
export function waitForVideoIndex(hash: string, timeoutMs: number): Promise<VideoIndexState | undefined> {
  ensureSubscribed();
  const settled = (state?: VideoIndexState) => state?.status === "ready" || state?.status === "failed";
  return new Promise((resolve) => {
    if (settled(states.get(hash))) return resolve(states.get(hash));
    const done = () => {
      clearTimeout(timer);
      listeners.delete(check);
      resolve(states.get(hash));
    };
    const check = () => {
      if (settled(states.get(hash))) done();
    };
    const timer = setTimeout(done, timeoutMs);
    listeners.add(check);
    void refreshVideoState(hash).then(check, (error) => logSwallow("video.status", error, "falls back to the event"));
  });
}

function subscribe(listener: () => void) {
  ensureSubscribed();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The live index state of one video for a component. */
export function useVideoIndexState(hash: string | null): VideoIndexState | undefined {
  const state = useSyncExternalStore(subscribe, () => (hash ? states.get(hash) : undefined));
  useEffect(() => {
    if (hash && !states.has(hash)) {
      refreshVideoState(hash).catch((error) => logSwallow("video.status", error, "the chip shows no progress"));
    }
  }, [hash]);
  return state;
}
