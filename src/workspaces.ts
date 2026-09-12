import { generateId } from "./utils";
import type { AppSettings, ChatSession, Workspace } from "./types";

/**
 * A workspace is what a conversation is about: an ordinary chat, or a folder
 * on disk that the model is allowed to work in. Settings live in two layers,
 * the app's and the workspace's, and this is where the two are put together.
 */

/** Matches `DEFAULT_WORKSPACE_ID` in electron/storage.cjs. */
export const DEFAULT_WORKSPACE_ID = "default";

/** Stood in for the real row until the main process answers, and in tests. */
export function fallbackWorkspace(): Workspace {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: "",
    kind: "chat",
    rootPath: null,
    permissionMode: "ask",
    settings: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

export function createProject(name: string, rootPath: string): Workspace {
  const now = Date.now();

  return {
    id: generateId(),
    name: name.trim() || folderName(rootPath),
    kind: "project",
    rootPath,
    // Editing inside the folder the user chose is the point of a project. What
    // happens outside it, and anything destructive, is still asked about.
    permissionMode: "acceptEdits",
    settings: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** The last segment of a path, whichever separator the platform uses. */
export function folderName(rootPath: string): string {
  const parts = rootPath.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || rootPath;
}

export function isDefault(workspace: Workspace | null | undefined): boolean {
  return !workspace || workspace.id === DEFAULT_WORKSPACE_ID;
}

export function workspaceIdOf(session: ChatSession): string {
  return session.workspaceId || DEFAULT_WORKSPACE_ID;
}

export function sessionsIn(
  sessions: ChatSession[],
  workspaceId: string,
): ChatSession[] {
  return sessions.filter((session) => workspaceIdOf(session) === workspaceId);
}

/**
 * The settings a turn actually runs with. Each override is checked rather than
 * spread: the values come back from JSON in the database, and a workspace has
 * no business changing the theme or the update schedule even if its row says so.
 */
export function resolveSettings(
  global: AppSettings,
  workspace: Workspace | null | undefined,
): AppSettings {
  const overrides = workspace?.settings;
  if (!overrides || Object.keys(overrides).length === 0) return global;

  const resolved: AppSettings = { ...global };

  // An empty model name means "whatever the app is running", not "no model".
  if (typeof overrides.modelName === "string" && overrides.modelName) {
    resolved.modelName = overrides.modelName;
  }

  if (Array.isArray(overrides.customInstructions)) {
    resolved.customInstructions = overrides.customInstructions;
  }

  if (overrides.thinkingMode) resolved.thinkingMode = overrides.thinkingMode;
  if (overrides.webMode) resolved.webMode = overrides.webMode;

  if (typeof overrides.codeExecution === "boolean") {
    resolved.codeExecution = overrides.codeExecution;
  }

  if (typeof overrides.libraryEnabled === "boolean") {
    resolved.libraryEnabled = overrides.libraryEnabled;
  }

  return resolved;
}

/** What the interface calls it. The default workspace has no name of its own. */
export function workspaceLabel(
  workspace: Workspace | null | undefined,
  t: (key: string) => string,
): string {
  if (isDefault(workspace)) return t("defaultWorkspace");
  return workspace?.name || t("untitledProject");
}
