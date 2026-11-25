//! Video attachments for the macOS and Linux shells: import into the blob store, background indexing, and the
//! `video_info`, `video_view` and `video_frame` tools. Ported from `app/src-tauri/src/ipc/video.rs` and
//! `app/src/tools/video.ts`, which stay the reference.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use draggy_agent::agent_loop::{ToolContext, ToolRuntime, WireMessage};
use draggy_agent::permissions::ToolAnnotations;
use draggy_agent::resume::SearchStep;
use draggy_agent::task_manager::{Attachment, Message};
use draggy_agent::tool_channel::{FunctionDefinition, ToolDefinition};
use draggy_agent::video_handle::{
    Segments, TrackedVideo, VIDEO_REF_PREFIX, describe_meta, format_duration, track_videos,
    video_handle_line,
};
use draggy_media::{
    CancelToken, FRAME_MAX_SIDE, FfmpegPaths, INDEX_VERSION, IndexOptions, MAX_VIDEO_BYTES,
    MAX_VIEW_FRAMES, MediaError, Segment, SegmentKind, VIEW_MAX_SIDE, VideoIndex, VideoMeta,
    select_frames,
};
use draggy_storage::Storage;
use serde_json::{Value, json};
use tokio::runtime::Handle;
use tokio::sync::Semaphore;

use crate::error::CoreError;

/// Indexing decodes the whole file; two at once keeps a batch of attachments from starving the machine.
const INDEX_SLOTS: usize = 2;
/// How long a tool waits for an index before it falls back to evenly spaced frames.
const INDEX_WAIT: Duration = Duration::from_secs(30);
const MAX_TIMELINE_LINES: usize = 200;
const TOOL_NAMES: [&str; 3] = ["video_info", "video_view", "video_frame"];

/// The extensions the shells' pickers offer, as on Windows.
pub const VIDEO_EXTENSIONS: [&str; 15] = [
    "mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "mpg", "mpeg", "3gp", "ts", "mts",
    "m2ts", "ogv",
];

/// A video the user attached, as the shell shows it and hands back to `send_with_media`.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct VideoRecord {
    /// SHA-256 of the file, the key it is stored under.
    pub hash: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub duration_s: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
}

#[derive(Clone)]
enum Status {
    Running(CancelToken),
    Ready,
    Failed,
}

fn failed(error: impl std::fmt::Display) -> CoreError {
    CoreError::Internal {
        message: error.to_string(),
    }
}

/// The `video/*` type of a file name, `video/mp4` when the extension says nothing better.
pub fn video_mime(name: &str) -> String {
    let extension = name.rsplit('.').next().unwrap_or_default().to_lowercase();
    match extension.as_str() {
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "mpg" | "mpeg" => "video/mpeg",
        "3gp" => "video/3gpp",
        "ts" | "mts" | "m2ts" => "video/mp2t",
        "ogv" => "video/ogg",
        _ => "video/mp4",
    }
    .to_owned()
}

/// The attachment a video becomes in the conversation: the same `draggy-video:` reference Windows stores.
pub fn video_attachment(video: &VideoRecord) -> Attachment {
    let reference = json!({
        "kind": "video",
        "hash": video.hash,
        "name": video.name,
        "meta": {
            "duration_s": video.duration_s,
            "width": video.width,
            "height": video.height,
            "fps": video.fps,
            "has_audio": video.has_audio,
        },
    });
    Attachment {
        name: video.name.clone(),
        kind: video.mime.clone(),
        content: format!("{VIDEO_REF_PREFIX}{reference}"),
    }
}

/// ffmpeg from the folder the shell named, beside the executable, in a macOS bundle's Resources, on `PATH`, then in
/// the usual Homebrew and system folders, which a macOS app started from Finder does not have on its `PATH`.
pub fn find_ffmpeg(dir: Option<&Path>) -> Result<FfmpegPaths, MediaError> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    let mut candidates: Vec<PathBuf> = dir.map(Path::to_path_buf).into_iter().collect();
    if let Some(exe_dir) = exe_dir {
        candidates.push(exe_dir.join("../Resources"));
        candidates.push(exe_dir);
    }
    for candidate in &candidates {
        if let Ok(found) = FfmpegPaths::find(Some(candidate), false) {
            return Ok(found);
        }
    }
    if let Ok(found) = FfmpegPaths::find(None, true) {
        return Ok(found);
    }
    for fallback in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        if let Ok(found) = FfmpegPaths::find(Some(Path::new(fallback)), false) {
            return Ok(found);
        }
    }
    Err(MediaError::FfmpegMissing)
}

/// Stored videos, their indexes and the jobs that build them. One per app; sessions borrow it.
#[derive(uniffi::Object)]
pub struct VideoStore {
    storage: Arc<Storage>,
    ffmpeg_dir: Option<PathBuf>,
    status: Mutex<HashMap<String, Status>>,
    meta: Mutex<HashMap<String, VideoMeta>>,
    slots: Arc<Semaphore>,
}

impl VideoStore {
    pub fn with_storage(storage: Arc<Storage>, ffmpeg_dir: Option<PathBuf>) -> Arc<Self> {
        Arc::new(Self {
            storage,
            ffmpeg_dir,
            status: Mutex::new(HashMap::new()),
            meta: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(INDEX_SLOTS)),
        })
    }

    fn paths(&self) -> Result<FfmpegPaths, MediaError> {
        find_ffmpeg(self.ffmpeg_dir.as_deref())
    }

    fn file(&self, hash: &str) -> Result<PathBuf, MediaError> {
        self.storage
            .video_path(hash)
            .ok()
            .flatten()
            .ok_or(MediaError::NoVideoStream)
    }

    fn set_status(&self, hash: &str, status: Status) {
        self.status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(hash.to_owned(), status);
    }

    fn status_of(&self, hash: &str) -> Option<Status> {
        if let Some(status) = self
            .status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(hash)
            .cloned()
        {
            return Some(status);
        }
        self.load_index(hash).map(|_| Status::Ready)
    }

    /// The stored index, when one of the current version exists.
    pub fn load_index(&self, hash: &str) -> Option<VideoIndex> {
        let row = self.storage.get_video_index(hash).ok()??;
        (row.version == i64::from(INDEX_VERSION))
            .then(|| serde_json::from_str(&row.json).ok())
            .flatten()
    }

    async fn meta_for(&self, paths: &FfmpegPaths, hash: &str) -> Result<VideoMeta, MediaError> {
        if let Some(meta) = self
            .meta
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(hash)
            .cloned()
        {
            return Ok(meta);
        }
        let meta = match self.load_index(hash) {
            Some(index) => index.meta,
            None => draggy_media::probe(paths, &self.file(hash)?).await?,
        };
        self.meta
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(hash.to_owned(), meta.clone());
        Ok(meta)
    }

    /// Starts building the index on `handle` unless it is built or building. A failed one is tried again.
    pub fn start_index(self: &Arc<Self>, handle: &Handle, hash: &str) {
        let cancel = {
            let mut map = self.status.lock().unwrap_or_else(PoisonError::into_inner);
            if matches!(map.get(hash), Some(Status::Running(_) | Status::Ready)) {
                return;
            }
            if self.load_index(hash).is_some() {
                map.insert(hash.to_owned(), Status::Ready);
                return;
            }
            let cancel = CancelToken::new();
            map.insert(hash.to_owned(), Status::Running(cancel.clone()));
            cancel
        };
        let store = Arc::clone(self);
        let hash = hash.to_owned();
        handle.spawn(async move {
            let status = match store.build_index(&hash, &cancel).await {
                Ok(()) => Status::Ready,
                Err(error) => {
                    tracing::warn!(target: "core.video", code = error.code(), "video index failed: {error}");
                    Status::Failed
                }
            };
            store.set_status(&hash, status);
        });
    }

    async fn build_index(&self, hash: &str, cancel: &CancelToken) -> Result<(), MediaError> {
        let _slot = tokio::select! {
            slot = Arc::clone(&self.slots).acquire_owned() => slot.map_err(|_| MediaError::Cancelled)?,
            () = cancel.cancelled() => return Err(MediaError::Cancelled),
        };
        let file = self.file(hash)?;
        let paths = self.paths()?;
        let meta = self.meta_for(&paths, hash).await?;
        let built = draggy_media::index(
            &paths,
            &file,
            &meta,
            IndexOptions::for_meta(&meta),
            |_| {},
            cancel,
        )
        .await?;
        let json =
            serde_json::to_string(&built).map_err(|error| MediaError::Probe(error.to_string()))?;
        self.storage
            .put_video_index(hash, i64::from(INDEX_VERSION), &json)
            .map_err(|error| MediaError::Io(std::io::Error::other(error.to_string())))
    }

    /// Waits for the index up to `INDEX_WAIT`, building it first. None when it is still not there.
    async fn wait_for_index(
        self: &Arc<Self>,
        hash: &str,
        cancel: &dyn Fn() -> bool,
    ) -> Option<VideoIndex> {
        if let Some(index) = self.load_index(hash) {
            return Some(index);
        }
        self.start_index(&Handle::current(), hash);
        let started = Instant::now();
        while started.elapsed() < INDEX_WAIT && !cancel() {
            match self.status_of(hash) {
                Some(Status::Ready) => return self.load_index(hash),
                Some(Status::Failed) | None => return None,
                Some(Status::Running(_)) => {}
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        None
    }

    /// The segment count for a handle line, without waiting.
    fn segments(&self, hash: &str) -> Segments {
        match self.status_of(hash) {
            Some(Status::Ready) => self.load_index(hash).map_or(Segments::Building, |index| {
                Segments::Count(index.segments.len())
            }),
            Some(Status::Failed) => Segments::Failed,
            _ => Segments::Building,
        }
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl VideoStore {
    /// Opens the store under the app's data folder. `ffmpeg_dir` is where the shell ships ffmpeg and ffprobe, if it
    /// does; otherwise they are looked up on `PATH` and in the usual install folders.
    #[uniffi::constructor]
    pub fn open(data_dir: String, ffmpeg_dir: Option<String>) -> Result<Arc<Self>, CoreError> {
        let storage = Storage::open(Path::new(&data_dir)).map_err(failed)?;
        Ok(Self::with_storage(
            Arc::new(storage),
            ffmpeg_dir.map(PathBuf::from),
        ))
    }

    /// Whether ffmpeg was found, so a shell can explain why videos cannot be attached.
    pub fn ffmpeg_available(&self) -> bool {
        self.paths().is_ok()
    }

    /// Probes and stores the video at `path`, then starts indexing it in the background.
    pub async fn import_video(self: Arc<Self>, path: String) -> Result<VideoRecord, CoreError> {
        let source = PathBuf::from(&path);
        let name = source.file_name().map_or_else(
            || "video".to_owned(),
            |name| name.to_string_lossy().into_owned(),
        );
        let paths = self.paths().map_err(failed)?;
        // Probing first refuses audio files and long videos before anything is copied.
        let meta = draggy_media::probe(&paths, &source).await.map_err(failed)?;
        let size = std::fs::metadata(&source)
            .map(|meta| meta.len())
            .unwrap_or(0);
        if size > MAX_VIDEO_BYTES {
            return Err(CoreError::Invalid {
                message: "The video is larger than 4GB.".to_owned(),
            });
        }
        let storage = Arc::clone(&self.storage);
        let (hash, size) = tokio::task::spawn_blocking(move || storage.import_video(&source))
            .await
            .map_err(failed)?
            .map_err(failed)?;
        self.meta
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(hash.clone(), meta.clone());
        self.start_index(&Handle::current(), &hash);
        Ok(VideoRecord {
            hash,
            mime: video_mime(&name),
            name,
            size,
            duration_s: meta.duration_s,
            width: meta.width,
            height: meta.height,
            fps: meta.fps,
            has_audio: meta.has_audio,
        })
    }

    /// `running`, `ready`, `failed` or `unknown`.
    pub fn index_state(&self, hash: String) -> String {
        match self.status_of(&hash) {
            Some(Status::Running(_)) => "running",
            Some(Status::Ready) => "ready",
            Some(Status::Failed) => "failed",
            None => "unknown",
        }
        .to_owned()
    }

    /// A small JPEG from early in the video for the attachment chip.
    pub async fn poster(self: Arc<Self>, hash: String) -> Result<Vec<u8>, CoreError> {
        let paths = self.paths().map_err(failed)?;
        let file = self.file(&hash).map_err(failed)?;
        let meta = self.meta_for(&paths, &hash).await.map_err(failed)?;
        let time_s = clamp_time(meta.duration_s * 0.1, meta.duration_s);
        draggy_media::extract_frame(&paths, &file, time_s, 320)
            .await
            .map_err(failed)
    }

    /// Stops indexing a video, as when its attachment is removed before sending.
    pub fn cancel_index(&self, hash: String) {
        if let Some(Status::Running(cancel)) = self
            .status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&hash)
        {
            cancel.cancel();
        }
    }
}

/// Keeps a seek a little short of the end, where ffmpeg would find no frame.
fn clamp_time(time_s: f64, duration_s: f64) -> f64 {
    time_s.clamp(0.0, (duration_s - 0.05).max(0.0))
}

/// `75.5`, `"75.5"`, `"1:15.5"` or `"0:01:15.5"` in seconds.
pub fn parse_time(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return number.is_finite().then_some(number);
    }
    let text = value.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    let parts: Vec<&str> = text.split(':').collect();
    if parts.len() > 3 {
        return None;
    }
    let mut total = 0.0;
    for part in parts {
        let valid = !part.is_empty()
            && !part.starts_with('.')
            && !part.ends_with('.')
            && part.chars().filter(|c| *c == '.').count() <= 1
            && part.chars().all(|c| c.is_ascii_digit() || c == '.');
        if !valid {
            return None;
        }
        total = total * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(total)
}

/// `01:07.5`.
pub fn clock(seconds: f64) -> String {
    let tenths = (seconds.max(0.0) * 10.0).round() as u64;
    let minutes = tenths / 600;
    let rest = (tenths % 600) as f64 / 10.0;
    format!("{minutes:02}:{rest:04.1}")
}

fn describe_segment(segment: &Segment) -> String {
    match segment.kind {
        SegmentKind::Static => "static".to_owned(),
        SegmentKind::Motion => format!(
            "motion ({} {})",
            segment.changes,
            if segment.changes == 1 {
                "change"
            } else {
                "changes"
            }
        ),
    }
}

/// One line per segment, or minute buckets when that would be too long to be useful.
pub fn timeline(segments: &[Segment], start: f64, end: f64) -> Vec<String> {
    let in_range: Vec<&Segment> = segments
        .iter()
        .filter(|segment| segment.end_s > start && segment.start_s < end)
        .collect();
    if in_range.len() <= MAX_TIMELINE_LINES {
        return in_range
            .iter()
            .map(|segment| {
                format!(
                    "{}-{} {}",
                    clock(segment.start_s),
                    clock(segment.end_s),
                    describe_segment(segment)
                )
            })
            .collect();
    }
    let mut buckets: Vec<(u64, usize, usize)> = Vec::new();
    for segment in &in_range {
        let minute = (segment.start_s / 60.0).floor() as u64;
        let moving = usize::from(segment.kind == SegmentKind::Motion);
        match buckets.last_mut() {
            Some(bucket) if bucket.0 == minute => {
                bucket.1 += 1;
                bucket.2 += moving;
            }
            _ => buckets.push((minute, 1, moving)),
        }
    }
    let mut lines: Vec<String> = buckets
        .iter()
        .map(|(minute, count, moving)| {
            format!(
                "{}-{} {count} segments, {moving} with motion",
                clock(*minute as f64 * 60.0),
                clock((*minute + 1) as f64 * 60.0)
            )
        })
        .collect();
    lines.push(format!(
        "{} segments is too many to list one by one. Call video_info again with start and end to see a range in full.",
        in_range.len()
    ));
    lines
}

fn even_times(start: f64, end: f64, count: usize) -> Vec<f64> {
    let step = (end - start) / count as f64;
    (0..count)
        .map(|i| start + step * (i as f64 + 0.5))
        .collect()
}

fn looked_again(tool: &str) -> String {
    format!(
        "TOOL RESULT ({tool}): You already looked at exactly this in this turn and its frames are above. Do not call it again: answer the user now from what you saw."
    )
}

fn definition(name: &str, description: &str, properties: Value) -> ToolDefinition {
    ToolDefinition {
        kind: "function".to_owned(),
        function: FunctionDefinition {
            name: name.to_owned(),
            description: description.to_owned(),
            parameters: json!({ "type": "object", "properties": properties, "required": ["video"] }),
        },
    }
}

/// The three video tools, offered when the chat holds a video and the model can see pictures.
pub fn definitions() -> Vec<ToolDefinition> {
    let video =
        json!({ "type": "string", "description": "The video's ID from the chat, such as v1." });
    vec![
        definition(
            "video_info",
            "Read a video's details and timeline: one line per stretch where the picture stays the same or moves. Text only, no frames. Call this first, then look at a narrow range with video_view.",
            json!({
                "video": video,
                "start": { "type": "string", "description": "Optional. Where the timeline starts, in seconds or mm:ss." },
                "end": { "type": "string", "description": "Optional. Where the timeline ends, in seconds or mm:ss." },
            }),
        ),
        definition(
            "video_view",
            "Look at a range of a video. One frame is shown per distinct stretch, so a still screen costs one frame however long it lasts. The frames follow the result. Keep the range narrow to see detail.",
            json!({
                "video": video,
                "start": { "type": "string", "description": "Where to start, in seconds or mm:ss. Defaults to the beginning." },
                "end": { "type": "string", "description": "Where to stop, in seconds or mm:ss. Defaults to the end." },
                "max_frames": { "type": "integer", "description": "At most this many frames, 1 to 12. Defaults to 8." },
                "grid": { "type": "boolean", "description": "Send the frames as one contact sheet instead of separate images." },
            }),
        ),
        definition(
            "video_frame",
            "Look at one exact frame of a video at full detail, by time or by frame number. Give one of the two.",
            json!({
                "video": video,
                "time": { "type": "string", "description": "The moment to show, in seconds or mm:ss." },
                "frame": { "type": "integer", "description": "The frame number to show, counting from 0." },
            }),
        ),
    ]
}

pub fn owns(name: &str) -> bool {
    TOOL_NAMES.contains(&name)
}

/// Whether any message holds a video, so the tools are worth offering.
pub fn has_videos(messages: &[Message]) -> bool {
    !track_videos(&messages.iter().collect::<Vec<_>>()).is_empty()
}

/// The video tools of one turn.
pub struct VideoTools {
    handle: Handle,
    store: Arc<VideoStore>,
    videos: Vec<TrackedVideo>,
    /// What this turn already looked at, so a small model asking again gets words instead of the same pictures.
    looked: HashSet<String>,
}

impl VideoTools {
    pub fn new(handle: Handle, store: Arc<VideoStore>, messages: &[Message]) -> Self {
        let mut videos = track_videos(&messages.iter().collect::<Vec<_>>());
        for video in &mut videos {
            video.segments = store.segments(&video.hash);
            store.start_index(&handle, &video.hash);
        }
        Self {
            handle,
            store,
            videos,
            looked: HashSet::new(),
        }
    }

    fn resolve(&self, raw: Option<&Value>) -> Result<TrackedVideo, String> {
        let wanted = raw
            .map(|value| match value {
                Value::String(text) => text.trim().to_owned(),
                other => other.to_string(),
            })
            .unwrap_or_default();
        if wanted.is_empty() && self.videos.len() == 1 {
            return Ok(self.videos[0].clone());
        }
        if let Some(video) = self
            .videos
            .iter()
            .find(|video| video.id == wanted.to_lowercase() || video.name == wanted)
        {
            return Ok(video.clone());
        }
        let ids: Vec<&str> = self.videos.iter().map(|video| video.id.as_str()).collect();
        Err(format!(
            "There is no video {} in this chat. Known videos: {}.",
            if wanted.is_empty() {
                "(none given)"
            } else {
                wanted.as_str()
            },
            if ids.is_empty() {
                "none".to_owned()
            } else {
                ids.join(", ")
            }
        ))
    }

    fn index(&self, hash: &str, ctx: &ToolContext<'_>) -> Option<VideoIndex> {
        let cancel = ctx.cancel.clone();
        let store = Arc::clone(&self.store);
        let hash = hash.to_owned();
        self.handle.block_on(async move {
            store
                .wait_for_index(&hash, &move || cancel.is_aborted())
                .await
        })
    }

    fn meta(&self, hash: &str) -> Result<(FfmpegPaths, PathBuf, VideoMeta), String> {
        let store = Arc::clone(&self.store);
        let hash = hash.to_owned();
        self.handle.block_on(async move {
            let paths = store.paths().map_err(|error| error.to_string())?;
            let file = store.file(&hash).map_err(|error| error.to_string())?;
            let meta = store
                .meta_for(&paths, &hash)
                .await
                .map_err(|error| error.to_string())?;
            Ok((paths, file, meta))
        })
    }

    fn step(ctx: &mut ToolContext<'_>, content: String) -> usize {
        let id = ctx.new_id();
        ctx.steps.push(SearchStep {
            id: Some(id),
            kind: "video".to_owned(),
            content: Some(content),
            is_complete: Some(false),
            ..SearchStep::default()
        });
        ctx.steps.len() - 1
    }

    fn finish(ctx: &mut ToolContext<'_>, at: usize, seen: Option<String>) {
        if let Some(step) = ctx.steps.get_mut(at) {
            step.is_complete = Some(true);
            if let Some(seen) = seen {
                step.extra
                    .insert("videoSeen".to_owned(), Value::String(seen));
            }
        }
    }

    fn info(&mut self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let video = match self.resolve(args.get("video")) {
            Ok(video) => video,
            Err(message) => return format!("TOOL RESULT (video_info): {message}"),
        };
        let at = Self::step(ctx, format!("Reading the timeline of {}", video.name));
        let index = self.index(&video.hash, ctx);
        Self::finish(
            ctx,
            at,
            Some(format!(
                "Read the timeline of {} \"{}\".",
                video.id, video.name
            )),
        );
        let mut head = format!("{} \"{}\"", video.id, video.name);
        let meta = index
            .as_ref()
            .map(|index| index.meta.clone())
            .or_else(|| self.meta(&video.hash).ok().map(|(_, _, meta)| meta));
        if let Some(meta) = &meta {
            head.push_str(&format!(
                "\n{} ({:.1}s), {}, {} audio",
                format_duration(meta.duration_s),
                meta.duration_s,
                describe_meta(&agent_meta(meta)),
                if meta.has_audio { "with" } else { "no" }
            ));
        }
        let Some(index) = index else {
            return format!(
                "TOOL RESULT (video_info): {head}\nThe index is still building. video_view still works with evenly spaced frames; try video_info again shortly."
            );
        };
        if let Some(tracked) = self.videos.iter_mut().find(|item| item.hash == video.hash) {
            tracked.segments = Segments::Count(index.segments.len());
        }
        let start = args
            .get("start")
            .and_then(parse_time)
            .unwrap_or(0.0)
            .max(0.0);
        let end = args
            .get("end")
            .and_then(parse_time)
            .unwrap_or(index.meta.duration_s)
            .min(index.meta.duration_s);
        if end <= start {
            return "TOOL RESULT (video_info): end must come after start.".to_owned();
        }
        format!(
            "TOOL RESULT (video_info): {head}\n{} distinct segments. Timeline {}-{}:\n{}",
            index.segments.len(),
            clock(start),
            clock(end),
            timeline(&index.segments, start, end).join("\n")
        )
    }

    fn view(&mut self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let video = match self.resolve(args.get("video")) {
            Ok(video) => video,
            Err(message) => return format!("TOOL RESULT (video_view): {message}"),
        };
        let (paths, file, meta) = match self.meta(&video.hash) {
            Ok(opened) => opened,
            Err(message) => return format!("TOOL RESULT (video_view): {message}"),
        };
        let duration = meta.duration_s;
        let start = args
            .get("start")
            .and_then(parse_time)
            .unwrap_or(0.0)
            .max(0.0)
            .min(duration);
        let end = args
            .get("end")
            .and_then(parse_time)
            .unwrap_or(duration)
            .min(duration);
        if end <= start {
            return "TOOL RESULT (video_view): end must come after start.".to_owned();
        }
        let max = args
            .get("max_frames")
            .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
            .filter(|value| value.is_finite() && *value != 0.0)
            .map_or(8, |value| {
                (value.round().max(1.0) as usize).min(MAX_VIEW_FRAMES)
            });
        let grid = matches!(args.get("grid"), Some(Value::Bool(true)))
            || args.get("grid").and_then(Value::as_str) == Some("true");
        let key = format!("view:{}:{start:.2}-{end:.2}:{max}:{grid}", video.hash);
        if !self.looked.insert(key) {
            return looked_again("video_view");
        }

        let range = format!("{}-{}", clock(start), clock(end));
        let at = Self::step(ctx, format!("Looking at {} {range}", video.name));
        let index = self.index(&video.hash, ctx);
        let (shown, skipped, times): (Vec<Option<Segment>>, usize, Vec<f64>) = match &index {
            Some(index) => {
                let selection = select_frames(&index.segments, start, end, max);
                let times = selection
                    .shown
                    .iter()
                    .map(|segment| segment.rep_s)
                    .collect();
                (
                    selection.shown.into_iter().map(Some).collect(),
                    selection.skipped,
                    times,
                )
            }
            None => (vec![None; max], 0, even_times(start, end, max)),
        };
        let times: Vec<f64> = times
            .into_iter()
            .map(|time| clamp_time(time, duration))
            .collect();

        let images: Result<Vec<Vec<u8>>, MediaError> = self.handle.block_on(async {
            if grid {
                let cols = (times.len() as f64).sqrt().ceil() as u32;
                let sheet =
                    draggy_media::contact_sheet(&paths, &file, &meta, &times, VIEW_MAX_SIDE, cols)
                        .await?;
                return Ok(vec![sheet]);
            }
            let mut frames = Vec::with_capacity(times.len());
            for time_s in &times {
                frames.push(
                    draggy_media::extract_frame(&paths, &file, *time_s, VIEW_MAX_SIDE).await?,
                );
            }
            Ok(frames)
        });
        let images = match images {
            Ok(images) => images,
            Err(error) => {
                Self::finish(ctx, at, None);
                return format!("TOOL RESULT (video_view): {error}");
            }
        };
        Self::finish(
            ctx,
            at,
            Some(format!(
                "Looked at {} \"{}\" {range} ({} frames).",
                video.id,
                video.name,
                times.len()
            )),
        );

        let mut lines: Vec<String> = Vec::new();
        let mut refused = 0;
        if grid {
            if !ctx.attach_image(STANDARD.encode(&images[0])) {
                refused = times.len();
            }
            let cols = (times.len() as f64).sqrt().ceil() as u32;
            lines.push(format!(
                "One contact sheet, {cols} tiles per row, read left to right then top to bottom:"
            ));
        } else {
            for image in &images {
                if !ctx.attach_image(STANDARD.encode(image)) {
                    refused += 1;
                }
            }
        }
        for (i, time) in times.iter().enumerate() {
            let covers = shown
                .get(i)
                .and_then(Option::as_ref)
                .map(|segment| {
                    format!(
                        ", covers {:.1}-{:.1}s, {}",
                        segment.start_s,
                        segment.end_s,
                        if segment.kind == SegmentKind::Static {
                            "unchanged".to_owned()
                        } else {
                            describe_segment(segment)
                        }
                    )
                })
                .unwrap_or_default();
            lines.push(format!(
                "{} {}: t={time:.1}s{covers}",
                if grid { "tile" } else { "image" },
                i + 1
            ));
        }
        if index.is_none() {
            lines.push("The index is still building, so these frames are evenly spaced rather than one per distinct stretch.".to_owned());
        }
        if skipped > 0 {
            lines.push(format!("{skipped} more distinct segments in this range were not shown. Call again with a narrower range to see them."));
        }
        if refused > 0 {
            lines.push(format!("{refused} frames were not sent: this turn's image budget is used up. Answer from what you have seen."));
        }
        format!(
            "TOOL RESULT (video_view): {} {range}. The frames follow this message.\n{}",
            video.id,
            lines.join("\n")
        )
    }

    fn frame(&mut self, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        let given = |key: &str| {
            args.get(key)
                .is_some_and(|value| !value.is_null() && value.as_str() != Some(""))
        };
        let (has_time, has_frame) = (given("time"), given("frame"));
        if has_time == has_frame {
            return "TOOL RESULT (video_frame): give either time or frame, not both and not neither."
                .to_owned();
        }
        let video = match self.resolve(args.get("video")) {
            Ok(video) => video,
            Err(message) => return format!("TOOL RESULT (video_frame): {message}"),
        };
        let (paths, file, meta) = match self.meta(&video.hash) {
            Ok(opened) => opened,
            Err(message) => return format!("TOOL RESULT (video_frame): {message}"),
        };
        let fps = if meta.fps > 0.0 { meta.fps } else { 30.0 };
        let asked = if has_time {
            args.get("time").and_then(parse_time)
        } else {
            args.get("frame")
                .and_then(|value| {
                    value
                        .as_f64()
                        .or_else(|| value.as_str()?.trim().parse().ok())
                })
                .map(|frame| (frame + 0.5) / fps)
        };
        let Some(asked) = asked.filter(|time| time.is_finite() && *time >= 0.0) else {
            return "TOOL RESULT (video_frame): the time or frame could not be read.".to_owned();
        };
        if !self
            .looked
            .insert(format!("frame:{}@{asked:.3}", video.hash))
        {
            return looked_again("video_frame");
        }

        let at = Self::step(
            ctx,
            format!("Looking at {} at {}", video.name, clock(asked)),
        );
        let time_s = clamp_time(asked, meta.duration_s);
        let bytes = self.handle.block_on(draggy_media::extract_frame(
            &paths,
            &file,
            time_s,
            FRAME_MAX_SIDE,
        ));
        let bytes = match bytes {
            Ok(bytes) => bytes,
            Err(error) => {
                Self::finish(ctx, at, None);
                return format!("TOOL RESULT (video_frame): {error}");
            }
        };
        Self::finish(
            ctx,
            at,
            Some(format!(
                "Looked at the frame of {} \"{}\" at {}.",
                video.id,
                video.name,
                clock(time_s)
            )),
        );
        if !ctx.attach_image(STANDARD.encode(&bytes)) {
            return format!(
                "TOOL RESULT (video_frame): the frame at t={time_s:.2}s was not sent: this turn's image budget is used up."
            );
        }
        let segment = self.store.load_index(&video.hash).and_then(|index| {
            index
                .segments
                .into_iter()
                .find(|item| time_s >= item.start_s && time_s < item.end_s)
        });
        let place = segment
            .map(|segment| {
                format!(
                    " It belongs to the {} segment {}-{}.",
                    describe_segment(&segment),
                    clock(segment.start_s),
                    clock(segment.end_s)
                )
            })
            .unwrap_or_default();
        format!(
            "TOOL RESULT (video_frame): {} at t={time_s:.2}s (frame {}).{place} The image follows this message.",
            video.id,
            (time_s * fps).floor() as u64
        )
    }
}

fn agent_meta(meta: &VideoMeta) -> draggy_agent::video_handle::VideoMeta {
    draggy_agent::video_handle::VideoMeta {
        duration_s: meta.duration_s,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
    }
}

impl ToolRuntime for VideoTools {
    fn annotations(&self, _name: &str) -> ToolAnnotations {
        ToolAnnotations {
            read_only: true,
            idempotent: true,
            sandboxed: true,
            ..ToolAnnotations::default()
        }
    }

    fn run(&mut self, name: &str, args: &Value, ctx: &mut ToolContext<'_>) -> String {
        match name {
            "video_info" => self.info(args, ctx),
            "video_view" => self.view(args, ctx),
            "video_frame" => self.frame(args, ctx),
            _ => format!("TOOL RESULT ({name}): unknown video tool."),
        }
    }

    /// The loop numbers videos with the index still building; a line whose index is ready gets its real count.
    fn prepare_wire(&mut self, wire: &mut [WireMessage]) {
        for video in &self.videos {
            if video.segments == Segments::Building {
                continue;
            }
            let building = video_handle_line(
                &TrackedVideo {
                    segments: Segments::Building,
                    ..video.clone()
                },
                true,
            );
            let known = video_handle_line(video, true);
            for message in wire.iter_mut().filter(|message| message.role == "user") {
                if message.content.contains(&building) {
                    message.content = message.content.replace(&building, &known);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_seconds_and_clock_times() {
        assert_eq!(parse_time(&json!(12)), Some(12.0));
        assert_eq!(parse_time(&json!("1:07.5")), Some(67.5));
        assert_eq!(parse_time(&json!("1:00:00")), Some(3600.0));
        assert_eq!(parse_time(&json!("soon")), None);
        assert_eq!(parse_time(&json!("-3")), None);
        assert_eq!(parse_time(&json!("")), None);
    }

    #[test]
    fn clocks_in_tenths() {
        assert_eq!(clock(67.5), "01:07.5");
        assert_eq!(clock(0.0), "00:00.0");
    }

    #[test]
    fn a_video_becomes_a_reference_the_loop_reads() {
        let record = VideoRecord {
            hash: "a".repeat(64),
            name: "demo.mov".into(),
            mime: video_mime("demo.mov"),
            size: 10,
            duration_s: 60.0,
            width: 640,
            height: 360,
            fps: 30.0,
            has_audio: false,
        };
        let attachment = video_attachment(&record);
        assert_eq!(attachment.kind, "video/quicktime");
        let (hash, name, meta) =
            draggy_agent::video_handle::video_ref_of(&attachment).expect("a video reference");
        assert_eq!(
            (hash.as_str(), name.as_str()),
            ("a".repeat(64).as_str(), "demo.mov")
        );
        assert_eq!(meta.map(|meta| meta.width), Some(640));
    }

    #[test]
    fn lists_one_line_per_segment() {
        let segment = |start_s: f64, end_s: f64, kind, changes| Segment {
            start_s,
            end_s,
            rep_s: (start_s + end_s) / 2.0,
            change_score: 0.0,
            kind,
            changes,
        };
        let segments = [
            segment(0.0, 20.0, SegmentKind::Static, 1),
            segment(20.0, 40.0, SegmentKind::Motion, 3),
            segment(40.0, 60.0, SegmentKind::Static, 1),
        ];
        assert_eq!(
            timeline(&segments, 10.0, 30.0),
            [
                "00:00.0-00:20.0 static",
                "00:20.0-00:40.0 motion (3 changes)"
            ]
        );
    }

    struct Ids(u32);

    impl draggy_agent::agent_loop::IdSource for Ids {
        fn next_id(&mut self) -> String {
            self.0 += 1;
            format!("id{}", self.0)
        }
    }

    fn call(tools: &mut VideoTools, name: &str, args: &Value) -> String {
        let (mut steps, mut ids) = (Vec::new(), Ids(0));
        let cancel = draggy_agent::task_manager::CancelSignal::new();
        let mut ctx = ToolContext {
            steps: &mut steps,
            ids: &mut ids,
            cancel: &cancel,
            plan: None,
            images: Vec::new(),
        };
        tools.run(name, args, &mut ctx)
    }

    #[test]
    fn checks_the_arguments_before_touching_the_file() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let storage = Arc::new(Storage::open(dir.path()).unwrap());
        let store = VideoStore::with_storage(storage, Some(dir.path().to_path_buf()));
        let record = VideoRecord {
            hash: "b".repeat(64),
            name: "clip.mp4".into(),
            mime: "video/mp4".into(),
            size: 1,
            duration_s: 10.0,
            width: 320,
            height: 240,
            fps: 25.0,
            has_audio: true,
        };
        let mut sent = Message {
            role: "user".into(),
            ..Message::default()
        };
        sent.attachments = Some(vec![video_attachment(&record)]);
        assert!(has_videos(std::slice::from_ref(&sent)));
        let mut tools = VideoTools::new(runtime.handle().clone(), store, &[sent]);

        let both = call(
            &mut tools,
            "video_frame",
            &json!({"video": "v1", "time": 1, "frame": 3}),
        );
        assert!(both.contains("give either time or frame"), "{both}");
        let neither = call(&mut tools, "video_frame", &json!({"video": "v1"}));
        assert!(neither.contains("give either time or frame"), "{neither}");
        let unknown = call(&mut tools, "video_info", &json!({"video": "v9"}));
        assert!(
            unknown.contains("There is no video v9 in this chat. Known videos: v1."),
            "{unknown}"
        );
    }

    #[test]
    fn offers_three_tools() {
        let names: Vec<String> = definitions()
            .into_iter()
            .map(|tool| tool.function.name)
            .collect();
        assert_eq!(names, TOOL_NAMES);
        assert!(owns("video_frame") && !owns("read_file"));
    }
}
