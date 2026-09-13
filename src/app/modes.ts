import { DEFAULT_WORKSPACE_ID } from "../workspaces";
import type { AppSettings, ChatSession, PermissionMode, Workspace } from "../types";

// Chat and Code are two separate places: plain conversations on one side, project folders on the
// other. The mode decides which workspaces, tasks and screens the sidebar offers.

export type AppMode = "chat" | "code";

export const MODE_KEY = "draggy_mode";
export const LAST_PROJECT_KEY = "draggy_last_project";

/** How much a project may do on its own, most careful first. Labels and hints are translation keys. */
export const PERMISSION_MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "plan", label: "permissionPlan", hint: "permissionPlanHint" },
  { id: "ask", label: "permissionAsk", hint: "permissionAskHint" },
  { id: "acceptEdits", label: "permissionAcceptEdits", hint: "permissionAcceptEditsHint" },
  { id: "auto", label: "permissionAuto", hint: "permissionAutoHint" },
];

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

// The composer settings each side keeps for itself, so a toggle in Code leaves Chat as it was.
const CODE_KEYS = {
  modelName: "codeModel",
  customInstructions: "codeInstructions",
  thinkingMode: "codeThinkingMode",
  webMode: "codeWebMode",
} as const satisfies Partial<Record<keyof AppSettings, keyof AppSettings>>;

/** The settings a mode runs with: Code reads its own model, instructions, thinking and web. */
export function settingsForMode(settings: AppSettings, mode: AppMode): AppSettings {
  if (mode === "chat") return settings;

  return {
    ...settings,
    // An unset code model follows the chat one rather than meaning no model.
    modelName: settings.codeModel || settings.modelName,
    customInstructions: settings.codeInstructions ?? [],
    thinkingMode: settings.codeThinkingMode ?? settings.thinkingMode,
    webMode: settings.codeWebMode ?? settings.webMode,
  };
}

/** A change made from one mode, written to that mode's own fields. */
export function patchForMode(mode: AppMode, patch: Partial<AppSettings>): Partial<AppSettings> {
  if (mode === "chat") return patch;

  const mapped: Partial<AppSettings> = {};
  for (const [key, value] of Object.entries(patch)) {
    const target = CODE_KEYS[key as keyof typeof CODE_KEYS] ?? key;
    (mapped as Record<string, unknown>)[target] = value;
  }
  return mapped;
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
