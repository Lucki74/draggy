// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ url: "http://127.0.0.1:4321", token: "draggy-test" })),
}));

import { gatewayRequest, installChatGateway } from "../ai/providers";

const info = { url: "http://127.0.0.1:4321", token: "draggy-test" };

describe("gatewayRequest", () => {
  it("points chat requests at the gateway with the bearer token", () => {
    const [url, init] = gatewayRequest("draggy-ai://chat", { method: "POST", body: "{}" }, info);
    expect(url).toBe("http://127.0.0.1:4321/chat");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer draggy-test");
  });

  it("leaves other URLs and their headers alone", () => {
    const [url, init] = gatewayRequest("https://example.test/x", undefined, info);
    expect(url).toBe("https://example.test/x");
    expect(init).toEqual({});
  });
});

describe("installChatGateway", () => {
  it("does nothing outside the Tauri shell", () => {
    const before = vi.fn();
    vi.stubGlobal("window", { fetch: before });
    installChatGateway();
    expect((globalThis as { window: { fetch: unknown } }).window.fetch).toBe(before);
    vi.unstubAllGlobals();
  });

  it("routes chat requests through the gateway inside the shell", async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    const stub = vi.fn(async (input: string, init?: RequestInit) => {
      seen.push([input, init]);
      return new Response("ok");
    });
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {}, fetch: stub });
    installChatGateway();
    const routed = (globalThis as unknown as { window: { fetch: (i: string) => Promise<Response> } }).window.fetch;
    await routed("draggy-ai://chat");
    expect(seen[0][0]).toBe("http://127.0.0.1:4321/chat");
    expect(new Headers(seen[0][1]?.headers).get("Authorization")).toBe("Bearer draggy-test");
    vi.unstubAllGlobals();
  });
});
