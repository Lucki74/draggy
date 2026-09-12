import { describe, expect, it, vi } from "vitest";
import {
  MAX_WIDGET_HEIGHT,
  isFromFrame,
  qualifyWidgetTool,
  readWidgetRequest,
  widgetCaller,
} from "../chat/widget";

/**
 * What a widget is allowed to ask the app for. The frame it runs in is built
 * in the main process; this is the other half, the door it can knock on.
 */

describe("what a widget may ask for", () => {
  it("reads a resize", () => {
    expect(readWidgetRequest({ type: "resize", height: 240 })).toEqual({
      type: "resize",
      height: 240,
    });
  });

  it("caps a resize rather than believing it", () => {
    const request = readWidgetRequest({ type: "resize", height: 90000 });

    expect(request).toEqual({ type: "resize", height: MAX_WIDGET_HEIGHT });
  });

  it("drops a resize that is not a number", () => {
    expect(readWidgetRequest({ type: "resize", height: "tall" })).toBeNull();
    expect(readWidgetRequest({ type: "resize", height: -10 })).toBeNull();
  });

  it("reads a tool call with its arguments", () => {
    const request = readWidgetRequest({
      type: "tool",
      name: "list_issues",
      args: { repo: "draggy" },
    });

    expect(request).toEqual({
      type: "tool",
      name: "list_issues",
      args: { repo: "draggy" },
    });
  });

  it("treats a missing argument object as no arguments", () => {
    expect(readWidgetRequest({ type: "tool", name: "ping" })).toEqual({
      type: "tool",
      name: "ping",
      args: {},
    });
  });

  it("refuses a nameless tool call", () => {
    expect(readWidgetRequest({ type: "tool", name: "   " })).toBeNull();
  });

  it("ignores anything else it is sent", () => {
    expect(readWidgetRequest({ type: "navigate", url: "https://x" })).toBeNull();
    expect(readWidgetRequest("resize")).toBeNull();
    expect(readWidgetRequest(null)).toBeNull();
    expect(readWidgetRequest(42)).toBeNull();
  });
});

describe("who a message came from", () => {
  const frame = { contentWindow: { id: "widget" } } as unknown as HTMLIFrameElement;

  it("accepts the frame's own window", () => {
    const event = { source: frame.contentWindow } as MessageEvent;

    expect(isFromFrame(event, frame)).toBe(true);
  });

  it("refuses anybody else", () => {
    const event = { source: { id: "somewhere else" } } as unknown as MessageEvent;

    expect(isFromFrame(event, frame)).toBe(false);
    expect(isFromFrame(event, null)).toBe(false);
  });
});

describe("the tools a widget may run", () => {
  const readOnly = { readOnly: true, destructive: false };

  it("qualifies a name the way the server side does", () => {
    expect(qualifyWidgetTool("github", "list_issues")).toBe("github__list_issues");
    expect(qualifyWidgetTool("my server", "do-it")).toBe("my_server__do_it");
  });

  it("runs a read-only tool on its own server", async () => {
    const call = vi.fn(async () => ({ success: true, text: "two issues" }));
    const run = widgetCaller("github", call, () => readOnly);

    const result = await run("github", "list_issues", { repo: "draggy" });

    expect(result).toEqual({ success: true, text: "two issues" });
    expect(call).toHaveBeenCalledWith("github", "list_issues", { repo: "draggy" });
  });

  it("refuses a tool that writes", async () => {
    const call = vi.fn();
    const run = widgetCaller("github", call, () => ({ readOnly: false }));

    const result = await run("github", "close_issue", {});

    expect(result.success).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses a read-only tool that is also destructive", async () => {
    const call = vi.fn();
    const run = widgetCaller("github", call, () => ({
      readOnly: true,
      destructive: true,
    }));

    expect((await run("github", "purge", {})).success).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses a tool that is not registered at all", async () => {
    const call = vi.fn();
    const run = widgetCaller("github", call, () => ({}));

    expect((await run("github", "whatever", {})).success).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("will not let a widget reach a different server", async () => {
    const call = vi.fn();
    const run = widgetCaller("github", call, () => readOnly);

    const result = await run("filesystem", "read_file", { path: "/etc/passwd" });

    expect(result.success).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});
