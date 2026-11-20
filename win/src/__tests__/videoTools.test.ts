import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toWireMessage } from "../agent/agentLoop";
import { formatVideoRef } from "../chat/videoRef";
import { VIDEO_TOOLS, parseTime, resetVideoCountsForTests, timeline, trackVideos, type TrackedVideo } from "../tools/video";
import type { ToolContext } from "../tools/registry";
import type { Message, SearchStep, VideoIndex, VideoMeta, VideoSegment } from "../types";

const HASH = "a".repeat(64);
const meta: VideoMeta = {
  duration_s: 60,
  fps: 30,
  width: 640,
  height: 360,
  codec: "h264",
  rotation: 0,
  has_audio: false,
  frame_count_estimate: 1800,
};
const segment = (start_s: number, end_s: number, kind: "static" | "motion" = "static", changes = 0): VideoSegment => ({
  start_s,
  end_s,
  rep_s: (start_s + end_s) / 2,
  change_score: 0,
  kind,
  changes,
});
const index: VideoIndex = { version: 1, meta, sample_fps: 4, segments: [segment(0, 20), segment(20, 40, "motion", 3), segment(40, 60)] };
const video: TrackedVideo = { id: "v1", hash: HASH, name: "demo.mp4", meta, segments: null };

function makeApi(ready = true) {
  return {
    getIndex: vi.fn(async () => ({ success: true as const, index: ready ? index : null })),
    index: vi.fn(async () => ({ success: true as const, state: { hash: HASH, status: "failed" as const, code: "E_INDEX", error: "x" } })),
    indexStatus: vi.fn(async () => ({ success: true as const, state: { hash: HASH, status: "failed" as const, code: "E_INDEX", error: "x" } })),
    select: vi.fn(async (_hash: string, start: number, end: number) => ({
      success: true as const,
      shown: index.segments.filter((item) => item.end_s > start && item.start_s < end),
      skipped: 2,
    })),
    frames: vi.fn(async (_hash: string, times: number[], options?: { grid?: boolean }) =>
      options?.grid
        ? { success: true as const, sheet: { mime: "image/jpeg", data: "SHEET" }, cols: 2 }
        : { success: true as const, frames: times.map((timeS) => ({ timeS, image: { mime: "image/jpeg", data: `F${timeS}` } })) },
    ),
    frame: vi.fn(async (_hash: string, timeS: number) => ({ success: true as const, timeS, image: { mime: "image/jpeg", data: "ONE" } })),
    onIndexProgress: vi.fn(() => () => {}),
  };
}

function makeContext(overrides: Partial<ToolContext> = {}) {
  const steps: SearchStep[] = [];
  const attachImage = vi.fn(() => true);
  const context: ToolContext = {
    t: (key) => key,
    settings: {} as never,
    pushStep: (step) => steps.push(step),
    patchStep: (id, patch) => {
      const at = steps.findIndex((entry) => entry.id === id);
      if (at !== -1) steps[at] = { ...steps[at], ...patch };
    },
    syncSteps: () => {},
    newId: () => `step-${steps.length}`,
    signal: new AbortController().signal,
    memo: new Map<string, unknown>(),
    vision: true,
    videos: [{ ...video }],
    attachImage,
    ...overrides,
  };
  return { context, steps, attachImage };
}

const tool = (name: string) => VIDEO_TOOLS.find((spec) => spec.name === name)!;
let api: ReturnType<typeof makeApi>;

beforeEach(() => {
  api = makeApi();
  vi.stubGlobal("window", { draggy: { video: api } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetVideoCountsForTests();
});

describe("parseTime", () => {
  it("reads seconds, mm:ss and h:mm:ss", () => {
    expect(parseTime(12)).toBe(12);
    expect(parseTime("1:07.5")).toBe(67.5);
    expect(parseTime("1:00:00")).toBe(3600);
  });

  it("refuses what is not a time", () => {
    expect(parseTime("soon")).toBeUndefined();
    expect(parseTime("-3")).toBeUndefined();
    expect(parseTime("")).toBeUndefined();
    expect(parseTime(Number.NaN)).toBeUndefined();
  });
});

describe("timeline", () => {
  it("lists one line per segment in range", () => {
    expect(timeline(index.segments, 10, 30)).toEqual(["00:00.0-00:20.0 static", "00:20.0-00:40.0 motion (3 changes)"]);
  });

  it("folds a long timeline into minute buckets", () => {
    const many = Array.from({ length: 300 }, (_, i) => segment(i, i + 1, i % 2 ? "motion" : "static", 1));
    const lines = timeline(many, 0, 300);
    expect(lines[0]).toBe("00:00.0-01:00.0 60 segments, 30 with motion");
    expect(lines.at(-1)).toContain("300 segments is too many");
  });
});

describe("toWireMessage with videos", () => {
  const message: Message = {
    id: "m1",
    role: "user",
    content: "Look",
    attachments: [{ name: "demo.mp4", type: "video/mp4", content: formatVideoRef({ kind: "video", hash: HASH, name: "demo.mp4", meta }) }],
  } as Message;

  it("tells a model without vision not to guess", () => {
    expect(toWireMessage(message, false, false).content).toContain("This model cannot see video frames");
  });

  it("says the frames cannot be looked at when tools are off", () => {
    expect(toWireMessage(message, true, false, undefined, false).content).toContain("Tools are off for this model");
  });

  it("keeps the same id when a later message brings a second video", () => {
    const second = { ...message, id: "m2", attachments: [{ ...message.attachments![0], name: "b.mp4", content: formatVideoRef({ kind: "video", hash: "b".repeat(64), name: "b.mp4", meta }) }] } as Message;
    const videos = trackVideos([message, second]);
    expect(toWireMessage(message, true, false, videos).content).toContain('[Video v1 "demo.mp4"');
    expect(toWireMessage(second, true, false, videos).content).toContain('[Video v2 "b.mp4"');
  });
});

describe("video_view", () => {
  it("sends one frame per distinct segment and reports what was skipped", async () => {
    const { context, attachImage, steps } = makeContext();
    const result = await tool("video_view").run({ video: "v1", start: "0:10", end: "50" }, context);
    expect(api.select).toHaveBeenCalledWith(HASH, 10, 50, 8);
    expect(attachImage).toHaveBeenCalledTimes(3);
    expect(result).toContain("image 2: t=30.0s, covers 20.0-40.0s, motion (3 changes)");
    expect(result).toContain("2 more distinct segments");
    expect(steps[0]).toMatchObject({ type: "video", isComplete: true, videoFrames: { hash: HASH, times: [10, 30, 50] } });
  });

  it("clamps the range to the video and the frame count to twelve", async () => {
    const { context } = makeContext();
    await tool("video_view").run({ video: "v1", start: "-5", end: "999", max_frames: 50 }, context);
    expect(api.select).toHaveBeenCalledWith(HASH, 0, 60, 12);
  });

  it("refuses an end before the start", async () => {
    const { context } = makeContext();
    expect(await tool("video_view").run({ video: "v1", start: "30", end: "10" }, context)).toContain("end must come after start");
  });

  it("sends a contact sheet as one image in grid mode", async () => {
    const { context, attachImage } = makeContext();
    const result = await tool("video_view").run({ video: "v1", grid: true }, context);
    expect(attachImage).toHaveBeenCalledOnce();
    expect(attachImage).toHaveBeenCalledWith("SHEET");
    expect(result).toContain("tile 1:");
  });

  it("falls back to evenly spaced frames while the index builds", async () => {
    api = makeApi(false);
    vi.stubGlobal("window", { draggy: { video: api } });
    const { context } = makeContext();
    const result = await tool("video_view").run({ video: "v1", max_frames: 4 }, context);
    expect(api.select).not.toHaveBeenCalled();
    expect(api.frames).toHaveBeenCalledWith(HASH, [7.5, 22.5, 37.5, 52.5], { grid: false });
    expect(result).toContain("evenly spaced");
  });

  it("says when the image budget is spent", async () => {
    const { context } = makeContext({ attachImage: () => false });
    expect(await tool("video_view").run({ video: "v1" }, context)).toContain("3 frames were not sent");
  });

  it("does not look without vision", async () => {
    const { context } = makeContext({ vision: false });
    expect(await tool("video_view").run({ video: "v1" }, context)).toContain("cannot see video frames");
    expect(api.frames).not.toHaveBeenCalled();
  });

  it("names the known videos when asked for one that is not there", async () => {
    const { context } = makeContext();
    expect(await tool("video_view").run({ video: "v9" }, context)).toContain("Known videos: v1");
  });
});

describe("video_frame", () => {
  it("wants exactly one of time and frame", async () => {
    const { context } = makeContext();
    expect(await tool("video_frame").run({ video: "v1" }, context)).toContain("give either time or frame");
    expect(await tool("video_frame").run({ video: "v1", time: "1", frame: 3 }, context)).toContain("give either time or frame");
  });

  it("refuses a time it cannot read", async () => {
    const { context } = makeContext();
    expect(await tool("video_frame").run({ video: "v1", time: "later" }, context)).toContain("could not be read");
  });

  it("turns a frame number into the middle of that frame", async () => {
    const { context, attachImage } = makeContext();
    const result = await tool("video_frame").run({ video: "v1", frame: 30 }, context);
    expect(api.frame).toHaveBeenCalledWith(HASH, 30.5 / 30);
    expect(attachImage).toHaveBeenCalledWith("ONE");
    expect(result).toContain("static segment 00:00.0-00:20.0");
  });
});
