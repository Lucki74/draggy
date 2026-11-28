import { useSyncExternalStore } from "react";
import { logRendererEvent, logSwallow } from "../logger";
import {
  AGENT_FOLDER,
  COMMAND_FOLDER,
  parseCustomFile,
  type CustomCommand,
  type CustomKind,
} from "./customCommands";

/** The commands and agents of the open workspace and the user's data folder. Empty until read, and empty on any failure. */
let current: CustomCommand[] = [];
const listeners = new Set<() => void>();
let loadToken = 0;

function publish(next: CustomCommand[]): void {
  current = next;
  listeners.forEach((listener) => listener());
}

export function getCustomCommands(): CustomCommand[] {
  return current;
}

export function useCustomCommands(): CustomCommand[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCustomCommands,
  );
}

/** A missing folder is normal and reads as empty. A failed call or read is logged at WARN and that file is skipped. */
type Entry = { name: string; path: string; isDirectory?: boolean };

/** The Markdown files of one folder. A missing or unreadable folder lists as empty. */
async function listFolder(workspaceId: string, folder: string): Promise<Entry[]> {
  const api = window.draggy?.files;
  if (!api) return [];

  const listing = await api.list(workspaceId, folder).catch((error: unknown) => {
    logRendererEvent("commands", "WARN", "custom folder could not be listed", { folder, error: String(error) });
    return null;
  });
  if (!listing) return [];
  if (!listing.success) {
    logRendererEvent("commands", "DEBUG", "custom folder not readable or missing", { folder });
    return [];
  }

  return (listing.entries ?? []).filter((entry) => !entry.isDirectory && /\.md$/i.test(entry.name));
}

async function readFolder(workspaceId: string, files: Entry[], kind: CustomKind): Promise<CustomCommand[]> {
  const api = window.draggy?.files;
  if (!api || files.length === 0) return [];
  const parsed = await Promise.all(
    files.map(async (entry) => {
      const read = await api.read(workspaceId, entry.path).catch((error: unknown) => {
        logRendererEvent("commands", "WARN", "custom file could not be read", { file: entry.name, error: String(error) });
        return null;
      });
      if (!read?.success || typeof read.text !== "string") return null;
      const command = parseCustomFile(entry.name, read.text, kind, "project");
      if (!command) logRendererEvent("commands", "DEBUG", "custom file skipped", { file: entry.name });
      return command;
    }),
  );
  return parsed.filter((command): command is CustomCommand => command !== null);
}

/** One name, one entry: project files come first, so they win a clash with a user file of the same name. */
export function mergeCustomCommands(project: CustomCommand[], user: CustomCommand[]): CustomCommand[] {
  const seen = new Set<string>();
  return [...project, ...user].filter((command) => {
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}

const TRUST_PREFIX = "commandTrust:";

/** A folder the user has not decided about yet is asked once; the answer is remembered for that folder. */
function trustKey(workspaceId: string): string {
  return `${TRUST_PREFIX}${workspaceId}`;
}

export function rememberedTrust(workspaceId: string): boolean | null {
  try {
    const value = localStorage.getItem(trustKey(workspaceId));
    return value === "yes" ? true : value === "no" ? false : null;
  } catch (error) {
    logSwallow("commands", error, "without storage every folder is asked again");
    return null;
  }
}

export function rememberTrust(workspaceId: string, trusted: boolean): void {
  try {
    localStorage.setItem(trustKey(workspaceId), trusted ? "yes" : "no");
  } catch (error) {
    logSwallow("commands", error, "the answer lasts until the window reloads");
  }
}

/** Asks the user whether a folder's own commands and agents may run. Shown as a plain prompt. */
let askTrust: (folder: string) => Promise<boolean> = async (folder) =>
  typeof window !== "undefined" && typeof window.confirm === "function"
    ? window.confirm(`Trust the commands and agents in this folder?

${folder}

Only say yes to folders you trust. Their agents can set tools, models and permissions.`)
    : false;

export function setCommandTrustPrompt(prompt: (workspaceId: string) => Promise<boolean>): void {
  askTrust = prompt;
}

async function trustedFolder(workspaceId: string, label: string): Promise<boolean> {
  const remembered = rememberedTrust(workspaceId);
  if (remembered !== null) return remembered;
  const answer = await askTrust(label).catch((error) => {
    logSwallow("commands", error, "trust prompt failed, folder not trusted");
    return false;
  });
  rememberTrust(workspaceId, answer);
  return answer;
}

/** Reads the workspace's folders once the folder is trusted. A folder with no command files is never asked about.
 * A newer call wins over an older one still running. */
export async function loadCustomCommands(workspaceId: string, folderPath?: string | null): Promise<void> {
  const token = ++loadToken;
  const [commandFiles, agentFiles] = await Promise.all([
    listFolder(workspaceId, COMMAND_FOLDER),
    listFolder(workspaceId, AGENT_FOLDER),
  ]);
  if (token !== loadToken) return;
  const trusted = commandFiles.length + agentFiles.length > 0 && (await trustedFolder(workspaceId, folderPath || workspaceId));
  const [commands, agents] = await Promise.all([
    trusted ? readFolder(workspaceId, commandFiles, "command") : Promise.resolve([]),
    trusted ? readFolder(workspaceId, agentFiles, "agent") : Promise.resolve([]),
  ]);
  if (token !== loadToken) return;
  const merged = mergeCustomCommands([...commands, ...agents], []);
  logRendererEvent("commands", "DEBUG", "custom commands loaded", {
    project: commands.length + agents.length,
    total: merged.length,
  });
  publish(merged);
}

/** Forgets the list, for when the workspace changes before its files are read. */
export function clearCustomCommands(): void {
  loadToken += 1;
  publish([]);
}
