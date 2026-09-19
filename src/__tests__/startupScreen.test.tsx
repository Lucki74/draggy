// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import StartupScreen from "../StartupScreen";
import { translations } from "../translations";

/** The engine is set up by the app itself, so a missing one is repaired rather than reported. */

const t = (key: string) => translations.en[key] || key;

const model = {
  name: "tiny.gguf",
  filename: "tiny.gguf",
  size: 1,
  path: "tiny.gguf",
  architecture: "llama",
  contextLength: 2048,
  blockCount: 1,
  fileType: 1,
};

/** The bridge, with the engine present only once setup has run when `installs` says so. */
function installBridge({ present, installs }: { present: boolean; installs: boolean }) {
  let hasBinary = present;
  const setupEngine = vi.fn(async () => {
    if (installs) hasBinary = true;
    return { success: installs };
  });
  const status = vi.fn(async () => ({ hasBinary, ready: hasBinary, runnerType: "vulkan" }));

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    gguf: {
      status,
      setupEngine,
      listModels: async () => [model],
      onProgress: () => () => {},
    },
    onDownloadProgress: () => () => {},
  };
  return { setupEngine, status };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("StartupScreen engine setup", () => {
  it("installs a missing engine and carries on without an error", async () => {
    const { setupEngine, status } = installBridge({ present: false, installs: true });
    const onReady = vi.fn();
    render(<StartupScreen modelName="tiny.gguf" language="en" onReady={onReady} />);

    await waitFor(() => expect(onReady).toHaveBeenCalledWith("tiny.gguf"), { timeout: 4000 });
    expect(setupEngine).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(t("missingGgufEngine"))).toBeNull();
  });

  it("does not run setup when the engine is already there", async () => {
    const { setupEngine } = installBridge({ present: true, installs: false });
    const onReady = vi.fn();
    render(<StartupScreen modelName="tiny.gguf" language="en" onReady={onReady} />);

    await waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: 4000 });
    expect(setupEngine).not.toHaveBeenCalled();
  });

  it("shows the error only when setup leaves the engine missing", async () => {
    const { setupEngine } = installBridge({ present: false, installs: false });
    const onReady = vi.fn();
    render(<StartupScreen modelName="tiny.gguf" language="en" onReady={onReady} />);

    expect(await screen.findByText(t("missingGgufEngine"))).toBeTruthy();
    expect(setupEngine).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });
});
