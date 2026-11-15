import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui";

/** A picture at full screen. It grows out of the thumbnail that opened it and shrinks back into it. */

const EASE = "cubic-bezier(.23,1,.32,1)";
const TOP = 56;
const PAD = 24;

export interface ViewerImage {
  src: string;
  title: string;
  /** Web pictures: shown after the title, and the picture is linked rather than copied. */
  host?: string;
  /** Pictures on disk, for Show in folder. */
  path?: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fit(width: number, height: number): Rect {
  const room = { w: window.innerWidth - PAD * 2, h: window.innerHeight - TOP - PAD };
  const k = Math.min(room.w / width, room.h / height);
  const w = width * k;
  const h = height * k;
  return { x: (window.innerWidth - w) / 2, y: TOP + (room.h - h) / 2, w, h };
}

/** The clipboard takes PNG everywhere; a JPEG or WebP is redrawn first. */
async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("no png"))), "image/png"));
}

async function copyImage(src: string): Promise<boolean> {
  try {
    const blob = await (await fetch(src)).blob();
    const png = blob.type === "image/png" ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}

/** The thumbnail hides while its picture is out, so only one copy is ever seen. */
const hide = (element: HTMLElement, hidden: boolean) => {
  element.style.visibility = hidden ? "hidden" : "";
};

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function transformBetween(from: DOMRect, to: Rect): string {
  return `translate(${from.left - to.x}px, ${from.top - to.y}px) scale(${from.width / to.w}, ${from.height / to.h})`;
}

interface ImageViewerProps {
  image: ViewerImage;
  /** The thumbnail that opened the viewer; it hides while the viewer is open and takes the picture back. */
  origin: HTMLElement;
  onClose: () => void;
  t: (key: string) => string;
}

export function ImageViewer({ image, origin, onClose, t }: ImageViewerProps) {
  const picRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const size = () => {
    const img = origin.querySelector("img");
    return { width: img?.naturalWidth || origin.clientWidth || 1, height: img?.naturalHeight || origin.clientHeight || 1 };
  };
  const [rect, setRect] = useState<Rect>(() => fit(size().width, size().height));
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const source = () => origin.querySelector("img") ?? origin;

  useEffect(() => {
    const resize = () => setRect(fit(size().width, size().height));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  useLayoutEffect(() => {
    hide(origin, true);
    if (!reduced()) {
      picRef.current?.animate?.([{ transform: transformBetween(source().getBoundingClientRect(), rect) }, { transform: "none" }], { duration: 420, easing: EASE });
    }
    requestAnimationFrame(() => setShown(true));
    minRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minimize = useCallback(() => {
    const pic = picRef.current;
    if (closing.current || !pic) return;
    closing.current = true;
    setShown(false);
    const done = () => {
      hide(origin, false);
      origin.focus({ preventScroll: true });
      onClose();
    };
    if (reduced() || !pic.animate) return done();
    const now = pic.getBoundingClientRect();
    const anim = pic.animate(
      [{ transform: "none" }, { transform: transformBetween((origin.querySelector("img") ?? origin).getBoundingClientRect(), { x: now.left, y: now.top, w: now.width, h: now.height }) }],
      { duration: 360, easing: EASE, fill: "forwards" },
    );
    anim.onfinish = done;
  }, [origin, onClose]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        minimize();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      hide(origin, false);
    };
  }, [minimize, origin]);

  const web = Boolean(image.host);
  const copy = () => {
    const work = web ? navigator.clipboard.writeText(image.src).then(() => true, () => false) : copyImage(image.src);
    void work.then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return createPortal(
    <div className={`img-viewer${shown ? " show" : ""}`} role="dialog" aria-modal="true" aria-label={image.title}>
      <div className="scrim" onClick={minimize} />
      <div className="bar">
        <b className="truncate">{image.title}</b>
        {image.host && <span>{image.host}</span>}
        <span className="flex-1" />
        <button type="button" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={15} />
          {copied ? t("imageCopied") : web ? t("copyLink") : t("copy")}
        </button>
        {web ? (
          <button type="button" onClick={() => window.open(image.src, "_blank")}>
            <Icon name="arrow-square-out" size={15} />
            {t("openInBrowser")}
          </button>
        ) : (
          image.path && (
            <button type="button" onClick={() => void window.draggy?.revealCreatedFile(image.path as string)}>
              <Icon name="folder-open" size={15} />
              {t("showInFolder")}
            </button>
          )
        )}
        <button type="button" ref={minRef} onClick={minimize}>
          <Icon name="arrows-in-simple" size={15} />
          {t("imageMinimize")}
        </button>
      </div>
      {
        <div ref={picRef} className="pic" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
          <img src={image.src} alt={image.title} />
        </div>
      }
    </div>,
    document.body,
  );
}
