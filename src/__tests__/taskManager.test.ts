import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRequest, AgentResult } from "../agent/agentLoop";
import type { AppSettings, ChatSession, MessageVersion } from "../types";

/**
 * Turns belong to a conversation, not to whatever is on screen. These are the
 * properties the surfaces in 2.0 rely on: two chats can generate at once, a
 * turn survives the user looking elsewhere, and stopping one leaves the other
 * alone.
 */

const pending = vi.hoisted(() => {
  const turns: {
    request: AgentRequest;
    resolve: (result: AgentResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  return turns;
});

vi.mock("../agent/agentLoop", () => ({
  KEEP_ALIVE: "30m",
  runAgentTurn: (request: AgentRequest) =>
    new Promise<AgentResult>((resolve, reject) => {
      pending.push({ request, resolve, reject });
    }),
}));

const { createTaskManager } = await import("../agent/taskManager");
import type { TaskHost } from "../agent/taskManager";

const settings = { customInstructions: [] } as unknown as AppSettings;

function finished(): AgentResult {
  return {
    steps: [],
    textContent: "done",
    content: "done",
    exhausted: false,
    outOfContext: false,
  } as unknown as AgentResult;
}

function createHost(workspaceId = "default") {
  const sessions = new Map<string, ChatSession>();

  const host: TaskHost = {
    getModel: () => "qwen3:8b",
    getSettings: () => settings,
    getEnvironment: () => ({
      webMode: "off",
      codeExecution: false,
      libraryReady: false,
    }),
    getWorkspaceId: () => workspaceId,
    getSession: (chatId) => sessions.get(chatId),
    addSession: (session) => sessions.set(session.id, session),
    updateSession: (chatId, updater) => {
      const session = sessions.get(chatId);
      if (session) sessions.set(chatId, updater(session));
    },
    patchActiveMessage: (chatId, patch: Partial<MessageVersion>) => {
      const session = sessions.get(chatId);
      if (!session || session.messages.length === 0) return;

      const messages = session.messages.slice();
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, ...patch };
      sessions.set(chatId, { ...session, messages });
    },
    t: (key) => key,
  };

  return { sessions, host };
}

function seed(sessions: Map<string, ChatSession>, id: string): ChatSession {
  const session: ChatSession = {
    id,
    title: id,
    messages: [],
    updatedAt: 0,
    isGenerating: false,
  };
  sessions.set(id, session);
  return session;
}

describe("the task manager", () => {
  beforeEach(() => {
    pending.length = 0;
  });

  it("starts a conversation the first message arrives for", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "hello");

    expect(sessions.get("chat-1")).toBeTruthy();
    expect(sessions.get("chat-1")?.isGenerating).toBe(true);
    expect(pending).toHaveLength(1);
  });

  it("starts it in the workspace that is open", () => {
    const { sessions, host } = createHost("project-7");
    const manager = createTaskManager(host);

    manager.send("chat-1", "hello");

    expect(sessions.get("chat-1")?.workspaceId).toBe("project-7");
  });

  it("keeps two conversations generating at the same time", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");

    expect(manager.running()).toEqual(["chat-1", "chat-2"]);
    expect(sessions.get("chat-1")?.isGenerating).toBe(true);
    expect(sessions.get("chat-2")?.isGenerating).toBe(true);
  });

  it("finishes a turn for a conversation that is no longer the one on screen", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");

    // Whatever the window is showing, the first turn is still its chat's.
    pending[0].resolve(finished());
    await vi.waitFor(() => expect(sessions.get("chat-1")?.isGenerating).toBe(false));

    expect(manager.isRunning("chat-1")).toBe(false);
    expect(manager.isRunning("chat-2")).toBe(true);
  });

  it("stops one conversation without touching the other", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");

    manager.stop("chat-1");

    expect(pending[0].request.signal.aborted).toBe(true);
    expect(pending[1].request.signal.aborted).toBe(false);
    expect(sessions.get("chat-1")?.isGenerating).toBe(false);
    expect(sessions.get("chat-2")?.isGenerating).toBe(true);
    expect(manager.running()).toEqual(["chat-2"]);
  });

  it("ignores a stopped turn that lands afterwards", async () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.stop("chat-1");

    // The loop notices the abort a moment later; nothing it says then counts.
    pending[0].reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await vi.waitFor(() => expect(manager.running()).toEqual([]));

    const messages = sessions.get("chat-1")?.messages ?? [];
    expect(messages.some((m) => m.content.includes("aborted"))).toBe(false);
  });

  it("stops everything at once", () => {
    const { host } = createHost();
    const manager = createTaskManager(host);

    manager.send("chat-1", "first");
    manager.send("chat-2", "second");
    manager.stopAll();

    expect(pending.every((turn) => turn.request.signal.aborted)).toBe(true);
    expect(manager.running()).toEqual([]);
  });

  it("tells subscribers which conversations are busy", () => {
    const { host } = createHost();
    const manager = createTaskManager(host);
    const seen: string[][] = [];

    const unsubscribe = manager.subscribe((running) => seen.push(running));

    manager.send("chat-1", "first");
    manager.stop("chat-1");
    unsubscribe();
    manager.send("chat-2", "second");

    expect(seen).toEqual([["chat-1"], []]);
  });

  it("hands the turn the conversation as it stands", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    const session = seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...session,
      messages: [{ id: "m1", role: "user", content: "earlier" }],
    });

    manager.send("chat-1", "later");

    const sent = pending[0].request.messages;
    expect(sent.map((m) => m.content)).toEqual(["earlier", "later"]);
  });

  it("replaces the last reply when regenerating, keeping the old one", () => {
    const { sessions, host } = createHost();
    const manager = createTaskManager(host);

    seed(sessions, "chat-1");
    sessions.set("chat-1", {
      ...(sessions.get("chat-1") as ChatSession),
      messages: [
        { id: "m1", role: "user", content: "question" },
        { id: "m2", role: "assistant", content: "first answer" },
      ],
    });

    manager.regenerate("chat-1");

    const messages = sessions.get("chat-1")?.messages ?? [];
    expect(messages).toHaveLength(2);
    expect(messages[1].versions?.[0]?.content).toBe("first answer");
    expect(messages[1].content).toBe("");
  });

  it("reads the newest host after it is reconfigured", () => {
    const first = createHost();
    const manager = createTaskManager(first.host);

    const second = createHost();
    manager.configure(second.host);

    manager.send("chat-1", "hello");

    expect(second.sessions.get("chat-1")).toBeTruthy();
    expect(first.sessions.get("chat-1")).toBeUndefined();
  });
});
