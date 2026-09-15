import { useCallback, useEffect, useRef, useState } from "react";
import { deleteModel, describeLoadedModels, listInstalledModels, pullModel, unloadModel } from "../ollama";
import type { InstalledModel, PullPhase } from "../ollama";

export interface PullState {
  name: string;
  percent: number;
  phase: PullPhase;
}

export interface ModelManager {
  installed: InstalledModel[];
  /** Names of models currently resident in VRAM. */
  loaded: string[];
  refresh: () => void;
  pull: PullState | null;
  /** Downloads a model, resolving true once it is installed. One at a time. */
  startPull: (name: string) => Promise<boolean>;
  cancelPull: () => void;
  remove: (name: string) => Promise<void>;
  /** Evicts a model from VRAM without deleting it. */
  unload: (name: string) => Promise<void>;
  error: string;
  vram: number;
  unifiedMemory: boolean;
}

/** The installed models and the one download in flight. Held by the settings shell, so a download
 * keeps going while the user moves between pages. The list is read again whenever `page` changes. */
export function useModelManager(page?: string): ModelManager {
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [pull, setPull] = useState<PullState | null>(null);
  const [error, setError] = useState("");
  const [vram, setVram] = useState(0);
  const [unifiedMemory, setUnifiedMemory] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const pullingRef = useRef(false);

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

  useEffect(() => () => controllerRef.current?.abort(), []);

  const startPull = useCallback(
    async (name: string) => {
      const target = name.trim();
      if (!target || pullingRef.current) return false;

      pullingRef.current = true;
      setError("");
      setPull({ name: target, percent: 0, phase: "preparing" });

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        await pullModel(
          target,
          (progress) => setPull({ name: target, percent: progress.percent, phase: progress.phase }),
          controller.signal,
        );
        refresh();
        return true;
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        pullingRef.current = false;
        controllerRef.current = null;
        setPull(null);
      }
    },
    [refresh],
  );

  const cancelPull = useCallback(() => controllerRef.current?.abort(), []);

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

  return { installed, loaded, refresh, pull, startPull, cancelPull, remove, unload, error, vram, unifiedMemory };
}
