import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "../ui/icons/Icon";
import {
  agentBlocks,
  onPrefill,
  subscribeAgentBlocks,
  takePrefill,
  type PrefillRequest,
} from "./terminalBus";
import {
  activeSessionId,
  allSessions,
  closeSession,
  fitSession,
  focusSession,
  openSession,
  prefillSession,
  selectSession,
  sessionsFor,
  subscribeSessions,
  terminalAvailable,
} from "./terminalSessions";

interface TerminalPaneProps {
  workspaceId: string;
  t: (key: string) => string;
  defaultShell?: string;
}

/** Interactive shells in tabs, and under them what the agent ran. The person types into the shells;
 * the agent's commands are shown here but never typed into. */
export default function TerminalPane({ workspaceId, t, defaultShell }: TerminalPaneProps) {
  useSyncExternalStore(subscribeSessions, allSessions);
  const blocks = useSyncExternalStore(subscribeAgentBlocks, agentBlocks);
  const [unavailable, setUnavailable] = useState(!terminalAvailable());
  const [message, setMessage] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const tabs = sessionsFor(workspaceId);
  const activeId = activeSessionId(workspaceId);
  const current = tabs.find((tab) => tab.id === activeId) ?? null;
  const claimed = useRef(false);
  const starting = useRef(false);
  const defaultRef = useRef(defaultShell);
  useEffect(() => {
    defaultRef.current = defaultShell;
  });

  const open = async (shell?: PrefillRequest["shell"]) => {
    const outcome = await openSession(workspaceId, shell, defaultRef.current === "auto" ? undefined : defaultRef.current);
    if (outcome.unavailable) setUnavailable(true);
    else if (!outcome.success) setMessage(outcome.error ?? t("terminalFailed"));
    else setMessage(outcome.notice ?? null);
    return outcome.id ?? null;
  };

  // The shown shell's display sits in the body; switching tabs moves the element.
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

  // A command from a code block: use a shell of the right kind, or start one, and leave Enter to the person.
  useEffect(() => {
    const handle = async (request: PrefillRequest) => {
      const match = sessionsFor(workspaceId).find((tab) => !tab.exited && (!request.shell || tab.shell === request.shell));
      const id = match?.id ?? (await open(request.shell));
      if (!id) return;
      selectSession(workspaceId, id);
      setTimeout(() => prefillSession(id, request.command), match ? 0 : 400);
    };
    const waiting = takePrefill();
    if (waiting) {
      claimed.current = true;
      void handle(waiting);
    }
    return onPrefill((request) => {
      takePrefill();
      void handle(request);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handler reads the latest props through refs
  }, [workspaceId]);

  useEffect(() => {
    // Strict mode runs this twice before the first shell exists, so a ref guards the open.
    if (!unavailable && tabs.length === 0 && !claimed.current && !starting.current) {
      starting.current = true;
      void open().finally(() => {
        starting.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a first shell opens once per workspace
  }, [workspaceId, unavailable]);

  if (unavailable) {
    return (
      <div className="terminal-pane terminal-pane-empty">
        <Icon name="terminal-window" size={20} className="text-text-tertiary" />
        <p className="terminal-pane-note">{t("terminalUnavailable")}</p>
      </div>
    );
  }

  return (
    <div className="terminal-pane">
      <div className="terminal-tabs" role="tablist">
        {tabs.map((tab) => (
          <div key={tab.id} className={`terminal-tab${tab.id === activeId ? " terminal-tab-active" : ""}`}>
            <button type="button" role="tab" aria-selected={tab.id === activeId} className="terminal-tab-label" onClick={() => selectSession(workspaceId, tab.id)}>
              {tab.shell}
              {tab.exited ? ` (${t("terminalExited")})` : ""}
            </button>
            <button type="button" className="terminal-tab-close" aria-label={t("terminalClose")} title={t("terminalClose")} onClick={() => closeSession(tab.id)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
        <button type="button" className="terminal-tab-new" aria-label={t("terminalNew")} title={t("terminalNew")} onClick={() => void open()}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {message ? <p className="terminal-pane-notice" role="status">{message}</p> : null}
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
