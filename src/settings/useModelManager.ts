import { useCallback, useEffect, useRef, useState } from "react";
import { deleteModel, describeLoadedModels, listInstalledModels, pullModel, unloadModel } from "../ollama";
import type { InstalledModel, PullPhase, PullProgress } from "../ollama";

/** Downloads that run at once. More than this wait their turn: several multi-gigabyte files sharing
 * one connection each crawl, and none of them is usable until it is whole. */
export const MAX_PARALLEL_PULLS = 2;

export interface PullState {
  name: string;
  percent: number;
  /** `queued` is waiting for a free slot; the rest are what the engine reports. */
  phase: PullPhase | "queued";
  remainingSeconds?: number | null;
}

/** Fallback for when the main process sent no estimate: the average speed since the first byte seen. */
function estimateRemaining(progress: PullProgress, first: { time: number; completed: number } | null): number | null {
  if (!first || progress.total <= progress.completed) return null;
  const elapsed = (Date.now() - first.time) / 1000;
  const speed = elapsed > 0 ? (progress.completed - first.completed) / elapsed : 0;
  return speed > 0 ? Math.round((progress.total - progress.completed) / speed) : null;
}

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
  startPull: (name: string, options?: { immediate?: boolean }) => Promise<boolean>;
  /** Stops a download or takes it out of the queue, and removes what it had written. */
  cancelPull: (name: string) => void;
  remove: (name: string) => Promise<void>;
  /** Evicts a model from VRAM without deleting it. */
  unload: (name: string) => Promise<void>;
  error: string;
  vram: number;
  unifiedMemory: boolean;
}

interface PullJob {
  name: string;
  immediate: boolean;
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
        setUnifiedMemory(Boolean(specs.unifiedMemory));
      })
      .catch(() => undefined);
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
        let first: { time: number; completed: number } | null = null;

        void pullModel(
          job.name,
          (progress) => {
            if (!first && progress.phase === "downloading" && progress.completed > 0) {
              first = { time: Date.now(), completed: progress.completed };
            }
            patchPull(job.name, {
              percent: progress.percent,
              phase: progress.phase,
              remainingSeconds: progress.remainingSeconds ?? estimateRemaining(progress, first),
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
              if (!job.controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
              job.settle(false);
            },
          )
          .finally(() => {
            jobsRef.current = jobsRef.current.filter((entry) => entry !== job);
            setPulls((current) => current.filter((entry) => entry.name !== job.name));
            pumpQueue();
          });
      }
    },
    [patchPull, refresh],
  );

  const startPull = useCallback(
    (name: string, options?: { immediate?: boolean }) => {
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
        started: false,
        controller: new AbortController(),
        result,
        settle,
      });

      setError("");
      setPulls((current) => [...current, { name: target, percent: 0, phase: "queued" }]);
      pump();
      return result;
    },
    [pump],
  );

  const cancelPull = useCallback(
    (name: string) => {
      const job = jobsRef.current.find((entry) => entry.name === name);
      if (!job) return;

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

  return { installed, loaded, refresh, pulls, startPull, cancelPull, remove, unload, error, vram, unifiedMemory };
}
