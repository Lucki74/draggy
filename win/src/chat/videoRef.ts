import type { Attachment, VideoMeta, VideoRef } from "../types";

/** A video attachment's `content` starts with this; the JSON of its `VideoRef` follows. Mirrors the storage crate. */
export const VIDEO_REF_PREFIX = "draggy-video:";

const HASH = /^[0-9a-f]{64}$/;

export function formatVideoRef(ref: VideoRef): string {
  return VIDEO_REF_PREFIX + JSON.stringify(ref);
}

/** The reference inside an attachment's content, or null for anything that is not a stored video. */
export function parseVideoRef(content: string): VideoRef | null {
  if (typeof content !== "string" || !content.startsWith(VIDEO_REF_PREFIX)) return null;
  try {
    const value = JSON.parse(content.slice(VIDEO_REF_PREFIX.length)) as Partial<VideoRef>;
    if (typeof value.hash !== "string" || !HASH.test(value.hash)) return null;
    return {
      kind: "video",
      hash: value.hash,
      name: typeof value.name === "string" ? value.name : "video",
      meta: value.meta ?? null,
    };
  } catch {
    return null;
  }
}

export function videoRefOf(attachment: Attachment): VideoRef | null {
  return attachment.type.startsWith("video/") ? parseVideoRef(attachment.content) : null;
}

/** `2m14s`, `45s` or `1h03m`: short enough for a chip and the model's handle line alike. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

/** `1920x1080, 30fps` from probed metadata. */
export function describeMeta(meta: VideoMeta): string {
  const fps = Math.round(meta.fps * 100) / 100;
  return `${meta.width}x${meta.height}, ${fps}fps`;
}

/** The translation key for a refusal from the video channels, or null when only the raw message fits. */
export function videoErrorKey(code: string | undefined): string | null {
  switch (code) {
    case "E_FFMPEG_MISSING":
      return "ffmpegMissing";
    case "E_NO_VIDEO_STREAM":
      return "videoNoStream";
    case "E_VIDEO_TOO_LONG":
      return "videoTooLong";
    case "E_VIDEO_TOO_LARGE":
      return "fileTooLarge";
    default:
      return null;
  }
}
