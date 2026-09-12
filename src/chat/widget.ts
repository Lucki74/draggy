/**
 * MCP Apps, renderer side: what a widget may ask the app for, and what the app
 * is willing to do about it. The frame itself is set up in the main process
 * (see electron/widgets.cjs), because the isolation that matters is an origin
 * of its own rather than an attribute on the element.
 */

/** What a widget may ask the app to do. Anything else is dropped. */
export type WidgetRequest =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "resize"; height: number }
  | { type: "ready" };

/** How tall a widget may grow before it is given a scrollbar instead. */
export const MAX_WIDGET_HEIGHT = 640;

/** The registry name a widget's tool call resolves to. Mirrors mcp.cjs. */
export function qualifyWidgetTool(serverId: string, name: string): string {
  const clean = (value: string) => String(value).replace(/[^a-zA-Z0-9_]/g, "_");
  return `${clean(serverId)}__${clean(name)}`;
}

export interface WidgetToolResult {
  success: boolean;
  text?: string;
  error?: string;
}

/**
 * Builds the one thing a widget can reach outside itself. Two rules: the tool
 * has to belong to the server that sent the widget, and it has to be one the
 * server itself marked read-only. A widget is markup Draggy did not write and
 * the user did not ask for, so it does not get to delete anything on the
 * strength of its own say-so.
 */
export function widgetCaller(
  serverId: string,
  call: (
    serverId: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<WidgetToolResult | undefined>,
  annotationsFor: (qualified: string) => {
    readOnly?: boolean;
    destructive?: boolean;
  },
) {
  return async (
    asked: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<WidgetToolResult> => {
    if (asked !== serverId) {
      return { success: false, error: "A widget may only call its own server." };
    }

    const annotations = annotationsFor(qualifyWidgetTool(serverId, tool));

    if (!annotations.readOnly || annotations.destructive) {
      return {
        success: false,
        error: "A widget may only call tools that read.",
      };
    }

    // A server that stopped between the widget appearing and the widget
    // asking is an answer too, rather than silence.
    const result = await call(serverId, tool, args);

    return result ?? { success: false, error: "That server is not running." };
  };
}

/**
 * Whether a message really came from this frame. Without the check, any page
 * or worker that can reach the window could pretend to be the widget and ask
 * for a tool call.
 */
export function isFromFrame(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
): boolean {
  return Boolean(frame && event.source === frame.contentWindow);
}

/** Reads a message from a widget, or rejects it. Nothing here trusts shape. */
export function readWidgetRequest(data: unknown): WidgetRequest | null {
  if (!data || typeof data !== "object") return null;

  const message = data as Record<string, unknown>;

  if (message.type === "resize") {
    const height = Number(message.height);
    if (!Number.isFinite(height) || height <= 0) return null;

    return { type: "resize", height: Math.min(height, MAX_WIDGET_HEIGHT) };
  }

  if (message.type === "ready") return { type: "ready" };

  if (message.type === "tool") {
    const name = typeof message.name === "string" ? message.name.trim() : "";
    if (!name) return null;

    const args =
      message.args && typeof message.args === "object"
        ? (message.args as Record<string, unknown>)
        : {};

    return { type: "tool", name, args };
  }

  return null;
}
