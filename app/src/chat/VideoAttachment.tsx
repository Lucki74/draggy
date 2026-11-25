import { useEffect, useState } from "react";
import { draggyUrl } from "../appUrl";
import { Icon, IconButton } from "../ui";
import { logSwallow } from "../logger";
import type { VideoRef } from "../types";
import { formatDuration, videoFrameKey, videoFrameUrls } from "./videoRef";
import { startVideoIndex, useVideoIndexState } from "./videoStatus";

const posters = new Map<string, string>();

/** A small frame for the chip and the turn, fetched once per video and kept for the session. */
function usePoster(hash: string): string | null {
  const [poster, setPoster] = useState<string | null>(posters.get(hash) ?? null);
  useEffect(() => {
    if (posters.has(hash) || !window.draggy?.video) return;
    let live = true;
    window.draggy.video
      .poster(hash)
      .then((reply) => {
        if (!reply.success) return;
        const url = `data:${reply.image.mime};base64,${reply.image.data}`;
        posters.set(hash, url);
        if (live) setPoster(url);
      })
      .catch((error) => logSwallow("video.poster", error, "the chip shows an icon instead"));
    return () => {
      live = false;
    };
  }, [hash]);
  return poster;
}

function Thumb({ poster, className }: { poster: string | null; className: string }) {
  return poster ? (
    <img src={poster} alt="" className={`${className} object-cover`} />
  ) : (
    <span className={`${className} grid place-items-center bg-surface-tint text-text-secondary`}>
      <Icon name="film-strip" size={16} />
    </span>
  );
}

/** The frames a video step looked at, small and in order. Frames not on hand, such as after a restart, are fetched once more. */
export function VideoStepFrames({ hash, times }: { hash: string; times: number[] }) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const missing = times.filter((time) => !videoFrameUrls.has(videoFrameKey(hash, time)));
    if (missing.length === 0 || !window.draggy?.video) return;
    let live = true;
    window.draggy.video
      .frames(hash, missing, { maxSide: 160 })
      .then((reply) => {
        if (!reply.success) return;
        missing.forEach((time, i) => {
          const frame = reply.frames?.[i];
          if (frame) videoFrameUrls.set(videoFrameKey(hash, time), `data:${frame.image.mime};base64,${frame.image.data}`);
        });
        if (live) redraw((n) => n + 1);
      })
      .catch((error) => logSwallow("video.stepFrames", error, "the step shows placeholders instead"));
    return () => {
      live = false;
    };
  }, [hash, times]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {times.map((time) => (
        <span key={time} className="flex flex-col items-center gap-0.5">
          <Thumb poster={videoFrameUrls.get(videoFrameKey(hash, time)) ?? null} className="h-12 w-20 rounded" />
          <span className="font-mono text-[11px] text-text-tertiary">{formatDuration(time)}</span>
        </span>
      ))}
    </div>
  );
}

/** Composer chip: poster, name, duration and indexing progress, with retry after a failure. */
export function VideoChip({
  video,
  onDelete,
  t,
}: {
  video: VideoRef;
  onDelete: () => void;
  t: (key: string) => string;
}) {
  const poster = usePoster(video.hash);
  const state = useVideoIndexState(video.hash);
  const percent = state?.status === "running" ? Math.round(state.progress * 100) : null;
  const failed = state?.status === "failed";
  return (
    <span
      title={video.name}
      className="inline-flex items-center gap-1.5 h-8 ps-1 pe-1 rounded-pill border border-rule bg-surface-tint text-[12px] text-text-secondary max-w-[260px]"
    >
      <Thumb poster={poster} className="w-6 h-6 rounded-full" />
      <span className="truncate text-text-primary">{video.name}</span>
      {video.meta && <span className="shrink-0">{formatDuration(video.meta.duration_s)}</span>}
      {percent !== null && (
        <span role="status" className="shrink-0 tabular-nums">
          {t("videoIndexing").replace("{percent}", String(percent))}
        </span>
      )}
      {failed && (
        <IconButton
          size="sm"
          label={t("videoRetryIndex")}
          title={`${t("videoIndexFailed")}: ${state.error}`}
          name="arrow-clockwise"
          onClick={() => void startVideoIndex(video.hash)}
        />
      )}
      <IconButton size="sm" name="x" label={t("remove")} onClick={onDelete} />
    </span>
  );
}

/** A sent video: its poster with a play button, then an inline player served in ranges from storage. */
export function VideoTurnCard({ video, t }: { video: VideoRef; t: (key: string) => string }) {
  const poster = usePoster(video.hash);
  const [playing, setPlaying] = useState(false);
  return (
    <figure className="flex flex-col gap-1 m-0 max-w-[360px]">
      {playing ? (
        <video
          src={draggyUrl(`video/${video.hash}`)}
          poster={poster ?? undefined}
          controls
          autoPlay
          className="block w-[360px] max-h-[240px] rounded-sm border border-rule bg-black"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={t("videoPlay").replace("{name}", video.name)}
          className="relative block w-[240px] h-[135px] rounded-sm overflow-hidden border border-rule hover:border-rule-strong focus-visible:outline-2 focus-visible:outline-offset-2 cursor-pointer"
        >
          <Thumb poster={poster} className="w-full h-full" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid place-items-center w-10 h-10 rounded-full bg-black/60 text-white">
              <Icon name="play" size={20} />
            </span>
          </span>
        </button>
      )}
    </figure>
  );
}
