import type { ImageProgress, ImageRequest, ImageResult, ImageStepInfo } from "../types";
import { logRendererEvent, swallowed } from "../logger";

/** One image job seen from the renderer: progress for this request only, and a cancel when the turn stops. */
export async function runImageJob(
  request: ImageRequest,
  options: { signal?: AbortSignal; onProgress?: (progress: ImageProgress) => void } = {},
): Promise<ImageResult> {
  const api = window.electronAPI?.sd;
  if (!api) return { success: false, code: "E_ENGINE_MISSING", error: "The image engine is not available in this build." };
  if (options.signal?.aborted) return { success: false, code: "E_CANCELLED", error: "Cancelled" };

  const stopListening = api.onProgress((progress) => {
    if (progress.requestId === request.requestId) options.onProgress?.(progress);
  });
  const cancel = () => void api.cancel(request.requestId).catch(swallowed("images", "the main process already logged this call"));
  options.signal?.addEventListener("abort", cancel, { once: true });

  const startedAt = performance.now();
  logRendererEvent("renderer.images", "INFO", "image job start", { requestId: request.requestId });
  try {
    const result = await api.generate(request);
    logRendererEvent("renderer.images", "INFO", "image job finish", {
      requestId: request.requestId,
      ok: result.success,
      durMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    logRendererEvent("renderer.images", "ERROR", "image job threw", {
      requestId: request.requestId,
      error: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    });
    return { success: false, code: "E_FAILED", error: error instanceof Error ? error.message : String(error) };
  } finally {
    stopListening();
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** The step as a progress event leaves it. Download events carry no request and change nothing here. */
export function applyImageProgress(info: ImageStepInfo, progress: ImageProgress): ImageStepInfo {
  if (progress.status === "queued") return { ...info, status: "queued", queuePosition: progress.position ?? 0 };
  if (progress.status === "loading-model" || progress.status === "generating") {
    return { ...info, status: progress.status, queuePosition: undefined };
  }
  return info;
}

/** The step once the job has ended, with a failure already put into words by the caller. */
export function finishImageStep(
  info: ImageStepInfo,
  result: ImageResult,
  location: "created" | "project",
  describeError: (result: ImageResult) => string,
): ImageStepInfo {
  const finishedAt = Date.now();
  if (result.success) {
    return {
      ...info,
      status: "done",
      location,
      path: result.path,
      filename: result.filename,
      width: result.width,
      height: result.height,
      seed: result.seed,
      model: result.model,
      queuePosition: undefined,
      error: undefined,
      finishedAt,
    };
  }
  if (result.code === "E_CANCELLED") return { ...info, status: "cancelled", queuePosition: undefined, finishedAt };
  return { ...info, status: "error", queuePosition: undefined, error: describeError(result), finishedAt };
}
