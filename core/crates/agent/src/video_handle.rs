//! The one line a turn carries for an attached video, ported from `win/src/tools/video.ts`.
//! `shared/fixtures/agent/videoHandle.json` pins both.

use serde::Deserialize;

use crate::task_manager::{Attachment, Message};

/// A video attachment's `content` starts with this; the JSON of its reference follows.
pub const VIDEO_REF_PREFIX: &str = "draggy-video:";

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct VideoMeta {
    pub duration_s: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

/// What a segment count is known to be: absent while the index builds.
#[derive(Debug, Clone, PartialEq)]
pub enum Segments {
    Building,
    Failed,
    Count(usize),
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrackedVideo {
    pub id: String,
    pub hash: String,
    pub name: String,
    pub meta: Option<VideoMeta>,
    pub segments: Segments,
}

#[derive(Deserialize)]
struct RawRef {
    hash: Option<String>,
    name: Option<String>,
    meta: Option<VideoMeta>,
}

/// The stored reference of a `video/*` attachment, or None for anything else.
pub fn video_ref_of(attachment: &Attachment) -> Option<(String, String, Option<VideoMeta>)> {
    if !attachment.kind.starts_with("video/") {
        return None;
    }
    let json = attachment.content.strip_prefix(VIDEO_REF_PREFIX)?;
    let raw: RawRef = serde_json::from_str(json).ok()?;
    let hash = raw.hash.filter(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })?;
    Some((hash, raw.name.unwrap_or_else(|| "video".into()), raw.meta))
}

/// `v1`, `v2`… in order of first appearance, so earlier lines never change between turns.
pub fn track_videos(messages: &[&Message]) -> Vec<TrackedVideo> {
    let mut videos: Vec<TrackedVideo> = Vec::new();
    for message in messages {
        for attachment in message.attachments.iter().flatten() {
            let Some((hash, name, meta)) = video_ref_of(attachment) else {
                continue;
            };
            if videos.iter().any(|video| video.hash == hash) {
                continue;
            }
            videos.push(TrackedVideo {
                id: format!("v{}", videos.len() + 1),
                hash,
                name,
                meta,
                segments: Segments::Building,
            });
        }
    }
    videos
}

/// `2m14s`, `45s` or `1h03m`.
pub fn format_duration(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let (hours, minutes, secs) = (total / 3600, (total % 3600) / 60, total % 60);
    if hours > 0 {
        format!("{hours}h{minutes:02}m")
    } else if minutes > 0 {
        format!("{minutes}m{secs:02}s")
    } else {
        format!("{secs}s")
    }
}

/// `1920x1080, 30fps`; the frame rate keeps at most two decimals, as JavaScript prints it.
pub fn describe_meta(meta: &VideoMeta) -> String {
    let fps = (meta.fps * 100.0).round() / 100.0;
    format!("{}x{}, {}fps", meta.width, meta.height, fps)
}

pub fn video_handle_line(video: &TrackedVideo, vision: bool) -> String {
    if !vision {
        return format!(
            "[Video {} \"{}\" attached. This model cannot see video frames; say so instead of guessing its contents.]",
            video.id, video.name
        );
    }
    let mut parts: Vec<String> = Vec::new();
    if let Some(meta) = &video.meta {
        parts.push(format_duration(meta.duration_s));
        parts.push(describe_meta(meta));
    }
    parts.push(match video.segments {
        Segments::Count(count) => format!("{count} distinct segments"),
        Segments::Failed => "could not be indexed".into(),
        Segments::Building => "index still building".into(),
    });
    format!(
        "[Video {} \"{}\": {}. Use video_info, video_view or video_frame to look at it.]",
        video.id,
        video.name,
        parts.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations_read_like_the_chip() {
        assert_eq!(format_duration(134.0), "2m14s");
        assert_eq!(format_duration(45.2), "45s");
        assert_eq!(format_duration(3780.0), "1h03m");
    }

    #[test]
    fn frame_rates_print_like_javascript() {
        let meta = |fps| VideoMeta {
            duration_s: 1.0,
            width: 640,
            height: 360,
            fps,
        };
        assert_eq!(describe_meta(&meta(30.0)), "640x360, 30fps");
        assert_eq!(describe_meta(&meta(29.97003)), "640x360, 29.97fps");
    }
}
