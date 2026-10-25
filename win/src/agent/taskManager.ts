import { CONTEXT_BUCKETS, FALLBACK_CONTEXT_LENGTH, contextSizeFor, getModelInfo, growContext, nextContextSize, windowCeiling } from "../llama";

import { isRemote } from "../ai/providers";
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
import { measureTurn, runAgentTurn } from "./agentLoop";
import type { AgentHost, ContextMeasurement, OutOfContextInfo } from "./agentLoop";
import { setLiveTurn } from "./liveTurn";
import { autoContinueWindow } from "./autoContinue";
import { defaultProjectPath, parseImageCommand } from "../images/imageCommand";
import { applyImageProgress, finishImageStep, runImageJob } from "../images/imageJob";
import { imageFailure } from "../ai/engineErrors";
import { isSlowModel } from "../slowMode";
import { logRendererError, logRendererEvent, newCorrelationId, swallowed } from "../logger";
import type { ToolEnvironment } from "../tools/registry";
import type { Grant } from "./permissions";
import type {
  ApprovalAnswer,
  UserReply,
  AppSettings,
  Attachment,
  ChatSession,
  FoldMarker,
  ImageRequest,
  ImageStepInfo,
  Message,
  MessageVersion,
  MetricRow,
  PermissionMode,
  QueuedMessage,
  SearchStep,
  TurnMetrics,
} from "../types";
import { classifyTurnError, editAt, isTransient, modelHistory, promoteShown, retryAt, switchAt } from "./turnHistory";
import { loadQueues, saveQueue } from "./turnQueue";

/** Running turns, keyed by conversation, so a turn belongs to its chat rather than the screen: it
 * keeps going elsewhere, and several can run at once. */

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
  /** Every turn is over, so nothing is still driving the Browser pane. */
  onIdle?: () => void;
  /** One model answers one chat at a time, so a second chat's message waits its turn. */
  oneTurnAtATime?: boolean;
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
    messageId?: string,
  ) => void;
  /** A finished turn, for the statistics page. Kept on this machine. */
  recordMetrics?: (row: MetricRow) => void;
  t: (key: string) => string;
}

export interface RunOptions {
  /** Replace the last reply, keeping the old one as a version. */
  isRetry?: boolean;
  /** Carry on where a reply that ran out of room stopped. */
  isContinuation?: boolean;
  /** Let a running fold finish first. Only for turns that add to the conversation; a turn that
   * rewrites history cancels it, or the notes would be wrong. */
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
  /** "/image" typed in the composer: a picture from the image engine, with no model turn. */
  image: (chatId: string, argument: string, attachments?: Attachment[]) => void;
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
  /** The user's reply to a question the model asked, or null to dismiss it. */
  answerQuestion: (questionId: string, reply: UserReply | null) => void;
  /** Folds the older conversation into notes now, rather than waiting for the limit. */
  compact: (chatId: string) => Promise<CompactOutcome>;
  /** Asks the model how many tokens the next turn would take, draft included. Null when that
   * cannot be asked without cost; `allowLoad` lets it load the model, as typing does. */
  measure: (
    chatId: string,
    draft: string,
    attachments: Attachment[],
    options: { signal: AbortSignal; allowLoad: boolean },
  ) => Promise<ContextMeasurement | null>;
  stop: (chatId: string) => void;
  stopAll: () => void;
  isRunning: (chatId: string) => boolean;
  running: () => string[];
  subscribe: (listener: (running: string[]) => void) => () => void;
  /** Holds a message until the running turn ends, then sends it; sends at once when idle. */
  enqueue: (chatId: string, content: string, attachments?: Attachment[]) => void;
  editQueued: (chatId: string, id: string, content: string) => void;
  removeQueued: (chatId: string, id: string) => void;
  moveQueued: (chatId: string, id: string, offset: number) => void;
  /** Stops the turn if one runs and sends this queued message now. */
  sendQueuedNow: (chatId: string, id: string) => void;
  /** Hands a note to the running turn at its next step; sent as a message when nothing runs. */
  steer: (chatId: string, content: string) => void;
  /** Stops the running turn and sends this in its place. */
  sendNow: (chatId: string, content: string, attachments?: Attachment[]) => void;
  queues: () => Record<string, QueuedMessage[]>;
  subscribeQueues: (listener: () => void) => () => void;
}

/** Which conversation, model and messages a measurement was for, so a turn sending exactly those
 * can start from it. */
/** How long a new turn waits for the one it replaced to let go before going ahead anyway. */
const UNWIND_WAIT_MS = 3000;
/** Quiet retries of an engine or network failure, before anything was written. */
const QUIET_RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;

const measuredFor = (model: string, messages: Message[]) => {
  const last = messages[messages.length - 1];
  const files = (last?.attachments ?? []).map((file) => `${file.name}:${file.content.length}`);
  return [model, messages.length, last?.role ?? "", last?.content ?? "", ...files].join("\n");
};

export function createTaskManager(initialHost: TaskHost): TaskManager {
  let host = initialHost;
  let lastMeasurement: { chatId: string; key: string; measurement: ContextMeasurement } | null = null;

  const runs = new Map<string, AbortController>();
  /** The newest turn per conversation, kept after a stop so its last words still land. A turn that
   * is no longer the newest writes nothing. */
  const latest = new Map<string, AbortController>();
  /** Resolves once a turn has fully unwound, so the next one does not race it for the engine. */
  const settling = new Map<string, Promise<void>>();
  /** The reply each conversation's turn writes into. */
  const turnMessage = new Map<string, string>();
  /** Notes typed while a turn ran, waiting for its next step. */
  const steers = new Map<string, string[]>();
  const queueMap = new Map<string, QueuedMessage[]>(Object.entries(loadQueues()));
  let queueSnapshot: Record<string, QueuedMessage[]> = Object.fromEntries(queueMap);
  const queueListeners = new Set<() => void>();
  const lastTurn = new Map<string, string>();
  /** Chats whose next message waits for another chat's turn to end, oldest first. The model answers
   * one chat at a time. */
  const waitingTurn: string[] = [];
  /** Folds in flight. `started` flips once there is actually something being folded, which is when
   * a turn waiting on it has anything worth saying. */
  interface Fold {
    controller: AbortController;
    done: Promise<CompactOutcome>;
    started: boolean;
  }

  const folds = new Map<string, Fold>();
  const listeners = new Set<(running: string[]) => void>();

  /** Calls waiting on the user. A turn is parked inside `runAgentTurn` until one of these is
   * answered, so stopping a conversation has to answer them too or the turn never ends. */
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

  const asking = new Map<string, { chatId: string; answer: (reply: UserReply | null) => void }>();

  function answerQuestion(questionId: string, reply: UserReply | null) {
    const pending = asking.get(questionId);
    if (!pending) return;

    asking.delete(questionId);
    pending.answer(reply);
  }

  function refuseWaiting(chatId: string) {
    for (const [id, pending] of [...asking]) {
      if (pending.chatId !== chatId) continue;
      asking.delete(id);
      pending.answer(null);
    }
    for (const [id, pending] of [...waiting]) {
      if (pending.chatId !== chatId) continue;
      waiting.delete(id);
      pending.answer("no");
    }
  }

  /** Cached rather than rebuilt per call: this is what a subscriber compares against, and a fresh
   * array every time reads as a change that never settles. */
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

  /** Characters the conversation may occupy before an automatic fold. The user's limit when there
   * is one, else a share of how far the window can grow, capped for a paid provider. */
  async function budgetFor(model: string, numCtx: number): Promise<number> {
    const settings = host.getSettings();
    const limit = settings.compactLimit ?? null;
    const info = await getModelInfo(model).catch(swallowed("chat", "model info is optional", null));
    const maxLocal = CONTEXT_BUCKETS[CONTEXT_BUCKETS.length - 1];
    const windowTokens = settings.fixedContextSize === "max"
      ? (info?.contextLength ?? FALLBACK_CONTEXT_LENGTH)
      : typeof settings.fixedContextSize === "number"
      ? settings.fixedContextSize
      : isRemote(model)
      ? windowCeiling(info?.contextLength ?? null, numCtx)
      : Math.min(maxLocal, windowCeiling(info?.contextLength ?? null, numCtx));

    return compactThreshold(windowTokens, limit, info?.cloud === true).tokens * CHARS_PER_TOKEN;

  }

  /** Folds older conversation into notes, in the idle gap after a turn or now when `manual`. A
   * marker under the last reply shows it running, then stays. */
  function compactChat(chatId: string, manual: boolean): Promise<CompactOutcome> {
    const inFlight = folds.get(chatId);
    if (inFlight) return inFlight.done;

    const model = host.getModel();
    if (!model) return Promise.resolve("nothing");

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
        // A summary pass on a model under 3 tokens per second would hold the chat for minutes.
        if (!manual && (await isSlowModel(model))) return "nothing";
        const existing = session.compaction ?? null;

        // The window the model is already loaded at. `contextSizeFor` never
        // shrinks, so asking it here cannot cause the reload this is avoiding.
        const numCtx = contextSizeFor(model, 0, null, host.getSettings().fixedContextSize);

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

  /** Writes into one message by id, so a turn never touches another reply. */
  function updateMessage(chatId: string, messageId: string, change: (message: Message) => Message) {
    host.updateSession(chatId, (s) => {
      const index = s.messages.findIndex((message) => message.id === messageId);
      if (index === -1) return s;
      const messages = s.messages.slice();
      messages[index] = change(messages[index]);
      return { ...s, messages };
    });
  }

  /** Steps left spinning by a turn that ended without finishing them. */
  function settledSteps(steps: SearchStep[] | undefined): SearchStep[] | undefined {
    return steps
      ?.filter((step) => step.isComplete || step.type !== "loading")
      .map((step) => (step.isComplete ? step : { ...step, isComplete: true }));
  }

  /** Lays out the reply a turn writes into. A retry's messages already end with its blank reply. */
  function scaffold(
    chatId: string,
    contextMessages: Message[],
    { isRetry, isContinuation }: RunOptions,
  ): { messageId: string | null; messages: Message[] } {
    let msgs: Message[];
    let messageId: string | null = null;

    if (isContinuation || isRetry) {
      msgs = [...contextMessages];
      const lastIdx = msgs.length - 1;
      if (msgs[lastIdx]?.role === "assistant") {
        // Resuming keeps the text, but the failure or stop no longer describes it.
        const {
          failed: _failed,
          error: _error,
          errorKind: _kind,
          stopped: _stopped,
          interrupted: _interrupted,
          ...resumed
        } = isContinuation ? promoteShown(msgs[lastIdx]) : msgs[lastIdx];
        msgs[lastIdx] = resumed;
        messageId = resumed.id;
      } else {
        logRendererEvent("renderer.agent", "WARN", "turn target not an assistant message", { role: msgs[lastIdx]?.role ?? "missing" });
      }
    } else {
      messageId = generateId();
      msgs = [...contextMessages, { id: messageId, role: "assistant" as const, content: "", steps: [] }];
    }

    host.updateSession(chatId, (s) => ({ ...s, isGenerating: true, messages: msgs }));
    return { messageId, messages: msgs };
  }

  /** Where a continuation picks up: the reply as it stands, steps included. */
  function seedFor(contextMessages: Message[]) {
    const lastMsg = contextMessages[contextMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return null;

    return {
      content: lastMsg.content || "",
      textContent: lastMsg.textContent || "",
      steps: lastMsg.steps ? [...lastMsg.steps] : [],
    };
  }

  function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }

  async function run(
    chatId: string,
    contextMessages: Message[],
    options: RunOptions = {},
  ) {
    const model = host.getModel();
    if (!model) return;

    runs.get(chatId)?.abort();
    const unwinding = settling.get(chatId);

    const pendingFold = folds.get(chatId);

    // A turn that rewrites history makes the notes being written wrong.
    if (pendingFold && !options.waitForFold) pendingFold.controller.abort();

    const correlationId = newCorrelationId();
    const controller = new AbortController();
    runs.set(chatId, controller);
    latest.set(chatId, controller);
    notify();

    let finishSettling = () => {};
    const settled = new Promise<void>((resolve) => {
      finishSettling = resolve;
    });
    settling.set(chatId, settled);

    const laid = scaffold(chatId, contextMessages, options);
    const messageId = laid.messageId;
    if (messageId) turnMessage.set(chatId, messageId);
    else turnMessage.delete(chatId);

    // A turn that was replaced or stopped and replaced may still be unwinding; its writes are dropped.
    const live = () => latest.get(chatId) === controller;
    const patch = (change: Partial<MessageVersion>, sessionPatch?: Partial<ChatSession>) => {
      if (live()) host.patchActiveMessage(chatId, change, sessionPatch, messageId ?? undefined);
    };

    const history = modelHistory(options.isContinuation ? laid.messages : laid.messages.slice(0, -1));
    const seed = options.isContinuation ? seedFor(laid.messages) : null;
    let failed = false;

    const wroteAnything = () => {
      const message = host.getSession(chatId)?.messages.find((m) => m.id === messageId);
      return Boolean(
        message?.content?.trim() ||
          message?.textContent?.trim() ||
          message?.steps?.some((step) => step.type !== "loading" && step.type !== "thinking"),
      );
    };

    try {
      // The turn this one replaced lets go of the engine first, or both talk to it at once.
      if (unwinding) {
        await Promise.race([unwinding, abortableDelay(UNWIND_WAIT_MS, controller.signal)]);
        if (controller.signal.aborted) return;
      }

      // An appending turn waits for the fold: it takes seconds and shrinks the prompt. Meanwhile
      // the reply says it is compacting, not that the model is warming up.
      if (pendingFold && options.waitForFold) {
        if (pendingFold.started) {
          patch({
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

        patch({ steps: [] });
      }

      // Timed from here, so a fold the turn waited on is not counted as the turn.
      const startedAt = Date.now();
      // `after` lets `npm run logs:turn` follow a continue or retry back to the turn it came from.
      const after = options.isContinuation || options.isRetry ? lastTurn.get(chatId) : undefined;
      lastTurn.set(chatId, correlationId);
      logRendererEvent("chat", "INFO", "turn sent", { chatId, model, messages: history.length, continuation: Boolean(options.isContinuation), retry: Boolean(options.isRetry), after }, correlationId);

      const request = {
        correlationId,
        model,
        settings: host.getSettings(),
        environment: host.getEnvironment(),
        messages: history,
        isContinuation: Boolean(options.isContinuation),
        seed,
        compaction: host.getSession(chatId)?.compaction,
        permission: host.getPermission(),
        workspaceId: host.getWorkspaceId(),
        chatId,
        contextBase:
          !options.isContinuation &&
          lastMeasurement?.chatId === chatId &&
          lastMeasurement.key === measuredFor(model, history)
            ? lastMeasurement.measurement
            : null,
        signal: controller.signal,
      };

      const callbacks: AgentHost = {
        t: host.t,
        getPlan: () => host.getSession(chatId)?.plan ?? null,
        onPlan: (items) => {
          if (live()) host.updateSession(chatId, (session) => ({ ...session, plan: items }));
        },
        requestAnswer: (question) =>
          new Promise<UserReply | null>((resolve) => {
            asking.set(question.id, { chatId, answer: resolve });
          }),
        requestApproval: (approval) =>
          new Promise<ApprovalAnswer>((resolve) => {
            waiting.set(approval.id, { chatId, answer: resolve });
          }),
        onGrant: (grant) => host.onGrant(grant),
        onSteps: (steps: SearchStep[]) => patch({ steps }),
        onPatch: (change) =>
          patch(
            {
              content: change.content,
              textContent: change.textContent,
              steps: change.steps,
            },
            { updatedAt: Date.now() },
          ),
        onOutOfContext: (outOfContext: boolean, info?: OutOfContextInfo) => {
          if (!live()) return;
          host.updateSession(chatId, (s) =>
            s.isOutOfContext === outOfContext && s.outOfContextInfo === info
              ? s
              : { ...s, isOutOfContext: outOfContext, outOfContextInfo: info },
          );
        },
        onMetrics: (metrics: TurnMetrics | null) => patch({ metrics }),
        onLive: (liveTurn) => {
          if (live()) setLiveTurn(chatId, liveTurn);
        },
        takeSteering: () => {
          const notes = steers.get(chatId) ?? [];
          steers.delete(chatId);
          return live() ? notes : [];
        },
      };

      let result: Awaited<ReturnType<typeof runAgentTurn>>;
      for (let attempt = 1; ; attempt++) {
        try {
          result = await runAgentTurn(request, callbacks);
          break;
        } catch (err: unknown) {
          const kind = err instanceof Error && err.name !== "AbortError" ? classifyTurnError(err.message) : null;
          // Once a tool has run, trying again would run it twice.
          if (!kind || !isTransient(kind) || attempt > QUIET_RETRIES || controller.signal.aborted || wroteAnything()) throw err;

          logRendererEvent("chat", "WARN", "turn retried", { chatId, kind, attempt }, correlationId);
          patch({
            steps: [
              {
                id: generateId(),
                type: "loading",
                content: host.t("turnRetrying").replace("{n}", String(attempt)).replace("{max}", String(QUIET_RETRIES)),
                isComplete: false,
              },
            ],
          });
          await abortableDelay(RETRY_BACKOFF_MS * attempt, controller.signal);
          patch({ steps: [] });
        }
      }

      logRendererEvent(
        "chat",
        "INFO",
        result.aborted ? "turn stopped" : "turn finished",
        { chatId, durMs: Date.now() - startedAt, loops: result.loops, exhausted: Boolean(result.exhausted) },
        correlationId,
      );

      logRendererEvent(
        "chat",
        result.aborted ? "WARN" : "INFO",
        "turn summary",
        {
          chatId,
          model: result.metrics?.model || model,
          // Providers that report no timings leave the numbers below out; this says which case it is.
          hasMetrics: Boolean(result.metrics),
          promptTokens: result.metrics?.promptTokens,
          outputTokens: result.metrics?.responseTokens,
          ttftMs: result.metrics?.timeToFirstTokenMs,
          tokensPerSecond:
            result.metrics?.responseMs && result.metrics.responseTokens
              ? Math.round((result.metrics.responseTokens / result.metrics.responseMs) * 10000) / 10
              : undefined,
          toolCalls: Object.values(result.toolCalls ?? {}).reduce((sum: number, count) => sum + Number(count), 0),
          loops: result.loops,
          aborted: Boolean(result.aborted),
          durMs: Date.now() - startedAt,
        },
        correlationId,
      );

      // A turn the user stopped is not a measurement of anything.
      if (result.metrics && !result.aborted) {
        host.recordMetrics?.({
          recordedAt: Date.now(),
          workspaceId: host.getSession(chatId)?.workspaceId ?? host.getWorkspaceId(),
          chatId,
          model: result.metrics.model || model,
          promptTokens: result.metrics.promptTokens,
          responseTokens: result.metrics.responseTokens,
          responseMs: result.metrics.responseMs,
          firstTokenMs: result.metrics.timeToFirstTokenMs,
          loadMs: result.metrics.loadMs,
          taskMs: Date.now() - startedAt,
          loops: result.loops,
          tools: result.toolCalls ?? {},
        });
      }

      // The closing text can be a fallback the stream never carried, so it is written on every finish.
      if (result.exhausted || !result.aborted) {
        patch(
          {
            steps: result.steps,
            textContent: result.textContent,
            ...(result.providerState && !result.aborted ? { provider_state: result.providerState } : {}),
          },
          { updatedAt: Date.now(), isOutOfContext: result.outOfContext },
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        failed = true;
        const errorMessage = err.message || "Error generating response.";
        const errorKind = classifyTurnError(errorMessage);
        logRendererError("chat", "turn failed", err, { chatId, model, kind: errorKind, shown: "failed assistant message" }, correlationId);

        // The reason goes in `error`, never the reply: the model would read it back as its own words.
        const fail = (message: Message): Message => {
          const steps = settledSteps(message.steps);
          const next: Message = { ...message, failed: true, error: errorMessage, errorKind };
          if (steps && steps.length > 0) next.steps = steps;
          else delete next.steps;
          return next;
        };
        if (live() && messageId) updateMessage(chatId, messageId, fail);
      }
    } finally {
      finishSettling();
      if (settling.get(chatId) === settled) settling.delete(chatId);

      if (runs.get(chatId) === controller) {
        runs.delete(chatId);
        setLiveTurn(chatId, null);
        notify();
        if (runs.size === 0 && waitingTurn.length === 0) host.onIdle?.();

        host.updateSession(chatId, (s) =>
          s.isGenerating ? { ...s, isGenerating: false } : s,
        );

        // Notes the turn ended before reading wait at the front of the queue.
        const unread = steers.get(chatId);
        if (unread && unread.length > 0) {
          steers.delete(chatId);
          setQueue(chatId, [...unread.map((content) => ({ id: generateId(), content })), ...queueOf(chatId)]);
        }

        // The user is now reading rather than waiting, which is the only
        // moment folding is free.
        const othersWaiting = waitingTurn.length > 0;
        if (!controller.signal.aborted) {
          host.onFinished?.(chatId);
          // A reply the context cut resumes at the next window up, ahead of queued messages.
          const cutSession = failed ? undefined : host.getSession(chatId);
          const cut = cutSession?.isOutOfContext ? cutSession.outOfContextInfo : undefined;
          if (cutSession && cut && model && autoContinueWindow(cut, nextContextSize(model, cut.modelMax, cut.loaded)) !== null) {
            growWindow(chatId, model, cut);
            dismissOutOfContext(chatId);
            void run(chatId, cutSession.messages, { isContinuation: true });
          } else if (othersWaiting) {
            // Another chat asked first, so this chat's own queue goes behind it.
            if (!failed && queueOf(chatId).length > 0) waitForTurn(chatId);
          } else if (failed || !dispatchNext(chatId)) void compactChat(chatId, false);
        }
        if (runs.size === 0 && othersWaiting) {
          dispatchWaiting();
          if (runs.size === 0) host.onIdle?.();
        }
      }
    }
  }

  /** Sends the first queued message, if any. */
  function dispatchNext(chatId: string): boolean {
    const [next, ...rest] = queueOf(chatId);
    if (!next) return false;
    setQueue(chatId, rest);
    send(chatId, next.content, next.attachments);
    return true;
  }

  function waitForTurn(chatId: string) {
    if (!waitingTurn.includes(chatId)) waitingTurn.push(chatId);
  }

  /** Hands the model to the chat that has waited longest and still has something queued. */
  function dispatchWaiting() {
    while (waitingTurn.length > 0) {
      if (dispatchNext(waitingTurn.shift()!)) return;
    }
  }

  /** A new message from the user. While another chat's turn runs it waits in this chat's queue. */
  function send(chatId: string, content: string, attachments?: Attachment[]) {
    if (host.oneTurnAtATime && runs.size > 0 && !runs.has(chatId)) {
      setQueue(chatId, [...queueOf(chatId), { id: generateId(), content, attachments }]);
      waitForTurn(chatId);
      return;
    }
    deliver(chatId, content, attachments);
  }

  /** Starts the turn, and the conversation if this is its first message. */
  function deliver(chatId: string, content: string, attachments?: Attachment[]) {
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

  function queueOf(chatId: string): QueuedMessage[] {
    return queueMap.get(chatId) ?? [];
  }

  function setQueue(chatId: string, queue: QueuedMessage[]) {
    if (queue.length === 0) queueMap.delete(chatId);
    else queueMap.set(chatId, queue);
    saveQueue(chatId, queue);
    queueSnapshot = Object.fromEntries(queueMap);
    for (const listener of [...queueListeners]) listener();
  }

  function enqueue(chatId: string, content: string, attachments?: Attachment[]) {
    if (!content.trim() && !(attachments && attachments.length > 0)) return;
    if (!runs.has(chatId)) {
      send(chatId, content, attachments);
      return;
    }
    setQueue(chatId, [...queueOf(chatId), { id: generateId(), content, attachments }]);
  }

  function editQueued(chatId: string, id: string, content: string) {
    setQueue(chatId, queueOf(chatId).map((item) => (item.id === id ? { ...item, content } : item)));
  }

  function removeQueued(chatId: string, id: string) {
    setQueue(chatId, queueOf(chatId).filter((item) => item.id !== id));
  }

  function moveQueued(chatId: string, id: string, offset: number) {
    const queue = queueOf(chatId).slice();
    const from = queue.findIndex((item) => item.id === id);
    const to = from + offset;
    if (from === -1 || to < 0 || to >= queue.length) return;
    const [item] = queue.splice(from, 1);
    queue.splice(to, 0, item);
    setQueue(chatId, queue);
  }

  function sendNow(chatId: string, content: string, attachments?: Attachment[]) {
    if (runs.has(chatId)) stop(chatId);
    send(chatId, content, attachments);
  }

  function sendQueuedNow(chatId: string, id: string) {
    const item = queueOf(chatId).find((queued) => queued.id === id);
    if (!item) return;
    removeQueued(chatId, id);
    sendNow(chatId, item.content, item.attachments);
  }

  function steer(chatId: string, content: string) {
    if (!content.trim()) return;
    if (!runs.has(chatId) || !turnMessage.has(chatId)) {
      enqueue(chatId, content);
      return;
    }
    steers.set(chatId, [...(steers.get(chatId) ?? []), content]);
    logRendererEvent("chat", "INFO", "turn steered", { chatId, chars: content.length });
  }

  /** The data URL of an attached picture, whichever way the attachment carried it. */
  function attachedImage(attachments?: Attachment[]): string | null {
    const picture = attachments?.find((file) => file.type.startsWith("image/"));
    if (!picture?.content) return null;
    return picture.content.startsWith("data:") ? picture.content : `data:${picture.type};base64,${picture.content}`;
  }

  function image(chatId: string, argument: string, attachments?: Attachment[]) {
    const existing = host.getSession(chatId);
    const parsed = parseImageCommand(argument);
    const typed = `/image ${argument}`.trim();
    const userMessage: Message = { id: generateId(), role: "user", content: typed, attachments };

    if (!existing) {
      host.addSession({
        id: chatId,
        workspaceId: host.getWorkspaceId(),
        title: titleFromContent("error" in parsed ? typed : parsed.prompt, host.t("newDiscussion")),
        messages: [],
        updatedAt: Date.now(),
        isGenerating: false,
      });
    }

    if ("error" in parsed) {
      const reply = parsed.error === "empty"
        ? host.t("imageCommandEmpty")
        : host.t("imageCommandBadFlag").replace("{flag}", parsed.flag);
      host.updateSession(chatId, (s) => ({
        ...s,
        updatedAt: Date.now(),
        messages: [...s.messages, userMessage, { id: generateId(), role: "assistant", content: reply }],
      }));
      return;
    }

    runs.get(chatId)?.abort();
    const controller = new AbortController();
    runs.set(chatId, controller);
    latest.set(chatId, controller);
    turnMessage.delete(chatId);
    notify();

    const replyId = generateId();
    const live = () => latest.get(chatId) === controller;
    const inProject = Boolean(host.getEnvironment().hasFolder);
    const workspaceId = host.getWorkspaceId();
    const requestId = generateId();
    let info: ImageStepInfo = {
      prompt: parsed.prompt,
      status: "loading-model",
      requestId,
      workspaceId: inProject ? workspaceId : undefined,
      width: parsed.width,
      height: parsed.height,
      startedAt: Date.now(),
    };
    const stepId = generateId();
    const stepOf = (current: ImageStepInfo): SearchStep => ({
      id: stepId,
      type: "image",
      content: current.prompt,
      isComplete: !["loading-model", "queued", "generating"].includes(current.status),
      image: current,
    });

    host.updateSession(chatId, (s) => ({
      ...s,
      isGenerating: true,
      updatedAt: Date.now(),
      messages: [...s.messages, userMessage, { id: replyId, role: "assistant", content: "", steps: [stepOf(info)] }],
    }));

    const init = parsed.from && inProject
      ? { kind: "project" as const, workspaceId, path: parsed.from }
      : attachedImage(attachments)
        ? { kind: "attachment" as const, dataUrl: attachedImage(attachments) as string }
        : undefined;

    const request: ImageRequest = {
      requestId,
      prompt: parsed.prompt,
      negativePrompt: parsed.negative,
      width: parsed.width,
      height: parsed.height,
      steps: parsed.steps,
      seed: parsed.seed,
      strength: parsed.strength,
      hires: parsed.hires,
      lora: parsed.lora,
      init,
      destination: inProject
        ? { kind: "project", workspaceId, path: parsed.to || defaultProjectPath(parsed.prompt), chatId, overwrite: parsed.overwrite }
        : { kind: "chat" },
    };

    void (async () => {
      try {
        const result = await runImageJob(request, {
          signal: controller.signal,
          onProgress: (progress) => {
            info = applyImageProgress(info, progress);
            if (live()) host.patchActiveMessage(chatId, { steps: [stepOf(info)] }, undefined, replyId);
          },
        });
        info = finishImageStep(info, result, inProject ? "project" : "created", (failed) => imageFailure(failed, { markdown: true }));
        const reply = result.success
          ? host.t("imageReply").replace("{file}", result.filename || "")
          : "";
        if (live()) host.patchActiveMessage(chatId, { steps: [stepOf(info)], content: reply }, { updatedAt: Date.now() }, replyId);
      } catch (err: unknown) {
        // A job that threw would otherwise leave its card spinning for good.
        const aborted = err instanceof Error && err.name === "AbortError";
        if (!aborted) logRendererError("chat", "image job failed", err, { chatId }, requestId);
        info = { ...info, status: aborted ? "cancelled" : "error" };
        const message = err instanceof Error ? err.message : String(err);
        if (live()) {
          host.patchActiveMessage(
            chatId,
            { steps: [stepOf(info)], ...(aborted ? {} : { failed: true, error: message, errorKind: classifyTurnError(message) }) },
            { updatedAt: Date.now() },
            replyId,
          );
        }
      } finally {
        if (runs.get(chatId) === controller) {
          runs.delete(chatId);
          notify();
          host.updateSession(chatId, (s) => (s.isGenerating ? { ...s, isGenerating: false } : s));
          if (runs.size === 0) dispatchWaiting();
        }
      }
    })();
  }

  function regenerate(chatId: string, index?: number) {
    const session = host.getSession(chatId);
    if (!session) return;

    const at = typeof index === "number" && index >= 0 ? index : session.messages.length - 1;
    const before = session.messages.slice(0, at);

    // A picture asked for with /image is drawn again, not handed to the chat model as text.
    const asked = before[before.length - 1];
    if (asked?.role === "user" && asked.content.startsWith("/image ")) {
      host.updateSession(chatId, (s) => ({ ...s, messages: before.slice(0, -1) }));
      image(chatId, asked.content.slice("/image ".length).trim(), asked.attachments);
      return;
    }

    // A question that never got its reply is simply asked again.
    if (at === session.messages.length - 1 && session.messages[at]?.role === "user") {
      void run(chatId, session.messages, {});
      return;
    }

    const next = retryAt(session.messages, at);
    if (!next) {
      logRendererEvent("renderer.agent", "WARN", "retry target not an assistant message", { index: at, role: session.messages[at]?.role ?? "missing" });
      return;
    }

    // Regenerating inside the folded range rewrites history the notes claim
    // to describe, so they have to go.
    const survived = compactionSurvives(
      session.compaction,
      before,
      typeof index === "number" ? index : undefined,
    );
    if (survived !== session.compaction) {
      host.updateSession(chatId, (s) => ({ ...s, compaction: survived }));
    }

    void run(chatId, next, { isRetry: true });
  }

  function editMessage(chatId: string, messageIndex: number, content: string) {
    const session = host.getSession(chatId);
    if (!session) return;

    const msgs = editAt(session.messages, messageIndex, content);
    if (!msgs) {
      logRendererEvent("renderer.agent", "WARN", "edit target not a user message", { index: messageIndex, role: session.messages[messageIndex]?.role ?? "missing" });
      return;
    }

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
    // Swapping an earlier branch would take the reply being written off screen mid-turn.
    const session = host.getSession(chatId);
    if (runs.has(chatId) && session && messageIndex < session.messages.length - 1) {
      logRendererEvent("renderer.agent", "WARN", "version switch refused during a turn", { index: messageIndex });
      return;
    }

    host.updateSession(chatId, (s) => {
      const msgs = switchAt(s.messages, messageIndex, versionIndex);
      if (msgs === s.messages) return s;
      return { ...s, messages: msgs, compaction: compactionSurvives(s.compaction, msgs, messageIndex) };
    });
  }

  /** Raises the window the next load uses, so the cut reply is not cut again at the same size. */
  function growWindow(chatId: string, model: string, cut: OutOfContextInfo) {
    const grown = growContext(model, cut.modelMax, cut.loaded);
    logRendererEvent("chat", "INFO", "context grown to continue", { chatId, from: cut.loaded, to: grown, max: cut.modelMax });
  }

  function dismissOutOfContext(chatId: string) {
    host.updateSession(chatId, (s) => ({ ...s, isOutOfContext: false, outOfContextInfo: undefined }));
  }

  function continueGeneration(chatId: string) {
    const session = host.getSession(chatId);
    if (!session) return;

    // The same window would cut the reply again, so the next load goes one size up.
    const cut = session.outOfContextInfo;
    const model = host.getModel();
    if (cut?.canGrow && model) growWindow(chatId, model, cut);
    dismissOutOfContext(chatId);
    void run(chatId, session.messages, { isContinuation: true });
  }

  async function measure(
    chatId: string,
    draft: string,
    attachments: Attachment[],
    options: { signal: AbortSignal; allowLoad: boolean },
  ): Promise<ContextMeasurement | null> {
    const model = host.getModel();
    const session = host.getSession(chatId);
    if (!model || runs.has(chatId)) return null;

    const messages: Message[] = modelHistory(session?.messages ?? []);
    if (draft.trim() || attachments.length > 0) {
      messages.push({ id: "draft", role: "user", content: draft, attachments });
    }

    const measurement = await measureTurn(
      {
        model,
        settings: host.getSettings(),
        environment: host.getEnvironment(),
        messages,
        compaction: session?.compaction,
        workspaceId: session?.workspaceId ?? host.getWorkspaceId(),
      },
      options,
    );

    if (measurement) lastMeasurement = { chatId, key: measuredFor(model, messages), measurement };
    return measurement;
  }

  function stop(chatId: string) {
    // A turn parked on a question cannot notice the abort until the question is
    // answered, so stopping answers it.
    refuseWaiting(chatId);
    steers.delete(chatId);

    const controller = runs.get(chatId);
    if (controller) {
      controller.abort();
      runs.delete(chatId);
      setLiveTurn(chatId, null);
      notify();
      if (runs.size === 0) dispatchWaiting();
      if (runs.size === 0) host.onIdle?.();

      // What it wrote stays, marked as stopped, so it can be carried on.
      const messageId = turnMessage.get(chatId);
      if (messageId) {
        updateMessage(chatId, messageId, (message) => {
          const steps = settledSteps(message.steps);
          return { ...message, stopped: true, ...(steps ? { steps } : {}) };
        });
      }
    }

    folds.get(chatId)?.controller.abort();
    folds.delete(chatId);

    host.updateSession(chatId, (s) => ({ ...s, isGenerating: false }));
  }

  function stopAll() {
    for (const chatId of runs.keys()) refuseWaiting(chatId);
    for (const controller of runs.values()) controller.abort();
    for (const chatId of runs.keys()) setLiveTurn(chatId, null);
    const hadRuns = runs.size > 0;
    runs.clear();
    if (hadRuns) host.onIdle?.();
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
    image,
    regenerate,
    editMessage,
    switchVersion,
    continueGeneration,
    dismissOutOfContext,
    answerApproval,
    answerQuestion,
    compact: (chatId: string) => compactChat(chatId, true),
    measure,
    stop,
    stopAll,
    enqueue,
    editQueued,
    removeQueued,
    moveQueued,
    sendQueuedNow,
    steer,
    sendNow,
    queues: () => queueSnapshot,
    subscribeQueues: (listener: () => void) => {
      queueListeners.add(listener);
      return () => {
        queueListeners.delete(listener);
      };
    },
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
