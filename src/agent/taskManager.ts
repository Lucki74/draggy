import { contextSizeFor, getModelInfo, isCloudModel } from "../ollama";
import { generateId, titleFromContent } from "../utils";
import {
  CHARS_PER_TOKEN,
  compactionSurvives,
  foldedTokens,
  planCompaction,
  planManualCompaction,
  runCompaction,
} from "./compaction";
import { compactThreshold } from "./contextBreakdown";
import { runAgentTurn } from "./agentLoop";
import type { ToolEnvironment } from "../tools/registry";
import type { Grant } from "./permissions";
import type {
  ApprovalAnswer,
  AppSettings,
  Attachment,
  ChatSession,
  FoldMarker,
  Message,
  MessageVersion,
  PermissionMode,
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
  /** How much a turn may do here, and what the user has already allowed. */
  getPermission: () => { mode: PermissionMode; grants: Grant[] };
  /** A permission to keep for this workspace, beyond the task that asked. */
  onGrant: (grant: Grant) => void;
  /** A turn that ended on its own, for a conversation nobody may be watching. */
  onFinished?: (chatId: string) => void;
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
  /**
   * Let a fold already under way finish first. True when the turn only adds to
   * the conversation; a turn that rewrites history cancels the fold instead,
   * since the notes would describe messages that are no longer there.
   */
  waitForFold?: boolean;
}

/** How a fold the user asked for went. */
export type CompactOutcome = "done" | "nothing" | "busy" | "failed";

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
  /** The user's answer to a call that was waiting on them. */
  answerApproval: (approvalId: string, answer: ApprovalAnswer) => void;
  /** Folds the older conversation into notes now, rather than waiting for the limit. */
  compact: (chatId: string) => Promise<CompactOutcome>;
  stop: (chatId: string) => void;
  stopAll: () => void;
  isRunning: (chatId: string) => boolean;
  running: () => string[];
  subscribe: (listener: (running: string[]) => void) => () => void;
}

export function createTaskManager(initialHost: TaskHost): TaskManager {
  let host = initialHost;

  const runs = new Map<string, AbortController>();
  /**
   * Folds in flight. `started` flips once there is actually something being
   * folded, which is when a turn waiting on it has anything worth saying.
   */
  interface Fold {
    controller: AbortController;
    done: Promise<CompactOutcome>;
    started: boolean;
  }

  const folds = new Map<string, Fold>();
  const listeners = new Set<(running: string[]) => void>();

  /**
   * Calls waiting on the user. A turn is parked inside `runAgentTurn` until one
   * of these is answered, so stopping a conversation has to answer them too or
   * the turn never ends.
   */
  const waiting = new Map<
    string,
    { chatId: string; answer: (answer: ApprovalAnswer) => void }
  >();

  function answerApproval(approvalId: string, answer: ApprovalAnswer) {
    const pending = waiting.get(approvalId);
    if (!pending) return;

    waiting.delete(approvalId);
    pending.answer(answer);
  }

  function refuseWaiting(chatId: string) {
    for (const [id, pending] of [...waiting]) {
      if (pending.chatId !== chatId) continue;
      waiting.delete(id);
      pending.answer("no");
    }
  }

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

  /** The reply a fold's marker sits under: the last one when the fold began. */
  function lastReplyId(session: ChatSession): string | null {
    for (let index = session.messages.length - 1; index >= 0; index--) {
      if (session.messages[index].role === "assistant") return session.messages[index].id;
    }
    return null;
  }

  function markFold(chatId: string, messageId: string | null, fold: FoldMarker | null) {
    if (!messageId) return;

    host.updateSession(chatId, (s) => ({
      ...s,
      messages: s.messages.map((message) => {
        if (message.id !== messageId) return message;
        if (fold) return { ...message, fold };

        const without = { ...message };
        delete without.fold;
        return without;
      }),
    }));
  }

  /**
   * Characters the conversation may occupy before an automatic fold. The
   * user's limit when there is one, otherwise a share of the loaded window.
   */
  async function budgetFor(model: string, numCtx: number): Promise<number> {
    const limit = host.getSettings().compactLimit ?? null;

    // The model's own maximum only matters for capping a limit, so it is not
    // asked for when there is none.
    const info = limit !== null ? await getModelInfo(model).catch(() => null) : null;
    const windowTokens = info?.contextLength ?? Math.max(numCtx, limit ?? 0);

    return compactThreshold(windowTokens, numCtx, limit).tokens * CHARS_PER_TOKEN;
  }

  /**
   * Folds the older conversation into notes. On its own this happens in the
   * idle gap after a turn, paid while the user reads; `manual` is the user
   * asking for it now. A marker under the last reply says it is happening, and
   * stays once it is done.
   */
  function compactChat(chatId: string, manual: boolean): Promise<CompactOutcome> {
    const inFlight = folds.get(chatId);
    if (inFlight) return inFlight.done;

    const model = host.getModel();
    if (!model || isCloudModel(model)) return Promise.resolve("nothing");

    const session = host.getSession(chatId);
    if (!session) return Promise.resolve("nothing");
    if (session.isGenerating || runs.has(chatId)) return Promise.resolve("busy");

    const fold = {
      controller: new AbortController(),
      started: false,
    } as Fold;

    folds.set(chatId, fold);

    fold.done = (async (): Promise<CompactOutcome> => {
      const { signal } = fold.controller;
      const replyId = lastReplyId(session);
      let marked = false;

      try {
        const existing = session.compaction ?? null;

        // The window the model is already loaded at. `contextSizeFor` never
        // shrinks, so asking it here cannot cause the reload this is avoiding.
        const numCtx = contextSizeFor(model, 0, null);

        const plan = manual
          ? planManualCompaction(session.messages, existing)
          : planCompaction(session.messages, {
              existing,
              budgetChars: await budgetFor(model, numCtx),
            });

        if (!plan || signal.aborted) return "nothing";

        const tokens = foldedTokens(session.messages, plan);

        fold.started = true;
        marked = true;
        markFold(chatId, replyId, { status: "running", tokens, at: Date.now() });

        const next = await runCompaction({
          model,
          numCtx,
          messages: session.messages,
          plan,
          existing,
          signal,
        });

        if (!next || signal.aborted) {
          markFold(chatId, replyId, null);
          return "failed";
        }

        host.updateSession(chatId, (s) =>
          // The conversation can have moved on while this ran; it may not have
          // gone backwards past what was just folded.
          s.messages.length >= next.throughIndex ? { ...s, compaction: next } : s,
        );

        markFold(chatId, replyId, { status: "done", tokens, at: Date.now() });
        return "done";
      } catch {
        // Nothing is lost by a fold that failed, and it will be tried again.
        if (marked) markFold(chatId, replyId, null);
        return "failed";
      } finally {
        if (folds.get(chatId) === fold) folds.delete(chatId);
      }
    })();

    return fold.done;
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

    const pendingFold = folds.get(chatId);

    // A turn that rewrites history makes the notes being written wrong.
    if (pendingFold && !options.waitForFold) pendingFold.controller.abort();

    const controller = new AbortController();
    runs.set(chatId, controller);
    notify();

    scaffold(chatId, contextMessages, options);

    const seed = options.isContinuation ? seedFor(contextMessages) : null;

    try {
      // A turn that only adds to the conversation lets the fold finish: it
      // takes seconds, the turn gets the smaller prompt, and the model is not
      // asked to do both at once. Until then the reply says what it waits on,
      // rather than claiming the model is warming up.
      if (pendingFold && options.waitForFold) {
        if (pendingFold.started) {
          host.patchActiveMessage(chatId, {
            steps: [
              {
                id: generateId(),
                type: "loading",
                content: host.t("compactingConversation"),
                isComplete: false,
              },
            ],
          });
        }

        await pendingFold.done;
        if (controller.signal.aborted) return;

        host.patchActiveMessage(chatId, { steps: [] });
      }

      const result = await runAgentTurn(
        {
          model,
          settings: host.getSettings(),
          environment: host.getEnvironment(),
          messages: contextMessages,
          isContinuation: Boolean(options.isContinuation),
          seed,
          compaction: host.getSession(chatId)?.compaction,
          permission: host.getPermission(),
          workspaceId: host.getWorkspaceId(),
          chatId,
          signal: controller.signal,
        },
        {
          t: host.t,
          getPlan: () => host.getSession(chatId)?.plan ?? null,
          onPlan: (items) =>
            host.updateSession(chatId, (session) => ({ ...session, plan: items })),
          requestApproval: (approval) =>
            new Promise<ApprovalAnswer>((resolve) => {
              waiting.set(approval.id, { chatId, answer: resolve });
            }),
          onGrant: (grant) => host.onGrant(grant),
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
        if (!controller.signal.aborted) {
          host.onFinished?.(chatId);
          void compactChat(chatId, false);
        }
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

    void run(chatId, [...(existing?.messages || []), userMessage], {
      waitForFold: true,
    });
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
    // A turn parked on a question cannot notice the abort until the question is
    // answered, so stopping answers it.
    refuseWaiting(chatId);

    const controller = runs.get(chatId);
    if (controller) {
      controller.abort();
      runs.delete(chatId);
      notify();
    }

    folds.get(chatId)?.controller.abort();
    folds.delete(chatId);

    host.updateSession(chatId, (s) => ({ ...s, isGenerating: false }));
  }

  function stopAll() {
    for (const chatId of runs.keys()) refuseWaiting(chatId);
    for (const controller of runs.values()) controller.abort();
    runs.clear();
    for (const fold of folds.values()) fold.controller.abort();
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
    answerApproval,
    compact: (chatId: string) => compactChat(chatId, true),
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
