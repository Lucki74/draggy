import { contextSizeFor, isCloudModel } from "../ollama";
import { generateId, titleFromContent } from "../utils";
import {
  budgetForWindow,
  compactionSurvives,
  planCompaction,
  runCompaction,
} from "./compaction";
import { runAgentTurn } from "./agentLoop";
import type { ToolEnvironment } from "../tools/registry";
import type {
  AppSettings,
  Attachment,
  ChatSession,
  Message,
  MessageVersion,
  SearchStep,
  TurnMetrics,
} from "../types";

/**
 * Running turns, keyed by conversation. Pulled out of the component so a run
 * belongs to a chat rather than to whatever is on screen: a turn keeps going
 * when the user looks at something else, and more than one can be in flight.
 */

/** What the manager needs from the app around it. No React in here. */
export interface TaskHost {
  getModel: () => string | null;
  getSettings: () => AppSettings;
  getEnvironment: () => ToolEnvironment;
  /** The workspace a conversation started now belongs to. */
  getWorkspaceId: () => string;
  getSession: (chatId: string) => ChatSession | undefined;
  addSession: (session: ChatSession) => void;
  updateSession: (
    chatId: string,
    updater: (session: ChatSession) => ChatSession,
  ) => void;
  patchActiveMessage: (
    chatId: string,
    patch: Partial<MessageVersion>,
    sessionPatch?: Partial<ChatSession>,
  ) => void;
  t: (key: string) => string;
}

export interface RunOptions {
  /** Replace the last reply, keeping the old one as a version. */
  isRetry?: boolean;
  /** Carry on where a reply that ran out of room stopped. */
  isContinuation?: boolean;
}

export interface TaskManager {
  /** Point the manager at the current app state. Called after every render. */
  configure: (host: TaskHost) => void;
  run: (
    chatId: string,
    contextMessages: Message[],
    options?: RunOptions,
  ) => Promise<void>;
  send: (chatId: string, content: string, attachments?: Attachment[]) => void;
  regenerate: (chatId: string, index?: number) => void;
  editMessage: (
    chatId: string,
    messageIndex: number,
    content: string,
  ) => void;
  switchVersion: (
    chatId: string,
    messageIndex: number,
    versionIndex: number,
  ) => void;
  continueGeneration: (chatId: string) => void;
  dismissOutOfContext: (chatId: string) => void;
  stop: (chatId: string) => void;
  stopAll: () => void;
  isRunning: (chatId: string) => boolean;
  running: () => string[];
  subscribe: (listener: (running: string[]) => void) => () => void;
}

export function createTaskManager(initialHost: TaskHost): TaskManager {
  let host = initialHost;

  const runs = new Map<string, AbortController>();
  const folds = new Map<string, AbortController>();
  const listeners = new Set<(running: string[]) => void>();

  /**
   * Cached rather than rebuilt per call: this is what a subscriber compares
   * against, and a fresh array every time reads as a change that never settles.
   */
  let snapshot: string[] = [];

  const running = () => snapshot;

  function notify() {
    snapshot = [...runs.keys()];
    for (const listener of [...listeners]) listener(snapshot);
  }

  /**
   * Folds the older conversation into notes in the idle gap, paid while the
   * user reads. Cancelled on send, and tried again after the next turn.
   */
  async function maybeCompact(chatId: string) {
    const model = host.getModel();
    if (!model || isCloudModel(model)) return;

    const session = host.getSession(chatId);
    if (!session || session.isGenerating) return;

    const existing = session.compaction ?? null;

    // The window the model is already loaded at. `contextSizeFor` never
    // shrinks, so asking it here cannot cause the reload this is avoiding.
    const numCtx = contextSizeFor(model, 0, null);

    const plan = planCompaction(session.messages, {
      existing,
      budgetChars: budgetForWindow(numCtx),
    });
    if (!plan) return;

    folds.get(chatId)?.abort();
    const controller = new AbortController();
    folds.set(chatId, controller);

    try {
      const next = await runCompaction({
        model,
        numCtx,
        messages: session.messages,
        plan,
        existing,
        signal: controller.signal,
      });

      if (!next || controller.signal.aborted) return;

      host.updateSession(chatId, (s) =>
        // The conversation can have moved on while this ran; it may not have
        // gone backwards past what was just folded.
        s.messages.length >= next.throughIndex ? { ...s, compaction: next } : s,
      );
    } catch {
      // Nothing is lost by a fold that failed, and it will be tried again.
    } finally {
      if (folds.get(chatId) === controller) folds.delete(chatId);
    }
  }

  function scaffold(
    chatId: string,
    contextMessages: Message[],
    { isRetry, isContinuation }: RunOptions,
  ) {
    host.updateSession(chatId, (s) => {
      let msgs: Message[];

      if (isContinuation) {
        msgs = [...contextMessages];
      } else if (isRetry) {
        msgs = [...s.messages];
        const lastIdx = msgs.length - 1;
        const lastMsg = { ...msgs[lastIdx] };

        if (lastMsg.role === "assistant") {
          const oldVersion: MessageVersion = {
            content: lastMsg.content,
            thinkingContent: lastMsg.thinkingContent,
            textContent: lastMsg.textContent,
            thoughtTime: lastMsg.thoughtTime,
            steps: lastMsg.steps,
            metrics: lastMsg.metrics,
          };
          lastMsg.versions = [...(lastMsg.versions || []), oldVersion];
          lastMsg.currentVersionIndex = lastMsg.versions.length;
          lastMsg.content = "";
          lastMsg.thinkingContent = null;
          lastMsg.textContent = "";
          lastMsg.thoughtTime = undefined;
          lastMsg.steps = [];
          lastMsg.metrics = null;
          msgs[lastIdx] = lastMsg;
        }
      } else {
        msgs = [
          ...contextMessages,
          {
            id: generateId(),
            role: "assistant" as const,
            content: "",
            steps: [],
          },
        ];
      }

      return { ...s, isGenerating: true, messages: msgs };
    });
  }

  /** Where a continuation picks up: the reply as it stands, steps included. */
  function seedFor(contextMessages: Message[]) {
    const lastMsg = contextMessages[contextMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return null;

    const target =
      lastMsg.versions &&
      lastMsg.currentVersionIndex !== undefined &&
      lastMsg.currentVersionIndex < lastMsg.versions.length
        ? lastMsg.versions[lastMsg.currentVersionIndex]
        : lastMsg;

    return {
      content: target.content || "",
      textContent: target.textContent || "",
      steps: target.steps ? [...target.steps] : [],
    };
  }

  async function run(
    chatId: string,
    contextMessages: Message[],
    options: RunOptions = {},
  ) {
    const model = host.getModel();
    if (!model) return;

    runs.get(chatId)?.abort();
    // A fold in flight is now competing with the reply the user is waiting
    // for, on the same model.
    folds.get(chatId)?.abort();

    const controller = new AbortController();
    runs.set(chatId, controller);
    notify();

    scaffold(chatId, contextMessages, options);

    const seed = options.isContinuation ? seedFor(contextMessages) : null;

    try {
      const result = await runAgentTurn(
        {
          model,
          settings: host.getSettings(),
          environment: host.getEnvironment(),
          messages: contextMessages,
          isContinuation: Boolean(options.isContinuation),
          seed,
          compaction: host.getSession(chatId)?.compaction,
          signal: controller.signal,
        },
        {
          t: host.t,
          onSteps: (steps: SearchStep[]) =>
            host.patchActiveMessage(chatId, { steps }),
          onPatch: (patch) =>
            host.patchActiveMessage(
              chatId,
              {
                content: patch.content,
                textContent: patch.textContent,
                steps: patch.steps,
              },
              { updatedAt: Date.now() },
            ),
          onOutOfContext: (outOfContext: boolean) =>
            host.updateSession(chatId, (s) =>
              s.isOutOfContext === outOfContext
                ? s
                : { ...s, isOutOfContext: outOfContext },
            ),
          onMetrics: (metrics: TurnMetrics | null) =>
            host.patchActiveMessage(chatId, { metrics }),
        },
      );

      if (result.exhausted) {
        host.patchActiveMessage(
          chatId,
          { steps: result.steps, textContent: result.textContent },
          { updatedAt: Date.now(), isOutOfContext: result.outOfContext },
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        host.updateSession(chatId, (s) => ({
          ...s,
          messages: [
            ...s.messages.slice(0, -1),
            {
              id: generateId(),
              role: "assistant",
              content: err.message || "Error generating response.",
            },
          ],
        }));
      }
    } finally {
      if (runs.get(chatId) === controller) {
        runs.delete(chatId);
        notify();

        host.updateSession(chatId, (s) =>
          s.isGenerating ? { ...s, isGenerating: false } : s,
        );

        // The user is now reading rather than waiting, which is the only
        // moment folding is free.
        if (!controller.signal.aborted) void maybeCompact(chatId);
      }
    }
  }

  /** A new message from the user, starting the conversation if it is the first. */
  function send(chatId: string, content: string, attachments?: Attachment[]) {
    const existing = host.getSession(chatId);

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content,
      attachments,
    };

    if (!existing) {
      host.addSession({
        id: chatId,
        workspaceId: host.getWorkspaceId(),
        title: content.trim()
          ? titleFromContent(content, host.t("newDiscussion"))
          : attachments && attachments.length > 0
            ? host.t("attachedFiles")
            : host.t("newDiscussion"),
        messages: [],
        updatedAt: Date.now(),
        isGenerating: false,
      });
    }

    void run(chatId, [...(existing?.messages || []), userMessage]);
  }

  function regenerate(chatId: string, index?: number) {
    const session = host.getSession(chatId);
    if (!session) return;

    const targetMessages =
      typeof index === "number" && index >= 0
        ? session.messages.slice(0, index)
        : session.messages.slice(0, -1);

    // Regenerating inside the folded range rewrites history the notes claim
    // to describe, so they have to go.
    const survived = compactionSurvives(
      session.compaction,
      targetMessages,
      typeof index === "number" ? index : undefined,
    );
    if (survived !== session.compaction) {
      host.updateSession(chatId, (s) => ({ ...s, compaction: survived }));
    }

    void run(chatId, targetMessages, { isRetry: true });
  }

  function editMessage(chatId: string, messageIndex: number, content: string) {
    const session = host.getSession(chatId);
    if (!session) return;

    const targetMsg = session.messages[messageIndex];
    if (!targetMsg || targetMsg.role !== "user") return;

    const versions: MessageVersion[] = [
      ...(targetMsg.versions || []),
      { content: targetMsg.content },
    ];

    const msgs = session.messages.slice(0, messageIndex);
    msgs.push({
      ...targetMsg,
      content,
      versions,
      currentVersionIndex: versions.length,
    });

    host.updateSession(chatId, (s) => ({
      ...s,
      messages: msgs,
      compaction: compactionSurvives(s.compaction, msgs, messageIndex),
    }));

    void run(chatId, msgs);
  }

  function switchVersion(
    chatId: string,
    messageIndex: number,
    versionIndex: number,
  ) {
    host.updateSession(chatId, (s) => {
      const msgs = [...s.messages];
      if (msgs[messageIndex]) {
        msgs[messageIndex] = {
          ...msgs[messageIndex],
          currentVersionIndex: versionIndex,
        };
      }
      return { ...s, messages: msgs };
    });
  }

  function dismissOutOfContext(chatId: string) {
    host.updateSession(chatId, (s) => ({ ...s, isOutOfContext: false }));
  }

  function continueGeneration(chatId: string) {
    const session = host.getSession(chatId);
    if (!session) return;

    dismissOutOfContext(chatId);
    void run(chatId, session.messages, { isContinuation: true });
  }

  function stop(chatId: string) {
    const controller = runs.get(chatId);
    if (controller) {
      controller.abort();
      runs.delete(chatId);
      notify();
    }

    folds.get(chatId)?.abort();
    folds.delete(chatId);

    host.updateSession(chatId, (s) => ({ ...s, isGenerating: false }));
  }

  function stopAll() {
    for (const controller of runs.values()) controller.abort();
    runs.clear();
    for (const controller of folds.values()) controller.abort();
    folds.clear();
    notify();
  }

  return {
    configure: (next: TaskHost) => {
      host = next;
    },
    run,
    send,
    regenerate,
    editMessage,
    switchVersion,
    continueGeneration,
    dismissOutOfContext,
    stop,
    stopAll,
    isRunning: (chatId: string) => runs.has(chatId),
    running,
    subscribe: (listener: (ids: string[]) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
