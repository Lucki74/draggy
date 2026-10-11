import React from "react";
import { Kbd } from "./Kbd";

export interface TooltipProps {
    label: React.ReactNode;
    shortcut?: string;
    side?: "top" | "bottom";
    align?: "center" | "start" | "end";
    children: React.ReactNode;
    className?: string;
}

const ALIGN = { center: "start-1/2 -translate-x-1/2", start: "start-0", end: "end-0" };

/** A label that shows on hover after a short delay and on keyboard focus, with the shortcut
 * beside it so keys are learned by use. Purely visual: the child keeps its own accessible name. */
export function Tooltip({ label, shortcut, side = "bottom", align = "center", children, className = "" }: TooltipProps) {
    return (
        <span className={`tip-host relative inline-flex ${className}`}>
            {children}
            <span
                aria-hidden="true"
                className={`tip ${ALIGN[align]} ${side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"} inline-flex items-center gap-2 rounded-xs bg-action-bg px-2 py-1 text-[12px] leading-4 text-action-fg`}
            >
                {label}
                {shortcut && <Kbd className="!bg-transparent !border-action-fg/30 !text-action-fg">{shortcut}</Kbd>}
            </span>
        </span>
    );
}
