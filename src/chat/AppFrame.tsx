import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui";
import { annotationsFor } from "../tools/registry";
import {
  MAX_WIDGET_HEIGHT,
  isFromFrame,
  readWidgetRequest,
  widgetCaller,
} from "./widget";
import type { WidgetToolResult } from "./widget";

interface AppFrameProps {
  serverId: string;
  html: string;
  t: (key: string) => string;
  /** Runs a tool the widget asked for, on the server the widget came from. */
  onCall?: (
    serverId: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<WidgetToolResult>;
}

/** A widget served from its own origin, with no network and nothing shared with the app. It may
 * only ask to resize and to run read-only tools on its server. */
export default function AppFrame({ serverId, html, t, onCall }: AppFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [height, setHeight] = useState(160);

  // The markup goes to the main process, which hands back an address to load
  // it from. Nothing about the widget is ever put into this document.
  useEffect(() => {
    let token: string | null = null;
    let dropped = false;

    const api = window.electronAPI?.widgets;

    void api?.stage(html).then((staged) => {
      if (!staged?.success || !staged.url) return;

      if (dropped) {
        void api.release(staged.token as string);
        return;
      }

      token = staged.token ?? null;
      setSource(staged.url);
    });

    return () => {
      dropped = true;
      if (token) void api?.release(token);
    };
  }, [html]);

  const call = useMemo(
    () =>
      onCall ??
      widgetCaller(
        serverId,
        async (id, tool, args) => window.electronAPI?.mcp?.call(id, tool, args),
        annotationsFor,
      ),
    [serverId, onCall],
  );

  useEffect(() => {
    const listen = async (event: MessageEvent) => {
      if (!isFromFrame(event, frameRef.current)) return;

      const request = readWidgetRequest(event.data);
      if (!request) return;

      if (request.type === "resize") {
        setHeight(request.height);
        return;
      }

      if (request.type === "tool") {
        const result = await call(serverId, request.name, request.args);

        // The answer goes back into the frame it came from, and nowhere else:
        // a widget is not a way for a server to write in the conversation.
        frameRef.current?.contentWindow?.postMessage(
          { type: "toolResult", name: request.name, ...result },
          event.origin || "*",
        );
      }
    };

    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [serverId, call]);

  return (
    <div className="mt-2 overflow-hidden rounded-sm border border-rule">
      <div className="flex items-center gap-2 h-8 border-b border-rule bg-surface-base px-3">
        <Icon name="puzzle-piece" size={14} className="text-text-secondary" />
        <span className="font-mono text-[12px] text-text-secondary">
          {serverId}
        </span>
        <span className="ms-auto text-[12px] text-text-tertiary">
          {t("widgetSandboxed")}
        </span>
      </div>

      {source && (
        <iframe
          ref={frameRef}
          // allow-same-origin keeps the widget on its widget:// origin, not an opaque one, so it
          // follows its own policy instead of inheriting ours.
          sandbox="allow-scripts allow-same-origin"
          src={source}
          title={`${serverId} widget`}
          style={{ height: Math.min(height, MAX_WIDGET_HEIGHT) }}
          className="w-full border-0 bg-surface-base"
        />
      )}
    </div>
  );
}
