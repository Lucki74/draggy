// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { flushSessionSaves, markSessionsSaved, queueSessionSave } from "../storage";
import { useSessions } from "../app/useSessions";
import type { ChatSession, Message } from "../types";

/** Saves are debounced, so a quit has to write the last ones itself before storage closes. */

// Storage picks its backend on import, so the bridge exists before the imports run.
const bridge = vi.hoisted(() => {
  const state = {
    saved: [] as ChatSession[],
    stored: [] as ChatSession[],
    hold: null as Promise<void> | null,
    quitHandlers: new Set<() => unknown>(),
  };

  (window as unknown as { electronAPI: unknown }).electronAPI = {
    db: {
      saveChat: async (session: ChatSession) => {
        if (state.hold) await state.hold;
        state.saved.push(session);
        return { success: true };
      },
      loadChats: async () => ({ success: true, chats: state.stored }),
      get: async () => ({ value: "done" }),
      set: async () => ({ success: true }),
    },
    onBeforeQuit: (handler: () => unknown) => {
      state.quitHandlers.add(handler);
      return () => {
        state.quitHandlers.delete(handler);
      };
    },
  };

  return state;
});

const message = (id: string, role: Message["role"], content: string): Message => ({
  id,
  role,
  content,
});

const chat = (id: string, content: string): ChatSession => ({
  id,
  title: id,
  updatedAt: 1,
  isGenerating: false,
  messages: [message(`${id}-m`, "user", content)],
});

const savedIds = () => bridge.saved.map((session) => session.id);
const lastWords = (session: ChatSession | undefined) => session?.messages.at(-1)?.content;
const quit = () => Promise.all([...bridge.quitHandlers].map((handler) => handler()));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  bridge.saved = [];
  bridge.stored = [];
  bridge.hold = null;
});

describe("flushing the saves still waiting", () => {
  it("writes a queued save straight away, and only once", async () => {
    vi.useFakeTimers();
    queueSessionSave(chat("q1", "the last reply"));

    await flushSessionSaves();
    expect(savedIds()).toEqual(["q1"]);

    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(savedIds()).toEqual(["q1"]);
  });

  it("keeps the queued version over a list that is a render behind", async () => {
    queueSessionSave(chat("q2", "newer"));

    await flushSessionSaves([chat("q2", "older")]);

    expect(bridge.saved).toHaveLength(1);
    expect(lastWords(bridge.saved[0])).toBe("newer");
  });

  it("leaves alone what is already on disk", async () => {
    const loaded = chat("d1", "as loaded");
    markSessionsSaved([loaded]);

    await flushSessionSaves([loaded, chat("d2", "never written")]);

    expect(savedIds()).toEqual(["d2"]);
  });

  it("waits for a write that is already on its way", async () => {
    vi.useFakeTimers();
    let release = () => {};
    bridge.hold = new Promise((resolve) => (release = resolve));

    queueSessionSave(chat("w1", "in flight"));
    vi.advanceTimersByTime(700);

    let done = false;
    const flushing = flushSessionSaves().then(() => (done = true));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(done).toBe(false);

    release();
    await flushing;
    expect(savedIds()).toEqual(["w1"]);
  });
});

describe("the conversations hook", () => {
  const reply = (id: string, content: string) => (session: ChatSession) => ({
    ...session,
    messages: [...session.messages, message(id, "assistant", content)],
  });

  it("writes the last reply when Draggy is about to quit, not a debounce later", async () => {
    bridge.stored = [chat("h1", "question"), chat("h2", "untouched")];
    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => result.current.updateSession("h1", reply("h1-r", "the last words")));
    expect(bridge.saved).toEqual([]);

    await act(quit);

    expect(savedIds()).toEqual(["h1"]);
    expect(lastWords(bridge.saved[0])).toBe("the last words");
  });

  it("saves the second of two updates batched into one render", async () => {
    // React runs a batched updater only at render, which the save used to miss.
    bridge.stored = [chat("b1", "question")];
    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.updateSession("b1", reply("b1-a", "first"));
      result.current.updateSession("b1", reply("b1-b", "second"));
    });

    await waitFor(() => expect(bridge.saved.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(lastWords(bridge.saved.at(-1))).toBe("second");
  });
});
