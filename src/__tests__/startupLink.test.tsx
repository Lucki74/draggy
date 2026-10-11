// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StartupScreen from "../StartupScreen";

/** The splash can be left for Providers without a local model; startupScreen.test.tsx stays untouched. */

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

function hangingBridge() {
  const never = () => new Promise(() => {});
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    gguf: { status: never, listModels: never, onProgress: () => () => {} },
    onDownloadProgress: () => () => {},
  };
}

describe("the splash's way to a provider", () => {
  it("hands over to Providers while the download is still going", () => {
    hangingBridge();
    const onUseProvider = vi.fn();
    render(<StartupScreen modelName="" language="en" onReady={() => {}} onUseProvider={onUseProvider} />);
    fireEvent.click(screen.getByRole("button", { name: "Use a cloud provider or local server instead" }));
    expect(onUseProvider).toHaveBeenCalledTimes(1);
  });

  it("is not offered where there is nowhere to hand over to", () => {
    hangingBridge();
    render(<StartupScreen modelName="" language="en" onReady={() => {}} />);
    expect(screen.queryByText("Use a cloud provider or local server instead")).toBeNull();
  });
});
