// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateChars, measureTurn, prepareTurn, runAgentTurn } from "../agent/agentLoop";
import type { TurnInput } from "../agent/agentLoop";
import type { LiveTurn } from "../agent/liveTurn";
import {
  beginLlamaWork,
  forgetContextSize,
  forgetModelInfo,
  peekContextSize,
  pickContextSize,
} from "../llama";
import { SETTINGS_KEY } from "../storage";
import { defaultSettings, loadSettings } from "../app/settings";
import { resetRegistry } from "../tools/registry";

/** The context meter counts with the model itself rather than guessing, and a running turn reports
 * its speed and size as it goes, without a single extra request while it generates. */

const MODEL = "count-model";

const input = (content = "How big is this?"): TurnInput => ({
  model: MODEL,
  settings: { ...defaultSettings, modelName: MODEL },
  environment: { webMode: "off", codeExecution: false, libraryReady: false },
  messages: [{ id: "u1", role: "user", content }],
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function sseStream(chunks: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          if (typeof chunk === "string") {
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function installGguf(options: {
  loadedAt: () => number | null;
  chat: (body: Record<string, unknown>, init?: RequestInit) => Promise<Response> | Response;
}) {
  const chats: Record<string, unknown>[] = [];

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    gguf: {
      status: async () => {
        const size = options.loadedAt();
        return size === null
          ? { running: false, model: null }
          : { running: true, model: MODEL, contextSize: size };
      },
      listModels: async () => [
        { filename: MODEL, contextLength: 32768, blockCount: 32, architecture: "gguf", fileType: 0 },
      ],
      start: async () => ({ success: true }),
    },
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/chat/completions")) {
        const body = JSON.parse(String(init?.body));
        chats.push(body);
        return options.chat(body, init);
      }
      return new Response("{}", { status: 404 });
    }),
  );

  return chats;
}

/** The window the model would be loaded at for this input, as a turn works it out. */
async function windowFor(request: TurnInput) {
  const turn = await prepareTurn(request);
  return peekContextSize(MODEL, estimateChars(turn.wire), 32768);
}

beforeEach(() => {
  resetRegistry();
  forgetModelInfo(MODEL);
  forgetContextSize(MODEL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("counting the next turn", () => {
  it("asks the model for one token of the very prompt a turn sends, and reports its count", async () => {
    const request = input();
    const size = await windowFor(request);
    const chats = installGguf({ loadedAt: () => size, chat: () => json({ usage: { prompt_tokens: 1234 } }) });

    const counted = await measureTurn(request, { signal: new AbortController().signal, allowLoad: false });

    expect(counted?.tokens).toBe(1234);
    expect(counted?.window).toBe(size);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ stream: false, max_tokens: 1 });

    const turn = await prepareTurn(request);
    expect((chats[0].messages as { role: string }[]).map((one) => one.role)).toEqual(turn.wire.map((one) => one.role));
    expect((chats[0].messages as { content: string }[])[0].content).toBe(turn.wire[0].content);
  });

  it("does not load a model just to count, unless the user is typing", async () => {
    const chats = installGguf({ loadedAt: () => null, chat: () => json({ usage: { prompt_tokens: 99 } }) });

    const idle = await measureTurn(input(), { signal: new AbortController().signal, allowLoad: false });
    expect(idle).toBeNull();
    expect(chats).toHaveLength(0);

    const typing = await measureTurn(input(), { signal: new AbortController().signal, allowLoad: true });
    expect(typing?.tokens).toBe(99);
  });

  it("asks nothing while a reply is being written anywhere", async () => {
    const request = input();
    const size = await windowFor(request);
    const chats = installGguf({ loadedAt: () => size, chat: () => json({ usage: { prompt_tokens: 5 } }) });

    const end = beginLlamaWork();
    try {
      expect(await measureTurn(request, { signal: new AbortController().signal, allowLoad: true })).toBeNull();
      expect(chats).toHaveLength(0);
    } finally {
      end();
    }
  });

  it("gives way the moment a reply starts, so it never holds one up", async () => {
    const request = input();
    const size = await windowFor(request);
    let aborted = false;
    const chats = installGguf({
      loadedAt: () => size,
      chat: (_body, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    const counting = measureTurn(request, { signal: new AbortController().signal, allowLoad: false });
    await vi.waitFor(() => expect(chats).toHaveLength(1));

    const end = beginLlamaWork();
    try {
      expect(await counting).toBeNull();
      expect(aborted).toBe(true);
    } finally {
      end();
    }
  });
});

describe("a turn as it runs", () => {
  it("snaps to the model's own counts when a pass ends", async () => {
    installGguf({
      loadedAt: () => null,
      chat: () =>
        sseStream([
          { choices: [{ delta: { content: "Four " }, finish_reason: null }] },
          { choices: [{ delta: { content: "words " }, finish_reason: null }] },
          { choices: [{ delta: { content: "of reply." }, finish_reason: null }] },
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 500, completion_tokens: 30 },
            timings: { predicted_ms: 1000, predicted_n: 30, prompt_ms: 50, prompt_n: 500 },
          },
          "[DONE]",
        ]),
    });

    const seen: LiveTurn[] = [];
    await runAgentTurn(
      { ...input(), signal: new AbortController().signal },
      {
        t: (key) => key,
        onPatch: () => {},
        onSteps: () => {},
        onOutOfContext: () => {},
        onLive: (live) => seen.push(live),
      },
    );

    expect(seen[0].contextExact).toBe(false);
    const last = seen.at(-1);
    expect(last).toMatchObject({ contextTokens: 530, contextExact: true, responseTokens: 30, tokensPerSecond: 30 });
  });

  it("starts from a count taken just before it, instead of an estimate", async () => {
    const request = input();
    const turn = await prepareTurn(request);
    installGguf({
      loadedAt: () => null,
      chat: () =>
        sseStream([
          {
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0 },
            timings: { predicted_ms: 0, predicted_n: 0, prompt_ms: 0, prompt_n: 0 },
          },
          "[DONE]",
        ]),
    });

    const seen: LiveTurn[] = [];
    await runAgentTurn(
      { ...request, contextBase: { tokens: 777, chars: estimateChars(turn.wire) }, signal: new AbortController().signal },
      { t: (key) => key, onPatch: () => {}, onSteps: () => {}, onOutOfContext: () => {}, onLive: (live) => seen.push(live) },
    );

    // The clock in the prompt can gain a character between the count and the turn.
    expect(Math.abs(seen[0].contextTokens - 777)).toBeLessThanOrEqual(1);
  });
});

describe("the speed line", () => {
  it("is off unless the user turns it on", () => {
    expect(defaultSettings.showMetrics).toBe(false);
  });

  it("stays off for settings an older version saved with it on", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showMetrics: true }));
    expect(loadSettings().showMetrics).toBe(false);
  });

  it("stays on once the user has chosen it", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showMetrics: true, metricsChosen: true }));
    expect(loadSettings().showMetrics).toBe(true);
  });
});

describe("estimateChars tool definitions", () => {
  const messages = [{ role: "user" as const, content: "x".repeat(4000) }];

  it("adds the tool payload on top of the message text", () => {
    expect(estimateChars(messages, 5000)).toBe(estimateChars(messages) + 5000);
  });

  it("moves a chat that only just fits without tools up a window once they are counted", () => {
    const bare = estimateChars([{ role: "user" as const, content: "x".repeat(24000) }]);
    const withTools = estimateChars([{ role: "user" as const, content: "x".repeat(24000) }], 8000);
    expect(pickContextSize(withTools, 131072)).toBeGreaterThan(pickContextSize(bare, 131072));
  });
});
