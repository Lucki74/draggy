import { registerTools, unregisterGroup } from "./registry";
import type { ToolParameter, ToolSpec } from "./registry";

/**
 * Turns an MCP server's tools into tools Draggy can call. The registry already
 * had an unused "external" group, so this side is only a translation.
 */

export interface McpToolDescription {
  name: string;
  qualifiedName: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<
      string,
      { type?: string; description?: string; enum?: unknown[] }
    >;
    required?: string[];
  };
}

export interface McpServerState {
  id: string;
  status: string;
  error: string | null;
  tools: McpToolDescription[];
}

/**
 * JSON Schema is richer than a registry parameter. Anything not scalar is
 * described as a string and passed through; the server validates it anyway.
 */
function toParameter(schema: {
  type?: string;
  description?: string;
  enum?: unknown[];
}): ToolParameter {
  const kind = String(schema?.type || "string");

  const type: ToolParameter["type"] =
    kind === "integer" || kind === "number" || kind === "boolean"
      ? (kind as ToolParameter["type"])
      : "string";

  const described = schema?.description ? String(schema.description) : "";
  const options = Array.isArray(schema?.enum)
    ? ` One of: ${schema.enum.map((value) => String(value)).join(", ")}.`
    : "";

  const shape =
    kind === "array" || kind === "object"
      ? ` Given as JSON (${kind}).`
      : "";

  return { type, description: `${described}${options}${shape}`.trim() || "No description." };
}

export function describeMcpTool(
  serverId: string,
  tool: McpToolDescription,
  call: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<
    { success: boolean; text?: string; error?: string } | undefined
  >,
): ToolSpec {
  const properties = tool.inputSchema?.properties || {};

  const parameters: Record<string, ToolParameter> = {};
  for (const [key, schema] of Object.entries(properties)) {
    parameters[key] = toParameter(schema);
  }

  const required = Array.isArray(tool.inputSchema?.required)
    ? tool.inputSchema.required.filter((key) => key in parameters)
    : [];

  const summary = tool.description || `The ${tool.name} tool from the ${serverId} server.`;

  return {
    name: tool.qualifiedName,
    group: "external",
    description: summary,
    parameters,
    required,
    usage: `${JSON.stringify(
      Object.fromEntries(required.map((key) => [key, "..."])),
    )} → ${summary}`,
    run: async (args, ctx) => {
      // An external tool has to appear in the timeline like a built-in one, or
      // a server that takes ten seconds looks like the app has stopped.
      const stepId = ctx.newId();
      ctx.pushStep({
        id: stepId,
        type: "extension",
        content: `${serverId}: **${tool.name}**`,
        isComplete: false,
      });

      const result = await call(serverId, tool.name, args);

      if (!result) {
        ctx.patchStep(stepId, { isComplete: true, type: "error" });
        ctx.syncSteps();
        return `TOOL RESULT (${tool.qualifiedName}): The ${serverId} server is unavailable.`;
      }

      if (!result.success) {
        ctx.patchStep(stepId, {
          isComplete: true,
          type: "error",
          content: `${serverId}: ${tool.name} failed`,
        });
        ctx.syncSteps();
        return `TOOL RESULT (${tool.qualifiedName}): Failed - ${result.error || "unknown error"}`;
      }

      ctx.patchStep(stepId, { isComplete: true });
      ctx.syncSteps();

      return `TOOL RESULT (${tool.qualifiedName}):\n${result.text}`;
    },
  };
}

/**
 * Replaces every external tool wholesale. A stopped server must not leave its
 * tools in the catalogue, having been offered as available.
 */
export function syncMcpTools(
  servers: McpServerState[],
  call: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<
    { success: boolean; text?: string; error?: string } | undefined
  >,
): number {
  unregisterGroup("external");

  const specs: ToolSpec[] = [];
  for (const server of servers) {
    if (server.status !== "ready") continue;
    for (const tool of server.tools) {
      specs.push(describeMcpTool(server.id, tool, call));
    }
  }

  if (specs.length > 0) registerTools(specs);
  return specs.length;
}
