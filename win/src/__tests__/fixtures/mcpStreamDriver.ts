/* eslint-disable @typescript-eslint/no-explicit-any -- the drivers take untyped fixture JSON and call CJS modules, so their values are dynamic */
/** Drives the Gemini tool server's call stream over loopback with its keep-alive timer faked, so each clock step is
 * exact. Shared by the fixture runner and its generator; the steps are advance (the clock moves), settle (the call
 * answers) and close (the client goes away). */
import { createRequire } from "node:module";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const mcpHttp = require("../../../electron/providers/gemini/mcpHttp.cjs");

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runMcpStream(input: any): Promise<any> {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const server = mcpHttp.createMcpServer({ name: "draggy", version: "1", keepAliveMs: 30_000 });
  let begun: () => void = () => undefined;
  const started = new Promise<void>((resolve) => (begun = resolve));
  let answered = false;
  let closedSignalled = false;
  let settle: { resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null;
  const endpoint = await server.register({
    tools: () => [],
    call: (_name: string, _args: unknown, { closed }: { closed: Promise<void> }) => {
      closed.then(() => {
        if (!answered) closedSignalled = true;
      });
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
        begun();
      });
    },
  });
  try {
    const base = endpoint.url.replace(/\/mcp\/[0-9a-f]+$/, "");
    const route = endpoint.url.slice(base.length);
    const request = input.request;
    const controller = new AbortController();
    const response = fetch(`${base}${request.path === "/mcp/fixture" ? route : request.path}`, {
      method: request.method,
      headers: { "content-type": "application/json", ...(request.origin ? { origin: request.origin } : {}) },
      body: request.body,
      signal: controller.signal,
    });
    let status: number | null = null;
    let contentType: string | null = null;
    let raw = "";
    const reading = response
      .then(async (res) => {
        status = res.status;
        contentType = res.headers.get("content-type");
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          raw += decoder.decode(value, { stream: true });
        }
      })
      .catch(() => undefined);
    await started;
    for (const step of input.steps as any[]) {
      if (step.advance !== undefined) {
        vi.advanceTimersByTime(step.advance);
        await pause(100);
      }
      if (step.settle) {
        answered = true;
        if (step.settle.error) (settle as any).reject(new Error(step.settle.error));
        else (settle as any).resolve(step.settle.result ?? null);
        await pause(100);
      }
      if (step.close) {
        controller.abort();
        await pause(100);
      }
    }
    await reading;
    const frames = raw.split(/(?<=\n\n)/).filter((frame) => frame.length > 0);
    return { status, contentType, frames, closedSignalled };
  } finally {
    endpoint.close();
    await server.stop();
    vi.useRealTimers();
  }
}
