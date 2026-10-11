import React, { useEffect, useId, useRef } from "react";
import { IconButton } from "./IconButton";
import { registerOverlay, wholeWindow } from "./overlays";

export interface DialogProps {
    open: boolean;
    onClose: () => void;
    title: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
    /** Buttons, end-aligned under the content. */
    actions?: React.ReactNode;
    closeLabel: string;
    width?: number;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal layer over a scrim. Focus moves in, Tab stays inside, Escape closes, and focus goes back
 * to whatever had it before the dialog opened. */
export function Dialog({ open, onClose, title, description, children, actions, closeLabel, width = 440 }: DialogProps) {
    const titleId = useId();
    const descId = useId();
    const boxRef = useRef<HTMLDivElement>(null);
    const latestClose = useRef(onClose);
    useEffect(() => {
        latestClose.current = onClose;
    });

    useEffect(() => {
        if (!open) return;
        const opener = document.activeElement as HTMLElement | null;
        const box = boxRef.current;
        const first = box?.querySelector<HTMLElement>("[data-autofocus]") ?? box?.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? box)?.focus();
        const unregister = registerOverlay(wholeWindow);

        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                latestClose.current();
                return;
            }
            if (event.key !== "Tab" || !box) return;
            const nodes = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (!nodes.length) return;
            const head = nodes[0];
            const tail = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === head) {
                event.preventDefault();
                tail.focus();
            } else if (!event.shiftKey && document.activeElement === tail) {
                event.preventDefault();
                head.focus();
            }
        };
        document.addEventListener("keydown", onKey, true);
        return () => {
            unregister();
            document.removeEventListener("keydown", onKey, true);
            opener?.focus?.();
        };
    }, [open]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[var(--scrim)] fade-in" onClick={onClose} aria-hidden="true" />
            <div
                ref={boxRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descId : undefined}
                tabIndex={-1}
                style={{ maxWidth: width }}
                className="relative w-full max-h-[85vh] overflow-y-auto rounded-lg bg-surface-base shadow-elev-1 p-6 outline-none float-in"
            >
                <div className="flex items-start gap-3">
                    <h2 id={titleId} className="flex-1 text-[18px] leading-[26px] font-semibold text-text-primary">
                        {title}
                    </h2>
                    <IconButton name="x" label={closeLabel} size="sm" onClick={onClose} className="-me-2 -mt-1" />
                </div>
                {description && (
                    <p id={descId} className="mt-1 text-[14px] leading-5 text-text-secondary">
                        {description}
                    </p>
                )}
                {children && <div className="mt-4">{children}</div>}
                {actions && <div className="mt-6 flex flex-wrap justify-end gap-2">{actions}</div>}
            </div>
        </div>
    );
}
