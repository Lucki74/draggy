import type { BackgroundTask, TaskEvent } from "../types";
import { logSwallow } from "../logger";

/** Background tasks as the UI sees them: every chat's tasks, kept current by the events the main
 * process sends. The tail is only what the Tasks view needs for a preview; the full output stays in
 * the main process and is read with task_output. */

const MAX_TAIL_CHARS = 4000;

interface TaskState {
  tasks: BackgroundTask[];
  tails: Record<string, string>;
}

let state: TaskState = { tasks: [], tails: {} };
const listeners = new Set<() => void>();
let started = false;
let unsubscribe: (() => void) | null = null;

const publish = (next: TaskState) => {
  state = next;
  for (const listener of listeners) listener();
};

const upsert = (tasks: BackgroundTask[], task: BackgroundTask) =>
  tasks.some((one) => one.uid === task.uid) ? tasks.map((one) => (one.uid === task.uid ? task : one)) : [...tasks, task];

export function applyTaskEvent(event: TaskEvent): void {
  if (event.type === "output") {
    const tail = ((state.tails[event.uid] ?? "") + event.chunk).slice(-MAX_TAIL_CHARS);
    publish({ ...state, tails: { ...state.tails, [event.uid]: tail } });
    return;
  }
  publish({ ...state, tasks: upsert(state.tasks, event.task) });
}

/** Starts listening, and loads what a chat already has running (the window may have reloaded). */
export function watchTasks(chatId?: string): void {
  const api = window.electronAPI?.tasks;
  if (!api) return;
  if (!started) {
    started = true;
    unsubscribe = api.onEvent(applyTaskEvent);
  }
  if (!chatId) return;
  void api
    .list(chatId)
    .then((result) => {
      for (const task of result.tasks ?? []) publish({ ...state, tasks: upsert(state.tasks, task) });
    })
    .catch((error) => logSwallow("tasks", error, "the list is filled by the next event"));
}

export function stopWatchingTasks(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
}

export const subscribeTasks = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const taskSnapshot = () => state;

export const tasksOfChat = (chatId: string | undefined) =>
  chatId ? state.tasks.filter((task) => task.chatId === chatId) : [];

export const runningOf = (tasks: BackgroundTask[]) => tasks.filter((task) => task.status === "running");

/** Failed tasks the person has not looked at yet. */
const seen = new Set<string>();

export const failedOf = (tasks: BackgroundTask[]) => tasks.filter((task) => task.status === "failed" && !seen.has(task.uid));

/** Marks a chat's failed tasks as looked at, so the chip stops showing them. */
export function acknowledgeFailed(chatId: string): void {
  for (const task of state.tasks) if (task.chatId === chatId && task.status === "failed") seen.add(task.uid);
  publish({ ...state });
}

/** Drops a chat's tasks when the chat is deleted. */
export function forgetChatTasks(chatId: string): void {
  publish({
    tasks: state.tasks.filter((task) => task.chatId !== chatId),
    tails: Object.fromEntries(
      Object.entries(state.tails).filter(([uid]) => !uid.startsWith(`${chatId}/`)),
    ),
  });
  void window.electronAPI?.tasks?.forget(chatId).catch((error) => logSwallow("tasks", error, "the main process drops them when the app quits"));
  void window.electronAPI?.commands?.resetState(chatId).catch((error) => logSwallow("tasks", error, "the saved folder is dropped when the app quits"));
}

export function resetTaskStore(): void {
  stopWatchingTasks();
  state = { tasks: [], tails: {} };
  seen.clear();
}

/** Commands running in the foreground right now, newest last, so a shortcut can send the latest away. */
const foreground: string[] = [];

export const markForeground = (runId: string) => void foreground.push(runId);

export const unmarkForeground = (runId: string) => {
  const at = foreground.indexOf(runId);
  if (at >= 0) foreground.splice(at, 1);
};

export const latestForeground = () => foreground[foreground.length - 1] ?? null;
