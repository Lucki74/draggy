import { useEffect, useRef, useSyncExternalStore } from "react";
import { agentBlocks, subscribeAgentBlocks } from "./terminalBus";
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

  // The shell's display sits in the body; it moves here when the tab comes forward.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !current) return;
    body.replaceChildren(current.host);
    fitSession(current.id);
    focusSession(current.id);
  }, [current, current?.view]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitSession(current.id));
    observer.observe(body);
    return () => observer.disconnect();
  }, [current]);

  return (
    <div className="terminal-pane">
      <div ref={bodyRef} className="terminal-body" data-terminal-body />
      {blocks.length ? (
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
