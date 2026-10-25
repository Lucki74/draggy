import type { ShellId } from "./shells";

/** What the chat hands the terminal pane: a command to put on the prompt, and the commands the agent
 * ran. Neither is ever executed from here; a person presses Enter. */

export interface PrefillRequest {
  command: string;
  shell?: ShellId;
}

export interface AgentBlock {
  id: string;
  command: string;
  shell?: string;
  output: string;
  status: "running" | "done" | "failed" | "stopped";
  exitCode?: number | null;
}

const MAX_BLOCKS = 20;
const MAX_BLOCK_CHARS = 40000;

let pending: PrefillRequest | null = null;
const prefillListeners = new Set<(request: PrefillRequest) => void>();
let blocks: AgentBlock[] = [];
const blockListeners = new Set<() => void>();

/** Text for a prompt: one command, without the characters that would end it or move the cursor. */
export function promptText(command: string): string {
  // eslint-disable-next-line no-control-regex -- escape and control characters are what is removed
  return String(command).replace(/\r/g, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trimEnd();
}

/** Asks the pane to put a command on a prompt. Held until a pane takes it, so the pane can be opened by the same click. */
export function requestPrefill(request: PrefillRequest): void {
  if (!promptText(request.command)) return;
  pending = request;
  for (const listener of prefillListeners) listener(request);
}

export function takePrefill(): PrefillRequest | null {
  const request = pending;
  pending = null;
  return request;
}

export function onPrefill(listener: (request: PrefillRequest) => void): () => void {
  prefillListeners.add(listener);
  return () => void prefillListeners.delete(listener);
}

const changed = () => {
  blocks = [...blocks];
  for (const listener of blockListeners) listener();
};

export function startAgentBlock(block: Pick<AgentBlock, "id" | "command" | "shell">): void {
  blocks = [...blocks.filter((entry) => entry.id !== block.id), { ...block, output: "", status: "running" as const }].slice(-MAX_BLOCKS);
  changed();
}

export function appendAgentBlock(id: string, chunk: string): void {
  const block = blocks.find((entry) => entry.id === id);
  if (!block) return;
  block.output = (block.output + chunk).slice(-MAX_BLOCK_CHARS);
  changed();
}

export function finishAgentBlock(id: string, patch: Partial<Pick<AgentBlock, "status" | "exitCode" | "shell">>): void {
  const block = blocks.find((entry) => entry.id === id);
  if (!block) return;
  Object.assign(block, patch);
  changed();
}

export const agentBlocks = (): AgentBlock[] => blocks;

export function subscribeAgentBlocks(listener: () => void): () => void {
  blockListeners.add(listener);
  return () => void blockListeners.delete(listener);
}

/** The shell a code block's language runs in, or undefined for a language that is not a shell. */
export function shellForLanguage(language: string): ShellId | undefined {
  switch (language.toLowerCase()) {
    case "bash":
    case "shell":
    case "sh":
    case "zsh":
      return "bash";
    case "powershell":
    case "pwsh":
    case "ps1":
      return "pwsh";
    case "cmd":
    case "batch":
    case "bat":
      return "cmd";
    default:
      return undefined;
  }
}

export function resetTerminalBus(): void {
  pending = null;
  blocks = [];
}
