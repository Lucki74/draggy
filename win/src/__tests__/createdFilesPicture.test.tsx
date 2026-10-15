// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CreatedFiles from "../CreatedFiles";
import { defaultSettings } from "../app/settings";

/** A drawn picture opens as a picture; the read-as-text path stays for everything else. */

const file = (name: string, extension: string) => ({
  name,
  path: `/created/${name}`,
  size: 2048,
  modified: Date.now(),
  extension,
});

let readMock = vi.fn();

beforeEach(() => {
  readMock = vi.fn(async () => ({ success: true, text: "", truncated: false, binary: true }));
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    listCreatedFiles: vi.fn(async () => ({
      success: true,
      files: [file("a dragon.png", "png"), file("blob.bin", "bin")],
    })),
    readCreatedFile: readMock,
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("CreatedFiles picture preview", () => {
  it("shows a png through the images protocol without reading it as text", async () => {
    render(<CreatedFiles settings={defaultSettings} />);
    fireEvent.click(await screen.findByText("a dragon.png"));

    const image = await screen.findByAltText("a dragon.png");
    expect(image.getAttribute("src")).toBe("draggy://images/a%20dragon.png");
    expect(readMock).not.toHaveBeenCalled();
  });

  it("falls back to the unavailable message when the picture fails to load", async () => {
    render(<CreatedFiles settings={defaultSettings} />);
    fireEvent.click(await screen.findByText("a dragon.png"));
    fireEvent.error(await screen.findByAltText("a dragon.png"));

    expect(screen.queryByAltText("a dragon.png")).toBeNull();
    expect(screen.getByText("This file cannot be shown as text.")).toBeTruthy();
  });

  it("still reads other files as text", async () => {
    render(<CreatedFiles settings={defaultSettings} />);
    fireEvent.click(await screen.findByText("blob.bin"));

    await screen.findByText("This file cannot be shown as text.");
    expect(readMock).toHaveBeenCalledTimes(1);
  });
});
