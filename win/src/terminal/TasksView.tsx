import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BackgroundTask } from "../types";
import { subscribeTasks, taskSnapshot } from "../tasks/taskStore";
import { Icon } from "../ui/icons/Icon";
import { createTerminalView, type TerminalView } from "./xtermView";

interface TasksViewProps {
  t: (key: string) => string;
}

const STATUS_KEYS: Record<BackgroundTask["status"], string> = {
  running: "taskStatusRunning",
  exited: "taskStatusDone",
  failed: "taskStatusFailed",
  stopped: "taskStatusStopped",
};

function elapsed(task: BackgroundTask, now: number): string {
  const total = Math.max(0, Math.round(((task.endedAt ?? now) - task.startedAt) / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}m ${total % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The terminal on a task you attached to: what it printed so far, then what it prints now, and the
 * keys you press go to the task. Closing it leaves the task running. */
function AttachedTask({ task, t, onBack }: { task: BackgroundTask; t: (key: string) => string; onBack: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const api = window.electronAPI?.tasks;
    if (!host || !api) return;
    let view: TerminalView | null = null;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let observer: ResizeObserver | undefined;

    void createTerminalView(host, {
      onInput: (data) => api.input(task.chatId, task.id, data),
      onLink: (uri) => void window.open(uri, "_blank"),
    }).then(async (created) => {
      if (disposed) {
        created.dispose();
        return;
      }
      view = created;
      const fitted = created.fit();
      if (fitted) void api.resize(task.uid, fitted.cols, fitted.rows);
      const snapshot = await api.snapshot(task.uid);
      if (snapshot.data) created.write(snapshot.data);
      unsubscribe = api.onEvent((event) => {
        if (event.type === "output" && event.uid === task.uid) created.write(event.chunk);
      });
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          const size = created.fit();
          if (size) void api.resize(task.uid, size.cols, size.rows);
        });
        observer.observe(host);
      }
      created.focus();
    });

    return () => {
      disposed = true;
      unsubscribe?.();
      observer?.disconnect();
      view?.dispose();
      host.replaceChildren();
    };
  }, [task.uid, task.chatId, task.id]);

  return (
    <div className="terminal-pane">
      <div className="terminal-tasks-head">
        <button type="button" className="terminal-tasks-action" onClick={onBack}>
          <Icon name="x" size={14} />
          <span>{t("detachTask")}</span>
        </button>
        <code className="terminal-agent-command">{task.command}</code>
      </div>
      <div ref={hostRef} className="terminal-body" data-terminal-body />
    </div>
  );
}

/** The tasks that keep running in the background, from every chat, with a live preview of each. */
export default function TasksView({ t }: TasksViewProps) {
  const { tasks, tails } = useSyncExternalStore(subscribeTasks, taskSnapshot);
  const [attached, setAttached] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const anyRunning = tasks.some((task) => task.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning]);

  const attachedTask = attached ? tasks.find((task) => task.uid === attached) : undefined;
  if (attachedTask) return <AttachedTask task={attachedTask} t={t} onBack={() => setAttached(null)} />;

  const ordered = [...tasks].sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.startedAt - a.startedAt);

  if (ordered.length === 0) {
    return (
      <div className="terminal-pane">
        <p className="terminal-tasks-empty">{t("noTasks")}</p>
      </div>
    );
  }

  return (
    <div className="terminal-pane">
      <ul className="terminal-tasks" aria-label={t("tasksTab")}>
        {ordered.map((task) => {
          const preview = (tails[task.uid] ?? "").trim().split("\n").slice(-3).join("\n") || task.lastLine;
          return (
            <li key={task.uid} className="terminal-task" data-status={task.status}>
              <div className="terminal-task-row">
                <span className="terminal-task-id">{task.id}</span>
                <code className="terminal-agent-command">{task.command}</code>
                <span className="terminal-agent-status">
                  {t(STATUS_KEYS[task.status])} · {elapsed(task, now)}
                </span>
              </div>
              {preview ? <pre className="terminal-agent-output">{preview}</pre> : null}
              {task.status === "running" ? (
                <div className="terminal-task-actions">
                  {task.canInput ? (
                    <button type="button" className="terminal-tasks-action" onClick={() => setAttached(task.uid)}>
                      <Icon name="terminal-window" size={14} />
                      <span>{t("attachTask")}</span>
                    </button>
                  ) : null}
                  <button type="button" className="terminal-tasks-action" onClick={() => void window.electronAPI?.tasks?.stop(task.chatId, task.id)}>
                    <Icon name="stop" size={14} />
                    <span>{t("stopTask")}</span>
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
