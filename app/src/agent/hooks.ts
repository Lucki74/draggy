/** Hook config, matching and exit-code rules for the agent loop. Pure logic; the runner lives in the Rust IPC. */

export const HOOK_EVENTS = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookEntry {
  event: HookEvent;
  /** Regex on the tool name. Empty or "*" matches every tool; only tool events use it. */
  matcher: string;
  command: string;
  /** Seconds. */
  timeout: number;
  enabled: boolean;
}

export const DEFAULT_HOOK_TIMEOUT = 60;
export const MAX_HOOK_TIMEOUT = 600;
/** A blocking hook exits with this code. */
export const BLOCKING_EXIT_CODE = 2;
/** A Stop hook may send the model back this many times in one turn. */
export const MAX_STOP_CONTINUES = 3;

/** Parse `{ "hooks": { "PreToolUse": [...] } }`; bad entries are skipped and reported. */
export function parseHooksConfig(raw: unknown): { hooks: HookEntry[]; errors: string[] } {
  const hooks: HookEntry[] = [];
  const errors: string[] = [];
  const root = isRecord(raw) && isRecord(raw.hooks) ? raw.hooks : null;
  if (!root) return { hooks, errors: isRecord(raw) && raw.hooks !== undefined ? ["hooks must be an object"] : [] };
  for (const [event, list] of Object.entries(root)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
      errors.push(`unknown event ${event}`);
      continue;
    }
    if (!Array.isArray(list)) {
      errors.push(`${event} must be a list`);
      continue;
    }
    list.forEach((item, index) => {
      const entry = parseEntry(event as HookEvent, item);
      if (typeof entry === "string") errors.push(`${event}[${index}]: ${entry}`);
      else hooks.push(entry);
    });
  }
  return { hooks, errors };
}

/** Re-checks the user's saved hook list, so a hand-edited entry never reaches the runner unchecked. */
export function sanitizeHookEntries(list: unknown): HookEntry[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const event = isRecord(item) ? item.event : undefined;
    if (typeof event !== "string" || !(HOOK_EVENTS as readonly string[]).includes(event)) return [];
    const entry = parseEntry(event as HookEvent, item);
    return typeof entry === "string" ? [] : [entry];
  });
}

function parseEntry(event: HookEvent, item: unknown): HookEntry | string {
  if (!isRecord(item)) return "entry must be an object";
  const command = typeof item.command === "string" ? item.command.trim() : "";
  if (!command) return "command is empty";
  const matcher = item.matcher === undefined ? "" : item.matcher;
  if (typeof matcher !== "string") return "matcher must be a string";
  if (matcher && matcher !== "*" && !isValidRegex(matcher)) return "matcher is not a valid regex";
  const timeout = typeof item.timeout === "number" && Number.isFinite(item.timeout) ? item.timeout : DEFAULT_HOOK_TIMEOUT;
  return {
    event,
    matcher,
    command,
    timeout: clampTimeout(timeout),
    enabled: item.enabled !== false,
  };
}

export function clampTimeout(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_HOOK_TIMEOUT;
  return Math.min(Math.max(Math.round(seconds), 1), MAX_HOOK_TIMEOUT);
}

/** Whether a tool-event hook applies to this tool name. Non-tool events always apply. */
export function hookMatchesTool(entry: HookEntry, toolName: string): boolean {
  if (!entry.enabled) return false;
  if (entry.event !== "PreToolUse" && entry.event !== "PostToolUse") return true;
  if (!entry.matcher || entry.matcher === "*") return true;
  try {
    return new RegExp(entry.matcher).test(toolName);
  } catch {
    return false;
  }
}

/** The hooks to run for an event, in config order. */
export function hooksFor(hooks: HookEntry[], event: HookEvent, toolName?: string): HookEntry[] {
  return hooks.filter(
    (entry) => entry.event === event && hookMatchesTool(entry, toolName ?? ""),
  );
}

export interface HookPayload {
  hook_event_name: HookEvent;
  session_id: string;
  cwd: string;
  permission_mode: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  stop_hook_active?: boolean;
}

/** The JSON a hook reads on stdin. Field names follow Claude Code's. */
/** Longest string a hook receives in tool_input or tool_response, in characters. */
export const HOOK_PAYLOAD_STRING_LIMIT = 32 * 1024;

function capStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > HOOK_PAYLOAD_STRING_LIMIT ? `${value.slice(0, HOOK_PAYLOAD_STRING_LIMIT)}[cut]` : value;
  }
  if (Array.isArray(value)) return value.map(capStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, capStrings(item)]));
  }
  return value;
}

export function buildHookPayload(event: HookEvent, context: Omit<HookPayload, "hook_event_name">): HookPayload {
  const payload: HookPayload = { hook_event_name: event, ...context };
  if (event === "SessionStart" || event === "Stop") {
    delete payload.tool_name;
    delete payload.tool_input;
    delete payload.tool_response;
  } else {
    if (payload.tool_input !== undefined) payload.tool_input = capStrings(payload.tool_input);
    if (payload.tool_response !== undefined) payload.tool_response = capStrings(payload.tool_response);
  }
  return payload;
}

export type HookDecision =
  | { action: "continue"; context?: string }
  | { action: "deny"; message: string }
  | { action: "error"; message: string };

/** Exit 2 blocks with stderr, or stdout if empty; other non-zero exits are errors. */
export function decideFromExit(
  event: HookEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  timedOut = false,
): HookDecision {
  if (timedOut) return { action: "error", message: "hook timed out" };
  if (exitCode === BLOCKING_EXIT_CODE) {
    const fallback = event === "Stop" ? "Stop hook blocked the finish." : "Blocked by hook.";
    const message = (stderr.trim() || stdout.trim() || fallback).trim();
    return { action: "deny", message };
  }
  if (exitCode !== 0) return { action: "error", message: `hook exited with ${exitCode ?? "no code"}` };
  if (event === "SessionStart" && stdout.trim()) return { action: "continue", context: stdout.trim() };
  return { action: "continue" };
}

/** Whether a Stop hook that blocked may still send the model back again this turn. */
export function canContinueStop(continuesSoFar: number): boolean {
  return continuesSoFar < MAX_STOP_CONTINUES;
}

/** Trust key for a project hooks file: a SHA-256 of its exact text, hex. */
export async function hookFileDigest(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Project hooks run only when the file's current digest is the one the user trusted. */
export function isProjectHooksTrusted(trusted: string | undefined, digest: string): boolean {
  return Boolean(trusted) && trusted === digest;
}

/** Log form of a command: its length and never its text. */
export function describeCommandForLog(command: string): string {
  return `command(${command.length} chars)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}
