import React from "react";
import { Icon, type IconName } from "../icons/Icon";
import { IconButton } from "../IconButton";

export interface PaneHeaderProps {
  title: React.ReactNode;
  icon?: IconName;
  actions?: React.ReactNode;
  onClose?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  closeLabel?: string;
  className?: string;
}

/** 36px header for dock panes hosting title, actions, and close button. */
export function PaneHeader({
  title,
  icon,
  actions,
  onClose,
  draggable = false,
  onDragStart,
  closeLabel = "Close",
  className = "",
}: PaneHeaderProps) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={`h-9 px-3 flex items-center justify-between gap-2 border-b border-rule bg-surface-base select-none flex-shrink-0 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${className}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {icon && <Icon name={icon} size={16} className="text-text-secondary flex-shrink-0" />}
        <span className="text-[13px] font-medium text-text-primary truncate">
          {title}
        </span>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {actions}
        {onClose && (
          <IconButton
            name="x"
            size="dense"
            label={closeLabel}
            onClick={onClose}
          />
        )}
      </div>
    </div>
  );
}
