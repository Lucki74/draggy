import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uiText } from "../i18n";
import { Icon } from "./icons/Icon";
import { clampPan, fitScale, wheelFactor, zoomAt, type Size, type View } from "./imageView";

export interface LightboxProps {
  open: boolean;
  src?: string;
  alt?: string;
  onClose: () => void;
}

const STAGE_SIZE: Size = { width: 0, height: 0 };
const KEY_STEP = 1.25;
const PAN_STEP = 60;

const buttonClass =
  "flex h-7 w-7 items-center justify-center rounded-pill text-text-secondary hover:text-text-primary hover:bg-surface-raised cursor-pointer";

/** Full-screen viewer: wheel zooms toward the cursor, drag pans, double-click toggles fit and 100%. */
export function Lightbox({ open, src, alt, onClose }: LightboxProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [natural, setNatural] = useState<Size>(STAGE_SIZE);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; from: View } | null>(null);
  const fitted = useRef(true);

  const boxSize = useCallback((): Size => {
    const rect = stage.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, []);

  const fit = useCallback(() => {
    fitted.current = true;
    setView({ scale: fitScale(natural, boxSize()), x: 0, y: 0 });
  }, [natural, boxSize]);

  const actualSize = useCallback(() => {
    fitted.current = false;
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  // Anchors are measured from the stage centre, which is where the picture sits.
  const zoomBy = useCallback(
    (factor: number, anchor = { x: 0, y: 0 }) => {
      fitted.current = false;
      setView((current) => zoomAt(current, factor, anchor, natural, boxSize()));
    },
    [natural, boxSize],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => setView((current) => clampPan({ ...current, x: current.x + dx, y: current.y + dy }, natural, boxSize())),
    [natural, boxSize],
  );

  const fromCentre = useCallback((clientX: number, clientY: number) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [PAN_STEP, 0],
        ArrowRight: [-PAN_STEP, 0],
        ArrowUp: [0, PAN_STEP],
        ArrowDown: [0, -PAN_STEP],
      };
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomBy(KEY_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / KEY_STEP);
      else if (e.key === "0") fit();
      else if (e.key === "1") actualSize();
      else if (arrows[e.key]) panBy(...arrows[e.key]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, zoomBy, fit, actualSize, panBy]);

  // Registered by hand because React's wheel listener is passive and cannot stop the page behind from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(wheelFactor(e.deltaY), fromCentre(e.clientX, e.clientY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, zoomBy, fromCentre, src]);

  // A resize keeps a fitted picture fitted rather than leaving it at the old scale.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (fitted.current) setView({ scale: fitScale(natural, boxSize()), x: 0, y: 0 });
      else setView((current) => clampPan(current, natural, boxSize()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, natural, boxSize]);

  if (!open || !src) return null;

  const percent = Math.round(view.scale * 1000) / 10;

  // In the body, so no transformed ancestor in the chat can shrink the full-screen box to its own size.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Image preview"}
      className="fixed inset-0 z-[120] flex flex-col bg-black/85 backdrop-blur-xs fade-in select-none"
    >
      <div
        ref={stage}
        className={`relative flex flex-1 min-h-0 items-center justify-center overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onDoubleClick={() => {
          if (Math.abs(view.scale - 1) < 0.001) fit();
          else actualSize();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, from: view };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start) return;
          setView(clampPan({ ...start.from, x: start.from.x + e.clientX - start.x, y: start.from.y + e.clientY - start.y }, natural, boxSize()));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        <img
          src={src}
          alt={alt || ""}
          draggable={false}
          onLoad={(e) => {
            const size = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight };
            setNatural(size);
            fitted.current = true;
            setView({ scale: fitScale(size, boxSize()), x: 0, y: 0 });
          }}
          style={{
            width: natural.width || undefined,
            height: natural.height || undefined,
            maxWidth: "none",
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            visibility: natural.width ? "visible" : "hidden",
          }}
          className="max-w-none shrink-0 rounded-sm shadow-2xl"
        />
      </div>

      <div className="absolute top-3 end-3 flex items-center gap-1.5 bg-surface-base/90 backdrop-blur-xs rounded-pill px-2 py-1 shadow-md border border-rule">
        <button type="button" onClick={() => zoomBy(1 / KEY_STEP)} aria-label={uiText("zoomOut")} title={`${uiText("zoomOut")} (-)`} className={buttonClass}>
          <span aria-hidden="true" className="text-base leading-none">−</span>
        </button>
        <button type="button" onClick={() => zoomBy(KEY_STEP)} aria-label={uiText("zoomIn")} title={`${uiText("zoomIn")} (+)`} className={buttonClass}>
          <Icon name="plus" size={16} />
        </button>
        <button
          type="button"
          onClick={() => (Math.abs(view.scale - 1) < 0.001 ? fit() : actualSize())}
          aria-label={uiText("lightboxFit")}
          title={uiText("lightboxFitHint")}
          className="px-2 text-xs font-mono text-text-secondary hover:text-text-primary cursor-pointer"
        >
          {percent}%
        </button>
        <div className="h-4 w-px bg-rule mx-0.5" />
        <button type="button" onClick={onClose} aria-label={uiText("closeDialog")} title={`${uiText("closeDialog")} (Esc)`} className={buttonClass}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
export default Lightbox;
