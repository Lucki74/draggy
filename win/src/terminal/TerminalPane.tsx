import { useEffect, useRef, useSyncExternalStore } from "react";
import { subscribeTasks, taskSnapshot } from "../tasks/taskStore";
import { agentBlocks, currentTerminalView, setTerminalView, subscribeAgentBlocks, subscribeTerminalView } from "./terminalBus";
import TasksView from "./TasksView";
import { allSessions, fitSession, focusSession, subscribeSessions } from "./terminalSessions";

interface TerminalPaneProps {
  /** The shell this dock tab shows. */
  sessionId: string;
  t: (key: string) => string;
}

/** One interactive shell, and under it what the agent ran. The person types into the shell; the
 * agent's commands are shown here but never typed into. */
export default function TerminalPane({ sessionId, t }: TerminalPaneProps) {
  const sessions = useSyncExternalStore(subscribeSessions, allSessions);
  const blocks = useSyncExternalStore(subscribeAgentBlocks, agentBlocks);
  const bodyRef = useRef<HTMLDivElement>(null);
  const current = sessions.find((session) => session.id === sessionId) ?? null;
  const view = useSyncExternalStore(subscribeTerminalView, currentTerminalView);

  // The shell's display sits in the body; it moves here when the tab comes forward.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !current) return;
    body.replaceChildren(current.host);
    fitSession(current.id);
    focusSession(current.id);
  }, [current, current?.view, view]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitSession(current.id));
    observer.observe(body);
    return () => observer.disconnect();
  }, [current]);

  const { tasks } = useSyncExternalStore(subscribeTasks, taskSnapshot);
  const running = tasks.filter((task) => task.status === "running").length;
  const tabs = (
    <div className="terminal-view-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={view === "shell"} className="terminal-view-tab" onClick={() => setTerminalView("shell")}>
        {t("shellTab")}
      </button>
      <button type="button" role="tab" aria-selected={view === "tasks"} className="terminal-view-tab" onClick={() => setTerminalView("tasks")}>
        {t("tasksTab")}
        {running > 0 ? ` (${running})` : ""}
      </button>
    </div>
  );

  return (
    <div className="terminal-pane">
      {tabs}
      {view === "tasks" ? <TasksView t={t} /> : null}
      <div ref={bodyRef} className="terminal-body" data-terminal-body hidden={view === "tasks"} />
      {view === "shell" && blocks.length ? (
        <div className="terminal-agent" aria-label={t("terminalAgentCommands")}>
          <p className="terminal-agent-title">{t("terminalAgentCommands")}</p>
          {blocks.map((block) => (
            <div key={block.id} className="terminal-agent-block" data-status={block.status}>
              <code className="terminal-agent-command">{block.command}</code>
              <pre className="terminal-agent-output">{block.output || (block.status === "running" ? "…" : "")}</pre>
              {block.status !== "running" ? (
                <span className="terminal-agent-status">{block.exitCode === undefined || block.exitCode === null ? block.status : `exit ${block.exitCode}`}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
