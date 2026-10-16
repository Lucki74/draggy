import type { ReactNode } from "react";
import { Button } from "./Button";

interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: ReactNode;
  className?: string;
}

/** One sentence and an optional action; no illustrations or stock drawings. */
export function EmptyState({
  message,
  actionLabel,
  onAction,
  actionIcon,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center space-y-3 ${className}`}>
      <p className="text-[13px] text-text-secondary">{message}</p>
      {actionLabel && onAction && (
        <Button variant="secondary" size="dense" onClick={onAction} icon={actionIcon}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
