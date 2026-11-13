import { useCallback, useState } from "react";

const TREE_WIDTH = 224;
const MIN_SIDE_WIDTH = 280;
const CHAT_WIDTH_BESIDE_TREE = 460;
const CHAT_MIN_WIDTH = 420;

export interface ShellLayoutOptions {
    canvasPath: string | null;
    initialRightPaneWidth?: number;
    onRightPaneWidthChange?: (width: number) => void;
}

/* Manages panel sizing, column constraints and drag resizing handlers. */
export function useShellLayout({
    canvasPath,
    initialRightPaneWidth,
    onRightPaneWidthChange,
}: ShellLayoutOptions) {
    const [treeOpen, setTreeOpen] = useState(true);
    const [workAreaWidth, setWorkAreaWidth] = useState(Infinity);
    const [treeWidth, setTreeWidth] = useState(TREE_WIDTH);
    const [rightPaneWidth, setRightPaneWidth] = useState(initialRightPaneWidth ?? 500);

    const observeWorkArea = useCallback((area: HTMLDivElement | null) => {
        if (!area || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => setWorkAreaWidth(Math.round(entry.contentRect.width)));
        observer.observe(area);
        return () => observer.disconnect();
    }, []);

    const startResizeTree = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = treeWidth;
        // The chat beside the tree keeps its 340px minimum, so the tree never pushes it off the window.
        const maxW = Math.max(startW, Math.min(480, workAreaWidth - 340));
        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            setTreeWidth(Math.max(160, Math.min(maxW, startW + delta)));
        };
        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }, [treeWidth, workAreaWidth]);

    const startResizeRightPane = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        // Capture keeps the drag alive over the chat, a browser pane or anything else under the cursor.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        const startX = e.clientX;
        const startW = rightPaneWidth;
        let lastWidth = startW;
        // The pane grows only into room the chat can give up; past that it would push off the window's edge.
        const room = Math.min(window.innerWidth, startW + workAreaWidth) - CHAT_MIN_WIDTH;
        const maxW = Math.max(startW, 300, room);
        const onMouseMove = (moveEvent: PointerEvent) => {
            const delta = startX - moveEvent.clientX;
            lastWidth = Math.max(260, Math.min(maxW, startW + delta));
            setRightPaneWidth(lastWidth);
        };
        const onMouseUp = () => {
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
            window.removeEventListener("pointercancel", onMouseUp);
            window.removeEventListener("pointermove", onMouseMove);
            window.removeEventListener("pointerup", onMouseUp);
            onRightPaneWidthChange?.(lastWidth);
        };
        window.addEventListener("pointermove", onMouseMove);
        window.addEventListener("pointerup", onMouseUp);
        window.addEventListener("pointercancel", onMouseUp);
    }, [rightPaneWidth, workAreaWidth, onRightPaneWidthChange]);

    // Window width only: the dock itself shrinks the work area, so using that would flip the dock to an overlay mid-drag.
    const isNarrow = typeof window !== "undefined" && window.innerWidth < 1100;
    const treeFits = workAreaWidth >= TREE_WIDTH + CHAT_WIDTH_BESIDE_TREE + (!isNarrow && canvasPath ? MIN_SIDE_WIDTH : 0);
    // A docked pane that would leave the chat under its minimum floats over it instead, so the chat keeps its width.
    const dockOverlay = isNarrow || workAreaWidth - rightPaneWidth < CHAT_MIN_WIDTH;

    return {
        treeOpen,
        setTreeOpen,
        treeFits,
        treeWidth,
        rightPaneWidth,
        dockOverlay,
        observeWorkArea,
        startResizeTree,
        startResizeRightPane,
    };
}

