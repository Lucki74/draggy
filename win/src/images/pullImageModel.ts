import type { PullProgress } from "../llama";
import { logRendererEvent } from "../logger";

/** An image model from the model list, downloaded into the image folder with the same progress a chat model reports. */
export async function pullImageModel(
  reference: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const api = typeof window === "undefined" ? undefined : window.electronAPI?.sd;
  if (!api) throw new Error("Downloading a model requires the desktop app.");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const stop = api.onProgress((progress) => {
    if (progress.reference !== reference) return;
    if (progress.status === "model-download") {
      onProgress({
        phase: "downloading",
        completed: progress.completed ?? 0,
        total: progress.total ?? 0,
        percent: progress.percent ?? 0,
        remainingSeconds: progress.remainingSeconds ?? null,
      });
    } else if (progress.status === "model-verify") {
      onProgress({ phase: "done", completed: progress.total ?? 0, total: progress.total ?? 0, percent: 100 });
    }
  });
  const cancel = () => void api.cancelDownload(reference);
  signal?.addEventListener("abort", cancel);

  const startedAt = performance.now();
  logRendererEvent("renderer.images", "INFO", "image model download start", { reference });
  try {
    const result = await api.downloadRepo(reference);
    // A cancel is the user's own doing, so it rejects the way a chat model's does and shows no error.
    if (result?.cancelled || signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!result?.success) throw new Error(result?.error || "The download failed");
    logRendererEvent("renderer.images", "INFO", "image model download finish", {
      reference,
      durMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    if ((error as Error | undefined)?.name !== "AbortError") {
      logRendererEvent("renderer.images", "ERROR", "image model download failed", {
        reference,
        error: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    stop();
    signal?.removeEventListener("abort", cancel);
  }
}
