import React, { useEffect, useRef } from "react";
import { registerOverlay } from "./overlays";

export type PopoverAlign = "start" | "end";
export type PopoverSide = "bottom" | "top";

/** Closes a floating layer on Escape or on a pointer press outside `refs`. Escape is stopped here so
 * only the innermost open layer closes. */
export function useDismiss(
    open: boolean,
    refs: React.RefObject<HTMLElement | null>[],
    onDismiss: (reason: "escape" | "outside") => void,
) {
    const latest = useRef(onDismiss);
    useEffect(() => {
        latest.current = onDismiss;
    });

    useEffect(() => {
        if (!open) return;
        // The last ref is the floating panel itself; the ones before it are what anchors it.
        const panel = refs[refs.length - 1];
        const unregister = registerOverlay(() => panel?.current?.getBoundingClientRect() ?? null);
        const onPointer = (event: PointerEvent) => {
            const target = event.target as Node;
            if (refs.some((ref) => ref.current?.contains(target))) return;
            latest.current("outside");
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            latest.current("escape");
        };
        document.addEventListener("pointerdown", onPointer, true);
        document.addEventListener("keydown", onKey, true);
        return () => {
            unregister();
            document.removeEventListener("pointerdown", onPointer, true);
            document.removeEventListener("keydown", onKey, true);
        };
        // The refs array is rebuilt every render; its members are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
}

export const FLOAT_CLASSES =
    "absolute z-50 min-w-44 rounded-sm bg-surface-base shadow-elev-1 text-[13px] text-text-primary float-in";

export function floatPosition(align: PopoverAlign, side: PopoverSide) {
    return `${align === "end" ? "end-0" : "start-0"} ${side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`;
}

