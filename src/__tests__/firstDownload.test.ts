// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useFirstDownload } from "../onboarding/useFirstDownload";

/** A bridge whose downloads wait until the test lets them finish, one per file. */
function bridge({ engineReady = true, installs = true } = {}) {
  let hasBinary = engineReady;
  const pending = new Map<string, (result: { success: boolean }) => void>();
  const order: string[] = [];
  const api = {
    resolveModelUrl: vi.fn(async (reference: string) => {
      const filename = `${reference.split("/")[1].replace(":", "-")}.gguf`;
      return { url: `https://huggingface.co/${filename}`, filename, size: 1000 };
    }),
    gguf: {
      status: vi.fn(async () => ({ hasBinary, ready: hasBinary })),
      setupEngine: vi.fn(async () => {
        order.push("setupEngine");
        if (installs) hasBinary = true;
        return { success: installs };
      }),
      onProgress: vi.fn(() => () => {}),
      downloadModel: vi.fn(({ filename }: { filename: string }) => {
        order.push(`download ${filename}`);
        return new Promise<{ success: boolean }>((resolve) => pending.set(filename, resolve));
      }),
      cancelDownload: vi.fn(async (filename: string) => {
        order.push(`cancel ${filename}`);
        pending.get(filename)?.({ success: false });
        return { success: true };
      }),
      deleteModel: vi.fn(async () => true),
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return { api, pending, order, finish: (filename: string) => pending.get(filename)?.({ success: true }) };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("the setup's downloads", () => {
  it("does nothing until a model is chosen", async () => {
    const { api } = bridge();
    renderHook(() => useFirstDownload(window.electronAPI));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.gguf.status).not.toHaveBeenCalled();
    expect(api.gguf.setupEngine).not.toHaveBeenCalled();
    expect(api.gguf.downloadModel).not.toHaveBeenCalled();
  });

  it("sets up a missing engine and downloads the chosen model together", async () => {
    const { api, finish } = bridge({ engineReady: false });
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));

    act(() => result.current.chooseModel("org/Model-GGUF:Q4"));
    await waitFor(() => expect(api.gguf.downloadModel).toHaveBeenCalled());
    expect(api.gguf.setupEngine).toHaveBeenCalledTimes(1);

    act(() => finish("Model-GGUF-Q4.gguf"));
    await waitFor(() => expect(result.current.model.phase).toBe("done"));
    expect(result.current.model.filename).toBe("Model-GGUF-Q4.gguf");
    await waitFor(() => expect(result.current.engine.phase).toBe("done"));
  });

  it("cancels a different running download before starting the new one", async () => {
    const { api, order } = bridge();
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));

    act(() => result.current.chooseModel("org/First-GGUF:Q4"));
    await waitFor(() => expect(order).toContain("download First-GGUF-Q4.gguf"));
    act(() => result.current.chooseModel("org/Second-GGUF:Q4"));
    await waitFor(() => expect(order).toContain("download Second-GGUF-Q4.gguf"));

    expect(order.indexOf("cancel First-GGUF-Q4.gguf")).toBeGreaterThan(-1);
    expect(order.indexOf("cancel First-GGUF-Q4.gguf")).toBeLessThan(order.indexOf("download Second-GGUF-Q4.gguf"));
    expect(result.current.model.reference).toBe("org/Second-GGUF:Q4");
    expect(api.gguf.downloadModel).toHaveBeenCalledTimes(2);
  });

  it("leaves the same choice alone", async () => {
    const { api } = bridge();
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));
    act(() => result.current.chooseModel("org/Same-GGUF:Q4"));
    await waitFor(() => expect(api.gguf.downloadModel).toHaveBeenCalledTimes(1));
    act(() => result.current.chooseModel("org/Same-GGUF:Q4"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.gguf.downloadModel).toHaveBeenCalledTimes(1);
    expect(api.gguf.cancelDownload).not.toHaveBeenCalled();
  });

  it("adopts an installed model without downloading anything", async () => {
    const { api } = bridge();
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));
    act(() => result.current.chooseModel("installed", "mine.gguf"));
    expect(result.current.model).toMatchObject({ phase: "done", filename: "mine.gguf" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.gguf.downloadModel).not.toHaveBeenCalled();
  });

  it("reports a failed download and tries again on retry", async () => {
    const { api, pending } = bridge();
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));
    act(() => result.current.chooseModel("org/Flaky-GGUF:Q4"));
    await waitFor(() => expect(pending.has("Flaky-GGUF-Q4.gguf")).toBe(true));

    act(() => pending.get("Flaky-GGUF-Q4.gguf")?.({ success: false }));
    await waitFor(() => expect(result.current.model.phase).toBe("error"));

    act(() => result.current.retry());
    await waitFor(() => expect(api.gguf.downloadModel).toHaveBeenCalledTimes(2));
  });

  it("says the engine is missing when setup leaves it missing", async () => {
    bridge({ engineReady: false, installs: false });
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));
    act(() => result.current.chooseModel("org/Model-GGUF:Q4"));
    await waitFor(() => expect(result.current.engine).toMatchObject({ phase: "error", error: "missingGgufEngine" }));
  });
});

describe("the optional downloads", () => {
  it("waits for the model, then runs them one at a time", async () => {
    const { order, finish } = bridge();
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));
    act(() => result.current.chooseModel("org/Main-GGUF:Q4"));
    act(() => {
      result.current.queueExtra("org/Voice-GGUF:Q4", "Voice");
      result.current.queueExtra("org/Embed-GGUF:Q8", "Library");
    });
    await waitFor(() => expect(order).toContain("download Main-GGUF-Q4.gguf"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order.filter((entry) => entry.startsWith("download"))).toEqual(["download Main-GGUF-Q4.gguf"]);

    act(() => finish("Main-GGUF-Q4.gguf"));
    await waitFor(() => expect(order).toContain("download Voice-GGUF-Q4.gguf"));
    expect(order).not.toContain("download Embed-GGUF-Q8.gguf");

    act(() => finish("Voice-GGUF-Q4.gguf"));
    await waitFor(() => expect(order).toContain("download Embed-GGUF-Q8.gguf"));
    act(() => finish("Embed-GGUF-Q8.gguf"));
    await waitFor(() => expect(result.current.extras.map((extra) => extra.phase)).toEqual(["done", "done"]));
  });

  it("stops an extra that is dropped, removing what it wrote", async () => {
    const { api, order, finish } = bridge();
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));
    act(() => result.current.chooseModel("org/Main-GGUF:Q4"));
    act(() => result.current.queueExtra("org/Voice-GGUF:Q4", "Voice"));
    await waitFor(() => expect(order).toContain("download Main-GGUF-Q4.gguf"));
    act(() => finish("Main-GGUF-Q4.gguf"));
    await waitFor(() => expect(order).toContain("download Voice-GGUF-Q4.gguf"));

    act(() => result.current.dropExtra("org/Voice-GGUF:Q4"));
    await waitFor(() => expect(api.gguf.cancelDownload).toHaveBeenCalledWith("Voice-GGUF-Q4.gguf"));
    expect(result.current.extras).toEqual([]);
  });

  it("hands over what is unfinished and starts nothing more", async () => {
    const { order, finish } = bridge();
    const { result } = renderHook(() => useFirstDownload(window.electronAPI));
    act(() => result.current.chooseModel("org/Main-GGUF:Q4"));
    act(() => {
      result.current.queueExtra("org/Voice-GGUF:Q4", "Voice");
      result.current.queueExtra("org/Embed-GGUF:Q8", "Library");
    });
    await waitFor(() => expect(order).toContain("download Main-GGUF-Q4.gguf"));
    act(() => finish("Main-GGUF-Q4.gguf"));
    await waitFor(() => expect(order).toContain("download Voice-GGUF-Q4.gguf"));

    let handed: string[] = [];
    act(() => {
      handed = result.current.handOff();
    });
    expect(handed).toEqual(["org/Voice-GGUF:Q4", "org/Embed-GGUF:Q8"]);
    act(() => finish("Voice-GGUF-Q4.gguf"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).not.toContain("download Embed-GGUF-Q8.gguf");
  });
});
