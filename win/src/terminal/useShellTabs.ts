import { useCallback, useEffect, useRef } from "react";
import { openPane, terminalPane, type DockLayout } from "../app/dockLayout";
import { onPrefill, takePrefill, type PrefillRequest } from "./terminalBus";
import type { ShellId } from "./shells";
import { activeSessionId, openSession, prefillSession, selectSession, sessionsFor, shellName } from "./terminalSessions";

interface ShellTabsOptions {
  workspaceId: string;
  /** The Default shell setting; "auto" lets the main process choose. */
  defaultShell?: string;
  layout: DockLayout;
  onLayoutChange: (next: DockLayout) => void;
  /** Said to the person when a shell cannot start or starts as another shell. */
  onMessage: (text: string) => void;
  t: (key: string) => string;
}

/** Each shell is a tab in the dock. This opens them: from the + menu, from the Terminal item, and
 * for a command a code block sends (which lands on a prompt and is never run). */
export function useShellTabs({ workspaceId, defaultShell, layout, onLayoutChange, onMessage, t }: ShellTabsOptions) {
  const latest = useRef({ layout, defaultShell, onLayoutChange, onMessage, t });
  useEffect(() => {
    latest.current = { layout, defaultShell, onLayoutChange, onMessage, t };
  });

  const showTab = useCallback((id: string) => {
    const { layout: current, onLayoutChange: change } = latest.current;
    const next = openPane(current, terminalPane(id));
    latest.current.layout = next;
    change(next);
  }, []);

  const openShell = useCallback(
    async (shell?: ShellId): Promise<string | null> => {
      const { defaultShell: preferred, onMessage: say, t: text } = latest.current;
      const outcome = await openSession(workspaceId, shell, preferred === "auto" ? undefined : preferred);
      if (!outcome.success || !outcome.id) {
        say(outcome.unavailable ? text("terminalUnavailable") : (outcome.error ?? text("terminalFailed")));
        return null;
      }
      if (outcome.notice) say(outcome.notice);
      showTab(outcome.id);
      return outcome.id;
    },
    [workspaceId, showTab],
  );

  /** The Terminal menu item: bring the shell already open forward, or start the first one. */
  const showTerminal = useCallback(() => {
    const id = activeSessionId(workspaceId);
    if (id && sessionsFor(workspaceId).some((session) => session.id === id)) {
      selectSession(workspaceId, id);
      showTab(id);
    } else {
      void openShell();
    }
  }, [workspaceId, openShell, showTab]);

  useEffect(() => {
    const handle = async (request: PrefillRequest) => {
      const wanted = request.shell ? shellName(request.shell) : null;
      const match = sessionsFor(workspaceId).find((session) => !session.exited && (!wanted || shellName(session.shell) === wanted));
      const id = match?.id ?? (await openShell(request.shell));
      if (!id) return;
      selectSession(workspaceId, id);
      if (match) showTab(id);
      setTimeout(() => prefillSession(id, request.command), match ? 0 : 400);
    };
    const waiting = takePrefill();
    if (waiting) void handle(waiting);
    return onPrefill((request) => {
      takePrefill();
      void handle(request);
    });
  }, [workspaceId, openShell, showTab]);

  return { openShell, showTerminal };
}
