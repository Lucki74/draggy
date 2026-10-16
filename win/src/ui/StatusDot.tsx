import React from "react";

export type StatusKind = "ok" | "warn" | "danger" | "idle";

export interface StatusDotProps {
    status: StatusKind;
    label?: string;
    className?: string;
}

const STATUS_CLASSES: Record<StatusKind, string> = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    idle: "bg-text-tertiary",
};

/* Still status dot always paired with accessible label or adjacent text. */
export function StatusDot({ status, label, className = "" }: StatusDotProps) {
    return (
        <span
            className={`inline-block w-[6px] h-[6px] rounded-full shrink-0 ${STATUS_CLASSES[status]} ${className}`}
            role={label ? "status" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        />
    );
}
