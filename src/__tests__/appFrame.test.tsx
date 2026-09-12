// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import AppFrame from "../chat/AppFrame";
import { MAX_WIDGET_HEIGHT } from "../chat/widget";
import { translations } from "../translations";

/**
 * The widget as it appears in a reply. Nothing about it is put into this
 * document: the markup goes to the main process and comes back as an address,
 * which is the whole point of the arrangement.
 */

const t = (key: string) => translations.en[key] || key;

const frameOf = () => document.querySelector("iframe") as HTMLIFrameElement | null;

/** A postMessage arriving at the app, from whoever the test says sent it. */
const send = async (source: unknown, data: unknown) => {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });

  await act(async () => {
    fireEvent(window, event);
  });
};

const stage = vi.fn(async () => ({
  success: true,
  token: "abc123",
  url: "widget://abc123/",
}));
const release = vi.fn(async () => ({ success: true }));

beforeEach(() => {
  stage.mockClear();
  release.mockClear();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    widgets: { stage, release },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

/** Renders and lets the staging promise settle. */
const show = async (props: Parameters<typeof AppFrame>[0]) => {
  await act(async () => {
    render(<AppFrame {...props} />);
  });
};

describe("a widget in the timeline", () => {
  it("says which extension sent it, and that it is walled off", async () => {
    await show({ serverId: "github", html: "<p>hi</p>", t });

    expect(screen.getByText("github")).toBeTruthy();
    expect(screen.getByText(translations.en.widgetSandboxed)).toBeTruthy();
  });

  it("hands the markup to the main process rather than the page", async () => {
    await show({ serverId: "github", html: "<p>hi</p>", t });

    expect(stage).toHaveBeenCalledWith("<p>hi</p>");
    expect(document.body.innerHTML).not.toContain("<p>hi</p>");
    expect(frameOf()?.getAttribute("srcdoc")).toBeFalsy();
  });

  it("loads the frame from the address it was given", async () => {
    await show({ serverId: "github", html: "<p>hi</p>", t });

    expect(frameOf()?.getAttribute("src")).toBe("widget://abc123/");
  });

  it("keeps the widget on its own origin and nothing more", async () => {
    await show({ serverId: "github", html: "<p>hi</p>", t });

    const sandbox = frameOf()?.getAttribute("sandbox") ?? "";

    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-popups");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-forms");
    expect(sandbox).not.toContain("allow-downloads");
  });

  it("shows no frame at all when staging fails", async () => {
    stage.mockResolvedValueOnce({ success: false } as never);

    await show({ serverId: "github", html: "<p>hi</p>", t });

    expect(frameOf()).toBeNull();
  });

  it("forgets the widget when the reply goes away", async () => {
    await show({ serverId: "github", html: "<p>hi</p>", t });

    cleanup();

    expect(release).toHaveBeenCalledWith("abc123");
  });
});

describe("what the frame is allowed to ask for", () => {
  it("grows to the height the widget reports", async () => {
    await show({ serverId: "github", html: "<p>hi</p>", t });

    const frame = frameOf() as HTMLIFrameElement;
    Object.defineProperty(frame, "contentWindow", { value: { name: "widget" } });

    await send(frame.contentWindow, { type: "resize", height: 300 });

    expect(frame.style.height).toBe("300px");
  });

  it("will not grow past the cap however loudly it asks", async () => {
    await show({ serverId: "github", html: "<p>hi</p>", t });

    const frame = frameOf() as HTMLIFrameElement;
    Object.defineProperty(frame, "contentWindow", { value: { name: "widget" } });

    await send(frame.contentWindow, { type: "resize", height: 99999 });

    expect(frame.style.height).toBe(`${MAX_WIDGET_HEIGHT}px`);
  });

  it("ignores a message from somewhere other than the frame", async () => {
    const onCall = vi.fn(async () => ({ success: true, text: "ran" }));
    await show({ serverId: "github", html: "<p>hi</p>", t, onCall });

    const frame = frameOf() as HTMLIFrameElement;
    Object.defineProperty(frame, "contentWindow", { value: { name: "widget" } });

    await send({ name: "somewhere else" }, {
      type: "tool",
      name: "list_issues",
      args: {},
    });

    expect(onCall).not.toHaveBeenCalled();
    expect(frame.style.height).toBe("160px");
  });

  it("runs a tool the widget asks for and answers into the frame", async () => {
    const onCall = vi.fn(async () => ({ success: true, text: "two issues" }));
    await show({ serverId: "github", html: "<p>hi</p>", t, onCall });

    const frame = frameOf() as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(frame, "contentWindow", { value: { postMessage } });

    await send(frame.contentWindow, {
      type: "tool",
      name: "list_issues",
      args: { repo: "draggy" },
    });

    expect(onCall).toHaveBeenCalledWith("github", "list_issues", { repo: "draggy" });
    expect(postMessage).toHaveBeenCalledWith(
      { type: "toolResult", name: "list_issues", success: true, text: "two issues" },
      expect.anything(),
    );
  });
});
