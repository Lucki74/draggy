// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adoptInstalled,
  autoSetup,
  BootError,
  bootErrorText,
  downloadModel,
  fitsOnDisk,
  planFromSpecs,
  type BootBridge,
} from "../boot/bootSequence";
import type { SystemSpecs } from "../types";

const pc = (vram: number, ram: number): SystemSpecs => ({ cpu: "AMD", ram, vram, platform: "win32", arch: "x64" });

describe("the first download's choices", () => {
  it("offers the splash's own pick with the rung either side of it", () => {
    const plan = planFromSpecs(pc(12, 64), 0);
    expect(plan.recommended.reference).toBe("mistralai/Ministral-3-14B-Instruct-2512-GGUF:Q4_K_M");
    expect(plan.lighter?.label).toBe("Gemma 4 12B");
    expect(plan.stronger?.label).toBe("GPT-OSS 20B");
    expect(plan.stronger?.fit.tone).toBe("amber");
  });

  it("has nothing lighter at the bottom of the ladder", () => {
    const plan = planFromSpecs(pc(0, 2), 0);
    expect(plan.recommended.label).toBe("Qwen 3.5 0.8B");
    expect(plan.lighter).toBeUndefined();
    expect(plan.stronger?.label).toBe("Qwen 3.5 2B");
  });

  it("has nothing stronger at the top", () => {
    const plan = planFromSpecs(pc(128, 256), 0);
    expect(plan.recommended.label).toBe("Qwen 3.5 122B");
    expect(plan.stronger).toBeUndefined();
    expect(plan.lighter?.label).toBe("GPT-OSS 120B");
  });

  it("leaves out a stronger model the graphics memory cannot run", () => {
    // Integrated graphics: RAM picks the rung, and the next one up would barely touch the GPU.
    const plan = planFromSpecs(pc(0.5, 32), 0);
    expect(plan.recommended.label).toBe("GPT-OSS 20B");
    expect(plan.stronger).toBeUndefined();
  });

  it("marks an option that does not fit on disk, and never refuses when space is unknown", () => {
    const plan = planFromSpecs(pc(12, 64), 10e9);
    expect(plan.recommended.fitsOnDisk).toBe(false);
    expect(plan.lighter?.fitsOnDisk).toBe(false);
    expect(fitsOnDisk(0, 80e9)).toBe(true);
    expect(fitsOnDisk(12.36e9, 8.24e9)).toBe(true);
    expect(fitsOnDisk(12.35e9, 8.24e9)).toBe(false);
  });
});

function machine(overrides: Partial<{ hasBinary: boolean; installs: boolean; models: string[]; online: boolean }> = {}) {
  let hasBinary = overrides.hasBinary ?? true;
  const models = (overrides.models ?? []).map((filename) => ({
    name: filename,
    filename,
    size: 1,
    path: filename,
    architecture: "llama",
    contextLength: 2048,
    blockCount: 1,
    fileType: 1,
    capabilities: filename.includes("embed") ? ["embedding"] : ["completion"],
  }));
  const downloadModel = vi.fn(async () => ({ success: true }));
  const api = {
    getSystemSpecs: async () => pc(12, 64),
    checkInternet: async () => overrides.online ?? true,
    checkDiskSpace: async () => 500,
    resolveModelUrl: vi.fn(async () => ({ url: "https://huggingface.co/x/m.gguf", filename: "m.gguf", size: 8e9 })),
    gguf: {
      status: async () => ({ hasBinary, ready: hasBinary }),
      setupEngine: vi.fn(async () => {
        if (overrides.installs) hasBinary = true;
        return { success: true };
      }),
      listModels: async () => models,
      onProgress: () => () => {},
      downloadModel,
      cancelDownload: vi.fn(async () => ({ success: true })),
      deleteModel: async () => true,
    },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return { api: api as unknown as BootBridge, downloadModel, raw: api };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("the splash's sequence", () => {
  it("reports every status of a first download, in order", async () => {
    const { api } = machine();
    const statuses: string[] = [];
    const model = await autoSetup(api, "", (key) => statuses.push(key), () => {});
    expect(model).toBe("m.gguf");
    expect(statuses).toEqual([
      "checkingService",
      "verifyingAssets",
      "checkingHardware",
      "checkingInternet",
      "checkingDisk",
      "preparingDownload",
      "downloadingModel",
      "installingService",
      "systemCheckComplete",
    ]);
  });

  it("installs a missing engine, then opens the saved model", async () => {
    const { api } = machine({ hasBinary: false, installs: true, models: ["a.gguf", "b.gguf"] });
    const statuses: string[] = [];
    const bars: unknown[] = [];
    const model = await autoSetup(api, "b.gguf", (key) => statuses.push(key), (bar) => bars.push(bar));
    expect(model).toBe("b.gguf");
    expect(statuses).toEqual(["checkingService", "installingService", "verifyingAssets", "startingService", "systemCheckComplete"]);
    expect(bars).toEqual([{ percent: 0, completed: 0, total: 100, label: "AI Engine" }, null]);
  });

  it("says so when the engine is still missing after setup", async () => {
    const { api } = machine({ hasBinary: false, installs: false });
    await expect(autoSetup(api, "", () => {}, () => {})).rejects.toMatchObject({ key: "missingGgufEngine" });
  });

  it("hands a provider's model straight through, still installing the engine the Library needs", async () => {
    const { api, raw, downloadModel } = machine({ hasBinary: false, installs: true, models: ["a.gguf"] });
    const statuses: string[] = [];
    const model = await autoSetup(api, "@openai/gpt-x", (key) => statuses.push(key), () => {});
    expect(model).toBe("@openai/gpt-x");
    expect(statuses).toEqual(["checkingService", "installingService", "systemCheckComplete"]);
    expect(raw.gguf.setupEngine).toHaveBeenCalled();
    expect(raw.resolveModelUrl).not.toHaveBeenCalled();
    expect(downloadModel).not.toHaveBeenCalled();
  });

  it("refuses offline before resolving anything", async () => {
    const { api, raw } = machine({ online: false });
    await expect(autoSetup(api, "", () => {}, () => {})).rejects.toMatchObject({ key: "noInternetConnection" });
    expect(raw.resolveModelUrl).not.toHaveBeenCalled();
  });
});

describe("the steps on their own", () => {
  it("adopts the first model that can chat when the saved one is gone", async () => {
    const { api } = machine({ models: ["embed.gguf", "chat.gguf"] });
    expect(await adoptInstalled(api, "gone.gguf")).toBe("chat.gguf");
    expect(await adoptInstalled(machine({ models: ["embed.gguf"] }).api, "")).toBeNull();
  });

  it("downloads a chosen model and answers with its file name", async () => {
    const { api, downloadModel: transfer } = machine();
    expect(await downloadModel(api, "unsloth/Qwen3.5-9B-GGUF:Q4_K_M", () => {})).toBe("m.gguf");
    expect(transfer).toHaveBeenCalledWith({ url: "https://huggingface.co/x/m.gguf", filename: "m.gguf" });
  });

  it("lets an abort through as an abort, not as a failed download", async () => {
    const { api, raw } = machine();
    raw.gguf.downloadModel.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const running = downloadModel(api, "unsloth/Qwen3.5-9B-GGUF:Q4_K_M", () => {}, controller.signal);
    await vi.waitFor(() => expect(raw.gguf.downloadModel).toHaveBeenCalled());
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(raw.gguf.cancelDownload).toHaveBeenCalledWith("m.gguf");
  });

  it("words a failure the way the splash always has", () => {
    const t = (key: string) => `<${key}>`;
    expect(bootErrorText(new BootError("downloadFailed", "Qwen"), t)).toBe("<downloadFailed>: Qwen");
    expect(bootErrorText(new BootError("downloadFailed", ""), t)).toBe("<downloadFailed>: ");
    expect(bootErrorText(new BootError("notEnoughSpace", undefined, true), t)).toBe("<notEnoughSpace>");
    expect(bootErrorText(new Error("boom"), t)).toBe("boom");
    expect(bootErrorText("?", t)).toBe("<initializationFailed>");
  });
});
