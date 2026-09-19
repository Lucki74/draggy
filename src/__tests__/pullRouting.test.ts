// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { pullModel } from "../llama";
import type { PullProgress } from "../llama";

type Handler = (progress: {
  phase: "downloading" | "done";
  completed: number;
  total: number;
  percent: number;
  label?: string;
}) => void;

function installBridge() {
  const handlers = new Set<Handler>();
  const downloads: { filename: string; finish: () => void; fail: () => void }[] = [];

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    gguf: {
      onProgress: (handler: Handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      downloadModel: ({ filename }: { filename: string }) =>
        new Promise((resolve) =>
          downloads.push({
            filename,
            finish: () => resolve({ success: true, filename }),
            fail: () => resolve({ success: false }),
          }),
        ),
      cancelDownload: vi.fn(async () => ({ success: true })),
      deleteModel: vi.fn(async () => true),
    },
  };

  const emit: Handler = (progress) => handlers.forEach((handler) => handler(progress));
  const api = (window as unknown as { electronAPI: { gguf: { deleteModel: ReturnType<typeof vi.fn> } } }).electronAPI;
  return { emit, downloads, deleteModel: api.gguf.deleteModel };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("pullModel with several downloads at once", () => {
  it("passes on only the progress that is about its own file", async () => {
    const { emit, downloads } = installBridge();
    const first: PullProgress[] = [];
    const second: PullProgress[] = [];

    const one = pullModel("https://host/one.gguf", (progress) => first.push(progress));
    const two = pullModel("https://host/two.gguf", (progress) => second.push(progress));

    emit({ phase: "downloading", completed: 10, total: 100, percent: 10, label: "one.gguf" });
    emit({ phase: "downloading", completed: 70, total: 100, percent: 70, label: "two.gguf" });

    expect(first.map((progress) => progress.percent)).toEqual([10]);
    expect(second.map((progress) => progress.percent)).toEqual([70]);

    downloads.forEach((download) => download.finish());
    await Promise.all([one, two]);
  });

  it("ignores the engine's own setup progress", async () => {
    const { emit, downloads } = installBridge();
    const seen: PullProgress[] = [];

    const pulling = pullModel("https://host/one.gguf", (progress) => seen.push(progress));
    emit({ phase: "downloading", completed: 5, total: 10, percent: 50, label: "AI Engine" });

    expect(seen).toHaveLength(0);
    downloads[0].finish();
    await pulling;
  });
});

describe("pullModel with a name it cannot resolve", () => {
  it("says it could not find the model instead of sending the name to the downloader as a URL", async () => {
    const { downloads } = installBridge();
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.resolveModelUrl = async () => null;

    await expect(pullModel("qwen3-embedding:0.6b", () => undefined)).rejects.toThrow(/qwen3-embedding:0\.6b/);
    expect(downloads).toHaveLength(0);
  });
});

describe("pullModel with a model split into parts", () => {
  const parts = [
    { url: "https://host/m-00001-of-00003.gguf", filename: "m-00001-of-00003.gguf", size: 100 },
    { url: "https://host/m-00002-of-00003.gguf", filename: "m-00002-of-00003.gguf", size: 100 },
    { url: "https://host/m-00003-of-00003.gguf", filename: "m-00003-of-00003.gguf", size: 100 },
  ];

  const resolveTo = () => {
    (window as unknown as { electronAPI: { resolveModelUrl: unknown } }).electronAPI.resolveModelUrl = async () => ({
      url: parts[0].url,
      filename: parts[0].filename,
      size: 300,
      parts,
    });
  };

  it("downloads every part in turn and reports one download", async () => {
    const { emit, downloads } = installBridge();
    resolveTo();
    const seen: PullProgress[] = [];

    const pulling = pullModel("acme/M-GGUF:Q4_K_M", (progress) => seen.push(progress));

    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    emit({ phase: "downloading", completed: 50, total: 100, percent: 50, label: parts[0].filename });
    emit({ phase: "done", completed: 100, total: 100, percent: 100, label: parts[0].filename });
    downloads[0].finish();

    await vi.waitFor(() => expect(downloads).toHaveLength(2));
    expect(downloads[1].filename).toBe(parts[1].filename);
    emit({ phase: "downloading", completed: 100, total: 100, percent: 100, label: parts[1].filename });
    downloads[1].finish();

    await vi.waitFor(() => expect(downloads).toHaveLength(3));
    emit({ phase: "done", completed: 100, total: 100, percent: 100, label: parts[2].filename });
    downloads[2].finish();
    await pulling;

    expect(seen.map((progress) => [progress.completed, progress.total])).toEqual([
      [50, 300],
      [100, 300],
      [200, 300],
      [300, 300],
    ]);
    // Only the last part finishing finishes the model.
    expect(seen.map((progress) => progress.phase)).toEqual(["downloading", "downloading", "downloading", "done"]);
  });

  it("removes the parts already downloaded when a later one fails", async () => {
    const { downloads, deleteModel } = installBridge();
    resolveTo();

    const pulling = pullModel("acme/M-GGUF:Q4_K_M", () => undefined);
    const failed = expect(pulling).rejects.toThrow("Could not download m-00002-of-00003.gguf");

    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    downloads[0].finish();
    await vi.waitFor(() => expect(downloads).toHaveLength(2));
    downloads[1].fail();

    await failed;
    expect(downloads).toHaveLength(2);
    expect(deleteModel).toHaveBeenCalledWith(parts[0].filename);
  });
});
