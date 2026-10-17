import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createBrowserPane, sanitiseBounds } = require("./browserPane.cjs");
const logger = require("./logger.cjs");

function fakeElectron({ zoom = 1 } = {}) {
  const views = [];
  class WebContentsView {
    constructor(options) {
      this.options = options;
      this.bounds = null;
      this.visible = true;
      this.webContents = { isDestroyed: () => false, close: vi.fn(), on: vi.fn() };
      views.push(this);
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    setVisible(visible) {
      this.visible = visible;
    }
  }
  const host = {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { getZoomFactor: () => zoom },
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
  };
  return { WebContentsView, host, views };
}

describe("sanitiseBounds", () => {
  const limit = { width: 1200, height: 800 };

  it("rounds a plain rectangle and keeps it", () => {
    expect(sanitiseBounds({ x: 10.4, y: 20.6, width: 300, height: 200 }, limit)).toEqual({
      x: 10,
      y: 21,
      width: 300,
      height: 200,
    });
  });

  it("refuses anything that is not four finite numbers", () => {
    expect(sanitiseBounds(null, limit)).toBeNull();
    expect(sanitiseBounds("0,0,1,1", limit)).toBeNull();
    expect(sanitiseBounds({ x: 0, y: 0, width: Infinity, height: 10 }, limit)).toBeNull();
    expect(sanitiseBounds({ x: "a", y: 0, width: 10, height: 10 }, limit)).toBeNull();
  });

  it("keeps the rectangle inside the window", () => {
    expect(sanitiseBounds({ x: -50, y: 700, width: 5000, height: 500 }, limit)).toEqual({
      x: 0,
      y: 700,
      width: 1200,
      height: 100,
    });
  });
});

describe("createBrowserPane", () => {
  it("creates no view until one is needed", () => {
    const { WebContentsView, host, views } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    expect(pane.view).toBeNull();
    expect(views).toHaveLength(0);
  });

  it("puts the page in the web session, sandboxed and without Node", () => {
    const { WebContentsView, host } = fakeElectron();
    const webSession = { name: "persist:draggy-web" };
    const prepare = vi.fn();
    const pane = createBrowserPane({ WebContentsView, host, webSession, prepare });

    const view = pane.ensure();
    expect(view.options.webPreferences).toMatchObject({
      session: webSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    });
    expect(view.options.webPreferences.preload).toBeUndefined();
    expect(host.contentView.addChildView).toHaveBeenCalledWith(view);
    expect(prepare).toHaveBeenCalledWith(view);
    expect(pane.ensure()).toBe(view);
  });

  it("starts hidden and shows only when visible with a size", () => {
    const { WebContentsView, host } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    const view = pane.ensure();
    expect(view.visible).toBe(false);

    pane.setVisible(true);
    expect(view.visible).toBe(false);

    pane.setBounds({ x: 800, y: 40, width: 400, height: 700 });
    expect(view.visible).toBe(true);
    expect(view.bounds).toEqual({ x: 800, y: 40, width: 400, height: 700 });

    pane.setVisible(false);
    expect(view.visible).toBe(false);
  });

  it("says whether the page can be seen, and wakes a caller waiting for that", async () => {
    const { WebContentsView, host } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    pane.ensure();
    expect(pane.isShown()).toBe(false);

    const waiting = pane.whenShown(1000);
    pane.setVisible(true);
    pane.setBounds({ x: 800, y: 40, width: 400, height: 700 });
    await expect(waiting).resolves.toBe(true);
    expect(pane.isShown()).toBe(true);
    await expect(pane.whenShown(10)).resolves.toBe(true);
  });

  it("gives up waiting for a pane that never shows", async () => {
    vi.useFakeTimers();
    const { WebContentsView, host } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    pane.ensure();
    const waiting = pane.whenShown(500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(waiting).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("scales CSS pixels by the window's zoom", () => {
    const { WebContentsView, host } = fakeElectron({ zoom: 1.25 });
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    const view = pane.ensure();
    pane.setBounds({ x: 400, y: 40, width: 400, height: 400 });
    pane.setVisible(true);
    expect(view.bounds).toEqual({ x: 500, y: 50, width: 500, height: 500 });
  });

  it("ignores a malformed rectangle", () => {
    const { WebContentsView, host } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    expect(pane.setBounds({ x: "1" + "e999", y: 0, width: 1, height: 1 })).toBe(false);
  });

  it("logs the navigated host only, a failed load as WARN and a dead page process as ERROR", () => {
    const info = vi.spyOn(logger.log, "info");
    const warn = vi.spyOn(logger.log, "warn");
    const error = vi.spyOn(logger.log, "error");
    const { WebContentsView, host } = fakeElectron();
    const view = createBrowserPane({ WebContentsView, host, webSession: {} }).ensure();
    const listener = (name) => view.webContents.on.mock.calls.find(([event]) => event === name)[1];

    listener("did-navigate")({}, "https://docs.example.com/private/page?token=abc123");
    listener("did-fail-load")({}, -105, "ERR_NAME_NOT_RESOLVED", "https://down.example.net/private?q=1", true);
    listener("render-process-gone")({}, { reason: "crashed", exitCode: 139 });

    expect(info).toHaveBeenCalledWith("window.browser", "navigated", { host: "docs.example.com" });
    expect(warn).toHaveBeenCalledWith("window.browser", "load failed", { host: "down.example.net", code: -105, description: "ERR_NAME_NOT_RESOLVED" });
    expect(error).toHaveBeenCalledWith("window.browser", "page process gone", { reason: "crashed", exitCode: 139 });
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain("private");
    expect(logged).not.toContain("abc123");
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("tabs", () => {
  const sized = (pane) => {
    pane.setBounds({ x: 0, y: 0, width: 400, height: 300 });
    pane.setVisible(true);
  };

  it("starts with one tab and opens more, the newest in front", () => {
    const { WebContentsView, host, views } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    const first = pane.ensure();
    sized(pane);
    const second = pane.openTab();
    expect(views).toHaveLength(2);
    expect(pane.view).toBe(second);
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(true);
    expect(pane.tabs().map((t) => t.active)).toEqual([false, true]);
  });

  it("prepares every tab it opens", () => {
    const { WebContentsView, host } = fakeElectron();
    const prepare = vi.fn();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {}, prepare });
    pane.ensure();
    pane.openTab();
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("selects a tab by position and rejects one that is not there", () => {
    const { WebContentsView, host } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    const first = pane.ensure();
    sized(pane);
    pane.openTab();
    expect(pane.selectTab(0)).toBe(true);
    expect(pane.view).toBe(first);
    expect(first.visible).toBe(true);
    expect(pane.selectTab(5)).toBe(false);
  });

  it("closes a tab and falls back to the one before it, never leaving none", () => {
    const { WebContentsView, host, views } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    const first = pane.ensure();
    sized(pane);
    pane.openTab();
    expect(pane.closeTab(1)).toBe(true);
    expect(views[1].webContents.close).toHaveBeenCalled();
    expect(pane.view).toBe(first);
    expect(pane.closeTab(0)).toBe(false);
    expect(pane.tabs()).toHaveLength(1);
  });

  it("caps how many tabs can be open", () => {
    const { WebContentsView, host } = fakeElectron();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {} });
    pane.ensure();
    for (let i = 0; i < 20; i += 1) pane.openTab();
    expect(pane.tabs().length).toBeLessThanOrEqual(8);
    expect(pane.openTab()).toBeNull();
  });

  it("tells the caller when the tabs change", () => {
    const { WebContentsView, host } = fakeElectron();
    const onChange = vi.fn();
    const pane = createBrowserPane({ WebContentsView, host, webSession: {}, onTabsChange: onChange });
    pane.ensure();
    pane.openTab();
    pane.selectTab(0);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
