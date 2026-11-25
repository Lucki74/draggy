import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { FLOAT_CLASSES, floatPosition, useDismiss, type PopoverAlign, type PopoverSide } from "./float";

export type { PopoverAlign, PopoverSide };

export interface TriggerProps {
    ref: React.Ref<HTMLButtonElement>;
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu" | "dialog";
    "aria-controls"?: string;
}

export interface PopoverProps {
    /** Renders the anchor. Spread the props onto a button. */
    trigger: (props: TriggerProps) => React.ReactNode;
    children: React.ReactNode | ((close: () => void) => React.ReactNode);
    align?: PopoverAlign;
    side?: PopoverSide;
    label?: string;
    className?: string;
    /** Classes for the box holding the trigger, such as `flex w-full` for a full-width row. */
    anchorClassName?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

/** A panel anchored to a trigger, level 1 elevation. Focus returns to the trigger when it closes. */
export function Popover({
    trigger,
    children,
    align = "start",
    side = "bottom",
    label,
    className = "",
    anchorClassName = "inline-flex",
    open: controlled,
    onOpenChange,
}: PopoverProps) {
    const [own, setOwn] = useState(false);
    const open = controlled ?? own;
    const id = useId();
    const anchorRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const setOpen = useCallback(
        (next: boolean) => {
            if (controlled === undefined) setOwn(next);
            onOpenChange?.(next);
        },
        [controlled, onOpenChange],
    );

    const close = useCallback(() => setOpen(false), [setOpen]);

    // In a narrow column an end-aligned panel can reach past the window edge: slide it back inside.
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!open || !panel) return;
        panel.style.translate = "";
        const box = panel.getBoundingClientRect();
        const margin = 8;
        let shift = 0;
        if (box.left < margin) shift = margin - box.left;
        else if (box.right > window.innerWidth - margin) shift = window.innerWidth - margin - box.right;
        if (shift) panel.style.translate = `${shift}px 0`;
    }, [open]);

    // When the panel goes away with focus inside it, focus would fall to the page: hand it back to the trigger.
    const wasOpen = useRef(open);
    useEffect(() => {
        if (wasOpen.current && !open && (!document.activeElement || document.activeElement === document.body)) {
            anchorRef.current?.focus();
        }
        wasOpen.current = open;
    }, [open]);

    useDismiss(open, [anchorRef, panelRef], (reason) => {
        setOpen(false);
        if (reason === "escape") anchorRef.current?.focus();
    });

    return (
        <div className={`relative ${anchorClassName}`}>
            {trigger({
                ref: anchorRef,
                onClick: () => setOpen(!open),
                "aria-expanded": open,
                "aria-haspopup": "dialog",
                "aria-controls": open ? id : undefined,
            })}
            {open && (
                <div
                    ref={panelRef}
                    id={id}
                    role="dialog"
                    aria-label={label}
                    className={`${FLOAT_CLASSES} ${floatPosition(align, side)} ${className}`}
                >
                    {typeof children === "function" ? children(close) : children}
                </div>
            )}
        </div>
    );
}
