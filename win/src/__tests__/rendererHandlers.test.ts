// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: unknown[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.resetModules();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    logBatch: (entries: unknown[]) => sent.push(...entries),
  };
});

describe("swallowed errors", () => {
  it("logs the reason at DEBUG and resolves to the fallback", async () => {
    const logger = await import("../logger");
    const value = await Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })).catch(logger.swallowed("files", "optional read", null));
    logger.flushLogs();
    expect(value).toBeNull();
    const entry = (sent as Array<{ level: string; message: string; context: string; data?: Record<string, unknown> }>).find(
      (e) => e.message === "swallowed: optional read",
    );
    expect(entry).toMatchObject({ level: "DEBUG", context: "files", data: { error: "denied", code: "EACCES" } });
  });
});

describe("global handlers", () => {
  it("logs an uncaught error and a rejected promise with a stack", async () => {
    const logger = await import("../logger");
    logger.installGlobalHandlers();
    const boom = new Error("boom");
    window.dispatchEvent(new ErrorEvent("error", { error: boom, message: "boom", filename: "x.js", lineno: 3, colno: 4 }));
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = new Error("nope");
    window.dispatchEvent(rejection);
    logger.flushLogs();
    const entries = sent as Array<{ level: string; message: string; error?: { stack?: string } }>;
    expect(entries.find((e) => e.message === "uncaught error")).toMatchObject({ level: "ERROR" });
    expect(entries.find((e) => e.message === "uncaught error")?.error?.stack).toContain("boom");
    expect(entries.find((e) => e.message === "unhandled rejection")?.error?.stack).toBeTruthy();
    const withRecent = entries.find((e) => e.message === "uncaught error") as { data?: { recent?: string[] } } | undefined;
    expect(withRecent?.data?.recent).toBeInstanceOf(Array);
  });

  it("tracks the screen from breadcrumbs and logs a once-line one time", async () => {
    const logger = await import("../logger");
    logger.logBreadcrumb("screen:settings");
    expect(logger.currentScreen()).toBe("settings");
    logger.logRendererOnce("k", "i18n", "WARN", "missing key");
    logger.logRendererOnce("k", "i18n", "WARN", "missing key");
    logger.flushLogs();
    expect((sent as Array<{ message: string }>).filter((e) => e.message === "missing key")).toHaveLength(1);
  });

  it("sends the turn id to the gateway and to nobody else", async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response("{}");
    });
    const logger = await import("../logger");
    await logger.loggedFetch("draggy-ai://chat", { method: "POST", headers: { "Content-Type": "application/json" } }, "cid-1");
    await logger.loggedFetch("https://example.test/x", {}, "cid-1");
    vi.unstubAllGlobals();
    expect(seen[0]).toMatchObject({ "X-Request-Id": "cid-1", "Content-Type": "application/json" });
    expect(seen[1]?.["X-Request-Id"]).toBeUndefined();
  });
});
