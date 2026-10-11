// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useModelManager } from "../settings/useModelManager";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";
import type { ImageProgress } from "../types";

/** An image model picked from the model list waits in the same queue, and shows in it, as a chat model. */

let emit: (progress: ImageProgress) => void;
let finish: (result: { success: boolean; cancelled?: boolean }) => void;
let cancelDownload: ReturnType<typeof vi.fn>;
let downloadRepo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installFakeElectronApi();
  const handlers = new Set<(progress: ImageProgress) => void>();
  emit = (progress) => handlers.forEach((handler) => handler(progress));
  downloadRepo = vi.fn(() => new Promise((resolve) => (finish = resolve)));
  cancelDownload = vi.fn(async () => {
    finish({ success: false, cancelled: true });
    return { success: true };
  });
  Object.assign((window.electronAPI as unknown as { sd: Record<string, unknown> }).sd, {
    downloadRepo,
    cancelDownload,
    onProgress: (handler: (progress: ImageProgress) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  });
});

afterEach(clearFakeElectronApi);

const REFERENCE = "acme/Qwen-Image-GGUF:Q4_K_M";

describe("an image model downloaded from the model list", () => {
  it("shows in the download queue with its own progress, and leaves it when done", async () => {
    const { result } = renderHook(() => useModelManager());
    let pulled: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pulled = result.current.startPull(REFERENCE, { image: true });
    });

    await waitFor(() => expect(downloadRepo).toHaveBeenCalledWith(REFERENCE));
    expect(result.current.pulls.map((pull) => pull.name)).toEqual([REFERENCE]);

    act(() => {
      emit({ status: "model-download", reference: "someone/else:Q8_0", percent: 90 });
      emit({ status: "model-download", reference: REFERENCE, percent: 40, completed: 40, total: 100 });
    });
    expect(result.current.pulls[0]).toMatchObject({ phase: "downloading", percent: 40 });

    await act(async () => {
      finish({ success: true });
      expect(await pulled).toBe(true);
    });
    expect(result.current.pulls).toEqual([]);
  });

  it("is cancelled from the queue by the name the queue shows", async () => {
    const { result } = renderHook(() => useModelManager());
    let pulled: Promise<boolean> = Promise.resolve(true);
    act(() => {
      pulled = result.current.startPull(REFERENCE, { image: true });
    });
    await waitFor(() => expect(downloadRepo).toHaveBeenCalled());

    await act(async () => {
      result.current.cancelPull(REFERENCE);
      expect(await pulled).toBe(false);
    });
    expect(cancelDownload).toHaveBeenCalledWith(REFERENCE);
    expect(result.current.error).toBe("");
  });
});
