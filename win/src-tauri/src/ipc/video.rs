//! Video attachments: import into the blob store, background indexing, and frames for the video tools.
//! Bytes go in by path where possible, so a large video never crosses IPC; frames come back as base64 JPEG.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use draggy_media::{
    CancelToken, FRAME_MAX_SIDE, FfmpegPaths, INDEX_VERSION, IndexOptions, MAX_VIDEO_BYTES,
    MAX_VIEW_FRAMES, MediaError, VIEW_MAX_SIDE, VideoIndex, VideoMeta, select_frames,
};
use draggy_storage::Storage;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Semaphore;

use super::{IpcError, Registry, emit};
use crate::AppState;

/// Paste and browser files arrive as bytes over IPC, so they get a much lower cap than a path import.
const MAX_IMPORT_BYTES: usize = 200 * 1024 * 1024;
/// Indexing decodes the whole file; two at once keeps a batch of attachments from starving the machine.
const INDEX_SLOTS: usize = 2;
const POSTER_SIDE: u32 = 320;
const PROGRESS_EVENT: &str = "video-index-progress";
/// Mirrors `VIDEO_EXTENSIONS` in the renderer's attachments.ts.
const PICKER_EXTENSIONS: [&str; 15] = [
    "mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "mpg", "mpeg", "3gp", "ts", "mts",
    "m2ts", "ogv",
];

pub fn register_all(registry: &mut Registry) {
    register!(registry, "video:pick" => pick);
    register!(registry, "video:import" => import);
    register!(registry, "video:import-bytes" => import_bytes);
    register!(registry, "video:index" => start_index);
    register!(registry, "video:index-status" => index_status);
    register!(registry, "video:get-index" => get_index);
    register!(registry, "video:select" => select);
    register!(registry, "video:frame" => frame);
    register!(registry, "video:frames" => frames);
    register!(registry, "video:poster" => poster);
    register!(registry, "video:cancel" => cancel);
}

#[derive(Clone, Debug)]
enum Status {
    Running { progress: f64, cancel: CancelToken },
    Ready,
    Failed { code: String, error: String },
}

impl Status {
    fn to_json(&self, hash: &str) -> Value {
        match self {
            Self::Running { progress, .. } => {
                json!({ "hash": hash, "status": "running", "progress": progress })
            }
            Self::Ready => json!({ "hash": hash, "status": "ready", "progress": 1.0 }),
            Self::Failed { code, error } => {
                json!({ "hash": hash, "status": "failed", "code": code, "error": error })
            }
        }
    }
}

/// Index jobs and probed metadata, shared by every handler.
struct Jobs {
    status: Mutex<HashMap<String, Status>>,
    meta: Mutex<HashMap<String, VideoMeta>>,
    slots: Arc<Semaphore>,
}

impl Jobs {
    fn new() -> Self {
        Self {
            status: Mutex::new(HashMap::new()),
            meta: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(INDEX_SLOTS)),
        }
    }

    fn get(&self, hash: &str) -> Option<Status> {
        self.status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(hash)
            .cloned()
    }

    /// Claims the hash for a new job, or returns the one already running. A failed job may be retried.
    fn begin(&self, hash: &str) -> Result<CancelToken, Status> {
        let mut map = self.status.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(existing @ (Status::Running { .. } | Status::Ready)) = map.get(hash) {
            return Err(existing.clone());
        }
        let cancel = CancelToken::new();
        map.insert(
            hash.to_owned(),
            Status::Running {
                progress: 0.0,
                cancel: cancel.clone(),
            },
        );
        Ok(cancel)
    }

    fn progress(&self, hash: &str, value: f64) {
        let mut map = self.status.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(Status::Running { progress, .. }) = map.get_mut(hash) {
            *progress = value;
        }
    }

    fn finish(&self, hash: &str, status: Status) {
        self.status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(hash.to_owned(), status);
    }

    /// Stops a running job. The job itself records the cancelled failure when ffmpeg is gone.
    fn cancel(&self, hash: &str) -> bool {
        let map = self.status.lock().unwrap_or_else(PoisonError::into_inner);
        match map.get(hash) {
            Some(Status::Running { cancel, .. }) => {
                cancel.cancel();
                true
            }
            _ => false,
        }
    }

    fn remember(&self, hash: &str, meta: &VideoMeta) {
        self.meta
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(hash.to_owned(), meta.clone());
    }

    fn cached_meta(&self, hash: &str) -> Option<VideoMeta> {
        self.meta
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(hash)
            .cloned()
    }
}

fn jobs() -> &'static Jobs {
    static JOBS: OnceLock<Jobs> = OnceLock::new();
    JOBS.get_or_init(Jobs::new)
}

/// Tauri copies `externalBin` beside the exe without the target triple. Debug builds also look at the staged
/// copies and the vendor folder, then PATH; a release build never runs an ffmpeg it did not ship.
fn ffmpeg_paths() -> Result<FfmpegPaths, MediaError> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    if let Some(dir) = exe_dir
        && let Ok(found) = FfmpegPaths::find(Some(&dir), false)
    {
        return Ok(found);
    }
    if !cfg!(debug_assertions) {
        return Err(MediaError::FfmpegMissing);
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let staged = |tool: &str| {
        manifest
            .join("binaries")
            .join(format!("{tool}-x86_64-pc-windows-msvc.exe"))
    };
    let (ffmpeg, ffprobe) = (staged("ffmpeg"), staged("ffprobe"));
    if ffmpeg.is_file() && ffprobe.is_file() {
        return Ok(FfmpegPaths { ffmpeg, ffprobe });
    }
    FfmpegPaths::find(Some(&manifest.join("../vendor/ffmpeg")), true)
}

fn refusal(error: &MediaError) -> Value {
    json!({ "success": false, "code": error.code(), "error": error.to_string() })
}

fn failed(code: &str, error: &str) -> Value {
    json!({ "success": false, "code": code, "error": error })
}

fn request(args: &[Value]) -> &Value {
    args.first().unwrap_or(&Value::Null)
}

/// A lowercase SHA-256 hex string, the only form a stored video has.
fn hash_arg(request: &Value) -> Option<String> {
    let hash = request.get("hash")?.as_str()?;
    (hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
    .then(|| hash.to_owned())
}

fn number_arg(request: &Value, key: &str) -> Option<f64> {
    request
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
}

fn side_arg(request: &Value, fallback: u32) -> u32 {
    number_arg(request, "maxSide").map_or(fallback, |side| {
        side.clamp(64.0, f64::from(FRAME_MAX_SIDE)) as u32
    })
}

/// Up to `MAX_VIEW_FRAMES` finite times, clamped to the video.
fn times_arg(request: &Value, duration_s: f64) -> Vec<f64> {
    request
        .get("times")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_f64)
                .filter(|time| time.is_finite())
                .take(MAX_VIEW_FRAMES)
                .map(|time| clamp_time(time, duration_s))
                .collect()
        })
        .unwrap_or_default()
}

/// Keeps a seek a little short of the end, where ffmpeg would find no frame.
fn clamp_time(time_s: f64, duration_s: f64) -> f64 {
    let last = (duration_s - 0.05).max(0.0);
    time_s.clamp(0.0, last)
}

fn storage(app: &AppHandle) -> Result<Arc<Storage>, Value> {
    app.state::<AppState>()
        .storage
        .handle()
        .ok_or_else(|| failed("E_STORAGE_CLOSED", "The chat database is not open."))
}

fn video_file(storage: &Storage, hash: &str) -> Result<PathBuf, Value> {
    match storage.video_path(hash) {
        Ok(Some(path)) => Ok(path),
        Ok(None) => Err(failed(
            "E_VIDEO_MISSING",
            "The video file is no longer stored.",
        )),
        Err(error) => Err(failed("E_STORAGE", &error.to_string())),
    }
}

/// Metadata from memory, then from a stored index, then from ffprobe.
async fn meta_for(
    paths: &FfmpegPaths,
    storage: &Arc<Storage>,
    hash: &str,
    file: &Path,
) -> Result<VideoMeta, MediaError> {
    if let Some(meta) = jobs().cached_meta(hash) {
        return Ok(meta);
    }
    let stored = {
        let storage = Arc::clone(storage);
        let hash = hash.to_owned();
        tauri::async_runtime::spawn_blocking(move || storage.get_video_index(&hash))
            .await
            .ok()
            .and_then(Result::ok)
            .flatten()
    };
    if let Some(index) = stored.and_then(|row| serde_json::from_str::<VideoIndex>(&row.json).ok()) {
        jobs().remember(hash, &index.meta);
        return Ok(index.meta);
    }
    let meta = draggy_media::probe(paths, file).await?;
    jobs().remember(hash, &meta);
    Ok(meta)
}

/// Everything a frame handler needs, or the refusal to answer with.
async fn open_video(
    app: &AppHandle,
    request: &Value,
) -> Result<(FfmpegPaths, PathBuf, VideoMeta), Value> {
    let hash =
        hash_arg(request).ok_or_else(|| failed("E_BAD_ARGS", "A video hash is required."))?;
    let storage = storage(app)?;
    let file = video_file(&storage, &hash)?;
    let paths = ffmpeg_paths().map_err(|error| refusal(&error))?;
    let meta = meta_for(&paths, &storage, &hash, &file)
        .await
        .map_err(|error| refusal(&error))?;
    Ok((paths, file, meta))
}

fn finish_import(
    hash: String,
    size: u64,
    name: &str,
    meta: Result<VideoMeta, MediaError>,
) -> Value {
    match meta {
        Ok(meta) => {
            jobs().remember(&hash, &meta);
            json!({ "success": true, "hash": hash, "name": name, "size": size, "meta": meta })
        }
        Err(error) => refusal(&error),
    }
}

/// The native picker, so a video of any size arrives as a path instead of bytes over IPC.
async fn pick(app: AppHandle, _args: Vec<Value>) -> Result<Value, IpcError> {
    let picker = app.clone();
    let chosen = super::storage::blocking(move || {
        let mut dialog = picker
            .dialog()
            .file()
            .add_filter("Video", &PICKER_EXTENSIONS);
        if let Some(window) = picker.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        dialog.blocking_pick_files()
    })
    .await?;
    let Some(files) = chosen else {
        return Ok(json!({ "success": false, "cancelled": true, "error": "" }));
    };
    let paths: Vec<String> = files
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    Ok(json!({ "success": true, "paths": paths }))
}

async fn import(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let request = request(&args);
    let Some(source) = request
        .get("path")
        .and_then(Value::as_str)
        .map(PathBuf::from)
    else {
        return Ok(failed("E_BAD_ARGS", "A file path is required."));
    };
    let name = request
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            source
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "video".to_owned());
    let paths = match ffmpeg_paths() {
        Ok(paths) => paths,
        Err(error) => return Ok(refusal(&error)),
    };
    // Probing the source first refuses audio files and long videos before anything is copied.
    let meta = match draggy_media::probe(&paths, &source).await {
        Ok(meta) => meta,
        Err(error) => return Ok(refusal(&error)),
    };
    let size = std::fs::metadata(&source)
        .map(|meta| meta.len())
        .unwrap_or(0);
    if size > MAX_VIDEO_BYTES {
        return Ok(failed("E_VIDEO_TOO_LARGE", "The video is larger than 4GB."));
    }
    let storage = match storage(&app) {
        Ok(storage) => storage,
        Err(refused) => return Ok(refused),
    };
    let stored = super::storage::blocking(move || storage.import_video(&source)).await?;
    Ok(match stored {
        Ok((hash, size)) => finish_import(hash, size, &name, Ok(meta)),
        Err(error) => failed("E_IMPORT", &error.to_string()),
    })
}

async fn import_bytes(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let request = request(&args);
    let name = request
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("video")
        .to_owned();
    let Some(bytes) = super::documents::bytes_arg(request.get("bytes")) else {
        return Ok(failed("E_BAD_ARGS", "No video data."));
    };
    if bytes.len() > MAX_IMPORT_BYTES {
        return Ok(failed(
            "E_VIDEO_TOO_LARGE",
            "Pasted videos are limited to 200MB. Attach the file instead.",
        ));
    }
    let storage = match storage(&app) {
        Ok(storage) => storage,
        Err(refused) => return Ok(refused),
    };
    let paths = match ffmpeg_paths() {
        Ok(paths) => paths,
        Err(error) => return Ok(refusal(&error)),
    };
    let saving = Arc::clone(&storage);
    let stored = super::storage::blocking(move || saving.import_video_bytes(&bytes)).await?;
    let (hash, size) = match stored {
        Ok(done) => done,
        Err(error) => return Ok(failed("E_IMPORT", &error.to_string())),
    };
    let file = match video_file(&storage, &hash) {
        Ok(file) => file,
        Err(refused) => return Ok(refused),
    };
    let meta = draggy_media::probe(&paths, &file).await;
    Ok(finish_import(hash, size, &name, meta))
}

/// Ready when a current index is stored; otherwise whatever the job table says, or pending.
async fn status_of(storage: &Arc<Storage>, hash: &str) -> Status {
    if let Some(status) = jobs().get(hash) {
        return status;
    }
    let storage = Arc::clone(storage);
    let key = hash.to_owned();
    let stored = tauri::async_runtime::spawn_blocking(move || storage.get_video_index(&key))
        .await
        .ok()
        .and_then(Result::ok)
        .flatten();
    match stored {
        Some(row) if row.version == i64::from(INDEX_VERSION) => Status::Ready,
        _ => Status::Failed {
            code: "E_PENDING".into(),
            error: String::new(),
        },
    }
}

fn status_json(status: &Status, hash: &str) -> Value {
    match status {
        Status::Failed { code, .. } if code == "E_PENDING" => {
            json!({ "hash": hash, "status": "pending" })
        }
        other => other.to_json(hash),
    }
}

async fn start_index(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(hash) = hash_arg(request(&args)) else {
        return Ok(failed("E_BAD_ARGS", "A video hash is required."));
    };
    let storage = match storage(&app) {
        Ok(storage) => storage,
        Err(refused) => return Ok(refused),
    };
    let current = status_of(&storage, &hash).await;
    if matches!(current, Status::Ready | Status::Running { .. }) {
        return Ok(json!({ "success": true, "state": status_json(&current, &hash) }));
    }
    let cancel = match jobs().begin(&hash) {
        Ok(cancel) => cancel,
        Err(existing) => {
            return Ok(json!({ "success": true, "state": existing.to_json(&hash) }));
        }
    };
    let job_hash = hash.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = run_index(&app, &storage, &job_hash, &cancel).await;
        let status = match outcome {
            Ok(()) => Status::Ready,
            Err(error) => Status::Failed {
                code: error.code().to_owned(),
                error: error.to_string(),
            },
        };
        jobs().finish(&job_hash, status.clone());
        emit(&app, PROGRESS_EVENT, status.to_json(&job_hash));
    });
    Ok(json!({ "success": true, "state": { "hash": hash, "status": "running", "progress": 0.0 } }))
}

async fn run_index(
    app: &AppHandle,
    storage: &Arc<Storage>,
    hash: &str,
    cancel: &CancelToken,
) -> Result<(), MediaError> {
    let _slot = tokio::select! {
        slot = Arc::clone(&jobs().slots).acquire_owned() => slot.map_err(|_| MediaError::Cancelled)?,
        () = cancel.cancelled() => return Err(MediaError::Cancelled),
    };
    let file = storage
        .video_path(hash)
        .ok()
        .flatten()
        .ok_or(MediaError::NoVideoStream)?;
    let paths = ffmpeg_paths()?;
    let meta = meta_for(&paths, storage, hash, &file).await?;
    let report = |progress: f64| {
        jobs().progress(hash, progress);
        emit(
            app,
            PROGRESS_EVENT,
            json!({ "hash": hash, "status": "running", "progress": progress }),
        );
    };
    let built = draggy_media::index(
        &paths,
        &file,
        &meta,
        IndexOptions::for_meta(&meta),
        report,
        cancel,
    )
    .await?;
    let json =
        serde_json::to_string(&built).map_err(|error| MediaError::Probe(error.to_string()))?;
    let storage = Arc::clone(storage);
    let key = hash.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        storage.put_video_index(&key, i64::from(INDEX_VERSION), &json)
    })
    .await
    .map_err(|error| MediaError::Io(std::io::Error::other(error.to_string())))?
    .map_err(|error| MediaError::Io(std::io::Error::other(error.to_string())))?;
    Ok(())
}

async fn index_status(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(hash) = hash_arg(request(&args)) else {
        return Ok(failed("E_BAD_ARGS", "A video hash is required."));
    };
    let storage = match storage(&app) {
        Ok(storage) => storage,
        Err(refused) => return Ok(refused),
    };
    let status = status_of(&storage, &hash).await;
    Ok(json!({ "success": true, "state": status_json(&status, &hash) }))
}

async fn load_index(storage: &Arc<Storage>, hash: &str) -> Option<VideoIndex> {
    let storage = Arc::clone(storage);
    let key = hash.to_owned();
    let row = tauri::async_runtime::spawn_blocking(move || storage.get_video_index(&key))
        .await
        .ok()?
        .ok()??;
    (row.version == i64::from(INDEX_VERSION))
        .then(|| serde_json::from_str(&row.json).ok())
        .flatten()
}

async fn get_index(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(hash) = hash_arg(request(&args)) else {
        return Ok(failed("E_BAD_ARGS", "A video hash is required."));
    };
    let storage = match storage(&app) {
        Ok(storage) => storage,
        Err(refused) => return Ok(refused),
    };
    let index = load_index(&storage, &hash).await;
    Ok(json!({ "success": true, "index": index }))
}

/// The segments worth showing in a range, chosen by the same rule the Rust agent would use.
async fn select(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let request = request(&args);
    let Some(hash) = hash_arg(request) else {
        return Ok(failed("E_BAD_ARGS", "A video hash is required."));
    };
    let storage = match storage(&app) {
        Ok(storage) => storage,
        Err(refused) => return Ok(refused),
    };
    let Some(index) = load_index(&storage, &hash).await else {
        return Ok(failed("E_INDEX_NOT_READY", "The video index is not ready."));
    };
    let start = number_arg(request, "start").unwrap_or(0.0);
    let end = number_arg(request, "end").unwrap_or(index.meta.duration_s);
    let max =
        number_arg(request, "max").map_or(8, |max| max.clamp(1.0, MAX_VIEW_FRAMES as f64) as usize);
    let selection = select_frames(&index.segments, start, end, max);
    Ok(json!({ "success": true, "shown": selection.shown, "skipped": selection.skipped }))
}

fn jpeg(bytes: &[u8]) -> Value {
    json!({ "mime": "image/jpeg", "data": STANDARD.encode(bytes) })
}

async fn frame(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let request = request(&args);
    let (paths, file, meta) = match open_video(&app, request).await {
        Ok(opened) => opened,
        Err(refused) => return Ok(refused),
    };
    let time_s = clamp_time(number_arg(request, "timeS").unwrap_or(0.0), meta.duration_s);
    let side = side_arg(request, FRAME_MAX_SIDE);
    Ok(
        match draggy_media::extract_frame(&paths, &file, time_s, side).await {
            Ok(bytes) => json!({ "success": true, "timeS": time_s, "image": jpeg(&bytes) }),
            Err(error) => refusal(&error),
        },
    )
}

async fn frames(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let request = request(&args);
    let (paths, file, meta) = match open_video(&app, request).await {
        Ok(opened) => opened,
        Err(refused) => return Ok(refused),
    };
    let times = times_arg(request, meta.duration_s);
    if times.is_empty() {
        return Ok(failed("E_BAD_ARGS", "At least one time is required."));
    }
    let side = side_arg(request, VIEW_MAX_SIDE);
    if request.get("grid").and_then(Value::as_bool) == Some(true) {
        let cols = (times.len() as f64).sqrt().ceil() as u32;
        return Ok(
            match draggy_media::contact_sheet(&paths, &file, &meta, &times, side, cols).await {
                Ok(bytes) => {
                    json!({ "success": true, "cols": cols, "times": times, "sheet": jpeg(&bytes) })
                }
                Err(error) => refusal(&error),
            },
        );
    }
    let mut out = Vec::with_capacity(times.len());
    for time_s in times {
        match draggy_media::extract_frame(&paths, &file, time_s, side).await {
            Ok(bytes) => out.push(json!({ "timeS": time_s, "image": jpeg(&bytes) })),
            Err(error) => return Ok(refusal(&error)),
        }
    }
    Ok(json!({ "success": true, "frames": out }))
}

async fn poster(app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let request = request(&args);
    let (paths, file, meta) = match open_video(&app, request).await {
        Ok(opened) => opened,
        Err(refused) => return Ok(refused),
    };
    let time_s = clamp_time(meta.duration_s * 0.1, meta.duration_s);
    Ok(
        match draggy_media::extract_frame(&paths, &file, time_s, POSTER_SIDE).await {
            Ok(bytes) => json!({ "success": true, "meta": meta, "image": jpeg(&bytes) }),
            Err(error) => refusal(&error),
        },
    )
}

async fn cancel(_app: AppHandle, args: Vec<Value>) -> Result<Value, IpcError> {
    let Some(hash) = hash_arg(request(&args)) else {
        return Ok(failed("E_BAD_ARGS", "A video hash is required."));
    };
    Ok(json!({ "success": true, "cancelled": jobs().cancel(&hash) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn only_a_lowercase_sha256_is_a_hash() {
        assert_eq!(hash_arg(&json!({ "hash": HASH })).as_deref(), Some(HASH));
        assert!(hash_arg(&json!({ "hash": HASH.to_uppercase() })).is_none());
        assert!(hash_arg(&json!({ "hash": "../../etc" })).is_none());
        assert!(hash_arg(&json!({})).is_none());
    }

    #[test]
    fn times_are_capped_and_clamped() {
        let many: Vec<f64> = (0..20).map(f64::from).collect();
        let times = times_arg(&json!({ "times": many }), 5.0);
        assert_eq!(times.len(), MAX_VIEW_FRAMES);
        assert_eq!(times[0], 0.0);
        assert!(times.iter().all(|time| *time <= 4.95));
        assert!(times_arg(&json!({ "times": [-3, "x"] }), 5.0) == vec![0.0]);
    }

    #[test]
    fn sides_stay_inside_the_frame_cap() {
        assert_eq!(side_arg(&json!({}), VIEW_MAX_SIDE), VIEW_MAX_SIDE);
        assert_eq!(
            side_arg(&json!({ "maxSide": 99_999 }), VIEW_MAX_SIDE),
            FRAME_MAX_SIDE
        );
        assert_eq!(side_arg(&json!({ "maxSide": 1 }), VIEW_MAX_SIDE), 64);
    }

    #[test]
    fn a_job_runs_once_and_can_be_retried_after_failing() {
        let jobs = Jobs::new();
        let token = jobs.begin(HASH).expect("starts");
        assert!(matches!(jobs.begin(HASH), Err(Status::Running { .. })));
        jobs.progress(HASH, 0.5);
        assert_eq!(
            jobs.get(HASH).map(|s| s.to_json(HASH)["progress"].clone()),
            Some(json!(0.5))
        );
        assert!(jobs.cancel(HASH));
        assert!(token.is_cancelled());
        jobs.finish(
            HASH,
            Status::Failed {
                code: "E_CANCELLED".into(),
                error: "cancelled".into(),
            },
        );
        assert!(!jobs.cancel(HASH));
        assert!(jobs.begin(HASH).is_ok());
        jobs.finish(HASH, Status::Ready);
        assert!(matches!(jobs.begin(HASH), Err(Status::Ready)));
    }

    #[test]
    fn status_json_names_each_state() {
        assert_eq!(Status::Ready.to_json(HASH)["status"], "ready");
        let pending = Status::Failed {
            code: "E_PENDING".into(),
            error: String::new(),
        };
        assert_eq!(status_json(&pending, HASH)["status"], "pending");
        let failed = Status::Failed {
            code: "E_FAILED".into(),
            error: "boom".into(),
        };
        assert_eq!(status_json(&failed, HASH)["code"], "E_FAILED");
    }
}
