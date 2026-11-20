import { registerTools } from "./registry";
import type { ToolContext, ToolSpec } from "./registry";
import { startVideoIndex, waitForVideoIndex } from "../chat/videoStatus";
import { describeMeta, formatDuration, videoFrameKey, videoFrameUrls, videoRefOf } from "../chat/videoRef";
import type { Message, VideoMeta, VideoSegment } from "../types";

/** A video of the chat as the model knows it: `v1`, `v2`… in order of first appearance. */
export interface TrackedVideo {
  id: string;
  hash: string;
  name: string;
  meta: VideoMeta | null;
  /** Distinct segments once indexed, null while the index builds, "failed" when it cannot be built. */
  segments: number | null | "failed";
}

export const VIDEO_INDEX_WAIT_MS = 30_000;
export const MAX_VIEW_FRAMES = 12;

const LOOKED = "video.looked";

/** A small model that already has the frames may ask for the same ones again and again; the second ask gets words, not pictures. */
function lookedBefore(ctx: ToolContext, key: string): boolean {
  const looked = (ctx.memo.get(LOOKED) as Set<string> | undefined) ?? new Set<string>();
  ctx.memo.set(LOOKED, looked);
  if (looked.has(key)) return true;
  looked.add(key);
  return false;
}

const lookedAgain = (tool: string) =>
  `TOOL RESULT (${tool}): You already looked at exactly this in this turn and its frames are above. Do not call it again: answer the user now from what you saw.`;
const MAX_TIMELINE_LINES = 200;

/** Same ids every turn for the same history, so earlier handle lines never change and the cache prefix holds. */
export function trackVideos(messages: Message[]): TrackedVideo[] {
  const videos: TrackedVideo[] = [];
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      const ref = videoRefOf(attachment);
      if (!ref || videos.some((video) => video.hash === ref.hash)) continue;
      videos.push({
        id: `v${videos.length + 1}`,
        hash: ref.hash,
        name: ref.name,
        meta: ref.meta,
        segments: segmentCounts.get(ref.hash) ?? null,
      });
    }
  }
  return videos;
}

/** Counts never change once an index is stored, so one lookup per video per session is enough. */
const segmentCounts = new Map<string, number | "failed">();

/** Fills in segment counts the backend already has, so the handle line can give one. */
export async function loadSegmentCounts(videos: TrackedVideo[]): Promise<void> {
  const api = typeof window === "undefined" ? undefined : window.draggy?.video;
  if (!api) return;
  await Promise.all(
    videos
      .filter((video) => video.segments === null)
      .map(async (video) => {
        try {
          const status = await api.indexStatus(video.hash);
          if (status.success && status.state.status === "failed") segmentCounts.set(video.hash, "failed");
          if (!status.success || status.state.status !== "ready") return;
          const stored = await api.getIndex(video.hash);
          if (stored.success && stored.index) segmentCounts.set(video.hash, stored.index.segments.length);
        } catch {
          // Without a count the line says the index is still building, which stays true enough.
          return;
        }
        video.segments = segmentCounts.get(video.hash) ?? null;
      }),
  );
}

export function resetVideoCountsForTests() {
  segmentCounts.clear();
}

/** The one line a turn carries for a video: no pixels, only what the tools can show. Mirrored in agent_loop.rs. */
export function videoHandleLine(video: TrackedVideo, vision: boolean, tools = true): string {
  if (!vision) {
    return `[Video ${video.id} "${video.name}" attached. This model cannot see video frames; say so instead of guessing its contents.]`;
  }
  const parts: string[] = [];
  if (video.meta) parts.push(formatDuration(video.meta.duration_s), describeMeta(video.meta));
  if (typeof video.segments === "number") parts.push(`${video.segments} distinct segments`);
  else if (video.segments === "failed") parts.push("could not be indexed");
  else parts.push("index still building");
  if (!tools) return `[Video ${video.id} "${video.name}": ${parts.join(", ")}. Tools are off for this model, so its frames cannot be looked at; say so instead of guessing its contents.]`;
  return `[Video ${video.id} "${video.name}": ${parts.join(", ")}. Use video_info, video_view or video_frame to look at it.]`;
}

/** `75.5`, `"75.5"`, `"1:15.5"` or `"0:01:15.5"` in seconds; undefined for anything else. */
export function parseTime(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parts = value.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** `01:07.5`: tenths are enough to name a frame and short enough for a long timeline. */
export function clock(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

function describeSegment(segment: VideoSegment): string {
  if (segment.kind === "static") return "static";
  return `motion (${segment.changes} ${segment.changes === 1 ? "change" : "changes"})`;
}

/** One line per segment, or minute buckets when that would be too long to be useful. */
export function timeline(segments: VideoSegment[], start: number, end: number): string[] {
  const inRange = segments.filter((segment) => segment.end_s > start && segment.start_s < end);
  if (inRange.length <= MAX_TIMELINE_LINES) {
    return inRange.map((segment) => `${clock(segment.start_s)}-${clock(segment.end_s)} ${describeSegment(segment)}`);
  }
  const buckets = new Map<number, VideoSegment[]>();
  for (const segment of inRange) {
    const minute = Math.floor(segment.start_s / 60);
    buckets.set(minute, [...(buckets.get(minute) ?? []), segment]);
  }
  const lines = [...buckets.entries()].map(([minute, group]) => {
    const moving = group.filter((segment) => segment.kind === "motion").length;
    return `${clock(minute * 60)}-${clock((minute + 1) * 60)} ${group.length} segments, ${moving} with motion`;
  });
  lines.push(`${inRange.length} segments is too many to list one by one. Call video_info again with start and end to see a range in full.`);
  return lines;
}

/** `v1`, the file name, or a path in the project folder, which is imported first. */
async function resolveVideo(raw: unknown, ctx: ToolContext): Promise<TrackedVideo | string> {
  const wanted = String(raw ?? "").trim();
  const videos = ctx.videos ?? [];
  if (!wanted && videos.length === 1) return videos[0];
  const known = videos.find((video) => video.id === wanted.toLowerCase() || video.name === wanted);
  if (known) return known;
  const api = window.draggy?.video;
  const root = ctx.projectRoot?.replace(/[\\/]+$/, "");
  const normalized = wanted.replace(/\//g, "\\");
  // A path the model names is read only inside the project folder, as file reads are.
  if (api && root && /\.[a-z0-9]{2,4}$/i.test(wanted)) {
    const absolute = /^[a-z]:\\/i.test(normalized) ? normalized : `${root.replace(/\//g, "\\")}\\${normalized}`;
    if (absolute.toLowerCase().startsWith(`${root.replace(/\//g, "\\").toLowerCase()}\\`) && !absolute.includes("..")) {
      const imported = await api.import(absolute);
      if (!imported.success) return imported.error;
      const video: TrackedVideo = {
        id: `v${videos.length + 1}`,
        hash: imported.hash,
        name: imported.name,
        meta: imported.meta,
        segments: null,
      };
      ctx.videos = [...videos, video];
      return video;
    }
  }
  const ids = videos.map((video) => video.id).join(", ") || "none";
  return `There is no video ${wanted || "(none given)"} in this chat. Known videos: ${ids}.`;
}

/** The stored index, building it first and waiting up to 30 s; null when it is still not ready. */
async function indexOf(video: TrackedVideo) {
  const api = window.draggy!.video;
  let stored = await api.getIndex(video.hash);
  if (stored.success && stored.index) return stored.index;
  await startVideoIndex(video.hash);
  const state = await waitForVideoIndex(video.hash, VIDEO_INDEX_WAIT_MS);
  if (state?.status !== "ready") return null;
  stored = await api.getIndex(video.hash);
  return stored.success ? stored.index : null;
}

const readOnly = {
  readOnly: true,
  readOnlyHint: true,
  destructive: false,
  destructiveHint: false,
  idempotent: true,
  idempotentHint: true,
  openWorld: false,
  openWorldHint: false,
};

const available: ToolSpec["available"] = (environment) => environment.vision === true && Boolean(environment.hasVideos);

const videoInfo: ToolSpec = {
  name: "video_info",
  group: "video",
  description:
    "Read a video's details and timeline: one line per stretch where the picture stays the same or moves. Text only, no frames. Call this first, then look at a narrow range with video_view.",
  parameters: {
    video: { type: "string", description: "The video's ID from the chat, such as v1." },
    start: { type: "string", description: "Optional. Where the timeline starts, in seconds or mm:ss." },
    end: { type: "string", description: "Optional. Where the timeline ends, in seconds or mm:ss." },
  },
  required: ["video"],
  usage: '{"video": "v1"} → the timeline of v1',
  annotations: readOnly,
  available,
  run: async (args, ctx) => {
    const video = await resolveVideo(args.video, ctx);
    if (typeof video === "string") return `TOOL RESULT (video_info): ${video}`;
    const meta = video.meta;
    const stepId = ctx.newId();
    ctx.pushStep({ id: stepId, type: "video", content: ctx.t("videoStepInfo").replace("{name}", video.name), isComplete: false });
    const index = await indexOf(video);
    ctx.patchStep(stepId, { isComplete: true, videoSeen: `Read the timeline of ${video.id} "${video.name}".` });
    const head = [
      `${video.id} "${video.name}"`,
      meta ? `${formatDuration(meta.duration_s)} (${meta.duration_s.toFixed(1)}s), ${describeMeta(meta)}, ${meta.has_audio ? "with" : "no"} audio` : "",
    ].filter(Boolean);
    if (!index) {
      return `TOOL RESULT (video_info): ${head.join("\n")}\nThe index is still building. video_view still works with evenly spaced frames; try video_info again shortly.`;
    }
    video.segments = index.segments.length;
    const start = Math.max(0, parseTime(args.start) ?? 0);
    const end = Math.min(index.meta.duration_s, parseTime(args.end) ?? index.meta.duration_s);
    if (end <= start) return "TOOL RESULT (video_info): end must come after start.";
    const lines = timeline(index.segments, start, end);
    return `TOOL RESULT (video_info): ${head.join("\n")}\n${index.segments.length} distinct segments. Timeline ${clock(start)}-${clock(end)}:\n${lines.join("\n")}`;
  },
};

/** Frames evenly spread over a range, for when there is no index to choose by. */
function evenTimes(start: number, end: number, count: number): number[] {
  const step = (end - start) / count;
  return Array.from({ length: count }, (_, i) => start + step * (i + 0.5));
}

const videoView: ToolSpec = {
  name: "video_view",
  group: "video",
  description:
    "Look at a range of a video. One frame is shown per distinct stretch, so a still screen costs one frame however long it lasts. The frames follow the result. Keep the range narrow to see detail.",
  parameters: {
    video: { type: "string", description: "The video's ID from the chat, such as v1." },
    start: { type: "string", description: "Where to start, in seconds or mm:ss. Defaults to the beginning." },
    end: { type: "string", description: "Where to stop, in seconds or mm:ss. Defaults to the end." },
    max_frames: { type: "integer", description: "At most this many frames, 1 to 12. Defaults to 8." },
    grid: { type: "boolean", description: "Send the frames as one contact sheet instead of separate images." },
  },
  required: ["video"],
  usage: '{"video": "v1", "start": "0:12", "end": "0:30"} → frames of v1 from 12s to 30s',
  annotations: readOnly,
  available,
  run: async (args, ctx) => {
    if (!ctx.vision || !ctx.attachImage) return "TOOL RESULT (video_view): This model cannot see video frames. Say so instead of guessing.";
    const video = await resolveVideo(args.video, ctx);
    if (typeof video === "string") return `TOOL RESULT (video_view): ${video}`;
    const api = window.draggy!.video;
    const duration = video.meta?.duration_s ?? 0;
    const start = Math.min(Math.max(0, parseTime(args.start) ?? 0), duration);
    const end = Math.min(parseTime(args.end) ?? duration, duration);
    if (end <= start) return "TOOL RESULT (video_view): end must come after start.";
    const max = Math.min(MAX_VIEW_FRAMES, Math.max(1, Math.round(Number(args.max_frames) || 8)));
    const grid = args.grid === true || args.grid === "true";
    if (lookedBefore(ctx, `view:${video.hash}:${start.toFixed(2)}-${end.toFixed(2)}:${max}:${grid}`)) return lookedAgain("video_view");

    const stepId = ctx.newId();
    const range = `${clock(start)}-${clock(end)}`;
    ctx.pushStep({
      id: stepId,
      type: "video",
      content: ctx.t("videoStepView").replace("{name}", video.name).replace("{range}", range),
      isComplete: false,
    });
    const index = await indexOf(video);
    let shown: (VideoSegment | null)[];
    let skipped = 0;
    if (index) {
      const selection = await api.select(video.hash, start, end, max);
      if (!selection.success) {
        ctx.patchStep(stepId, { isComplete: true });
        return `TOOL RESULT (video_view): ${selection.error}`;
      }
      shown = selection.shown;
      skipped = selection.skipped;
    } else {
      shown = evenTimes(start, end, max).map(() => null);
    }
    const times = index ? (shown as VideoSegment[]).map((segment) => segment.rep_s) : evenTimes(start, end, max);
    const reply = await api.frames(video.hash, times, { grid });
    if (reply.success) for (const frame of reply.frames ?? []) videoFrameUrls.set(videoFrameKey(video.hash, frame.timeS), `data:${frame.image.mime};base64,${frame.image.data}`);
    ctx.patchStep(stepId, {
      isComplete: true,
      ...(reply.success
        ? { videoSeen: `Looked at ${video.id} "${video.name}" ${range} (${times.length} frames).`, videoFrames: { hash: video.hash, times } }
        : {}),
    });
    if (!reply.success) return `TOOL RESULT (video_view): ${reply.error}`;

    const lines: string[] = [];
    let refused = 0;
    if (grid && reply.sheet) {
      if (ctx.attachImage(reply.sheet.data) === false) refused = times.length;
      lines.push(`One contact sheet, ${reply.cols ?? 1} tiles per row, read left to right then top to bottom:`);
    } else {
      for (const frame of reply.frames ?? []) if (ctx.attachImage(frame.image.data) === false) refused++;
    }
    times.forEach((time, i) => {
      const segment = shown[i];
      const covers = segment ? `, covers ${segment.start_s.toFixed(1)}-${segment.end_s.toFixed(1)}s, ${segment.kind === "static" ? "unchanged" : describeSegment(segment)}` : "";
      lines.push(`${grid ? "tile" : "image"} ${i + 1}: t=${time.toFixed(1)}s${covers}`);
    });
    if (!index) lines.push("The index is still building, so these frames are evenly spaced rather than one per distinct stretch.");
    if (skipped > 0) lines.push(`${skipped} more distinct segments in this range were not shown. Call again with a narrower range to see them.`);
    if (refused > 0) lines.push(`${refused} frames were not sent: this turn's image budget is used up. Answer from what you have seen.`);
    return `TOOL RESULT (video_view): ${video.id} ${range}. The frames follow this message.\n${lines.join("\n")}`;
  },
};

const videoFrame: ToolSpec = {
  name: "video_frame",
  group: "video",
  description: "Look at one exact frame of a video at full detail, by time or by frame number. Give one of the two.",
  parameters: {
    video: { type: "string", description: "The video's ID from the chat, such as v1." },
    time: { type: "string", description: "The moment to show, in seconds or mm:ss." },
    frame: { type: "integer", description: "The frame number to show, counting from 0." },
  },
  required: ["video"],
  usage: '{"video": "v1", "time": "1:07.5"} → the frame of v1 at 67.5s',
  annotations: readOnly,
  available,
  run: async (args, ctx) => {
    if (!ctx.vision || !ctx.attachImage) return "TOOL RESULT (video_frame): This model cannot see video frames. Say so instead of guessing.";
    const hasTime = args.time !== undefined && args.time !== null && args.time !== "";
    const hasFrame = args.frame !== undefined && args.frame !== null && args.frame !== "";
    if (hasTime === hasFrame) return "TOOL RESULT (video_frame): give either time or frame, not both and not neither.";
    const video = await resolveVideo(args.video, ctx);
    if (typeof video === "string") return `TOOL RESULT (video_frame): ${video}`;
    const fps = video.meta?.fps || 30;
    const asked = hasTime ? parseTime(args.time) : (Number(args.frame) + 0.5) / fps;
    if (asked === undefined || !Number.isFinite(asked) || asked < 0) return "TOOL RESULT (video_frame): the time or frame could not be read.";
    if (lookedBefore(ctx, `frame:${video.hash}@${asked.toFixed(3)}`)) return lookedAgain("video_frame");

    const stepId = ctx.newId();
    ctx.pushStep({
      id: stepId,
      type: "video",
      content: ctx.t("videoStepFrame").replace("{name}", video.name).replace("{time}", clock(asked)),
      isComplete: false,
    });
    const api = window.draggy!.video;
    const reply = await api.frame(video.hash, asked);
    if (reply.success) videoFrameUrls.set(videoFrameKey(video.hash, reply.timeS), `data:${reply.image.mime};base64,${reply.image.data}`);
    ctx.patchStep(stepId, {
      isComplete: true,
      ...(reply.success
        ? { videoSeen: `Looked at the frame of ${video.id} "${video.name}" at ${clock(reply.timeS)}.`, videoFrames: { hash: video.hash, times: [reply.timeS] } }
        : {}),
    });
    if (!reply.success) return `TOOL RESULT (video_frame): ${reply.error}`;
    const sent = ctx.attachImage(reply.image.data) !== false;
    const stored = await api.getIndex(video.hash);
    const segment = stored.success
      ? stored.index?.segments.find((item) => reply.timeS >= item.start_s && reply.timeS < item.end_s)
      : undefined;
    const where = segment
      ? ` It belongs to the ${describeSegment(segment)} segment ${clock(segment.start_s)}-${clock(segment.end_s)}.`
      : "";
    if (!sent) return `TOOL RESULT (video_frame): the frame at t=${reply.timeS.toFixed(2)}s was not sent: this turn's image budget is used up.`;
    return `TOOL RESULT (video_frame): ${video.id} at t=${reply.timeS.toFixed(2)}s (frame ${Math.floor(reply.timeS * fps)}).${where} The image follows this message.`;
  },
};

export const VIDEO_TOOLS: ToolSpec[] = [videoInfo, videoView, videoFrame];

export function registerVideoTools(): void {
  registerTools(VIDEO_TOOLS);
}

/** The system prompt line on how to work with an attached video. */
export const VIDEO_GUIDANCE =
  "Videos are not preloaded: each one appears as a line such as [Video v1 ...]. Start with video_info to read its timeline, then use video_view on narrow ranges and video_frame for one exact moment.";
