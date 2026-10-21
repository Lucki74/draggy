import { useCallback, useEffect, useRef, useState } from "react";
import { downloadModel, type BootBridge } from "../boot/bootSequence";
import { createSpeedMeter } from "../downloadSpeed";
import { pullImageModel } from "../images/pullImageModel";

/** The engine and the first model, downloading while the user carries on through the setup. Held
 * at the setup's root so a step change never interrupts it, and it never starts on its own. */

export interface EngineDownload {
  phase: "idle" | "running" | "done" | "error";
  percent: number;
  error?: string;
}

export interface ModelDownload {
  reference?: string;
  filename?: string;
  phase: "idle" | "queued" | "downloading" | "done" | "error";
  percent: number;
  completed: number;
  total: number;
  remainingSeconds: number | null;
  /** Averaged since the first byte, so a stall shows as a slowing rate. 0 until it is known. */
  bytesPerSecond: number;
  error?: string;
}

/** Voice, document search and image generation, ticked on the Preferences step. */
export interface ExtraDownload {
  reference: string;
  label: string;
  /** An image model goes to the image folder with its encoder and VAE; the rest are chat GGUFs. */
  kind: "model" | "image";
  phase: "queued" | "downloading" | "done" | "error";
  percent: number;
}

export interface FirstDownload {
  engine: EngineDownload;
  model: ModelDownload;
  extras: ExtraDownload[];
  /** True on a provider's path: no model of Draggy's own is coming, so the extras need not wait. */
  modelless: boolean;
  /** Starts the engine if it is missing and this model, cancelling a different one still running.
   * An installed model is adopted as it is, with nothing downloaded. */
  chooseModel(reference: string, installed?: string): void;
  /** The engine alone, for the Library and voice: a provider's model needs no download. */
  withoutModel(): void;
  retry(): void;
  cancelAll(): void;
  /** Settles once no engine setup is running, so Skip never starts a second one beside it. */
  engineIdle(): Promise<void>;
  /** Waits for the model, then runs one at a time: never beside the model, which matters most. */
  queueExtra(reference: string, label: string, kind?: ExtraDownload["kind"]): void;
  /** Takes an extra out of the queue, or stops it and removes what it wrote. */
  dropExtra(reference: string): void;
}

const ENGINE_LABEL = "AI Engine";
const IDLE_MODEL: ModelDownload = { phase: "idle", percent: 0, completed: 0, total: 0, remainingSeconds: null, bytesPerSecond: 0 };

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export function useFirstDownload(api: BootBridge | undefined = window.electronAPI): FirstDownload {
  const [engine, setEngine] = useState<EngineDownload>({ phase: "idle", percent: 0 });
  const [model, setModel] = useState<ModelDownload>(IDLE_MODEL);
  const controllerRef = useRef<AbortController | null>(null);
  const engineRef = useRef<Promise<void> | null>(null);
  const lastRef = useRef<{ reference: string; installed?: string } | null>(null);
  const [extras, setExtras] = useState<ExtraDownload[]>([]);
  const extrasRef = useRef<ExtraDownload[]>([]);
  const extraControllers = useRef(new Map<string, AbortController>());
  const modelDoneRef = useRef(false);
  const [modelless, setModelless] = useState(false);
  const pumpRef = useRef<() => void>(() => {});

  const updateExtras = useCallback((change: (list: ExtraDownload[]) => ExtraDownload[]) => {
    extrasRef.current = change(extrasRef.current);
    setExtras(extrasRef.current);
  }, []);

  const patchExtra = useCallback(
    (reference: string, patch: Partial<ExtraDownload>) =>
      updateExtras((list) => list.map((extra) => (extra.reference === reference ? { ...extra, ...patch } : extra))),
    [updateExtras],
  );

  const pump = useCallback(() => {
    if (!api || !modelDoneRef.current) return;
    if (extrasRef.current.some((extra) => extra.phase === "downloading")) return;
    const next = extrasRef.current.find((extra) => extra.phase === "queued");
    if (!next) return;

    const controller = new AbortController();
    extraControllers.current.set(next.reference, controller);
    patchExtra(next.reference, { phase: "downloading" });
    const onProgress = (progress: { percent: number } | null | undefined) => {
      if (progress && !controller.signal.aborted) patchExtra(next.reference, { percent: progress.percent });
    };
    (next.kind === "image"
      ? pullImageModel(next.reference, onProgress, controller.signal)
      : downloadModel(api, next.reference, onProgress, controller.signal)
    )
      .then(
        () => {
          if (!controller.signal.aborted) patchExtra(next.reference, { phase: "done", percent: 100 });
        },
        () => {
          if (!controller.signal.aborted) patchExtra(next.reference, { phase: "error" });
        },
      )
      .finally(() => {
        extraControllers.current.delete(next.reference);
        pumpRef.current();
      });
  }, [api, patchExtra]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const startEngine = useCallback(() => {
    if (!api?.gguf) return;
    if (engineRef.current) return;

    const gguf = api.gguf;
    const stopWatching = gguf.onProgress?.((progress) => {
      if (progress.label !== ENGINE_LABEL) return;
      setEngine((current) => (current.phase === "running" ? { ...current, percent: Number(progress.percent) || 0 } : current));
    });

    engineRef.current = (async () => {
      try {
        const before = await gguf.status();
        if (before?.hasBinary && before?.ready) {
          setEngine({ phase: "done", percent: 100 });
          return;
        }
        setEngine({ phase: "running", percent: 0 });
        await gguf.setupEngine?.();
        const after = await gguf.status();
        setEngine(
          after?.hasBinary && after?.ready
            ? { phase: "done", percent: 100 }
            : { phase: "error", percent: 0, error: "missingGgufEngine" },
        );
      } catch (error) {
        setEngine({ phase: "error", percent: 0, error: error instanceof Error ? error.message : "missingGgufEngine" });
      } finally {
        stopWatching?.();
      }
    })().finally(() => {
      engineRef.current = null;
    });
  }, [api]);

  const startModel = useCallback(
    (reference: string, installed?: string) => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      lastRef.current = { reference, installed };
      modelDoneRef.current = false;
      setModelless(false);

      if (installed) {
        setModel({ ...IDLE_MODEL, reference, filename: installed, phase: "done", percent: 100 });
        modelDoneRef.current = true;
        pumpRef.current();
        return;
      }
      if (!api) return;

      const controller = new AbortController();
      controllerRef.current = controller;
      setModel({ ...IDLE_MODEL, reference, phase: "queued" });
      const meter = createSpeedMeter();

      downloadModel(
        api,
        reference,
        (progress) => {
          if (controller.signal.aborted || !progress) return;
          const measured = meter.sample(progress.completed, progress.total);
          setModel((current) => ({
            ...current,
            filename: progress.label,
            phase: "downloading",
            percent: progress.percent,
            completed: progress.completed,
            total: progress.total || current.total,
            remainingSeconds: measured.remainingSeconds,
            bytesPerSecond: measured.bytesPerSecond ?? 0,
          }));
        },
        controller.signal,
      ).then(
        (filename) => {
          if (controller.signal.aborted) return;
          setModel((current) => ({ ...current, filename, phase: "done", percent: 100, remainingSeconds: 0 }));
          modelDoneRef.current = true;
          pumpRef.current();
        },
        (error: unknown) => {
          if (controller.signal.aborted || isAbort(error)) return;
          const message = error instanceof Error ? error.message : String(error);
          setModel((current) => ({ ...current, phase: "error", error: message }));
        },
      );
    },
    [api],
  );

  const chooseModel = useCallback(
    (reference: string, installed?: string) => {
      startEngine();
      const last = lastRef.current;
      const running = controllerRef.current && !controllerRef.current.signal.aborted;
      // The same choice again, still running or already done, is left alone.
      if (last?.reference === reference && last.installed === installed && (running || model.phase === "done")) return;
      startModel(reference, installed);
    },
    [model.phase, startEngine, startModel],
  );

  const withoutModel = useCallback(() => {
    startEngine();
    controllerRef.current?.abort();
    controllerRef.current = null;
    lastRef.current = null;
    setModel(IDLE_MODEL);
    setModelless(true);
    modelDoneRef.current = true;
    pumpRef.current();
  }, [startEngine]);

  const retry = useCallback(() => {
    if (engine.phase === "error") startEngine();
    const last = lastRef.current;
    if (last && model.phase === "error") startModel(last.reference, last.installed);
  }, [engine.phase, model.phase, startEngine, startModel]);

  const cancelAll = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    lastRef.current = null;
    modelDoneRef.current = false;
    setModelless(false);
    setModel(IDLE_MODEL);
    for (const controller of extraControllers.current.values()) controller.abort();
    extraControllers.current.clear();
    updateExtras(() => []);
  }, [updateExtras]);

  const engineIdle = useCallback(() => engineRef.current ?? Promise.resolve(), []);

  const queueExtra = useCallback(
    (reference: string, label: string, kind: ExtraDownload["kind"] = "model") => {
      const existing = extrasRef.current.find((extra) => extra.reference === reference);
      if (existing && existing.phase !== "error") return;
      updateExtras((list) => [
        ...list.filter((extra) => extra.reference !== reference),
        { reference, label, kind, phase: "queued", percent: 0 },
      ]);
      pumpRef.current();
    },
    [updateExtras],
  );

  const dropExtra = useCallback(
    (reference: string) => {
      extraControllers.current.get(reference)?.abort();
      extraControllers.current.delete(reference);
      updateExtras((list) => list.filter((extra) => extra.reference !== reference));
      pumpRef.current();
    },
    [updateExtras],
  );

  return { engine, model, extras, modelless, chooseModel, withoutModel, retry, cancelAll, engineIdle, queueExtra, dropExtra };
}
