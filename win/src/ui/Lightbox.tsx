import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons/Icon";

export interface LightboxProps {
  open: boolean;
  src?: string;
  alt?: string;
  onClose: () => void;
}

/** Full-screen overlay to inspect image attachments at original size with zoom. */
export function Lightbox({ open, src, alt, onClose }: LightboxProps) {
  const [scale, setScale] = useState(1);

  const handleClose = useCallback(() => {
    setScale(1);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open || !src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Image preview"}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-xs p-6 fade-in select-none"
      onClick={handleClose}
    >
      <div
        className="relative max-w-full max-h-full flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt || ""}
          style={{ transform: `scale(${scale})`, transition: "transform 150ms ease-out" }}
          className="max-w-[85vw] max-h-[85vh] object-contain rounded-sm shadow-2xl cursor-default"
        />

        <div className="absolute top-2 end-2 flex items-center gap-1.5 bg-surface-base/90 backdrop-blur-xs rounded-pill px-2 py-1 shadow-md border border-rule">
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            aria-label="Zoom in"
            title="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-pill text-text-secondary hover:text-text-primary hover:bg-surface-raised cursor-pointer"
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            type="button"
            onClick={() => setScale(1)}
            aria-label="Reset zoom"
            title="Reset zoom"
            className="px-2 text-xs font-mono text-text-secondary hover:text-text-primary cursor-pointer"
          >
            {Math.round(scale * 100)}%
          </button>
          <div className="h-4 w-px bg-rule mx-0.5" />
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            title="Close"
            className="flex h-7 w-7 items-center justify-center rounded-pill text-text-secondary hover:text-text-primary hover:bg-surface-raised cursor-pointer"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
export default Lightbox;
