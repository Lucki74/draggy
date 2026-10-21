// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ImageCard from "../chat/ImageCard";
import { ImageModelRow } from "../settings/ImageModelsSection";
import { useImageEngine } from "../images/useImageEngine";
import { translations } from "../translations";
import { clearFakeElectronApi, installFakeElectronApi } from "./helpers/electronApi";
import type { ImageEngineStatus, ImageModelEntry, ImageStepInfo, SearchStep } from "../types";

/** The card and the engine group wired to the bridge, which is where image generation can break
 * without any calculation being wrong. */

const t = (key: string) => translations.en[key] ?? key;

function step(image: ImageStepInfo): SearchStep {
  return { id: "s1", type: "image", content: image.prompt, isComplete: image.status === "done", image };
}

beforeEach(() => {
  installFakeElectronApi();
});

afterEach(() => {
  cleanup();
  clearFakeElectronApi();
  vi.restoreAllMocks();
});

const bridge = () =>
  window.electronAPI as unknown as { sd: Record<string, unknown>; files: Record<string, unknown> } & Record<string, unknown>;

describe("the image card", () => {
  it("shows a message, not a broken image, when the picture cannot load", () => {
    render(<ImageCard step={step({ prompt: "a pear", status: "done", filename: "a-pear.png", location: "created", path: "C:/a-pear.png", model: "sd15-q8" })} t={t} />);
    fireEvent.error(screen.getByAltText("a pear"));
    expect(screen.queryByAltText("a pear")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(translations.en.imageUnavailable);
  });

  it("says what it is doing and stops the job from its button", () => {
    const cancel = vi.fn(async () => ({ success: true }));
    bridge().sd.cancel = cancel;

    render(<ImageCard step={step({ prompt: "a fox", status: "generating", requestId: "r1", startedAt: Date.now() })} t={t} />);
    expect(screen.getByRole("status").textContent).toBe("Drawing…");
    // The pulsing placeholder alone says it is working; no bar rides on the picture.
    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    expect(cancel).toHaveBeenCalledWith("r1");
  });

  it("holds the picture's place at its requested shape while it is drawn", () => {
    const { container } = render(
      <ImageCard step={step({ prompt: "tall", status: "loading-model", requestId: "r1", width: 512, height: 1024 })} t={t} />,
    );
    expect(container.querySelector<HTMLElement>("[style*='aspect-ratio']")?.style.aspectRatio).toBe("512 / 1024");
  });

  it("says where it is in the queue", () => {
    render(<ImageCard step={step({ prompt: "a fox", status: "queued", queuePosition: 2, requestId: "r1" })} t={t} />);
    expect(screen.getByRole("status").textContent).toBe("Waiting in line (position 2)");
  });

  it("shows a finished picture from the output folder by its path, never embedded bytes", () => {
    render(
      <ImageCard
        step={step({
          prompt: "a fox",
          status: "done",
          location: "created",
          filename: "2026 fox.png",
          path: "C:\\d\\2026 fox.png",
          width: 768,
          height: 512,
          seed: 9,
          model: "Z-Image",
        })}
        t={t}
      />,
    );
    const image = screen.getAllByRole("img", { name: "a fox" })[0] as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("draggy://images/2026%20fox.png");
    expect(screen.getByText("Z-Image · 768×512")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Open$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Show in folder/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /seed 9/ })).toBeTruthy();
  });

  it("copies the seed and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <ImageCard step={step({ prompt: "a fox", status: "done", location: "created", filename: "f.png", path: "C:\\f.png", seed: 77 })} t={t} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /seed 77/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("77"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Copied"));
  });

  it("reads a project picture through the file tools, inside the conversation's folder", async () => {
    const read = vi.fn(async () => ({ success: true, dataUrl: "data:image/png;base64,AAAA", isImage: true }));
    bridge().files.read = read;

    render(
      <ImageCard
        step={step({ prompt: "logo", status: "done", location: "project", workspaceId: "w1", filename: "logo.png", path: "C:\\p\\public\\logo.png" })}
        t={t}
      />,
    );
    await waitFor(() => expect(screen.getAllByRole("img", { name: "logo" }).length).toBeGreaterThan(0));
    expect(read).toHaveBeenCalledWith("w1", "C:\\p\\public\\logo.png");
  });

  it("shows a failure in words, with its link", () => {
    render(
      <ImageCard
        step={step({ prompt: "big", status: "error", error: "Not enough memory. [More about this error](https://draggy.org/error/image-out-of-memory)" })}
        t={t}
      />,
    );
    expect(screen.getByText("Not drawn")).toBeTruthy();
    expect(screen.getByRole("link", { name: "More about this error" }).getAttribute("href")).toBe(
      "https://draggy.org/error/image-out-of-memory",
    );
  });

  it("tells a picture stopped by the user from one stopped when the app closed", () => {
    const { rerender } = render(<ImageCard step={step({ prompt: "a fox", status: "cancelled", finishedAt: 5 })} t={t} />);
    expect(screen.getByRole("status").textContent).toBe("Stopped");
    rerender(<ImageCard step={step({ prompt: "a fox", status: "cancelled" })} t={t} />);
    expect(screen.getByRole("status").textContent).toBe("Stopped when Draggy closed");
  });

  it("enlarges the picture and closes again with Escape", () => {
    render(<ImageCard step={step({ prompt: "a fox", status: "done", location: "created", filename: "f.png", path: "C:\\f.png" })} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Show full size" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const model = (patch: Partial<ImageModelEntry> = {}): ImageModelEntry => ({
  id: "file:qwen-image-Q4_K_M.gguf",
  name: "qwen-image-Q4_K_M",
  variant: "",
  kind: "single",
  curated: false,
  installed: true,
  partial: false,
  size: 1000,
  vramGB: 0,
  defaults: { width: 512, height: 512, steps: 20, cfgScale: 7 },
  license: "",
  licenseUrl: "",
  files: [],
  ...patch,
});

describe("the image engine", () => {
  const status = (extra: Partial<ImageEngineStatus> = {}): ImageEngineStatus => ({
    success: true,
    installed: true,
    runner: "cuda",
    source: "app",
    runners: ["cuda", "vulkan", "cpu"],
    defaultRunner: "cuda",
    model: "",
    ready: false,
    release: "master-898-2bb7294",
    models: [model()],
    ...extra,
  });

  function Probe() {
    useImageEngine();
    return null;
  }

  it("installs itself once an image model is on disk", async () => {
    const setupEngine = vi.fn(async () => ({ success: true, runner: "cuda" }));
    bridge().sd.status = async () => status({ installed: false, runner: null, source: null });
    bridge().sd.setupEngine = setupEngine;
    render(<Probe />);
    await waitFor(() => expect(setupEngine).toHaveBeenCalledTimes(1));
  });
});

describe("an installed image model", () => {
  it("is removed only after the confirmation names it", () => {
    const onRemove = vi.fn();
    render(<ImageModelRow entry={model({ name: "Z-Image", variant: "Q4" })} active onRemove={onRemove} t={t} />);
    expect(screen.getByText("Image generation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Remove Z-Image Q4/ }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toMatch(/Remove .*Z-Image Q4.*\?/);

    const confirm = screen.getAllByRole("button", { name: "Remove" }).at(-1) as HTMLElement;
    fireEvent.click(confirm);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
