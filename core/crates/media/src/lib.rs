//! Reads attached videos through ffmpeg and ffprobe running as hidden child processes. The caller passes the binary
//! paths, so this crate knows nothing about Tauri, and frames stay out of the model context until a tool asks.

mod extract;
mod index;
mod paths;
mod probe;
mod run;
mod segment;

pub use extract::{contact_sheet, extract_frame, extract_frame_by_number};
pub use index::{IndexOptions, index};
pub use paths::FfmpegPaths;
pub use probe::{VideoMeta, parse_probe, probe};
pub use segment::{
    INDEX_VERSION, PROXY_BYTES, PROXY_HEIGHT, PROXY_WIDTH, Segment, SegmentKind, Segmenter,
    Selection, Thresholds, VideoIndex, select_frames,
};

pub use draggy_tools::spawn::CancelToken;

/// Longest video the indexer accepts, in seconds.
pub const MAX_DURATION_S: f64 = 4.0 * 3600.0;
/// Largest video file the import accepts.
pub const MAX_VIDEO_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// Default indexing rate; a source with a lower frame rate is sampled at its own rate.
pub const SAMPLE_FPS: f64 = 4.0;
/// Longest side of a single exact frame.
pub const FRAME_MAX_SIDE: u32 = 1568;
/// Longest side of each frame a range view returns.
pub const VIEW_MAX_SIDE: u32 = 768;
/// Most images one range view may return.
pub const MAX_VIEW_FRAMES: usize = 12;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("E_FFMPEG_MISSING: ffmpeg was not found")]
    FfmpegMissing,
    #[error("E_NO_VIDEO_STREAM: the file has no video stream")]
    NoVideoStream,
    #[error("E_VIDEO_TOO_LONG: the video lasts {0:.0}s, over the 4 hour limit")]
    TooLong(f64),
    #[error("E_PROBE: could not read the video details: {0}")]
    Probe(String),
    #[error("E_FFMPEG_FAILED: ffmpeg exited with {code:?}: {stderr}")]
    Failed { code: Option<i32>, stderr: String },
    #[error("E_NO_FRAME: no frame at that time")]
    NoFrame,
    #[error("E_CANCELLED: indexing was cancelled")]
    Cancelled,
    #[error("E_TIMEOUT: ffmpeg took too long")]
    Timeout,
    #[error("E_IO: {0}")]
    Io(#[from] std::io::Error),
}

impl MediaError {
    /// The stable code the renderer maps to a translated message.
    pub fn code(&self) -> &'static str {
        match self {
            Self::FfmpegMissing => "E_FFMPEG_MISSING",
            Self::NoVideoStream => "E_NO_VIDEO_STREAM",
            Self::TooLong(_) => "E_VIDEO_TOO_LONG",
            Self::Probe(_) => "E_PROBE",
            Self::Failed { .. } => "E_FFMPEG_FAILED",
            Self::NoFrame => "E_NO_FRAME",
            Self::Cancelled => "E_CANCELLED",
            Self::Timeout => "E_TIMEOUT",
            Self::Io(_) => "E_IO",
        }
    }
}
