import type { PermissionMode } from "../types";
import type { CustomCommand } from "./customCommands";
import { usableCommands } from "./slashCommands";

/** Least to most permissive. An agent may only pick a mode at or below the chat's own. */
const MODE_RANK: Record<PermissionMode, number> = { plan: 0, ask: 1, acceptEdits: 2, auto: 3, turbo: 4 };

export interface AgentParent {
  mode: PermissionMode;
  /** Tool names the agent may keep. Left empty when the agent names none. */
  tools: string[];
  /** Models the user has enabled. An agent names one of these or it is an error. */
  models: string[];
}

export interface AgentPolicy {
  model?: string;
  tools: string[];
  permissions: PermissionMode;
  /** Shown to the user; a request that could not be honoured is never silently widened. */
  errors: string[];
}

/** What one send carries to the agent loop. Tools are a list of names, left out to keep the chat's own. */
export interface AgentTurn {
  id: string;
  model?: string;
  tools?: string[];
  permissions: PermissionMode;
  errors: string[];
}

function isMode(value: string): value is PermissionMode {
  return Object.prototype.hasOwnProperty.call(MODE_RANK, value);
}

/** The more restrictive of the chat's mode and a requested one. A request never widens. */
export function narrowPermission(parent: PermissionMode, requested?: PermissionMode): PermissionMode {
  if (!requested || !isMode(requested)) return parent;
  return MODE_RANK[requested] < MODE_RANK[parent] ? requested : parent;
}

/** Resolves an agent's frontmatter against the chat. Agents can only narrow; unknown values are errors. */
export function resolveAgentPolicy(agent: CustomCommand, parent: AgentParent): AgentPolicy {
  const errors: string[] = [];

  let model: string | undefined;
  if (agent.model) {
    if (parent.models.includes(agent.model)) model = agent.model;
    else errors.push(`model "${agent.model}" is not enabled`);
  }

  let tools = [...parent.tools];
  if (agent.tools) {
    const allowed = new Set(parent.tools);
    const unknown = agent.tools.filter((name) => !allowed.has(name));
    if (unknown.length > 0) errors.push(`unknown tools: ${unknown.join(", ")}`);
    tools = agent.tools.filter((name) => allowed.has(name));
  }

  let permissions = parent.mode;
  if (agent.permissions) {
    if (!isMode(agent.permissions)) {
      errors.push(`unknown permission mode "${agent.permissions}"`);
    } else {
      if (MODE_RANK[agent.permissions] > MODE_RANK[parent.mode]) {
        errors.push(`agent cannot raise permissions above ${parent.mode}`);
      }
      permissions = narrowPermission(parent.mode, agent.permissions);
    }
  }

  return { model, tools, permissions, errors };
}

/** Sends a typed line as its agent turn. A policy with errors is not sent: the errors come back to show instead. */
export async function startAgentSend(
  typed: string | undefined,
  commands: CustomCommand[],
  mode: PermissionMode,
  canUseModel: (model: string) => Promise<boolean>,
  enabledTools: string[],
  send: (agent: AgentTurn | undefined) => void,
): Promise<string[]> {
  try {
    const agent = await agentTurnFor(typed, commands, mode, canUseModel, enabledTools);
    if (agent && agent.errors.length > 0) return agent.errors;
    send(agent ?? undefined);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

/** The agent a typed "/name args" line runs, with its narrowed settings. Null for anything else. */
export async function agentTurnFor(
  typed: string | undefined,
  commands: CustomCommand[],
  mode: PermissionMode,
  canUseModel: (model: string) => Promise<boolean>,
  enabledTools: string[],
): Promise<AgentTurn | null> {
  const match = typed ? /^\/([a-z0-9][a-z0-9-]*)(?:\s|$)/i.exec(typed.trim()) : null;
  const agent = match
    ? usableCommands(commands).find((one) => one.kind === "agent" && one.id === match[1].toLowerCase())
    : undefined;
  if (!agent) return null;

  const usable = agent.model ? await canUseModel(agent.model).catch(() => false) : false;
  const policy = resolveAgentPolicy(agent, {
    mode,
    tools: enabledTools,
    models: usable && agent.model ? [agent.model] : [],
  });
  return {
    id: agent.id,
    model: policy.model,
    tools: agent.tools ? policy.tools : undefined,
    permissions: policy.permissions,
    errors: policy.errors,
  };
}
