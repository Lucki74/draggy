/** Floating layers that are open right now. The Browser pane's page is a native view drawn above all
 * HTML, so it reads this list and steps aside whenever one of them would land on top of it. */

type Area = () => DOMRect | null;

const layers = new Set<Area>();
const listeners = new Set<() => void>();
let queued = false;

/** Tells listeners after the next frame, once the layer has been laid out and has a size. */
function notify() {
    if (queued) return;
    queued = true;
    const run = () => {
        queued = false;
        for (const listener of [...listeners]) listener();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 0);
}

/** Registers an open layer by the area it covers. Returns the call that unregisters it. */
export function registerOverlay(area: Area): () => void {
    layers.add(area);
    notify();
    return () => {
        layers.delete(area);
        notify();
    };
}

export function subscribeOverlays(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The whole window, for modal layers whose scrim covers everything. */
export const wholeWindow = () => new DOMRect(0, 0, window.innerWidth, window.innerHeight);

export function overlapsOverlay(rect: { left: number; top: number; right: number; bottom: number }): boolean {
    for (const area of layers) {
        const box = area();
        if (!box || box.width === 0 || box.height === 0) continue;
        if (box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top) return true;
    }
    return false;
}
