import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHost, AgentRequest, AgentResult } from "../agent/agentLoop";
import type { AppSettings, ChatSession, CompactionState, Message, MessageVersion } from "../types";

/** Compaction as the user sees it: a running marker under the last reply, then "Compacted N
 * tokens", and a waiting message that says so. */

const turns = vi.hoisted(
  () =>
    [] as {
      request: AgentRequest;
      host: AgentHost;
      resolve: (result: AgentResult) => void;
    }[],
);

const folding = vi.hoisted(
  () =>
    [] as {
      request: { plan: { foldThrough: number }; signal?: AbortSignal };
      resolve: (state: CompactionState | null) => void;
    }[],
);

vi.mock("../agent/agentLoop", () => ({
  KEEP_ALIVE: "30m",
  runAgentTurn: (request: AgentRequest, host: AgentHost) =>
    new Promise<AgentResult>((resolve) => {
      turns.push({ request, host, resolve });
    }),
}));

vi.mock("../agent/compaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/compaction")>();

  return {
    ...actual,
    runCompaction: (request: { plan: { foldThrough: number }; signal?: AbortSignal }) =>
      new Promise<CompactionState | null>((resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
        folding.push({ request, resolve });
      }),
  };
});

vi.mock("../ollama", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ollama")>();
  return {
    ...actual,
    getModelInfo: async () => ({ contextLength: 128_000, capabilities: ["tools"] }),
  };
});

const { createTaskManager } = await import("../agent/taskManager");
import type { TaskHost } from "../agent/taskManager";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const finished = (): AgentResult =>
  ({
    steps: [],
    textContent: "done",
    content: "done",
    exhausted: false,
    outOfContext: false,
  }) as unknown as AgentResult;

const say = (role: Message["role"], chars: number, index: number): Message => ({
  id: `${role}-${index}`,
  role,
  content: "x".repeat(chars),
});

/** A long conversation: well past any automatic limit on a small window. */
const longChat = (pairs = 6, chars = 30_000): Message[] =>
  Array.from({ length: pairs * 2 }, (_, index) =>
    say(index % 2 === 0 ? "user" : "assistant", chars, index),
  );

function createHost(settings: Partial<AppSettings> = {}) {
  const sessions = new Map<string, ChatSession>();

  const host: TaskHost = {
    getModel: () => "qwen3:8b",
    getSettings: () => ({ customInstructions: [], compactLimit: null, ...settings }) as AppSettings,
    getEnvironment: () => ({ webMode: "off", codeExecution: false, libraryReady: false }),
    getWorkspaceId: () => "default",
    getPermission: () => ({ mode: "auto" as const, grants: [] }),
    onGrant: () => {},
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
      messages[messages.length - 1] = { ...messages[messages.length - 1], ...patch };
      sessions.set(chatId, { ...session, messages });
    },
    t: (key) => key,
  };

  return { sessions, host };
}

function seed(sessions: Map<string, ChatSession>, messages: Message[]) {
  sessions.set("chat", {
    id: "chat",
    title: "chat",
    messages,
    updatedAt: 0,
    isGenerating: false,
  });
}

const lastReply = (sessions: Map<string, ChatSession>) => {
  const messages = sessions.get("chat")!.messages;
  return [...messages].reverse().find((message) => message.role === "assistant");
};

beforeEach(() => {
  turns.length = 0;
  folding.length = 0;
});

describe("a fold the user asks for", () => {
  it("finds nothing to do in a conversation that has barely started", async () => {
    const { sessions, host } = createHost();
    seed(sessions, [say("user", 10, 0), say("assistant", 10, 1)]);

    const manager = createTaskManager(host);

    await expect(manager.compact("chat")).resolves.toBe("nothing");
    expect(folding).toHaveLength(0);
  });

  it("shows a running marker under the last reply, then how much it folded", async () => {
    const { sessions, host } = createHost();
    seed(sessions, longChat(3, 400));

    const manager = createTaskManager(host);
    const outcome = manager.compact("chat");

    expect(lastReply(sessions)?.fold?.status).toBe("running");

    folding[0].resolve({ throughIndex: 4, summary: "notes", updatedAt: 1 });

    await expect(outcome).resolves.toBe("done");
    expect(lastReply(sessions)?.fold).toMatchObject({ status: "done", tokens: 400 });
    expect(sessions.get("chat")?.compaction?.summary).toBe("notes");
  });

  it("takes the marker away again when the fold fails", async () => {
    const { sessions, host } = createHost();
    seed(sessions, longChat(3, 400));

    const manager = createTaskManager(host);
    const outcome = manager.compact("chat");

    folding[0].resolve(null);

    await expect(outcome).resolves.toBe("failed");
    expect(lastReply(sessions)?.fold).toBeUndefined();
  });

  it("waits for a reply that is still being written", async () => {
    const { sessions, host } = createHost();
    seed(sessions, longChat(3, 400));

    const manager = createTaskManager(host);
    manager.send("chat", "one more thing");

    await expect(manager.compact("chat")).resolves.toBe("busy");
  });
});

describe("the fold that follows a turn", () => {
  it("starts on its own once a long conversation's turn ends", async () => {
    const { sessions, host } = createHost();
    seed(sessions, longChat());

    const manager = createTaskManager(host);
    manager.send("chat", "and then?");
    await settle();

    turns[0].resolve(finished());
    await settle();

    expect(folding).toHaveLength(1);
    expect(lastReply(sessions)?.fold?.status).toBe("running");
  });

  it("follows the user's own limit rather than the window", async () => {
    // Short enough never to fold on its own, long enough to pass a small limit.
    const { sessions, host } = createHost({ compactLimit: 2000 });
    seed(sessions, longChat(6, 2000));

    const manager = createTaskManager(host);
    manager.send("chat", "and then?");
    await settle();

    turns[0].resolve(finished());
    await settle();
    await settle();

    expect(folding).toHaveLength(1);
  });

  it("does not start when the conversation is under the limit", async () => {
    const { sessions, host } = createHost({ compactLimit: 1_000_000 });
    seed(sessions, longChat(6, 2000));

    const manager = createTaskManager(host);
    manager.send("chat", "and then?");
    await settle();

    turns[0].resolve(finished());
    await settle();
    await settle();

    expect(folding).toHaveLength(0);
  });
});

describe("sending while a fold is running", () => {
  it("says the reply is waiting on the fold, and starts once it is done", async () => {
    const { sessions, host } = createHost();
    seed(sessions, longChat(3, 400));

    const manager = createTaskManager(host);
    void manager.compact("chat");

    manager.send("chat", "next question");
    await settle();

    const waiting = sessions.get("chat")!.messages.at(-1)!;
    expect(waiting.steps?.[0]).toMatchObject({
      type: "loading",
      content: "compactingConversation",
    });
    expect(turns).toHaveLength(0);

    folding[0].resolve({ throughIndex: 4, summary: "notes", updatedAt: 1 });
    await settle();
    await settle();

    expect(turns).toHaveLength(1);
    expect(turns[0].request.compaction?.summary).toBe("notes");
    expect(sessions.get("chat")!.messages.at(-1)!.steps).toEqual([]);

    // The marker stays under the reply the fold followed.
    expect(sessions.get("chat")!.messages[5].fold?.status).toBe("done");
  });

  it("cancels the fold instead when the turn rewrites history", async () => {
    const { sessions, host } = createHost();
    seed(sessions, longChat(3, 400));

    const manager = createTaskManager(host);
    const outcome = manager.compact("chat");

    manager.regenerate("chat");

    await expect(outcome).resolves.toBe("failed");
    expect(sessions.get("chat")!.messages.some((message) => message.fold)).toBe(false);
  });
});
