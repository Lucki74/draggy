import type { PermissionMode } from "../types";
import { commandCovered, commandGrantTargets, commandSegments, dialectFor } from "./commandRules";

/** Whether a tool call may run. One pure function for built-in and MCP tools, with flags mirroring
 * MCP's own annotations, so there is one answer everywhere. */
export interface ToolAnnotations {
  /** Reads or searches. Changes nothing, anywhere. */
  readOnly?: boolean;
  /** Can lose work: deletes, overwrites, moves. */
  destructive?: boolean;
  /** Running it twice is the same as running it once. */
  idempotent?: boolean;
  /** Reaches the network, or drives a browser at a real site. */
  openWorld?: boolean;
  /** Its effects stay inside Draggy's own storage: the output folder, the scratch directory, the
   * embedded browser. Nothing of the user's is at stake. */
  sandboxed?: boolean;
  /** Runs a command on the user's computer, which can do anything the user can. Asked about in
   * every mode but auto, unless each command in it was allowed before. */
  executes?: boolean;
  /** Runs outside the sandbox. Never allowed without a question, whatever the mode but YOLO. */
  outsideSandbox?: boolean;

  /** Explicit hints matching MCP and directory requirements. */
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Something the user has already agreed to. A grant with no target covers every call of that tool;
 * one with a target covers that path or address and anything under it. */
export interface Grant {
  tool: string;
  target?: string;
}

export type Decision = "allow" | "ask" | "deny";

export interface Verdict {
  decision: Decision;
  /** Why. Shown to the user, and handed to the model when it is a refusal. */
  reason: string;
}

export interface PermissionQuery {
  mode: PermissionMode;
  tool: string;
  annotations?: ToolAnnotations;
  /** The path, file or address the call is about, when it has one. */
  target?: string | null;
  grants?: Grant[];
  /** The shell a command runs in; a missing one reads as the strictest grammar. */
  shell?: string | null;
}

const PLAN_REFUSAL =
  "This conversation is in plan mode, which cannot change anything or run commands. Describe what you would do instead, and the user will decide.";

/** Compares paths and addresses the way the file system does on this platform. */
function sameOrInside(grantTarget: string, target: string): boolean {
  const normalise = (value: string) =>
    value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();

  const granted = normalise(grantTarget);
  const asked = normalise(target);

  if (!granted) return true;
  if (granted === asked) return true;

  return asked.startsWith(`${granted}/`);
}

export function grantCovers(
  grant: Grant,
  tool: string,
  target?: string | null,
): boolean {
  if (grant.tool !== tool) return false;
  if (!grant.target) return true;
  if (!target) return false;

  return sameOrInside(grant.target, target);
}

/** Adds a grant, dropping any it makes redundant. */
export function addGrant(grants: Grant[], grant: Grant): Grant[] {
  const kept = grants.filter(
    (existing) => !grantCovers(grant, existing.tool, existing.target),
  );
  return [...kept, grant];
}

/** Commands that only read. The sandbox mount does the real enforcing; this list only decides when
 * the question can be skipped. */
const READ_ONLY_COMMANDS = new Set([
  "dir", "type", "ls", "cat", "head", "tail", "pwd", "echo", "wc", "find", "grep", "rg", "tree",
  "where", "which", "whoami", "hostname", "get-childitem", "get-content", "select-string",
  "get-location", "findstr", "sort", "uniq", "stat", "file", "du", "more", "cd", "set-location",
]);
const READ_ONLY_GIT = new Set([
  "status", "log", "diff", "show", "branch", "blame", "ls-files", "rev-parse", "remote", "describe",
]);

function readOnlySegment(segment: string): boolean {
  const words = segment.trim().split(/\s+/);
  const head = (words[0] ?? "").toLowerCase();
  if (head === "git") {
    const sub = words.slice(1).find((word) => !word.startsWith("-"));
    return !!sub && READ_ONLY_GIT.has(sub.toLowerCase());
  }
  if (head === "find" && words.some((w) => /^-(delete|exec|execdir|ok)$/i.test(w))) return false;
  return READ_ONLY_COMMANDS.has(head);
}

/** True when every command in the line is on the read-only list. Opaque lines are not. */
export function commandReadOnly(command: string | null | undefined, shell: string | null = null): boolean {
  const segments = commandSegments(command, dialectFor(shell));
  return !!segments && segments.length > 0 && segments.every(readOnlySegment);
}

export function decide(query: PermissionQuery): Verdict {
  const { mode, tool, annotations = {}, target = null, grants = [], shell = null } = query;
  const isReadOnly = annotations.readOnlyHint ?? annotations.readOnly;
  const isDestructive = annotations.destructiveHint ?? annotations.destructive;

  // Reading is allowed everywhere, plan mode included: looking at the project
  // is exactly what plan mode is for.
  if (isReadOnly) {
    return { decision: "allow", reason: "This tool only reads." };
  }

  if (mode === "plan") {
    return { decision: "deny", reason: PLAN_REFUSAL };
  }

  if (mode === "auto") {
    return {
      decision: "allow",
      reason: "This workspace runs tools without asking.",
    };
  }

  // A command can do anything, so accepting edits does not cover it; only an earlier "always"
  // for every command in the line does.
  if (annotations.executes) {
    if (!annotations.outsideSandbox) {
      if (mode === "turbo") {
        return { decision: "allow", reason: "Turbo runs commands inside the project sandbox." };
      }
      if (commandReadOnly(target, shell)) {
        return { decision: "allow", reason: "This command only reads, inside the sandbox." };
      }
    }
    const allowed = grants
      .filter((grant) => grant.tool === tool && grant.target)
      .map((grant) => grant.target as string);

    if (commandCovered(allowed, target, dialectFor(shell))) {
      return { decision: "allow", reason: "The user has already allowed this command." };
    }

    return {
      decision: "ask",
      reason: "This runs a command on the user's computer, so the user is asked first.",
    };
  }

  // Writing a file Draggy made, running code in the scratch directory, driving
  // the embedded browser: nothing here is the user's to lose.
  if (annotations.sandboxed && !isDestructive) {
    return {
      decision: "allow",
      reason: "This stays inside Draggy's own storage.",
    };
  }

  if (grants.some((grant) => grantCovers(grant, tool, target))) {
    return { decision: "allow", reason: "The user has already allowed this." };
  }

  if (mode === "turbo") {
    return { decision: "allow", reason: "Turbo has no limits inside the project folder." };
  }

  if (mode === "acceptEdits" && !isDestructive) {
    return {
      decision: "allow",
      reason: "Edits are accepted in this workspace.",
    };
  }

  return {
    decision: "ask",
    reason: isDestructive
      ? "This can lose work, so the user is asked first."
      : "This changes something outside Draggy, so the user is asked first.",
  };
}

/** What an approval remembers. A command keeps the start of each command in it, so "always" for
 * "npm test --watch" allows "npm test" again but not anything chained after it. */
export function grantsFor(
  tool: string,
  target: string | null | undefined,
  annotations: ToolAnnotations = {},
  shell: string | null = null,
): Grant[] {
  if (annotations.executes) {
    return commandGrantTargets(target, dialectFor(shell)).map((prefix) => ({ tool, target: prefix }));
  }
  return [{ tool, ...(target ? { target } : {}) }];
}

/** What the user is being asked about: the path, file or address in the call. */
const TARGET_KEYS = [
  "path",
  "filepath",
  "file_path",
  "filename",
  "file",
  "directory",
  "folder",
  "source",
  "url",
  "command",
];

export function targetFromArgs(args: Record<string, unknown>): string | null {
  for (const key of TARGET_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** What a refusal reads like to the model, in the shape tools answer in. */
export function refusalFor(tool: string, verdict: Verdict): string {
  return `TOOL RESULT (${tool}): Not allowed. ${verdict.reason}`;
}

export function deniedByUser(tool: string): string {
  return `TOOL RESULT (${tool}): The user declined this. Do not try it again; ask them what to do instead, or carry on without it.`;
}
