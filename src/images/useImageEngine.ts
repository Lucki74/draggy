import { useCallback, useEffect, useState } from "react";
import type { ImageEngineStatus } from "../types";
import { swallowed } from "../logger";

const EMPTY: ImageEngineStatus = {
  success: false,
  installed: false,
  runner: null,
  source: null,
  runners: [],
  defaultRunner: null,
  model: "",
  models: [],
  ready: false,
};

let setupStarted = false;

/** Whether images can be made, read again after anything that could change it: a download, an install, a job. */
export function useImageEngine(refreshKey?: unknown): ImageEngineStatus & { refresh: () => void } {
  const [status, setStatus] = useState<ImageEngineStatus>(EMPTY);

  const refresh = useCallback(() => {
    const api = window.electronAPI?.sd;
    if (!api) return;
    api
      .status()
      .then((next) => {
        if (next?.success) setStatus(next);
      })
      .catch(swallowed("images", "the main process already logged this call"));
  }, []);

  useEffect(refresh, [refresh, refreshKey]);

  // With an image model on disk the engine is installed, or switched to this machine's best build, without asking.
  const wantsEngine =
    status.success &&
    status.runners.length > 0 &&
    status.models.some((entry) => entry.installed) &&
    (!status.installed || (status.source === "app" && Boolean(status.defaultRunner) && status.runner !== status.defaultRunner));
  useEffect(() => {
    const api = window.electronAPI?.sd;
    if (!wantsEngine || !api || setupStarted) return;
    setupStarted = true;
    void api
      .setupEngine()
      .catch(swallowed("images", "the main process already logged this call"))
      .then(refresh);
  }, [wantsEngine, refresh]);

  useEffect(() => {
    const api = window.electronAPI?.sd;
    if (!api) return;
    return api.onProgress((progress) => {
      if (progress.status === "model-done" || progress.status === "done") refresh();
    });
  }, [refresh]);

  return { ...status, refresh };
}
