import { DEFAULT_WORKSPACE_ID } from "../workspaces";
import type { ChatSession, Workspace } from "../types";

// Chat and Code are two separate places: plain conversations on one side, project folders on the
// other. The mode decides which workspaces, tasks and screens the sidebar offers.

export type AppMode = "chat" | "code";

export const MODE_KEY = "draggy_mode";
export const LAST_PROJECT_KEY = "draggy_last_project";

export function isProject(workspace: Workspace | null | undefined): boolean {
  return Boolean(workspace && workspace.kind === "project" && workspace.rootPath);
}

export function modeOf(workspace: Workspace | null | undefined): AppMode {
  return isProject(workspace) ? "code" : "chat";
}

export function projectsOf(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter(isProject);
}

/** The mode a window opens in: the one it was left in, or the one its last workspace implies. */
export function initialMode(stored: string | null, activeId: string | null): AppMode {
  if (stored === "chat" || stored === "code") return stored;
  return activeId && activeId !== DEFAULT_WORKSPACE_ID ? "code" : "chat";
}

/** Where switching to a mode lands: the chat workspace, or the last project (else the first). */
export function workspaceForMode(
  mode: AppMode,
  workspaces: Workspace[],
  lastProjectId: string | null,
): string | null {
  if (mode === "chat") return DEFAULT_WORKSPACE_ID;

  const projects = projectsOf(workspaces);
  if (projects.length === 0) return null;

  return projects.find((one) => one.id === lastProjectId)?.id ?? projects[0].id;
}

/** The workspace a conversation lives in, for opening it from outside its own list. */
export function workspaceOfChat(sessions: ChatSession[], chatId: string): string {
  return sessions.find((one) => one.id === chatId)?.workspaceId || DEFAULT_WORKSPACE_ID;
}

/** Running tasks that belong to this mode, so a chat never shows project work and the reverse. */
export function runningInMode(
  running: string[],
  sessions: ChatSession[],
  workspaces: Workspace[],
  mode: AppMode,
): string[] {
  return running.filter((chatId) => {
    const workspace = workspaces.find((one) => one.id === workspaceOfChat(sessions, chatId));
    return modeOf(workspace) === mode;
  });
}
