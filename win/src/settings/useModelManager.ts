import { useCallback, useEffect, useRef, useState } from "react";
import { deleteModel, describeLoadedModels, listInstalledModels, pullModel, unloadModel } from "../llama";
import type { InstalledModel, PullPhase } from "../llama";
import { pullImageModel } from "../images/pullImageModel";
import { createSpeedMeter } from "../downloadSpeed";
import { swallowed } from "../logger";

/** Downloads that run at once. More than this wait their turn: several multi-gigabyte files sharing
 * one connection each crawl, and none of them is usable until it is whole. */
export const MAX_PARALLEL_PULLS = 2;

export interface PullState {
  name: string;
  percent: number;
  /** `queued` is waiting for a free slot and `failed` stopped on an error; the rest are what the
   * engine reports. */
  phase: PullPhase | "queued" | "failed";
  remainingSeconds?: number | null;
  /** Bytes written so far and in total, once the engine reports them. */
  completed?: number;
  total?: number;
  /** Average speed over the last 10 seconds, in bytes per second. */
  bytesPerSecond?: number | null;
  /** Why a failed download stopped. */
  error?: string;
  /** An image model, which a retry has to ask for the same way. */
  image?: boolean;
}

/** A download still on its way: running or waiting, not one that stopped on an error. */
export const isActivePull = (pull: PullState) => pull.phase !== "failed";

export interface ModelManager {
  installed: InstalledModel[];
  /** Names of models currently resident in VRAM. */
  loaded: string[];
  refresh: () => void;
  /** Every download, in the order it was asked for: the ones running and the ones waiting. */
  pulls: PullState[];
  /** Downloads a model, resolving true once it is installed. Only `MAX_PARALLEL_PULLS` run at once and
   * the rest queue; `immediate` skips the queue, for a small file something else is waiting on. Asking
   * for a model already downloading returns that download. */
  startPull: (name: string, options?: { immediate?: boolean; image?: boolean }) => Promise<boolean>;
  /** Stops a download or takes it out of the queue, and removes what it had written. Also clears a
   * failed one from the list. */
  cancelPull: (name: string) => void;
  remove: (name: string) => Promise<void>;
  /** Evicts a model from VRAM without deleting it. */
  unload: (name: string) => Promise<void>;
  error: string;
  vram: number;
  ram?: number;
  unifiedMemory: boolean;
}

interface PullJob {
  name: string;
  immediate: boolean;
  /** An image model, which goes to the image folder but waits in the same queue. */
  image: boolean;
  started: boolean;
  controller: AbortController;
  result: Promise<boolean>;
  settle: (installed: boolean) => void;
}

/** The installed models and the downloads in flight. Held by the settings shell, so a download
 * keeps going while the user moves between pages. The list is read again whenever `page` changes. */
export function useModelManager(page?: string): ModelManager {
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [pulls, setPulls] = useState<PullState[]>([]);
  const [error, setError] = useState("");
  const [vram, setVram] = useState(0);
  const [ram, setRam] = useState(0);
  const [unifiedMemory, setUnifiedMemory] = useState(false);
  const jobsRef = useRef<PullJob[]>([]);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    listInstalledModels()
      .then((models) => {
        if (!cancelled) setInstalled(models);
      })
      .catch(() => {
        if (!cancelled) setInstalled([]);
      });
    return () => {
      cancelled = true;
    };
  }, [version, page]);

  useEffect(() => {
    let cancelled = false;
    describeLoadedModels()
      .then((models) => {
        if (!cancelled) setLoaded(models.map((m) => m.name));
      })
      .catch(() => {
        if (!cancelled) setLoaded([]);
      });
    return () => {
      cancelled = true;
    };
  }, [version, page]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      ?.getSystemSpecs()
      .then((specs) => {
        if (cancelled || !specs) return;
        setVram(specs.vram || 0);
        setRam(specs.ram || 0);
        setUnifiedMemory(Boolean(specs.unifiedMemory));
      })
      .catch(swallowed("settings", "the main process already logged this call"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      for (const job of jobsRef.current) job.controller.abort();
    },
    [],
  );

  const patchPull = useCallback((name: string, patch: Partial<PullState>) => {
    setPulls((current) => current.map((entry) => (entry.name === name ? { ...entry, ...patch } : entry)));
  }, []);

  /** Starts whatever the free slots allow, oldest request first. Each finished download asks again. */
  const pump = useCallback(
    function pumpQueue() {
      const runningSlots = jobsRef.current.filter((job) => job.started && !job.immediate).length;
      let free = MAX_PARALLEL_PULLS - runningSlots;

      for (const job of jobsRef.current) {
        if (job.started) continue;
        if (!job.immediate) {
          if (free <= 0) continue;
          free -= 1;
        }

        job.started = true;
        patchPull(job.name, { phase: "preparing" });
        const meter = createSpeedMeter();

        void (job.image ? pullImageModel : pullModel)(
          job.name,
          (progress) => {
            const measured = progress.phase === "downloading" ? meter.sample(progress.completed, progress.total) : null;
            patchPull(job.name, {
              percent: progress.percent,
              phase: progress.phase,
              remainingSeconds: measured ? measured.remainingSeconds : progress.remainingSeconds,
              completed: progress.completed,
              total: progress.total,
              bytesPerSecond: measured?.bytesPerSecond ?? null,
            });
          },
          job.controller.signal,
        )
          .then(
            () => {
              refresh();
              job.settle(true);
            },
            (err: unknown) => {
              if (!job.controller.signal.aborted) {
                const message = err instanceof Error ? err.message : String(err);
                setError(message);
                // A failed download stays listed so it can be tried again from where it is shown.
                patchPull(job.name, { phase: "failed", error: message });
              }
              job.settle(false);
            },
          )
          .finally(() => {
            jobsRef.current = jobsRef.current.filter((entry) => entry !== job);
            setPulls((current) => current.filter((entry) => entry.name !== job.name || entry.phase === "failed"));
            pumpQueue();
          });
      }
    },
    [patchPull, refresh],
  );

  const startPull = useCallback(
    (name: string, options?: { immediate?: boolean; image?: boolean }) => {
      const target = name.trim();
      if (!target) return Promise.resolve(false);

      const existing = jobsRef.current.find((job) => job.name === target);
      if (existing) return existing.result;

      let settle: (installed: boolean) => void = () => undefined;
      const result = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      jobsRef.current.push({
        name: target,
        immediate: Boolean(options?.immediate),
        image: Boolean(options?.image),
        started: false,
        controller: new AbortController(),
        result,
        settle,
      });

      setError("");
      setPulls((current) => [
        ...current.filter((entry) => entry.name !== target),
        { name: target, percent: 0, phase: "queued", image: Boolean(options?.image) },
      ]);
      pump();
      return result;
    },
    [pump],
  );

  const cancelPull = useCallback(
    (name: string) => {
      const job = jobsRef.current.find((entry) => entry.name === name);
      if (!job) {
        setPulls((current) => current.filter((entry) => entry.name !== name));
        return;
      }

      // A running download removes its own partial file when aborted, and asks for the next one
      // in the queue when it settles. One still waiting has nothing to stop, so it just leaves.
      job.controller.abort();
      if (!job.started) {
        jobsRef.current = jobsRef.current.filter((entry) => entry !== job);
        job.settle(false);
      }
      setPulls((current) => current.filter((entry) => entry.name !== name));
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (name: string) => {
      setError("");
      try {
        await deleteModel(name);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  const unload = useCallback(
    async (name: string) => {
      setError("");
      try {
        await unloadModel(name);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  return { installed, loaded, refresh, pulls, startPull, cancelPull, remove, unload, error, vram, ram, unifiedMemory };
}
