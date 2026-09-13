// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateChars, measureTurn, prepareTurn, runAgentTurn } from "../agent/agentLoop";
import type { TurnInput } from "../agent/agentLoop";
import type { LiveTurn } from "../agent/liveTurn";
import {
  beginOllamaWork,
  forgetContextSize,
  forgetModelInfo,
  peekContextSize,
} from "../ollama";
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

function stream(lines: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function installOllama(options: {
  loadedAt: () => number | null;
  chat: (body: Record<string, unknown>, init?: RequestInit) => Promise<Response> | Response;
}) {
  const chats: Record<string, unknown>[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/show")) {
        return json({ capabilities: ["completion"], model_info: { "test.context_length": 32768 } });
      }
      if (url.endsWith("/api/ps")) {
        const size = options.loadedAt();
        return json({ models: size === null ? [] : [{ name: MODEL, size: 1, size_vram: 1, context_length: size }] });
      }
      if (url.endsWith("/api/chat")) {
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
});

describe("counting the next turn", () => {
  it("asks the model for one token of the very prompt a turn sends, and reports its count", async () => {
    const request = input();
    const size = await windowFor(request);
    const chats = installOllama({ loadedAt: () => size, chat: () => json({ done: true, prompt_eval_count: 1234 }) });

    const counted = await measureTurn(request, { signal: new AbortController().signal, allowLoad: false });

    expect(counted?.tokens).toBe(1234);
    expect(counted?.window).toBe(size);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ stream: false, options: { num_ctx: size, num_predict: 1 } });

    const turn = await prepareTurn(request);
    expect((chats[0].messages as { role: string }[]).map((one) => one.role)).toEqual(turn.wire.map((one) => one.role));
    expect((chats[0].messages as { content: string }[])[0].content).toBe(turn.wire[0].content);
  });

  it("does not load a model just to count, unless the user is typing", async () => {
    const chats = installOllama({ loadedAt: () => null, chat: () => json({ prompt_eval_count: 99 }) });

    const idle = await measureTurn(input(), { signal: new AbortController().signal, allowLoad: false });
    expect(idle).toBeNull();
    expect(chats).toHaveLength(0);

    const typing = await measureTurn(input(), { signal: new AbortController().signal, allowLoad: true });
    expect(typing?.tokens).toBe(99);
  });

  it("asks nothing while a reply is being written anywhere", async () => {
    const request = input();
    const size = await windowFor(request);
    const chats = installOllama({ loadedAt: () => size, chat: () => json({ prompt_eval_count: 5 }) });

    const end = beginOllamaWork();
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
    const chats = installOllama({
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

    const end = beginOllamaWork();
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
    installOllama({
      loadedAt: () => null,
      chat: () =>
        stream([
          { message: { content: "Four " } },
          { message: { content: "words " } },
          { message: { content: "of reply." } },
          { done: true, done_reason: "stop", prompt_eval_count: 500, eval_count: 30, eval_duration: 1e9 },
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
    installOllama({
      loadedAt: () => null,
      chat: () => stream([{ done: true, done_reason: "stop", prompt_eval_count: 0, eval_count: 0 }]),
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
