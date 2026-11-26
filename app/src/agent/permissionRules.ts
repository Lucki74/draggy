import type { PermissionRule, PermissionRuleKind, Workspace } from "../types";
import { commandSegments, dialectFor } from "./commandRules";
import type { ToolAnnotations } from "./permissions";

/** The rules from the Permissions page that hold in one project: its own and the ones for every
 * project. A relative path is read from the project's folder. */
export function rulesFor(
  rules: PermissionRule[] | undefined,
  workspace: Pick<Workspace, "id" | "rootPath"> | null,
): PermissionRule[] {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule && typeof rule.value === "string" && rule.value.trim())
    .filter((rule) => !rule.workspaceId || rule.workspaceId === workspace?.id)
    .map((rule) =>
      rule.kind === "path" && workspace?.rootPath && !isAbsolute(rule.value)
        ? { ...rule, value: joinPath(workspace.rootPath, rule.value) }
        : rule,
    );
}

function isAbsolute(path: string): boolean {
  return /^([a-zA-Z]:)?[\\/]/.test(path.trim()) || path.trim().startsWith("~");
}

function joinPath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relative.trim().replace(/^\.?[\\/]+/, "")}`;
}

function normalisePath(value: string): string {
  return value
    .trim()
    .replace(/[\\/]\*\*?$/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function pathCovers(rule: string, target: string): boolean {
  const ruled = normalisePath(rule);
  const asked = normalisePath(target);
  return !!ruled && (asked === ruled || asked.startsWith(`${ruled}/`));
}

function hostOf(target: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function siteCovers(rule: string, target: string): boolean {
  const ruled = hostOf(rule.trim());
  const asked = hostOf(target.trim());
  return !!ruled && !!asked && (asked === ruled || asked.endsWith(`.${ruled}`));
}

function commandStarts(segment: string, prefix: string): boolean {
  const text = segment.trim().replace(/\s+/g, " ").toLowerCase();
  const start = prefix.trim().replace(/\s+/g, " ").toLowerCase();
  return !!start && (text === start || text.startsWith(`${start} `));
}

export interface RuleCall {
  tool: string;
  annotations?: ToolAnnotations;
  target?: string | null;
  shell?: string | null;
}

/** Whether a deny rule stops this call. A command is refused when any command in its line matches,
 * and a line no reader can split is refused when the rule appears anywhere in it. */
export function denies(rule: PermissionRule, call: RuleCall): boolean {
  const target = call.target ?? "";
  switch (rule.kind) {
    case "tool":
      return call.tool === rule.value.trim();
    case "command": {
      if (!call.annotations?.executes || !target) return false;
      const segments = commandSegments(target, dialectFor(call.shell ?? null));
      if (!segments) return target.toLowerCase().includes(rule.value.trim().toLowerCase());
      return segments.some((segment) => commandStarts(segment, rule.value));
    }
    case "path":
      return !!target && !call.annotations?.executes && pathCovers(rule.value, target);
    case "site":
      return !!target && siteCovers(rule.value, target);
  }
}

/** Whether an allow rule lets this call through without a question. Commands are matched through
 * the command grants instead, so every command in a line must be allowed. */
export function allows(rule: PermissionRule, call: RuleCall): boolean {
  const target = call.target ?? "";
  switch (rule.kind) {
    case "tool":
      return call.tool === rule.value.trim();
    case "command":
      return false;
    case "path":
      return !!target && !call.annotations?.executes && pathCovers(rule.value, target);
    case "site":
      return !!target && !call.annotations?.executes && siteCovers(rule.value, target);
  }
}

/** The command starts the allow rules name, read alongside the grants saved from "Always". */
export function allowedCommands(rules: PermissionRule[]): string[] {
  return rules.filter((rule) => rule.effect === "allow" && rule.kind === "command").map((rule) => rule.value.trim());
}

export function sameRule(a: PermissionRule, b: PermissionRule): boolean {
  return (
    a.effect === b.effect &&
    a.kind === b.kind &&
    a.value.trim().toLowerCase() === b.value.trim().toLowerCase() &&
    (a.workspaceId ?? "") === (b.workspaceId ?? "")
  );
}

export const RULE_KINDS: PermissionRuleKind[] = ["command", "path", "tool", "site"];
