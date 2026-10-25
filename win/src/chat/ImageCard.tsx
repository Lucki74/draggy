import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Chip, Icon, IconButton, Lightbox, Skeleton, Spark, Tooltip } from "../ui";
import type { ImageStepInfo, SearchStep } from "../types";
import { INLINE_COMPONENTS, REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import { swallowed } from "../logger";

/** A picture from the local image engine: its progress while it is made, then the picture and what can be done with it. */

const RUNNING: ImageStepInfo["status"][] = ["loading-model", "queued", "generating"];

/** The tallest the picture, or the placeholder for it, gets. */
const MAX_HEIGHT_REM = 24;

/** A model that does not say what size it draws is taken as square. */
const DEFAULT_SIZE = 1024;

function imageSource(info: ImageStepInfo): string | null {
  if (info.status !== "done" || !info.filename || info.location !== "created") return null;
  return `draggy://images/${encodeURIComponent(info.filename)}`;
}

function useElapsed(startedAt: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || startedAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running, startedAt]);
  return startedAt === undefined ? 0 : Math.max(0, now - startedAt);
}

/** A project picture goes through the file tools, so it is only read from inside the conversation's folder. */
function useProjectImage(info: ImageStepInfo): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (info.status !== "done" || info.location !== "project" || !info.path) return;
    let cancelled = false;
    window.electronAPI?.files
      .read(info.workspaceId || "default", info.path)
      .then((result) => {
        if (!cancelled && result?.success && result.dataUrl) setDataUrl(result.dataUrl);
      })
      .catch(swallowed("chat", "the main process already logged this call"));
    return () => {
      cancelled = true;
    };
  }, [info.status, info.location, info.path, info.workspaceId]);
  return dataUrl;
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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

type Copied = "image" | "seed" | null;

interface ImageCardProps {
  step: SearchStep;
  t: (key: string) => string;
  /** Shows this picture instead of reading the file, for the gallery and tests where none is on disk. */
  previewSrc?: string;
}

export default function ImageCard({ step, t, previewSrc }: ImageCardProps) {
  const info = step.image;
  const running = Boolean(info && RUNNING.includes(info.status));
  const elapsed = useElapsed(info?.startedAt, running);
  const projectSrc = useProjectImage(info ?? { prompt: "", status: "error" });
  const [lightbox, setLightbox] = useState(false);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const flash = useCallback((what: Exclude<Copied, null>) => {
    setCopied(what);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1600);
  }, []);

  if (!info) return null;

  const candidate = previewSrc ?? imageSource(info) ?? projectSrc;
  // A picture the page cannot load is never drawn as a broken-image icon.
  const unloadable = candidate !== null && candidate === brokenSrc;
  const src = unloadable ? null : candidate;
  const width = info.width || DEFAULT_SIZE;
  const height = info.height || DEFAULT_SIZE;
  const ratio = width / height;
  const interrupted = info.status === "cancelled" && info.finishedAt === undefined;
  const hasSeed = info.seed !== undefined && info.seed >= 0;

  const statusText =
    info.status === "loading-model"
      ? t("imageLoadingModel")
      : info.status === "queued"
        ? t("imageQueued").replace("{position}", String(Math.max(1, info.queuePosition ?? 1)))
        : info.status === "generating"
          ? t("imageGenerating")
          : interrupted
            ? t("imageInterrupted")
            : info.status === "cancelled"
              ? t("imageCancelled")
              : info.status === "error"
                ? t("imageFailed")
                : unloadable
                  ? t("imageUnavailable")
                  : "";

  const meta = [info.model, info.width && info.height ? `${info.width}×${info.height}` : ""].filter(Boolean).join(" · ");
  const doneWithPicture = info.status === "done" && src;

  return (
    <div className="mb-3 w-full max-w-xl overflow-hidden rounded-md border border-rule bg-surface-base" data-testid="image-card">
      {running && (
        <div className="relative mx-auto w-full" style={{ aspectRatio: `${width} / ${height}`, maxWidth: `${MAX_HEIGHT_REM * ratio}rem` }}>
          <Skeleton className="absolute inset-0 rounded-none motion-reduce:animate-none" />
        </div>
      )}

      {doneWithPicture && (
        <button
          type="button"
          onClick={() => setLightbox(true)}
          aria-label={t("imageEnlarge")}
          className="block w-full cursor-zoom-in bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary"
        >
          <img src={src} alt={info.prompt} onError={() => setBrokenSrc(src)} className="mx-auto block w-auto object-contain" style={{ maxHeight: `${MAX_HEIGHT_REM}rem`, maxWidth: "100%" }} />
        </button>
      )}

      <div className="flex items-start gap-2 px-3 py-2.5">
        {running ? (
          <Spark className="mt-[6px]" />
        ) : (
          <Icon name={info.status === "error" || unloadable ? "warning-circle" : "image"} size={16} className={`mt-0.5 shrink-0 ${info.status === "error" || unloadable ? "text-danger" : "text-text-secondary"}`} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-[18px] text-text-primary" title={info.prompt}>
            {info.prompt}
          </p>
          <p className="flex items-center gap-2 text-[12px] leading-4 text-text-secondary">
            <span role="status" className={info.status === "error" || unloadable ? "text-danger" : undefined}>
              {statusText}
              {copied && <span className="sr-only">{t("imageCopied")}</span>}
            </span>
            {running && (
              <span aria-hidden="true" className="font-mono tabular-nums">
                {clock(elapsed)}
              </span>
            )}
            {info.status === "done" && !unloadable && meta && <span className="truncate">{meta}</span>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {running && info.requestId && (
            <Tooltip label={t("imageStop")} align="end">
              <IconButton name="stop" size="dense" label={t("imageStop")} onClick={() => void window.electronAPI?.sd?.cancel(info.requestId as string)} />
            </Tooltip>
          )}
          {doneWithPicture && (
            <>
              <Tooltip label={copied === "image" ? t("imageCopied") : t("imageCopy")}>
                <IconButton
                  name={copied === "image" ? "check" : "copy"}
                  size="dense"
                  label={t("imageCopy")}
                  onClick={() => void copyImage(src).then((ok) => ok && flash("image"))}
                />
              </Tooltip>
              {info.path && (
                <>
                  <Tooltip label={t("openFile")}>
                    <IconButton name="arrow-square-out" size="dense" label={t("openFile")} onClick={() => void window.electronAPI?.openFile(info.path as string)} />
                  </Tooltip>
                  <Tooltip label={t("showInFolder")} align="end">
                    <IconButton name="folder-open" size="dense" label={t("showInFolder")} onClick={() => void window.electronAPI?.revealCreatedFile(info.path as string)} />
                  </Tooltip>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {info.status === "done" && hasSeed && (
        <div className="flex items-center gap-1.5 px-3 pb-2.5 ps-9">
          <Chip
            size="dense"
            label={<span className="font-mono tabular-nums">{`${t("imageSeed")} ${info.seed}`}</span>}
            icon={<Icon name={copied === "seed" ? "check" : "copy"} size={12} />}
            title={t("imageCopySeed")}
            onClick={() => void copyText(String(info.seed)).then((ok) => ok && flash("seed"))}
          />
        </div>
      )}

      {info.status === "error" && info.error && (
        <div className="markdown-inline px-3 pb-3 ps-9 text-[13px] leading-5 text-text-secondary">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={INLINE_COMPONENTS}>
            {info.error}
          </ReactMarkdown>
        </div>
      )}

      <Lightbox open={lightbox} src={src ?? undefined} alt={info.prompt} onClose={() => setLightbox(false)} />
    </div>
  );
}
