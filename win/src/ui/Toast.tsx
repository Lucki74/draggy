import React, { useEffect, useRef, useState } from "react";
import { collectErrorDetails } from "../errorDetails";
import { uiText } from "../i18n";
import { logRendererEvent, logSwallow, newCorrelationId } from "../logger";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

export interface ToastProps {
  open: boolean;
  onClose?: () => void;
  children?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: React.ReactNode;
  tone?: "neutral" | "danger" | "ok";
  duration?: number;
  className?: string;
}

/** Non-modal status message at the window's bottom-end corner, one at a time.
 * Automatically clears after duration if specified, and accepts an action. */
export function Toast({
  open,
  onClose,
  children,
  title,
  description,
  action,
  icon,
  tone = "neutral",
  duration,
  className = "",
}: ToastProps) {
  useEffect(() => {
    if (!open || !duration || !onClose) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [open, duration, onClose]);

  // An error the user sees is also a log line, under an id the copied details carry.
  const errorId = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const failing = open && tone === "danger";

  useEffect(() => {
    if (!failing) {
      errorId.current = null;
      return;
    }
    errorId.current = newCorrelationId();
    logRendererEvent(
      "renderer.ui",
      "WARN",
      "error shown",
      { surface: "toast", text: typeof title === "string" ? title.slice(0, 160) : null },
      errorId.current,
    );
    // Only the moment it opens is a new error; a re-render with the same title is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failing, typeof title === "string" ? title : null]);

  const copyDetails = async () => {
    try {
      const text = await collectErrorDetails({
        text: typeof title === "string" ? title : "",
        scope: "toast",
        cid: errorId.current ?? undefined,
      });
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logSwallow("app", error, "clipboard access can fail in restricted environments");
    }
  };

  if (!open) return null;

  const toneClass =
    tone === "danger"
      ? "border-danger/30 text-danger"
      : tone === "ok"
        ? "border-ok/30 text-text-primary"
        : "border-rule text-text-primary";

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live="polite"
      className={`fixed bottom-4 end-4 z-[100] flex max-w-md items-center gap-3 rounded-md bg-surface-base px-3.5 py-2.5 text-[13px] leading-5 shadow-elev-1 border float-in ${toneClass} ${className}`}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-text-primary">{title}</p>}
        {description && <p className="text-[12px] leading-4 text-text-secondary">{description}</p>}
        {children}
      </div>
      {action && (
        <Button variant="secondary" size="dense" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {failing && !action && (
        <Button variant="ghost" size="dense" onClick={() => void copyDetails()}>
          {copied ? uiText("errorCopied") : uiText("errorCopy")}
        </Button>
      )}
      {onClose && <IconButton name="x" label={uiText("dismiss")} size="sm" onClick={onClose} />}
    </div>
  );
}
