import type { PermissionMode } from "../types";

/**
 * Whether a tool call may run. One pure function decides for built-in tools and
 * for anything an MCP server offers, so there is a single answer to "is Draggy
 * allowed to do this" rather than one per subsystem.
 *
 * The flags mirror MCP's own tool annotations, so a server that describes
 * itself honestly needs no translation layer.
 */
export interface ToolAnnotations {
  /** Reads or searches. Changes nothing, anywhere. */
  readOnly?: boolean;
  /** Can lose work: deletes, overwrites, moves. */
  destructive?: boolean;
  /** Running it twice is the same as running it once. */
  idempotent?: boolean;
  /** Reaches the network, or drives a browser at a real site. */
  openWorld?: boolean;
  /**
   * Its effects stay inside Draggy's own storage: the output folder, the
   * scratch directory, the embedded browser. Nothing of the user's is at stake.
   */
  sandboxed?: boolean;
}

/**
 * Something the user has already agreed to. A grant with no target covers every
 * call of that tool; one with a target covers that path or address and anything
 * under it.
 */
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
}

const PLAN_REFUSAL =
  "This conversation is in plan mode, which cannot change anything. Describe what you would do instead, and the user will decide.";

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

export function decide(query: PermissionQuery): Verdict {
  const { mode, tool, annotations = {}, target = null, grants = [] } = query;

  // Reading is allowed everywhere, plan mode included: looking at the project
  // is exactly what plan mode is for.
  if (annotations.readOnly) {
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

  // Writing a file Draggy made, running code in the scratch directory, driving
  // the embedded browser: nothing here is the user's to lose.
  if (annotations.sandboxed && !annotations.destructive) {
    return {
      decision: "allow",
      reason: "This stays inside Draggy's own storage.",
    };
  }

  if (grants.some((grant) => grantCovers(grant, tool, target))) {
    return { decision: "allow", reason: "The user has already allowed this." };
  }

  if (mode === "acceptEdits" && !annotations.destructive) {
    return {
      decision: "allow",
      reason: "Edits are accepted in this workspace.",
    };
  }

  return {
    decision: "ask",
    reason: annotations.destructive
      ? "This can lose work, so the user is asked first."
      : "This changes something outside Draggy, so the user is asked first.",
  };
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
