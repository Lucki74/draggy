import { logSwallow } from "../logger";
import { createTerminalView, type TerminalView } from "./xtermView";
import { promptText } from "./terminalBus";
import type { ShellId } from "./shells";

/** The open terminals, kept outside the pane so switching to another dock pane and back does not
 * close a shell. Each one is an xterm on its own element that the pane attaches where it shows. */

export interface TerminalSession {
  id: string;
  workspaceId: string;
  shell: string;
  exited: boolean;
  exitCode?: number;
  host: HTMLElement;
  view: TerminalView | null;
  queue: string[];
}

export interface OpenOutcome {
  success: boolean;
  id?: string;
  notice?: string;
  unavailable?: boolean;
  error?: string;
}

let sessions: TerminalSession[] = [];
const active = new Map<string, string>();
const listeners = new Set<() => void>();
let disposers: Array<() => void> = [];

const notify = () => {
  sessions = [...sessions];
  for (const listener of listeners) listener();
};

const byId = (id: string) => sessions.find((session) => session.id === id);
const api = () => window.electronAPI?.shell;

export const terminalAvailable = (): boolean => Boolean(api());

export function subscribeSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const allSessions = (): TerminalSession[] => sessions;
export const sessionsFor = (workspaceId: string): TerminalSession[] => sessions.filter((session) => session.workspaceId === workspaceId);
export const activeSessionId = (workspaceId: string): string | null => active.get(workspaceId) ?? null;

/** The name a shell tab carries. PowerShell and pwsh are one shell, so both read "Pwsh". */
export function shellName(shell: string): string {
  const id = shell.toLowerCase().replace(/\.exe$/, "");
  if (id === "pwsh" || id === "powershell") return "Pwsh";
  if (id === "cmd") return "CMD";
  return id ? id[0].toUpperCase() + id.slice(1) : "Shell";
}

/** Tab names for a workspace's shells; a second shell of one kind reads "Bash 2". */
export function sessionLabels(workspaceId: string): Map<string, string> {
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const session of sessionsFor(workspaceId)) {
    const name = shellName(session.shell);
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    labels.set(session.id, count === 1 ? name : `${name} ${count}`);
  }
  return labels;
}

/** The shells installed here, as the ids a new terminal takes. */
export async function availableShells(): Promise<ShellId[]> {
  const result = await api()?.list();
  return (result?.shells ?? []) as ShellId[];
}

export function selectSession(workspaceId: string, id: string): void {
  active.set(workspaceId, id);
  notify();
}

function listen(): void {
  if (disposers.length || !api()) return;
  disposers = [
    api()!.onData(({ id, data }) => {
      const session = byId(id);
      if (!session) return;
      if (session.view) session.view.write(data);
      else session.queue.push(data);
    }),
    api()!.onExit(({ id, exitCode }) => {
      const session = byId(id);
      if (!session) return;
      session.exited = true;
      session.exitCode = exitCode;
      session.view?.write(`\r\n[exit ${exitCode}]\r\n`);
      notify();
    }),
  ];
}

function release(): void {
  if (sessions.length) return;
  for (const dispose of disposers) dispose();
  disposers = [];
}

export async function openSession(workspaceId: string, shell: ShellId | undefined, defaultShell: string | undefined): Promise<OpenOutcome> {
  const bridge = api();
  if (!bridge) return { success: false, unavailable: true };

  const result = await bridge.open(workspaceId, { shell, defaultShell });
  if (!result.success || !result.id) {
    return { success: false, unavailable: result.unavailable, error: result.error };
  }

  const id = result.id;
  const host = document.createElement("div");
  host.className = "h-full w-full";
  const session: TerminalSession = { id, workspaceId, shell: result.shell ?? shell ?? "shell", exited: false, host, view: null, queue: [] };
  sessions = [...sessions, session];
  active.set(workspaceId, id);
  listen();
  notify();

  createTerminalView(host, {
    onInput: (data) => bridge.write(id, data),
    onLink: (uri) => void window.open(uri, "_blank"),
  })
    .then((view) => {
      if (!byId(id)) {
        view.dispose();
        return;
      }
      session.view = view;
      for (const chunk of session.queue.splice(0)) view.write(chunk);
      notify();
    })
    .catch((error) => logSwallow("terminal", error, "the terminal view did not load; the session stays open without a display"));

  return { success: true, id, notice: result.notice };
}

export function closeSession(id: string): void {
  const session = byId(id);
  if (!session) return;
  sessions = sessions.filter((entry) => entry.id !== id);
  session.view?.dispose();
  session.host.remove();
  void api()?.close(id);
  if (active.get(session.workspaceId) === id) {
    const next = sessionsFor(session.workspaceId).at(-1);
    if (next) active.set(session.workspaceId, next.id);
    else active.delete(session.workspaceId);
  }
  notify();
  release();
}

/** Fits the shell's display to its container and tells the shell the new size. */
export function fitSession(id: string): void {
  const session = byId(id);
  const size = session?.view?.fit();
  if (size) void api()?.resize(id, size.cols, size.rows);
}

export function focusSession(id: string): void {
  byId(id)?.view?.focus();
}

/** Puts text on the prompt without pressing Enter. A multi-line command goes in as a paste, so no
 * line runs before the person has read it. */
export function prefillSession(id: string, command: string): boolean {
  const session = byId(id);
  const bridge = api();
  if (!session || !bridge || session.exited) return false;

  const lines = String(command).split("\n").map(promptText).filter(Boolean);
  if (!lines.length) return false;
  bridge.write(id, lines.length === 1 ? lines[0] : `\u001b[200~${lines.join("\n")}\u001b[201~`);
  session.view?.focus();
  return true;
}

export function resetSessions(): void {
  for (const session of sessions) session.view?.dispose();
  sessions = [];
  active.clear();
  for (const dispose of disposers) dispose();
  disposers = [];
}
