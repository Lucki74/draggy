/* Shared token rewrite and context, not a hot-reloaded component module. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from "react";
import { draggyUrl } from "../appUrl";
import { uiText } from "../i18n";
import { hostnameOf } from "../utils";
import { swallowed } from "../logger";
import type { TrackedImage } from "../images/imageTracker";
import { ImageViewer } from "./ImageViewer";

/** A picture the answer placed with {image}img_2|Title{image}, or {image}https://…|Title{image} for one from the web. */

export const ChatImagesContext = createContext<TrackedImage[]>([]);

const TOKEN = /\{image\}([^{}|\n]+?)(?:\|([^{}\n]+?))?\{image\}/g;
// An image token still being written: hidden until it closes, so the raw braces never flash up.
const OPEN_TAIL = /\{image\}[^\n]*$/;

const escapeTitle = (title: string) => title.replace(/["\\]/g, "\\$&").replace(/[[\]]/g, "\\$&");

/** Turns each token into a markdown image of its own block, which the img component then draws. */
export function withImageTokens(text: string, streaming = false): string {
  if (!text.includes("{image}")) return text;
  const placed = text.replace(TOKEN, (_, src: string, title?: string) => {
    const name = escapeTitle((title ?? "").trim());
    return `\n\n![${name}](<${src.trim()}>${name ? ` "${name}"` : ""})\n\n`;
  });
  return streaming ? placed.replace(OPEN_TAIL, "") : placed;
}

const WEB = /^https?:\/\//i;

/** Where a tracked picture can be read from; a project picture needs the file tools, so it comes back later. */
function useTrackedSrc(image: TrackedImage | undefined): string | null {
  const [projectSrc, setProjectSrc] = useState<string | null>(null);
  const project = image?.origin === "generated" && image.location === "project" ? image : undefined;
  useEffect(() => {
    if (!project?.path) return;
    let cancelled = false;
    window.draggy?.files
      .read(project.workspaceId || "default", project.path)
      .then((result) => {
        if (!cancelled && result?.success && result.dataUrl) setProjectSrc(result.dataUrl);
      })
      .catch(swallowed("chat", "the main process already logged this call"));
    return () => {
      cancelled = true;
    };
  }, [project?.path, project?.workspaceId]);
  if (!image) return null;
  if (image.dataUrl) return image.dataUrl;
  if (project) return projectSrc;
  const file = image.path?.split(/[\\/]/).pop();
  return file ? draggyUrl(`images/${encodeURIComponent(file)}`) : null;
}

export function AnswerImage({ src, title }: { src?: string; alt?: string; title?: string }) {
  const images = useContext(ChatImagesContext);
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  const [broken, setBroken] = useState(false);
  const wanted = String(src ?? "").trim();
  const web = WEB.test(wanted);
  const tracked = web ? undefined : images.find((image) => image.id === wanted.toLowerCase());
  const trackedSrc = useTrackedSrc(tracked);
  const shown = web ? wanted : trackedSrc;
  // An ID the chat does not have, or a picture that will not load, draws nothing rather than a broken icon.
  if (!shown || broken) return null;
  const name = title || (tracked?.origin === "attached" ? tracked.label : "") || (web ? hostnameOf(wanted) : wanted);

  return (
    <>
      <button type="button" className="img-inline" aria-label={`${uiText("imageEnlarge")}: ${name}`} onClick={(event) => setOrigin(event.currentTarget)}>
        <img src={shown} alt={name} onError={() => setBroken(true)} />
        {title && <span className="htitle">{title}</span>}
      </button>
      {origin && (
        <ImageViewer
          image={{ src: shown, title: name, host: web ? hostnameOf(wanted) : undefined, path: tracked?.path }}
          origin={origin}
          onClose={() => setOrigin(null)}
          t={uiText}
        />
      )}
    </>
  );
}
