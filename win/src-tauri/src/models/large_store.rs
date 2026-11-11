//! Downloads every file of a Hugging Face repository into one folder, as the Electron largeModelStore did.
//! Partial files resume, each finished file is checked against its LFS hash, and a marker keeps a
//! half-finished folder from passing as a model.

use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use draggy_diagnostics::{Diagnostics, ErrorInfo};
use draggy_models::download::{Body, Cancel, HttpClient, read_all};
use draggy_web::policy::UrlPolicy;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use super::drives::Drive;
use super::hub::now_ms;

pub const PARTIAL_MARKER: &str = ".draggy-partial";
const MIRRORS_FILE: &str = "large-model-mirrors.json";
const SPACE_MARGIN: f64 = 1.1;
pub const CONCURRENCY: usize = 4;
const MAX_REDIRECTS: usize = 5;
const MAX_PAGES: usize = 50;
const RETRIES: u32 = 1;
const STALL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoFile {
    pub path: String,
    pub size: u64,
    pub sha256: Option<String>,
}

/// Files of a `tree?recursive=true` answer. Folders, unsafe paths and malformed entries are dropped.
pub fn parse_manifest(entries: &Value) -> Vec<RepoFile> {
    let Some(list) = entries.as_array() else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|entry| {
            if entry.get("type")?.as_str()? != "file" {
                return None;
            }
            let path = entry.get("path")?.as_str()?;
            if path.split('/').any(|part| part == "..") {
                return None;
            }
            let lfs = entry.get("lfs");
            let size = lfs
                .and_then(|value| value.get("size"))
                .filter(|value| !value.is_null())
                .or_else(|| entry.get("size"));
            let oid = lfs
                .and_then(|value| value.get("oid"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let sha256 = is_sha256(oid).then(|| oid.to_ascii_lowercase());
            Some(RepoFile {
                path: path.to_owned(),
                size: size_of(size),
                sha256,
            })
        })
        .collect()
}

fn size_of(value: Option<&Value>) -> u64 {
    let number = match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => text.parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    };
    if number.is_finite() && number > 0.0 {
        number as u64
    } else {
        0
    }
}

fn is_sha256(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub fn total_bytes(files: &[RepoFile]) -> u64 {
    files.iter().map(|file| file.size).sum()
}

/// `owner/name` with word characters, dots and dashes, as the hub allows.
pub fn valid_repo_id(repo: &str) -> bool {
    let Some((owner, name)) = repo.split_once('/') else {
        return false;
    };
    let part_ok = |part: &str| {
        let mut chars = part.chars();
        matches!(chars.next(), Some(first) if first.is_ascii_alphanumeric() || first == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    };
    part_ok(owner) && part_ok(name)
}

/// The `next` target of a Link header, if it has one.
fn next_link(header: &str) -> Option<String> {
    header
        .split(',')
        .find(|part| part.contains("rel=\"next\""))
        .and_then(|part| {
            let start = part.find('<')?;
            let end = part[start..].find('>')? + start;
            Some(part[start + 1..end].to_owned())
        })
}

/// Every file of a repository, following the tree API's Link-header pages.
pub async fn fetch_manifest<C: HttpClient>(
    client: &C,
    repo: &str,
) -> Result<Vec<RepoFile>, String> {
    if !valid_repo_id(repo) {
        return Err("Invalid repository id".to_owned());
    }
    let mut url = Some(format!(
        "https://huggingface.co/api/models/{repo}/tree/main?recursive=true"
    ));
    let mut entries: Vec<Value> = Vec::new();
    for _ in 0..MAX_PAGES {
        let Some(current) = url.take() else {
            break;
        };
        let headers = [("User-Agent".to_owned(), "Draggy".to_owned())];
        let mut reply = client
            .get(&current, &headers, Some(STALL))
            .await
            .map_err(|error| error.to_string())?;
        if !(200..300).contains(&reply.status) {
            return Err(format!("Hugging Face returned HTTP {}", reply.status));
        }
        let link = reply.header("link").map(str::to_owned);
        let bytes = read_all(&mut reply.body)
            .await
            .map_err(|error| error.to_string())?;
        let page: Value = serde_json::from_slice(&bytes)
            .map_err(|_| "Hugging Face sent an unreadable list".to_owned())?;
        if let Some(items) = page.as_array() {
            entries.extend(items.iter().cloned());
        }
        url = link.as_deref().and_then(next_link);
    }
    Ok(parse_manifest(&Value::Array(entries)))
}

/// Where a download goes, or why it cannot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Found {
        volume: PathBuf,
        need_bytes: u64,
        resume: bool,
    },
    Refused {
        reason: &'static str,
        need_bytes: Option<u64>,
    },
}

impl Target {
    /// The planner's answer as the renderer reads it.
    pub fn to_json(&self) -> Value {
        match self {
            Self::Found {
                volume,
                need_bytes,
                resume,
            } => {
                let mut out = json!({ "ok": true, "volume": volume.to_string_lossy(), "needBytes": need_bytes });
                if *resume {
                    out["resume"] = json!(true);
                }
                out
            }
            Self::Refused { reason, need_bytes } => {
                let mut out = json!({ "ok": false, "reason": reason });
                if let Some(need) = need_bytes {
                    out["needBytes"] = json!(need);
                }
                out
            }
        }
    }
}

fn need_for(bytes: u64) -> u64 {
    (bytes as f64 * SPACE_MARGIN).round() as u64
}

/// The roomiest fixed drive that holds the files plus 10%. Removable drives are never used.
/// Unlike the Electron planner, no benchmark decides between drives yet.
pub fn choose_volume(files: &[RepoFile], drives: &[Drive]) -> Target {
    let need = need_for(total_bytes(files));
    let internal: Vec<&Drive> = drives.iter().filter(|drive| !drive.removable).collect();
    if internal.is_empty() {
        return Target::Refused {
            reason: "usb-drive",
            need_bytes: None,
        };
    }
    let mut fits: Vec<&Drive> = internal
        .into_iter()
        .filter(|drive| drive.free_bytes >= need)
        .collect();
    if fits.is_empty() {
        return Target::Refused {
            reason: "no-space",
            need_bytes: Some(need),
        };
    }
    fits.sort_by_key(|a| std::cmp::Reverse(a.free_bytes));
    Target::Found {
        volume: fits[0].volume.clone(),
        need_bytes: need,
        resume: false,
    }
}

/// A copy already started stays on its drive and needs room only for what is missing.
pub fn plan_target(repo: &str, files: &[RepoFile], drives: &[Drive]) -> Target {
    let usable: Vec<&Drive> = drives.iter().filter(|drive| !drive.removable).collect();
    if let Some((dir, _)) = locate(repo, usable.iter().map(|drive| drive.volume.as_path()))
        && let Some(drive) = usable
            .iter()
            .find(|drive| default_dir(&drive.volume, repo) == dir)
    {
        let have = on_disk_bytes(&dir, files);
        let need = need_for(total_bytes(files).saturating_sub(have));
        if drive.free_bytes >= need {
            return Target::Found {
                volume: drive.volume.clone(),
                need_bytes: need,
                resume: true,
            };
        }
    }
    choose_volume(files, drives)
}

/// Bytes of these files already in `dir`, whole or partial, never more than each file's size.
pub fn on_disk_bytes(dir: &Path, files: &[RepoFile]) -> u64 {
    let mut have = 0;
    for file in files {
        let target = join_repo_path(dir, &file.path);
        for candidate in [target.clone(), with_suffix(&target, ".partial")] {
            let Some(size) = file_len(&candidate) else {
                continue;
            };
            if file.size == 0 || size <= file.size {
                have += size;
                break;
            }
        }
    }
    have
}

/// The folder for a repository on a volume.
pub fn default_dir(volume: &Path, repo: &str) -> PathBuf {
    volume
        .join("Draggy")
        .join("models")
        .join(repo.replace('/', "--"))
}

/// The first volume holding a copy of `repo`, and whether that copy finished.
pub fn locate<'a>(repo: &str, volumes: impl Iterator<Item = &'a Path>) -> Option<(PathBuf, bool)> {
    for volume in volumes {
        let dir = default_dir(volume, repo);
        if dir.exists() {
            let complete = !dir.join(PARTIAL_MARKER).exists();
            return Some((dir, complete));
        }
    }
    None
}

/// The download address of one file. Segments are percent-encoded the way encodeURIComponent does.
pub fn hf_url(repo: &str, file: &RepoFile) -> String {
    let path = file
        .path
        .split('/')
        .map(encode_component)
        .collect::<Vec<_>>()
        .join("/");
    format!("https://huggingface.co/{repo}/resolve/main/{path}?download=true")
}

fn encode_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn join_repo_path(dir: &Path, relative: &str) -> PathBuf {
    relative
        .split('/')
        .fold(dir.to_path_buf(), |path, part| path.join(part))
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut text = path.as_os_str().to_owned();
    text.push(suffix);
    PathBuf::from(text)
}

fn file_len(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|meta| meta.len())
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Which mirror paths each model keeps, in a JSON file in the data folder.
pub struct Mirrors {
    dir: PathBuf,
    file: PathBuf,
}

impl Mirrors {
    pub fn new(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
            file: dir.join(MIRRORS_FILE),
        }
    }

    fn read(&self) -> Map<String, Value> {
        fs::read_to_string(&self.file)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|value| match value {
                Value::Object(map) => Some(map),
                _ => None,
            })
            .unwrap_or_default()
    }

    pub fn get(&self, model_id: &str) -> Value {
        match self.read().remove(model_id) {
            Some(list @ Value::Array(_)) => list,
            _ => json!([]),
        }
    }

    /// Keeps each path once, drops empty ones, and removes the model when nothing is left.
    pub fn set(&self, model_id: &str, paths: &[Value]) -> Result<Value, String> {
        let mut all = self.read();
        let mut clean: Vec<String> = Vec::new();
        for path in paths.iter().filter_map(Value::as_str) {
            if !path.is_empty() && !clean.iter().any(|kept| kept == path) {
                clean.push(path.to_owned());
            }
        }
        if clean.is_empty() {
            all.remove(model_id);
        } else {
            all.insert(model_id.to_owned(), json!(clean));
        }
        fs::create_dir_all(&self.dir).map_err(|error| error.to_string())?;
        let text =
            serde_json::to_string_pretty(&Value::Object(all)).map_err(|error| error.to_string())?;
        fs::write(&self.file, text).map_err(|error| error.to_string())?;
        Ok(json!(clean))
    }
}

/// A bytes-per-second ceiling shared by every stream.
pub struct Throttle {
    bytes_per_sec: f64,
    window: Mutex<(f64, f64)>,
}

impl Throttle {
    /// None for 0, which means unlimited.
    pub fn new(bytes_per_sec: u64, now_ms: f64) -> Option<Self> {
        (bytes_per_sec > 0).then(|| Self {
            bytes_per_sec: bytes_per_sec as f64,
            window: Mutex::new((now_ms, 0.0)),
        })
    }

    /// Milliseconds to pause after `bytes` at `now_ms`. The window restarts every five seconds.
    pub fn pause_for(&self, bytes: u64, now_ms: f64) -> f64 {
        let mut window = self.window.lock().unwrap_or_else(PoisonError::into_inner);
        let (start, used) = *window;
        let used = used + bytes as f64;
        let elapsed = now_ms - start;
        let allowed = self.bytes_per_sec * elapsed / 1000.0;
        let wait = if used > allowed {
            (used - allowed) / self.bytes_per_sec * 1000.0
        } else {
            0.0
        };
        *window = if elapsed > 5000.0 {
            (now_ms, 0.0)
        } else {
            (start, used)
        };
        wait
    }

    pub async fn take(&self, bytes: u64) {
        let wait = self.pause_for(bytes, now_ms() as f64);
        if wait > 0.0 {
            tokio::time::sleep(Duration::from_secs_f64(wait / 1000.0)).await;
        }
    }
}

pub type ProgressSink = Arc<dyn Fn(Value) + Send + Sync>;

/// Everything one repository download needs.
pub struct Request {
    pub repo: String,
    pub files: Vec<RepoFile>,
    pub dest: PathBuf,
    pub bandwidth_bps: u64,
    pub cancel: Arc<Cancel>,
    pub diag: Option<Arc<Diagnostics>>,
    pub progress: ProgressSink,
}

#[derive(Default)]
struct Counters {
    done: i64,
    moved: i64,
    last_decile: Option<i64>,
}

struct Job<C> {
    client: Arc<C>,
    repo: String,
    total: i64,
    started_ms: f64,
    cancel: Arc<Cancel>,
    diag: Option<Arc<Diagnostics>>,
    progress: ProgressSink,
    throttle: Option<Throttle>,
    queue: Mutex<VecDeque<(RepoFile, PathBuf)>>,
    counters: Mutex<Counters>,
}

impl<C> Job<C> {
    fn log(&self, write: impl FnOnce(&Diagnostics)) {
        if let Some(diag) = &self.diag {
            write(diag);
        }
    }

    /// Adds bytes to what is on disk and to what this run moved, then reports progress.
    fn add_bytes(&self, bytes: i64, file: &str) {
        {
            let mut counters = self.counters.lock().unwrap_or_else(PoisonError::into_inner);
            counters.done += bytes;
            counters.moved += bytes;
        }
        self.report(Some(file));
    }

    fn report(&self, file: Option<&str>) {
        let elapsed = ((now_ms() as f64 - self.started_ms) / 1000.0).max(0.001);
        let (done, moved, decile_log) = {
            let mut counters = self.counters.lock().unwrap_or_else(PoisonError::into_inner);
            let decile = if self.total > 0 {
                ((counters.done as f64 / self.total as f64) * 10.0).floor() as i64
            } else {
                -1
            };
            let log = counters.last_decile.is_none_or(|last| decile > last);
            if log {
                counters.last_decile = Some(decile);
            }
            (counters.done, counters.moved, log.then_some(decile))
        };
        let rate = moved.max(0) as f64 / elapsed;
        if let Some(decile) = decile_log {
            self.log(|diag| {
                diag.debug(
                    "engine.models",
                    "repo download progress",
                    Some(json!({ "percent": decile * 10, "doneBytes": done, "totalBytes": self.total, "bytesPerSecond": rate.round() as i64 })),
                );
            });
        }
        let eta = (rate > 0.0).then(|| ((self.total - done) as f64 / rate).round() as i64);
        (self.progress)(json!({
            "repo": self.repo,
            "doneBytes": done,
            "totalBytes": self.total,
            "bytesPerSecond": rate.round() as i64,
            "etaSeconds": eta,
            "file": file,
        }));
    }

    fn done(&self) -> i64 {
        self.counters
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .done
    }
}

/// GET with a Range when resuming. Each redirect hop is checked against the URL policy.
async fn fetch_range<C: HttpClient>(
    client: &C,
    url: &str,
    start: u64,
) -> Result<(u16, C::Body), String> {
    let mut current = url.to_owned();
    for hop in 0..=MAX_REDIRECTS {
        if !current.starts_with("https://") || !UrlPolicy::new().is_fetchable_url(&current, false) {
            return Err("URL refused by outbound security policy".to_owned());
        }
        let mut headers = vec![("User-Agent".to_owned(), "Draggy".to_owned())];
        if start > 0 {
            headers.push(("Range".to_owned(), format!("bytes={start}-")));
        }
        let reply = client
            .get(&current, &headers, Some(STALL))
            .await
            .map_err(|error| error.to_string())?;
        if (300..400).contains(&reply.status)
            && let Some(location) = reply.header("location")
        {
            if hop == MAX_REDIRECTS {
                return Err("Too many redirects".to_owned());
            }
            current = resolve_location(&current, location)
                .ok_or_else(|| "Unsupported redirect".to_owned())?;
            continue;
        }
        if reply.status != 200 && reply.status != 206 {
            return Err(format!("Server returned HTTP {}", reply.status));
        }
        return Ok((reply.status, reply.body));
    }
    Err("Too many redirects".to_owned())
}

fn resolve_location(current: &str, location: &str) -> Option<String> {
    if location.starts_with("https://") {
        return Some(location.to_owned());
    }
    if location.starts_with('/') {
        let origin_len = current["https://".len()..]
            .find('/')
            .map_or(current.len(), |index| index + "https://".len());
        return Some(format!("{}{location}", &current[..origin_len]));
    }
    None
}

async fn write_body<C: HttpClient>(
    job: &Job<C>,
    body: &mut C::Body,
    partial: &Path,
    have: u64,
    file: &str,
) -> Result<(), String> {
    let mut out = OpenOptions::new()
        .create(true)
        .write(true)
        .append(have > 0)
        .truncate(have == 0)
        .open(partial)
        .map_err(|error| error.to_string())?;
    loop {
        if job.cancel.is_cancelled() {
            return Err("cancelled".to_owned());
        }
        let Some(chunk) = body.next_chunk().await.map_err(|error| error.to_string())? else {
            break;
        };
        out.write_all(&chunk).map_err(|error| error.to_string())?;
        job.add_bytes(chunk.len() as i64, file);
        if let Some(throttle) = &job.throttle {
            throttle.take(chunk.len() as u64).await;
        }
    }
    out.flush().map_err(|error| error.to_string())
}

/// Downloads one file to `<target>.partial`, resuming, checks its hash, then renames it into place.
/// A hash mismatch discards only this file, which is fetched once more.
async fn download_file<C: HttpClient>(
    job: &Job<C>,
    file: &RepoFile,
    target: &Path,
) -> Result<(), String> {
    let partial = with_suffix(target, ".partial");
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let url = hf_url(&job.repo, file);
    let mut attempt: u32 = 0;
    loop {
        let mut have = file_len(&partial).unwrap_or(0);
        if file.size > 0 && have > file.size {
            let _ = fs::remove_file(&partial);
            have = 0;
        }
        if file.size == 0 || have < file.size {
            let (status, mut body) = fetch_range(job.client.as_ref(), &url, have).await?;
            if have > 0 && status == 200 {
                job.log(|diag| {
                    diag.warn(
                        "engine.models",
                        "range ignored, file restarted",
                        Some(json!({ "from": have })),
                    )
                });
                let _ = fs::remove_file(&partial);
                job.add_bytes(-(have as i64), &file.path);
                have = 0;
            } else if have > 0 {
                job.log(|diag| {
                    diag.info(
                        "engine.models",
                        "file resumed",
                        Some(json!({ "from": have, "bytes": file.size })),
                    )
                });
            }
            write_body(job, &mut body, &partial, have, &file.path).await?;
        }
        let on_disk =
            file_len(&partial).ok_or_else(|| format!("{}: incomplete download", file.path))?;
        if file.size > 0 && on_disk != file.size {
            return Err(format!("{}: incomplete download", file.path));
        }
        if let Some(expected) = &file.sha256 {
            let actual = sha256_file(&partial).map_err(|error| error.to_string())?;
            if &actual != expected {
                job.log(|diag| {
                    diag.warn(
                        "engine.models",
                        "checksum mismatch",
                        Some(json!({ "attempt": attempt + 1, "bytes": file.size })),
                    )
                });
                let _ = fs::remove_file(&partial);
                job.add_bytes(-(file.size as i64), &file.path);
                if attempt >= RETRIES {
                    return Err(format!("Checksum mismatch for {}", file.path));
                }
                attempt += 1;
                continue;
            }
            job.log(|diag| {
                diag.info(
                    "engine.models",
                    "checksum matched",
                    Some(json!({ "bytes": file.size })),
                )
            });
        }
        fs::rename(&partial, target).map_err(|error| error.to_string())?;
        return Ok(());
    }
}

async fn worker<C: HttpClient + 'static>(job: Arc<Job<C>>) -> Result<(), String> {
    loop {
        if job.cancel.is_cancelled() {
            return Ok(());
        }
        let next = job
            .queue
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pop_front();
        let Some((file, target)) = next else {
            return Ok(());
        };
        // A partial longer than its file is discarded by download_file, so none of it counts.
        let partial = file_len(&with_suffix(&target, ".partial")).unwrap_or(0);
        let base = if file.size > 0 && partial > file.size {
            0
        } else {
            partial
        };
        job.counters
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .done += base as i64;
        download_file(&job, &file, &target).await?;
    }
}

/// Downloads every file not already complete. The marker stays until the last file is in place.
pub async fn download_repo<C: HttpClient + 'static>(client: Arc<C>, request: Request) -> Value {
    let Request {
        repo,
        files,
        dest,
        bandwidth_bps,
        cancel,
        diag,
        progress,
    } = request;
    let fail_early = |error: String| json!({ "ok": false, "error": error, "doneBytes": 0 });
    if let Err(error) = fs::create_dir_all(&dest) {
        return fail_early(error.to_string());
    }
    let marker = dest.join(PARTIAL_MARKER);
    let marker_text = json!({ "repo": repo, "startedAt": now_ms() }).to_string();
    if let Err(error) = fs::write(&marker, marker_text) {
        return fail_early(error.to_string());
    }

    let total = total_bytes(&files) as i64;
    let mut done: i64 = 0;
    let mut queue = VecDeque::new();
    for file in &files {
        let target = join_repo_path(&dest, &file.path);
        if file.size > 0 && file_len(&target) == Some(file.size) {
            done += file.size as i64;
            continue;
        }
        queue.push_back((file.clone(), target));
    }
    let queued = queue.len();
    let started_ms = now_ms() as f64;
    let job = Arc::new(Job {
        client,
        repo,
        total,
        started_ms,
        cancel: cancel.clone(),
        diag,
        progress,
        throttle: Throttle::new(bandwidth_bps, started_ms),
        queue: Mutex::new(queue),
        counters: Mutex::new(Counters {
            done,
            ..Counters::default()
        }),
    });
    job.log(|diag| {
        diag.info(
            "engine.models",
            "repo download started",
            Some(json!({ "files": files.len(), "queued": queued, "totalBytes": total, "resumedBytes": done })),
        );
    });
    job.report(None);

    let handles: Vec<_> = (0..CONCURRENCY.min(queued.max(1)))
        .map(|_| tokio::spawn(worker(job.clone())))
        .collect();
    let mut failure: Option<String> = None;
    for handle in handles {
        let outcome = match handle.await {
            Ok(result) => result,
            Err(join) => Err(join.to_string()),
        };
        if let Err(reason) = outcome {
            failure.get_or_insert(reason);
        }
    }

    let done = job.done();
    let duration_ms = (now_ms() as f64 - started_ms) as i64;
    if cancel.is_cancelled() {
        job.log(|diag| {
            diag.info(
                "engine.models",
                "repo download cancelled",
                Some(json!({ "doneBytes": done, "durMs": duration_ms })),
            );
        });
        return json!({ "ok": false, "error": "cancelled", "doneBytes": done });
    }
    if let Some(reason) = failure {
        job.log(|diag| {
            diag.fail(
                "engine.models",
                "repo download failed",
                &ErrorInfo::new("Error", reason.clone()),
                Some(json!({ "doneBytes": done, "durMs": duration_ms })),
            );
        });
        return json!({ "ok": false, "error": reason, "doneBytes": done });
    }
    let _ = fs::remove_file(&marker);
    let moved = job
        .counters
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .moved;
    job.log(|diag| {
        diag.info(
            "engine.models",
            "repo download finished",
            Some(json!({ "doneBytes": done, "movedBytes": moved, "durMs": duration_ms })),
        );
    });
    json!({ "ok": true, "doneBytes": done, "destDir": dest.to_string_lossy() })
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, HashMap, VecDeque};
    use std::sync::Mutex;

    use draggy_models::download::{Reply, TransportError};

    use super::*;

    struct Chunks(VecDeque<Vec<u8>>);

    impl Body for Chunks {
        async fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
            Ok(self.0.pop_front())
        }
    }

    /// Serves fixed bodies by URL. `link` is sent as the Link header of that page.
    #[derive(Default)]
    struct Fake {
        routes: HashMap<String, (Vec<u8>, Option<String>)>,
        ignore_range: bool,
        ranges: Mutex<Vec<String>>,
    }

    impl HttpClient for Fake {
        type Body = Chunks;

        async fn get(
            &self,
            url: &str,
            headers: &[(String, String)],
            _stall: Option<Duration>,
        ) -> Result<Reply<Chunks>, TransportError> {
            let Some((bytes, link)) = self.routes.get(url) else {
                return Ok(Reply {
                    status: 404,
                    headers: BTreeMap::new(),
                    body: Chunks(VecDeque::new()),
                });
            };
            let start = headers
                .iter()
                .find(|(name, _)| name == "Range")
                .and_then(|(_, value)| value.strip_prefix("bytes="))
                .and_then(|value| value.strip_suffix('-'))
                .and_then(|value| value.parse::<usize>().ok());
            if let Some(start) = start {
                self.ranges.lock().unwrap().push(format!("{start}"));
            }
            let (status, body) = match start {
                Some(start) if !self.ignore_range => {
                    (206, bytes[start.min(bytes.len())..].to_vec())
                }
                _ => (200, bytes.clone()),
            };
            let mut reply_headers = BTreeMap::new();
            if let Some(link) = link {
                reply_headers.insert("link".to_owned(), link.clone());
            }
            Ok(Reply {
                status,
                headers: reply_headers,
                body: Chunks(VecDeque::from([body])),
            })
        }
    }

    fn file(path: &str, size: u64) -> RepoFile {
        RepoFile {
            path: path.to_owned(),
            size,
            sha256: None,
        }
    }

    fn drive(volume: &Path, free: u64, removable: bool) -> Drive {
        Drive {
            volume: volume.to_path_buf(),
            free_bytes: free,
            removable,
        }
    }

    fn sha(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn sink() -> (ProgressSink, Arc<Mutex<Vec<Value>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let writer = seen.clone();
        (
            Arc::new(move |value| writer.lock().unwrap().push(value)),
            seen,
        )
    }

    fn request(dest: PathBuf, files: Vec<RepoFile>, progress: ProgressSink) -> Request {
        Request {
            repo: "acme/tiny".to_owned(),
            files,
            dest,
            bandwidth_bps: 0,
            cancel: Arc::new(Cancel::new()),
            diag: None,
            progress,
        }
    }

    #[test]
    fn manifest_reads_files_sizes_and_lfs_hashes_and_drops_folders_and_unsafe_paths() {
        let hash = "a".repeat(64);
        let entries = json!([
            { "type": "directory", "path": "experts" },
            { "type": "file", "path": "config.json", "size": 120 },
            { "type": "file", "path": "experts/0.bin", "size": 134, "lfs": { "oid": hash, "size": 9000 } },
            { "type": "file", "path": "../escape", "size": 1 },
        ]);
        let files = parse_manifest(&entries);
        assert_eq!(
            files,
            vec![
                file("config.json", 120),
                RepoFile {
                    path: "experts/0.bin".into(),
                    size: 9000,
                    sha256: Some(hash)
                },
            ]
        );
        assert_eq!(total_bytes(&files), 9120);
        assert!(parse_manifest(&Value::Null).is_empty());
    }

    #[tokio::test]
    async fn fetch_manifest_follows_next_links_and_refuses_a_bad_repo_id() {
        let mut fake = Fake::default();
        let first = "https://huggingface.co/api/models/acme/tiny/tree/main?recursive=true";
        let second = "https://huggingface.co/page-2";
        fake.routes.insert(
            first.to_owned(),
            (
                json!([{ "type": "file", "path": "a.bin", "size": 1 }])
                    .to_string()
                    .into_bytes(),
                Some(format!("<{second}>; rel=\"next\"")),
            ),
        );
        fake.routes.insert(
            second.to_owned(),
            (
                json!([{ "type": "file", "path": "b.bin", "size": 2 }])
                    .to_string()
                    .into_bytes(),
                None,
            ),
        );
        let files = fetch_manifest(&fake, "acme/tiny").await.unwrap();
        assert_eq!(files, vec![file("a.bin", 1), file("b.bin", 2)]);
        assert!(fetch_manifest(&fake, "not a repo").await.is_err());
    }

    #[test]
    fn choosing_a_drive_refuses_usb_and_no_room_and_takes_the_one_with_room() {
        let files = vec![file("m.bin", 1000)];
        let roomy = Path::new("D:\\");
        let small = Path::new("E:\\");
        let usb = Path::new("F:\\");
        let drives = [
            drive(small, 500, false),
            drive(roomy, 5000, false),
            drive(usb, 9999, true),
        ];
        assert_eq!(
            choose_volume(&files, &drives),
            Target::Found {
                volume: roomy.into(),
                need_bytes: 1100,
                resume: false
            }
        );
        assert_eq!(
            choose_volume(&files, &[drive(usb, 9999, true)]),
            Target::Refused {
                reason: "usb-drive",
                need_bytes: None
            }
        );
        assert_eq!(
            choose_volume(&files, &[drive(small, 500, false)]),
            Target::Refused {
                reason: "no-space",
                need_bytes: Some(1100)
            }
        );
    }

    #[test]
    fn a_started_copy_stays_on_its_drive_and_asks_room_for_only_the_rest() {
        let volume = tempfile::tempdir().unwrap();
        let files = vec![file("m.bin", 100)];
        let dir = default_dir(volume.path(), "acme/tiny");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(PARTIAL_MARKER), "{}").unwrap();
        fs::write(dir.join("m.bin.partial"), vec![0u8; 40]).unwrap();
        let drives = [drive(volume.path(), 100, false)];
        assert_eq!(
            plan_target("acme/tiny", &files, &drives),
            Target::Found {
                volume: volume.path().into(),
                need_bytes: 66,
                resume: true
            }
        );
        let fresh = tempfile::tempdir().unwrap();
        assert_eq!(
            plan_target("acme/tiny", &files, &[drive(fresh.path(), 1000, false)]),
            Target::Found {
                volume: fresh.path().into(),
                need_bytes: 110,
                resume: false
            }
        );
        assert_eq!(
            locate("acme/tiny", [volume.path()].into_iter()),
            Some((dir.clone(), false))
        );
        fs::remove_file(dir.join(PARTIAL_MARKER)).unwrap();
        assert_eq!(
            locate("acme/tiny", [volume.path()].into_iter()),
            Some((dir, true))
        );
    }

    #[tokio::test]
    async fn downloads_every_file_and_clears_the_marker_only_when_all_are_in_place() {
        let dest = tempfile::tempdir().unwrap();
        let mut fake = Fake::default();
        let files = vec![file("a.bin", 5), file("sub/b.bin", 3)];
        fake.routes
            .insert(hf_url("acme/tiny", &files[0]), (b"hello".to_vec(), None));
        fake.routes
            .insert(hf_url("acme/tiny", &files[1]), (b"abc".to_vec(), None));
        let (progress, seen) = sink();
        let out = download_repo(
            Arc::new(fake),
            request(dest.path().join("m"), files, progress),
        )
        .await;
        assert_eq!(out["ok"], json!(true));
        assert_eq!(out["doneBytes"], json!(8));
        assert_eq!(fs::read(dest.path().join("m/sub/b.bin")).unwrap(), b"abc");
        assert!(!dest.path().join("m").join(PARTIAL_MARKER).exists());
        assert!(!seen.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn resumes_a_partial_file_and_starts_over_when_the_server_ignores_the_range() {
        let dest = tempfile::tempdir().unwrap();
        let files = vec![file("a.bin", 5)];
        let target_dir = dest.path().join("m");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("a.bin.partial"), b"he").unwrap();
        let mut fake = Fake::default();
        fake.routes
            .insert(hf_url("acme/tiny", &files[0]), (b"hello".to_vec(), None));
        let (progress, _) = sink();
        let fake = Arc::new(fake);
        let out = download_repo(
            fake.clone(),
            request(target_dir.clone(), files.clone(), progress),
        )
        .await;
        assert_eq!(out["ok"], json!(true));
        assert_eq!(fs::read(target_dir.join("a.bin")).unwrap(), b"hello");
        assert_eq!(fake.ranges.lock().unwrap().as_slice(), ["2"]);

        fs::write(target_dir.join("a.bin.partial"), b"he").unwrap();
        fs::remove_file(target_dir.join("a.bin")).unwrap();
        let mut ignoring = Fake {
            ignore_range: true,
            ..Fake::default()
        };
        ignoring
            .routes
            .insert(hf_url("acme/tiny", &files[0]), (b"hello".to_vec(), None));
        let (progress, _) = sink();
        let out = download_repo(
            Arc::new(ignoring),
            request(target_dir.clone(), files, progress),
        )
        .await;
        assert_eq!(out["ok"], json!(true));
        assert_eq!(fs::read(target_dir.join("a.bin")).unwrap(), b"hello");
    }

    #[tokio::test]
    async fn a_file_that_keeps_failing_its_hash_fails_and_leaves_the_marker() {
        let dest = tempfile::tempdir().unwrap();
        let mut bad = file("a.bin", 5);
        bad.sha256 = Some(sha(b"other"));
        let mut fake = Fake::default();
        fake.routes
            .insert(hf_url("acme/tiny", &bad), (b"hello".to_vec(), None));
        let target_dir = dest.path().join("m");
        let (progress, _) = sink();
        let out = download_repo(
            Arc::new(fake),
            request(target_dir.clone(), vec![bad], progress),
        )
        .await;
        assert_eq!(out["ok"], json!(false));
        assert_eq!(out["error"], json!("Checksum mismatch for a.bin"));
        assert!(target_dir.join(PARTIAL_MARKER).exists());
        assert!(!target_dir.join("a.bin").exists());
    }

    #[tokio::test]
    async fn a_missing_file_fails_the_download() {
        let dest = tempfile::tempdir().unwrap();
        let (progress, _) = sink();
        let out = download_repo(
            Arc::new(Fake::default()),
            request(dest.path().join("m"), vec![file("a.bin", 5)], progress),
        )
        .await;
        assert_eq!(out["ok"], json!(false));
    }

    #[test]
    fn waits_once_a_stream_goes_over_the_cap() {
        let throttle = Throttle::new(1000, 0.0).unwrap();
        assert_eq!(throttle.pause_for(500, 1000.0), 0.0);
        assert_eq!(throttle.pause_for(1500, 1000.0), 1000.0);
        assert!(Throttle::new(0, 0.0).is_none());
    }

    #[test]
    fn keeps_mirror_paths_per_model_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let paths = [json!("E:\\m"), json!("E:\\m"), json!("F:\\m")];
        Mirrors::new(dir.path()).set("glm-5.2", &paths).unwrap();
        assert_eq!(
            Mirrors::new(dir.path()).get("glm-5.2"),
            json!(["E:\\m", "F:\\m"])
        );
        Mirrors::new(dir.path()).set("glm-5.2", &[]).unwrap();
        assert_eq!(Mirrors::new(dir.path()).get("glm-5.2"), json!([]));
    }

    #[test]
    fn builds_hugging_face_file_addresses() {
        assert_eq!(
            hf_url("o/m", &file("experts/a b.bin", 0)),
            "https://huggingface.co/o/m/resolve/main/experts/a%20b.bin?download=true"
        );
    }
}
