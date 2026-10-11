import { useCallback, useState } from "react";

const TREE_WIDTH = 224;
const MIN_SIDE_WIDTH = 280;
const CHAT_WIDTH_BESIDE_TREE = 460;

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
        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            setTreeWidth(Math.max(160, Math.min(480, startW + delta)));
        };
        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }, [treeWidth]);

    const startResizeRightPane = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = rightPaneWidth;
        let lastWidth = startW;
        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = startX - moveEvent.clientX;
            const maxW = Math.max(300, window.innerWidth - 420);
            lastWidth = Math.max(260, Math.min(maxW, startW + delta));
            setRightPaneWidth(lastWidth);
        };
        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            onRightPaneWidthChange?.(lastWidth);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }, [rightPaneWidth, onRightPaneWidthChange]);

    const isNarrow = workAreaWidth < 1100 || (typeof window !== "undefined" && window.innerWidth < 1100);
    const treeFits = workAreaWidth >= TREE_WIDTH + CHAT_WIDTH_BESIDE_TREE + (!isNarrow && canvasPath ? MIN_SIDE_WIDTH : 0);

    return {
        treeOpen,
        setTreeOpen,
        treeFits,
        treeWidth,
        rightPaneWidth,
        isNarrow,
        observeWorkArea,
        startResizeTree,
        startResizeRightPane,
    };
}

