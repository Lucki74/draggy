import { useEffect, useMemo, useRef, useState } from "react";
import { Blocks } from "lucide-react";
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

/**
 * A widget an extension returned instead of text. The main process serves it
 * from an origin of its own, so it shares nothing with the app and cannot
 * reach the network. From in there it can ask for exactly two things: a
 * different height, and a read-only tool call on the server that sent it.
 */
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
    <div className="mt-2 ml-7 overflow-hidden rounded-xl border-[3px] border-[var(--border-light)]">
      <div className="flex items-center gap-2 bg-[var(--bg-panel)] px-3 py-1.5">
        <Blocks className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {serverId}
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {t("widgetSandboxed")}
        </span>
      </div>

      {source && (
        <iframe
          ref={frameRef}
          // allow-same-origin keeps the widget on its own widget:// origin
          // rather than an opaque one. That origin is not the app's, so it
          // still reaches nothing here, and it means the widget is judged by
          // its own content policy instead of inheriting the app's.
          sandbox="allow-scripts allow-same-origin"
          src={source}
          title={`${serverId} widget`}
          style={{ height: Math.min(height, MAX_WIDGET_HEIGHT) }}
          className="w-full border-0 bg-[var(--bg-base)]"
        />
      )}
    </div>
  );
}
