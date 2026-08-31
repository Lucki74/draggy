import type { AppSettings, SearchStep } from "../types";

export type ToolGroup = "web" | "browser" | "files" | "code" | "library" | "external";

export interface ToolParameter {
  type: "string" | "integer" | "number" | "boolean";
  description: string;
}

export interface ToolEnvironment {
  webMode: AppSettings["webMode"];
  codeExecution: boolean;
  libraryReady: boolean;
}

export interface ToolContext {
  t: (key: string) => string;
  settings: AppSettings;
  pushStep: (step: SearchStep) => void;
  patchStep: (id: string, patch: Partial<SearchStep>) => void;
  syncSteps: () => void;
  newId: () => string;
  signal: AbortSignal;
  /**
   * Scratch space shared by every tool call in one turn and thrown away after
   * it. Tools use it to notice that they are being asked the same thing twice.
   */
  memo: Map<string, unknown>;
}

export interface ToolSpec {
  name: string;
  group: ToolGroup;
  description: string;
  parameters: Record<string, ToolParameter>;
  required: string[];
  usage: string;
  available?: (environment: ToolEnvironment) => boolean;
  run: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameter>;
      required: string[];
    };
  };
}

const registry = new Map<string, ToolSpec>();

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function onRegistryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerTool(spec: ToolSpec): void {
  registry.set(spec.name, spec);
  notify();
}

export function registerTools(specs: ToolSpec[]): void {
  for (const spec of specs) registry.set(spec.name, spec);
  notify();
}

export function unregisterTool(name: string): void {
  if (registry.delete(name)) notify();
}

export function unregisterGroup(group: ToolGroup): void {
  let changed = false;
  for (const [name, spec] of registry) {
    if (spec.group === group) {
      registry.delete(name);
      changed = true;
    }
  }
  if (changed) notify();
}

export function allTools(): ToolSpec[] {
  return [...registry.values()];
}

export function allToolNames(): string[] {
  return [...registry.keys()];
}

export function availableTools(environment: ToolEnvironment): ToolSpec[] {
  return allTools().filter(
    (spec) => !spec.available || spec.available(environment),
  );
}

export function isBrowsingTool(name: string): boolean {
  const spec = registry.get(name);
  return spec?.group === "web" || spec?.group === "browser";
}

export function toolDefinitions(environment: ToolEnvironment): ToolDefinition[] {
  return availableTools(environment).map((spec) => ({
    type: "function" as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: {
        type: "object" as const,
        properties: spec.parameters,
        required: spec.required,
      },
    },
  }));
}

export function describeToolsForPrompt(environment: ToolEnvironment): string {
  const specs = availableTools(environment);
  if (specs.length === 0) return "";

  const lines = specs.map(
    (spec, index) => `${index + 1}. ${spec.name}: ${spec.usage}`,
  );

  return `AVAILABLE TOOLS
${lines.join("\n")}

To use a tool, output EXACTLY this JSON format inside <tool> tags and nothing else:
<tool>
{"name": "${specs[0].name}", "args": {${specs[0].required
    .map((key) => `"${key}": "..."`)
    .join(", ")}}}
</tool>

Call one tool at a time and wait for its result before deciding what to do next. Stop calling tools and answer as soon as you have what you need.`;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  environment: ToolEnvironment,
): Promise<string> {
  const spec = registry.get(name);

  if (!spec) {
    return `TOOL ERROR: There is no tool called "${name}". Available tools: ${availableTools(
      environment,
    )
      .map((entry) => entry.name)
      .join(", ")}.`;
  }

  if (spec.available && !spec.available(environment)) {
    if (spec.group === "web" || spec.group === "browser") {
      return "TOOL RESULT: Web access is turned off for this conversation. Answer from your own knowledge.";
    }
    return `TOOL RESULT (${name}): This tool is not enabled right now.`;
  }

  const missing = spec.required.filter(
    (key) => args[key] === undefined || args[key] === null || args[key] === "",
  );
  if (missing.length > 0) {
    return `TOOL ERROR (${name}): missing required argument(s): ${missing.join(", ")}.`;
  }

  try {
    return await spec.run(args, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `TOOL RESULT (${name}): Failed - ${message}`;
  }
}

export function resetRegistry(): void {
  registry.clear();
  notify();
}
