import React from "react";
import { uiText } from "../i18n";
import { Icon } from "./icons/Icon";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    label: React.ReactNode;
    count?: number | string;
    icon?: React.ReactNode;
    selected?: boolean;
    dropdown?: boolean;
    onDelete?: (e: React.MouseEvent) => void;
    size?: "default" | "dense";
}

/* Choice pill with optional count, leading icon and menu caret. */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
    {
        label,
        count,
        icon,
        selected = false,
        dropdown = false,
        onDelete,
        size = "default",
        disabled = false,
        className = "",
        type = "button",
        ...props
    },
    ref,
) {
    const sizeClasses = size === "dense"
        ? "h-6 px-2 text-[11px] gap-1"
        : "h-7 px-2.5 text-[12px] gap-1.5";

    const stateClasses = selected
        ? "bg-surface-base text-text-primary border-text-primary shadow-xs"
        : "bg-surface-tint text-text-secondary border-rule hover:text-text-primary hover:bg-surface-raised active:bg-surface-raised/80";

    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled}
            aria-pressed={selected ? "true" : undefined}
            className={`inline-flex items-center min-w-0 font-medium rounded-pill border transition-colors duration-120 select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas ${sizeClasses} ${stateClasses} ${className}`}
            {...props}
        >
            {icon && <span className="shrink-0 inline-flex items-center">{icon}</span>}
            <span className="truncate">{label}</span>
            {count !== undefined && (
                <span className="px-1.5 py-0.2 rounded-pill bg-surface-raised text-[10px] tabular-nums font-mono">
                    {count}
                </span>
            )}
            {dropdown && (
                <Icon name="caret-down" size={14} className="text-text-secondary shrink-0" aria-hidden />
            )}
            {onDelete && (
                <span
                    role="button"
                    tabIndex={0}
                    aria-label={uiText("remove")}
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(e);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            e.preventDefault();
                            onDelete(e as unknown as React.MouseEvent);
                        }
                    }}
                    className="ms-0.5 p-0.5 rounded-full hover:bg-surface-raised hover:text-danger cursor-pointer"
                >
                    <Icon name="x" size={12} aria-hidden />
                </span>
            )}
        </button>
    );
});
