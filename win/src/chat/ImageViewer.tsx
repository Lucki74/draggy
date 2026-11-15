import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../ui";
import { clampScale, wheelFactor } from "../ui/imageView";

/** A picture at full screen. It grows out of the thumbnail that opened it and shrinks back into it.
 * The wheel zooms toward the cursor from 1% to 800% of the picture's own size, and a drag moves it. */

const EASE = "cubic-bezier(.23,1,.32,1)";
const TOP = 56;
const PAD = 24;
const KEY_STEP = 1.25;
// However far it is dragged, this much of the picture stays on screen to grab it back.
const KEEP = 64;

/** Zoom is the picture's own pixels (1 = 100%); x and y move its centre from the centre of its fitted box. */
interface View {
  zoom: number;
  x: number;
  y: number;
}

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
  const room = {
    w: window.innerWidth - PAD * 2,
    h: window.innerHeight - TOP - PAD,
  };
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
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("no png"))),
      "image/png",
    ),
  );
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

const reduced = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

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
  const rootRef = useRef<HTMLDivElement>(null);
  const minRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const size = () => {
    const img = origin.querySelector("img");
    return {
      width: img?.naturalWidth || origin.clientWidth || 1,
      height: img?.naturalHeight || origin.clientHeight || 1,
    };
  };
  const [rect, setRect] = useState<Rect>(() =>
    fit(size().width, size().height),
  );
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const source = () => origin.querySelector("img") ?? origin;
  const fitZoom = rect.w / size().width;
  const [view, setView] = useState<View | null>(null);
  const [eased, setEased] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; from: View } | null>(null);
  const current: View = view ?? { zoom: fitZoom, x: 0, y: 0 };

  /** Keeps a corner of the picture on screen wherever it is pushed. */
  const held = useCallback(
    (next: View): View => {
      const k = next.zoom / fitZoom;
      const limitX = (rect.w * k) / 2 + window.innerWidth / 2 - KEEP;
      const limitY = (rect.h * k) / 2 + window.innerHeight / 2 - KEEP;
      return {
        zoom: next.zoom,
        x: Math.max(-limitX, Math.min(limitX, next.x)),
        y: Math.max(-limitY, Math.min(limitY, next.y)),
      };
    },
    [fitZoom, rect.w, rect.h],
  );

  // The anchor is measured from the centre of the fitted box, so the point under it stays put.
  const zoomBy = useCallback(
    (factor: number, anchor = { x: 0, y: 0 }, smooth = false) => {
      setEased(smooth);
      setView((was) => {
        const from = was ?? { zoom: fitZoom, x: 0, y: 0 };
        const zoom = clampScale(from.zoom * factor);
        const ratio = zoom / from.zoom;
        return held({
          zoom,
          x: anchor.x - (anchor.x - from.x) * ratio,
          y: anchor.y - (anchor.y - from.y) * ratio,
        });
      });
    },
    [fitZoom, held],
  );
  const fitView = () => {
    setEased(true);
    setView(null);
  };
  const actualSize = () => {
    setEased(true);
    setView({ zoom: 1, x: 0, y: 0 });
  };
  const fromCentre = (clientX: number, clientY: number) => ({
    x: clientX - (rect.x + rect.w / 2),
    y: clientY - (rect.y + rect.h / 2),
  });

  // By hand, because React's wheel listener is passive and could not keep the chat behind from scrolling.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(
        wheelFactor(event.deltaY),
        fromCentre(event.clientX, event.clientY),
      );
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomBy, rect]);

  useEffect(() => {
    const resize = () => setRect(fit(size().width, size().height));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  useLayoutEffect(() => {
    hide(origin, true);
    if (!reduced()) {
      picRef.current?.animate?.(
        [
          {
            transform: transformBetween(source().getBoundingClientRect(), rect),
          },
          { transform: "none" },
        ],
        { duration: 420, easing: EASE },
      );
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
    setEased(true);
    setView(null);
    const done = () => {
      hide(origin, false);
      origin.focus({ preventScroll: true });
      onClose();
    };
    if (reduced() || !pic.animate) return done();
    const now = pic.getBoundingClientRect();
    const anim = pic.animate(
      [
        { transform: "none" },
        {
          transform: transformBetween(
            (origin.querySelector("img") ?? origin).getBoundingClientRect(),
            { x: now.left, y: now.top, w: now.width, h: now.height },
          ),
        },
      ],
      { duration: 360, easing: EASE, fill: "forwards" },
    );
    anim.onfinish = done;
  }, [origin, onClose]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        minimize();
      } else if (event.key === "+" || event.key === "=")
        zoomBy(KEY_STEP, undefined, true);
      else if (event.key === "-" || event.key === "_")
        zoomBy(1 / KEY_STEP, undefined, true);
      else if (event.key === "0") fitView();
      else if (event.key === "1") actualSize();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      hide(origin, false);
    };
  }, [minimize, origin, zoomBy]);

  const web = Boolean(image.host);
  const copy = () => {
    const work = web
      ? navigator.clipboard.writeText(image.src).then(
          () => true,
          () => false,
        )
      : copyImage(image.src);
    void work.then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return createPortal(
    <div
      ref={rootRef}
      className={`img-viewer${shown ? " show" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={image.title}
    >
      <div className="scrim" onClick={minimize} />
      <div className="bar">
        <b className="truncate">{image.title}</b>
        {image.host && <span>{image.host}</span>}
        <span className="flex-1" />
        <span className="zoom">
          <button
            type="button"
            onClick={() => zoomBy(1 / KEY_STEP, undefined, true)}
            aria-label={t("zoomOut")}
            title={`${t("zoomOut")} (-)`}
          >
            <span aria-hidden="true" className="text-base leading-none">
              −
            </span>
          </button>
          <button
            type="button"
            className="level"
            onClick={() => (view ? fitView() : actualSize())}
            aria-label={t("lightboxFit")}
            title={t("lightboxFitHint")}
          >
            {Math.round(current.zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomBy(KEY_STEP, undefined, true)}
            aria-label={t("zoomIn")}
            title={`${t("zoomIn")} (+)`}
          >
            <Icon name="plus" size={15} />
          </button>
        </span>
        <button type="button" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={15} />
          {copied ? t("imageCopied") : web ? t("copyLink") : t("copy")}
        </button>
        {web ? (
          <button
            type="button"
            onClick={() => {
              window.open(image.src, "_blank");
              minimize();
            }}
          >
            <Icon name="arrow-square-out" size={15} />
            {t("openInBrowser")}
          </button>
        ) : (
          image.path && (
            <button
              type="button"
              onClick={() =>
                void window.draggy?.revealCreatedFile(image.path as string)
              }
            >
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
        <div
          ref={picRef}
          className="pic"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        >
          <img
            src={image.src}
            alt={image.title}
            draggable={false}
            className={`${dragging ? "dragging" : ""}${eased && !dragging ? " eased" : ""}`}
            style={{
              transform: `translate(${current.x}px, ${current.y}px) scale(${current.zoom / fitZoom})`,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                x: event.clientX,
                y: event.clientY,
                from: current,
              };
              setDragging(true);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start) return;
              setEased(false);
              setView(
                held({
                  ...start.from,
                  x: start.from.x + event.clientX - start.x,
                  y: start.from.y + event.clientY - start.y,
                }),
              );
            }}
            onPointerUp={() => {
              drag.current = null;
              setDragging(false);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(false);
            }}
            onDoubleClick={(event) => {
              if (view) fitView();
              else
                zoomBy(
                  Math.max(2, 1 / fitZoom),
                  fromCentre(event.clientX, event.clientY),
                  true,
                );
            }}
          />
        </div>
      }
    </div>,
    document.body,
  );
}
