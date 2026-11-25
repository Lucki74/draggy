import { draggyUrl } from "../appUrl";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ImageStepInfo, SearchStep } from "../types";
import { INLINE_COMPONENTS, REHYPE_PLUGINS, REMARK_PLUGINS } from "./markdown";
import { swallowed } from "../logger";
import { StepLine } from "./StepLine";
import { NoiseThumb } from "./NoiseThumb";
import { ImageViewer } from "./ImageViewer";

/** A picture from the local image engine as one step of the work: a line saying what it is doing, a small
 * placeholder while it draws, then the thumbnail that opens it full screen. */

const RUNNING: ImageStepInfo["status"][] = ["loading-model", "queued", "generating"];

function imageSource(info: ImageStepInfo): string | null {
  if (info.status !== "done" || !info.filename || info.location !== "created") return null;
  return draggyUrl(`images/${encodeURIComponent(info.filename)}`);
}

/** A project picture goes through the file tools, so it is only read from inside the conversation's folder. */
function useProjectImage(info: ImageStepInfo | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const status = info?.status;
  const location = info?.location;
  const path = info?.path;
  const workspaceId = info?.workspaceId;
  useEffect(() => {
    if (status !== "done" || location !== "project" || !path) return;
    let cancelled = false;
    window.draggy?.files
      .read(workspaceId || "default", path)
      .then((result) => {
        if (!cancelled && result?.success && result.dataUrl) setDataUrl(result.dataUrl);
      })
      .catch(swallowed("chat", "the main process already logged this call"));
    return () => {
      cancelled = true;
    };
  }, [status, location, path, workspaceId]);
  return dataUrl;
}

/** The short name shown on the picture: the title the model gave it, else its ID in the chat. */
const imageTitle = (info: ImageStepInfo) => info.title || info.imageId || info.prompt;

interface ImageCardProps {
  step: SearchStep;
  t: (key: string) => string;
  /** Shows this picture instead of reading the file, for the gallery and tests where none is on disk. */
  previewSrc?: string;
}

export default function ImageCard({ step, t, previewSrc }: ImageCardProps) {
  const info = step.image;
  const projectSrc = useProjectImage(info);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  // The picture fades in from the cloud only when it arrives, never when an old chat is opened.
  const [reveal] = useState(() => Boolean(info && RUNNING.includes(info.status)));
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  // The answer shows the picture itself, so the step keeps its thumbnail folded away until asked.
  const [open, setOpen] = useState(false);

  if (!info) return null;

  const running = RUNNING.includes(info.status);
  const candidate = previewSrc ?? imageSource(info) ?? projectSrc;
  // A picture the page cannot load is never drawn as a broken-image icon.
  const unloadable = candidate !== null && candidate === brokenSrc;
  const src = unloadable ? null : candidate;
  const interrupted = info.status === "cancelled" && info.finishedAt === undefined;

  const verb =
    info.status === "loading-model"
      ? t("imageStepLoading")
      : info.status === "queued"
        ? t("imageStepQueued")
        : info.status === "generating"
          ? t("imageStepGenerating")
          : info.status === "error"
            ? t("imageStepFailed")
            : info.status === "cancelled"
              ? t("imageStepStopped")
              : t("imageStepDone");
  const target = info.status === "loading-model" || info.status === "queued" ? undefined : info.prompt;
  const meta = interrupted ? t("imageInterrupted") : info.status === "done" && unloadable ? t("imageUnavailable") : undefined;
  const title = imageTitle(info);
  const shownThumb =
    info.status === "done" && src ? (
      <button
        type="button"
        className={`img-thumb${reveal ? " reveal" : ""}`}
        aria-label={`${t("imageEnlarge")}: ${title}`}
        onClick={(event) => setOrigin(event.currentTarget)}
      >
        <img src={src} alt={info.prompt} onError={() => setBrokenSrc(src)} />
        <span className="htitle">{title}</span>
      </button>
    ) : undefined;

  return (
    <div className="img-step" data-testid="image-card">
      <StepLine
        verb={verb}
        target={target}
        meta={meta}
        failed={unloadable}
        active={running}
        open={open && Boolean(shownThumb)}
        onToggle={shownThumb ? () => setOpen((value) => !value) : undefined}
        details={shownThumb}
        actions={
          info.status === "generating" && info.requestId ? (
            <button type="button" className="img-stop" onClick={() => void window.draggy?.sd?.cancel(info.requestId as string)}>
              {t("imageStop")}
            </button>
          ) : undefined
        }
        t={t}
      />

      {running && (
        <div className="img-thumb wait" role="status" aria-label={verb}>
          <NoiseThumb dim={info.status !== "generating"} />
        </div>
      )}

      {info.status === "done" && info.referenceDropped && (
        <p role="note" className="img-err">
          {t("imageReferenceDropped")}
        </p>
      )}

      {info.status === "error" && info.error && (
        <div className="img-err markdown-inline" role="status">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={INLINE_COMPONENTS}>
            {info.error}
          </ReactMarkdown>
        </div>
      )}

      {origin && src && (
        <ImageViewer image={{ src, title, path: info.path }} origin={origin} onClose={() => setOrigin(null)} t={t} />
      )}
    </div>
  );
}
