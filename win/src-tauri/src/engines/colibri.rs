//! The colibri engine on Windows: release install, rollback, the embeddable Python it runs on, and the gateway process.
//! Port of electron/colibriBinary.cjs and the start/stop/health half of electron/colibriProcess.cjs.

use std::collections::VecDeque;
use std::fs;
use std::io;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::PoisonError;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::locked;
use crate::engines::tier_planner::is_slow_plan;
use crate::engines::tier_stats;
use draggy_engine::binary_manager::{BinaryError, Downloader, Extractor};
use draggy_engine::colibri_runtime::{
    GatewayEvent, build_launch, parse_gateway_line, parse_sums, spawn_plan,
};
use draggy_tools::spawn::{hidden_command, kill_tree};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Child;

pub const RELEASES_URL: &str = "https://api.github.com/repos/JustVugg/colibri/releases?per_page=5";
const ENGINE_LABEL: &str = "colibri";
const PREVIOUS_KEPT: usize = 1;
const PY_VERSION: &str = "3.12.10";
const PY_URL: &str = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip";
const PY_SHA256: &str = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3";
const PY_PTH: &str = "python312._pth";
const PY_SIZE_HINT: u64 = 11_100_000;

/// Hosts a colibri download may come from. Only https, and only these names.
pub fn allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    host == "github.com"
        || host == "api.github.com"
        || host == "www.python.org"
        || host == "githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
}

/// The `current`, `previous` and `variant` fields of `colibri/state.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub current: Option<String>,
    pub previous: Option<String>,
    pub variant: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Asset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

/// The assets one install needs: the main archive, the CUDA drop-in when usable, and the checksum list.
pub struct Picked<'a> {
    pub main: Option<&'a Asset>,
    pub cuda: Option<&'a Asset>,
    pub sums: Option<&'a Asset>,
    pub variant: &'static str,
}

pub fn pick_assets(assets: &[Asset], windows_x64: bool, cuda_capable: bool) -> Picked<'_> {
    let find = |suffix: &str| assets.iter().find(|a| a.name.ends_with(suffix));
    let sums = assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"));
    let (main, cuda) = if windows_x64 {
        let cuda = if cuda_capable {
            find("windows-x86_64-cuda.zip")
        } else {
            None
        };
        (find("windows-x86_64.zip"), cuda)
    } else {
        (None, None)
    };
    Picked {
        main,
        cuda,
        sums,
        variant: if cuda.is_some() { "cuda" } else { "vulkan" },
    }
}

/// `nvidia-smi --query-gpu=compute_cap` output: one number per GPU. The CUDA build needs 8.0 or newer.
pub fn parse_compute_capability(text: &str) -> f64 {
    text.lines()
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite())
        .fold(0.0_f64, f64::max)
}

pub async fn cuda_capable() -> bool {
    let args = ["--query-gpu=compute_cap", "--format=csv,noheader"];
    match draggy_tools::spawn::hidden_command("nvidia-smi", &args, |_| {})
        .output()
        .await
    {
        Ok(out) if out.status.success() => {
            parse_compute_capability(&String::from_utf8_lossy(&out.stdout)) >= 8.0
        }
        _ => false,
    }
}

fn root(user_data: &Path) -> PathBuf {
    user_data.join("colibri")
}

fn version_dir(user_data: &Path, tag: &str) -> PathBuf {
    root(user_data).join(tag)
}

fn python_dir(user_data: &Path) -> PathBuf {
    root(user_data).join("python").join(PY_VERSION)
}

pub fn read_state(user_data: &Path) -> State {
    fs::read_to_string(root(user_data).join("state.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_state(user_data: &Path, state: &State) -> io::Result<()> {
    fs::create_dir_all(root(user_data))?;
    let text = serde_json::to_string_pretty(state).map_err(io::Error::other)?;
    fs::write(root(user_data).join("state.json"), text)
}

fn is_installed(user_data: &Path, tag: &str) -> bool {
    version_dir(user_data, tag)
        .join("openai_server.py")
        .exists()
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(text)?;
    Ok(Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Downloads `url` to `dest` and refuses it unless its SHA-256 equals `expected`.
pub(crate) async fn download_verified<D: Downloader>(
    net: &D,
    url: &str,
    dest: &Path,
    expected: &str,
    on_bytes: &(dyn Fn(u64) + Sync),
) -> Result<(), String> {
    if !allowed_url(url) {
        return Err("URL refused by outbound security policy".into());
    }
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("No checksum to verify against".into());
    }
    net.download(url, dest, on_bytes).await.map_err(text)?;
    let actual = sha256_hex(dest)?;
    if actual != expected.to_ascii_lowercase() {
        let _ = fs::remove_file(dest);
        let name = dest.file_name().map(|n| n.to_string_lossy().into_owned());
        return Err(format!(
            "Checksum mismatch for {}",
            name.unwrap_or_default()
        ));
    }
    Ok(())
}

/// Throttled progress: at most one event per 100 ms, and always the last one.
pub(crate) fn reporter(total: u64, progress: &(dyn Fn(Value) + Sync)) -> impl Fn(u64) + Sync + '_ {
    let state = Mutex::new((0_u64, None::<Instant>));
    move |bytes| {
        let mut guard = state.lock().unwrap_or_else(PoisonError::into_inner);
        guard.0 += bytes;
        let now = Instant::now();
        let due = guard
            .1
            .is_none_or(|last| now.duration_since(last) >= Duration::from_millis(100))
            || guard.0 >= total;
        if !due {
            return;
        }
        guard.1 = Some(now);
        let completed = guard.0;
        drop(guard);
        let percent = if total > 0 {
            (completed as f64 / total as f64 * 1000.0).round() / 10.0
        } else {
            0.0
        };
        progress(json!({
            "percent": percent,
            "completed": completed,
            "total": total,
            "phase": "downloading",
            "label": ENGINE_LABEL,
        }));
    }
}

/// The one folder inside an archive, when it holds only one; otherwise the archive's own folder.
fn unwrap_dir(dir: &Path) -> Result<PathBuf, String> {
    let entries: Vec<_> = fs::read_dir(dir)
        .map_err(text)?
        .filter_map(Result::ok)
        .collect();
    if entries.len() == 1 && entries[0].file_type().map_err(text)?.is_dir() {
        Ok(entries[0].path())
    } else {
        Ok(dir.to_path_buf())
    }
}

/// Copies a tree, replacing files that exist already.
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// A virus scanner can hold a fresh folder for a moment; the rename works once it lets go.
async fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut attempt = 1_u64;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error)
                if attempt < 6
                    && (error.kind() == io::ErrorKind::PermissionDenied
                        || error.raw_os_error() == Some(16)) =>
            {
                tokio::time::sleep(Duration::from_millis(150 * attempt)).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

#[derive(Debug)]
pub struct Installed {
    pub tag: String,
    pub variant: &'static str,
}

/// Installs a colibri release: download, verify against SHA256SUMS, stage, then swap into place. The old version
/// stays as `previous` for rollback; anything older goes. A failure leaves what ran before.
pub async fn install<D: Downloader, X: Extractor>(
    user_data: &Path,
    net: &D,
    extractor: &X,
    wanted: Option<Release>,
    cuda: bool,
    progress: &(dyn Fn(Value) + Sync),
) -> Result<Installed, String> {
    let release = match wanted {
        Some(release) => release,
        None => {
            let body = fetch_text(net, RELEASES_URL, Some("application/vnd.github+json")).await?;
            let list: Vec<Release> = serde_json::from_str(&body).map_err(text)?;
            list.into_iter()
                .find(|r| {
                    !r.draft && !r.prerelease && pick_assets(&r.assets, true, cuda).main.is_some()
                })
                .ok_or("No colibri release matches this platform")?
        }
    };
    let picked = pick_assets(&release.assets, true, cuda);
    let main = picked
        .main
        .ok_or("No colibri release matches this platform")?;
    let sums_asset = picked
        .sums
        .ok_or("The colibri release has no SHA256SUMS.txt")?;
    let tag = release.tag_name.clone();
    if tag.is_empty()
        || !tag
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.+-".contains(&b))
    {
        return Err("Unexpected colibri release tag".into());
    }

    let sums = parse_sums(&fetch_text(net, &sums_asset.browser_download_url, None).await?);
    let assets: Vec<&Asset> = [Some(main), picked.cuda].into_iter().flatten().collect();
    for asset in &assets {
        if !sums.contains_key(&asset.name) {
            return Err(format!("SHA256SUMS.txt has no entry for {}", asset.name));
        }
    }

    let stage = root(user_data).join(format!(".stage-{tag}"));
    let result = async {
        let _ = fs::remove_dir_all(&stage);
        let out = stage.join("engine");
        fs::create_dir_all(&out).map_err(text)?;
        let total: u64 = assets.iter().map(|a| a.size).sum();
        let bytes = reporter(total, progress);
        for (index, asset) in assets.iter().enumerate() {
            let archive = stage.join(&asset.name);
            download_verified(
                net,
                &asset.browser_download_url,
                &archive,
                &sums[&asset.name],
                &bytes,
            )
            .await?;
            let unpacked = stage.join(format!("x{index}"));
            extractor.extract(&archive, &unpacked).await.map_err(text)?;
            copy_tree(&unwrap_dir(&unpacked)?, &out).map_err(text)?;
        }
        if !out.join("openai_server.py").exists() {
            return Err("The colibri archive has no openai_server.py".to_string());
        }
        let stamp = json!({ "tag": tag, "variant": picked.variant, "installedAt": now_ms() });
        fs::write(out.join("draggy-install.json"), stamp.to_string()).map_err(text)?;
        progress(json!({ "percent": 100, "phase": "installing", "label": ENGINE_LABEL }));

        let target = version_dir(user_data, &tag);
        let _ = fs::remove_dir_all(&target);
        rename_with_retry(&out, &target).await.map_err(text)?;
        Ok::<(), String>(())
    }
    .await;
    let _ = fs::remove_dir_all(&stage);
    result?;

    let before = read_state(user_data);
    let previous = match before.current {
        Some(current) if current != tag => Some(current),
        _ => before.previous,
    };
    write_state(
        user_data,
        &State {
            current: Some(tag.clone()),
            previous: previous.filter(|p| *p != tag),
            variant: Some(picked.variant.to_string()),
        },
    )
    .map_err(text)?;
    prune(user_data);
    Ok(Installed {
        tag,
        variant: picked.variant,
    })
}

async fn fetch_text<D: Downloader>(
    net: &D,
    url: &str,
    accept: Option<&str>,
) -> Result<String, String> {
    if !allowed_url(url) {
        return Err("URL refused by outbound security policy".into());
    }
    net.get_text(url, accept)
        .await
        .map_err(|e: BinaryError| e.to_string())
}

/// Removes every version folder except the current one and the rollback target.
pub fn prune(user_data: &Path) {
    let state = read_state(user_data);
    let keep: Vec<String> = [state.current, state.previous]
        .into_iter()
        .flatten()
        .take(1 + PREVIOUS_KEPT)
        .collect();
    let Ok(entries) = fs::read_dir(root(user_data)) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir || name == "python" || name.starts_with(".stage-") || keep.contains(&name) {
            continue;
        }
        let _ = fs::remove_dir_all(entry.path());
    }
}

/// Goes back to the previous version. Returns the tag now current, or None when there is nothing to go back to.
pub fn rollback(user_data: &Path) -> Option<String> {
    let state = read_state(user_data);
    let previous = state.previous.clone()?;
    if !is_installed(user_data, &previous) {
        return None;
    }
    write_state(
        user_data,
        &State {
            current: Some(previous.clone()),
            previous: state.current,
            variant: state.variant,
        },
    )
    .ok()?;
    Some(previous)
}

/// Downloads the embeddable Python, checks it against the pinned hash and unpacks it.
pub async fn ensure_python<D: Downloader, X: Extractor>(
    user_data: &Path,
    net: &D,
    extractor: &X,
    progress: &(dyn Fn(Value) + Sync),
) -> Result<PathBuf, String> {
    let dir = python_dir(user_data);
    if dir.join("python.exe").exists() {
        return Ok(dir);
    }
    let parent = root(user_data).join("python");
    fs::create_dir_all(&parent).map_err(text)?;
    let stage = parent.join(format!(".stage-{PY_VERSION}"));
    let result = async {
        let _ = fs::remove_dir_all(&stage);
        fs::create_dir_all(&stage).map_err(text)?;
        let archive = stage.join("python-embed.zip");
        let bytes = reporter(PY_SIZE_HINT, progress);
        download_verified(net, PY_URL, &archive, PY_SHA256, &bytes).await?;
        let unpacked = stage.join("x");
        extractor.extract(&archive, &unpacked).await.map_err(text)?;
        let _ = fs::remove_dir_all(&dir);
        fs::rename(&unpacked, &dir).map_err(text)?;
        Ok::<(), String>(())
    }
    .await;
    let _ = fs::remove_dir_all(&stage);
    result?;
    Ok(dir)
}

/// What the process needs to start the gateway.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    pub tag: String,
    pub variant: String,
    pub dir: PathBuf,
    pub python: PathBuf,
    pub script: PathBuf,
}

/// The installed version and its Python, or None when either is missing.
pub fn runtime(user_data: &Path) -> Option<Runtime> {
    let state = read_state(user_data);
    let tag = state.current?;
    if !is_installed(user_data, &tag) {
        return None;
    }
    let py = python_dir(user_data);
    let python = py.join("python.exe");
    if !python.exists() {
        return None;
    }
    let dir = version_dir(user_data, &tag);
    Some(Runtime {
        script: dir.join("openai_server.py"),
        variant: state.variant.unwrap_or_else(|| "vulkan".into()),
        tag,
        dir,
        python,
    })
}

/// Points the embedded interpreter at the colibri folder, which holds the gateway and its sibling modules.
pub fn prepare_runtime(user_data: &Path) -> Option<Runtime> {
    let found = runtime(user_data)?;
    let lines = ["python312.zip", ".", &found.dir.to_string_lossy()];
    let pth = python_dir(user_data).join(PY_PTH);
    fs::write(pth, format!("{}\r\n", lines.join("\r\n"))).ok()?;
    Some(found)
}

/// The environment the engine reads, from a tier plan. Mirrors are joined with `;`, as colibri reads them.
pub fn plan_environment(
    plan: &Value,
    cuda_build: bool,
    physical: usize,
    direct: bool,
    lossy: bool,
) -> Vec<(String, String)> {
    let mut env = Vec::new();
    let num = |v: &Value, path: &[&str]| -> Option<f64> {
        path.iter()
            .try_fold(v, |acc, key| acc.get(*key))
            .and_then(Value::as_f64)
    };
    if let (Some(dense), Some(cache)) = (
        num(plan, &["ram", "denseGB"]),
        num(plan, &["ram", "expertCacheGB"]),
    ) {
        env.push((
            "RAM_GB".into(),
            ((dense + cache).floor() as i64).max(1).to_string(),
        ));
    }
    if cuda_build {
        env.push(("COLI_CUDA".into(), "1".into()));
        env.push(("COLI_GPU".into(), "0".into()));
        env.push(("CUDA_DENSE".into(), "1".into()));
        if let Some(expert) = num(plan, &["vram", "expertGB"]).filter(|v| *v > 0.0) {
            env.push(("CUDA_EXPERT_GB".into(), (expert.floor() as i64).to_string()));
        }
    }
    if num(plan, &["disk", "coldGB"]).is_some_and(|v| v > 0.0) {
        env.push(("PILOT".into(), "1".into()));
    }
    if direct {
        env.push(("DIRECT".into(), "1".into()));
    }
    if lossy {
        env.push(("CACHE_ROUTE".into(), "1".into()));
        env.push(("TOPP".into(), "0.7".into()));
    }
    let mirrors: Vec<&str> = plan
        .pointer("/disk/mirrors")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if !mirrors.is_empty() {
        env.push(("COLI_MODEL_MIRROR".into(), mirrors.join(";")));
    }
    if physical > 0 {
        env.push(("OMP_NUM_THREADS".into(), physical.to_string()));
    }
    env.push(("PYTHONUTF8".into(), "1".into()));
    env.push(("PYTHONUNBUFFERED".into(), "1".into()));
    env
}

/// The load failure the app reports: a kind the renderer translates, plus the engine's own words.
pub fn load_failure(kind: &str, detail: &str, model: &str) -> Value {
    let mapped = match kind {
        "nomem" => "colibri-nomem",
        "io" => "colibri-io",
        "format" => "colibri-format",
        "unsupported" => "colibri-unsupported",
        _ => "stopped-loading",
    };
    let reason = if detail.is_empty() { kind } else { detail };
    json!({
        "success": false,
        "error": format!("colibri could not load {model}: {kind}{}", if detail.is_empty() { String::new() } else { format!(" {detail}") }),
        "kind": mapped,
        "params": { "model": model, "reason": reason },
    })
}

/// The failure a gateway that printed a load error or a policy block reports, if it did.
fn output_failure(progress: &Progress, model: &str) -> Option<Value> {
    if let Some((kind, detail)) = &progress.failure {
        return Some(load_failure(kind, detail, model));
    }
    progress.blocked.then(|| blocked_failure(model))
}

/// The failure for a gateway that ended while loading: its exit code and its last lines.
pub fn exit_failure(model: &str, code: &str, recent: &[String]) -> Value {
    let reason = recent
        .iter()
        .rev()
        .take(3)
        .rev()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(" | ");
    let log = recent
        .iter()
        .rev()
        .take(40)
        .rev()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("\n");
    let mut error = format!("colibri stopped while loading {model} (exit code {code})");
    if !reason.is_empty() {
        error = format!("{error}: {reason}");
    }
    json!({
        "success": false,
        "error": error,
        "kind": "stopped-loading",
        "params": { "model": model, "code": code, "reason": reason, "log": log },
    })
}

fn exit_text(code: Option<i32>) -> String {
    code.map_or_else(|| "signal".to_owned(), |c| c.to_string())
}

/// The failure for a gateway that could not be started at all.
fn spawn_failure(error: &io::Error, model: &str) -> Value {
    if error.kind() == io::ErrorKind::PermissionDenied {
        return blocked_failure(model);
    }
    json!({
        "success": false,
        "error": error.to_string(),
        "kind": "engine-missing",
        "params": { "model": model },
    })
}

pub fn blocked_failure(model: &str) -> Value {
    json!({
        "success": false,
        "error": "Windows blocked the colibri engine from starting",
        "kind": "colibri-blocked",
        "params": { "model": model },
    })
}

/// A free loopback port: 8000 first, since the provider list looks there, otherwise any.
pub fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 8000))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8000)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// `/health`'s tiers and scheduler as one telemetry record; null when there is no answer.
pub fn telemetry_from(health: &Value) -> Value {
    if !health.is_object() {
        return Value::Null;
    }
    let tiers = match health.get("tiers") {
        Some(t) => json!({
            "vramExperts": t.get("vram"),
            "ramExperts": t.get("ram"),
            "diskExperts": t.get("disk"),
            "vramGB": t.get("vram_gb"),
            "ramGB": t.get("ram_gb"),
        }),
        None => Value::Null,
    };
    let s = health.get("scheduler").cloned().unwrap_or(Value::Null);
    let get = |key: &str, default: u64| s.get(key).and_then(Value::as_u64).unwrap_or(default);
    json!({
        "status": health.get("status").cloned().unwrap_or(Value::Null),
        "tiers": tiers,
        "scheduler": {
            "active": get("active", 0),
            "queued": get("queued", 0),
            "capacity": get("capacity", 1),
            "completed": get("completed", 0),
        },
    })
}

const LOAD_IDLE: Duration = Duration::from_secs(900);
const POLL: Duration = Duration::from_millis(250);
const RECENT_LINES: usize = 60;
const PHASES: [&str; 4] = ["engine", "dense", "experts", "ready"];

/// What the gateway's output has said so far. The readers write it, the start loop reads it.
#[derive(Debug)]
struct Progress {
    recent: VecDeque<String>,
    failure: Option<(String, String)>,
    listening: bool,
    blocked: bool,
    phase: &'static str,
    last_activity: Instant,
    /// Set once the process has ended: its exit code, or None when a signal ended it.
    exit: Option<Option<i32>>,
}

impl Progress {
    fn new() -> Self {
        Self {
            recent: VecDeque::new(),
            failure: None,
            listening: false,
            blocked: false,
            phase: "engine",
            last_activity: Instant::now(),
            exit: None,
        }
    }

    fn absorb(&mut self, line: &str) {
        self.last_activity = Instant::now();
        if self.recent.len() == RECENT_LINES {
            self.recent.pop_front();
        }
        self.recent.push_back(line.to_owned());
        self.phase = load_phase(line, self.phase);
        match parse_gateway_line(line) {
            GatewayEvent::LoadFail { kind, detail } => self.failure = Some((kind, detail)),
            GatewayEvent::Listening => self.listening = true,
            GatewayEvent::Blocked => self.blocked = true,
            GatewayEvent::Line => {}
        }
    }
}

/// Where the earliest of `words` starts a word in `text`, or None.
fn word_at(text: &str, words: &[&str]) -> Option<usize> {
    let bytes = text.as_bytes();
    words
        .iter()
        .flat_map(|word| text.match_indices(*word).map(|(at, _)| at))
        .filter(|&at| at == 0 || !bytes[at - 1].is_ascii_alphanumeric())
        .min()
}

/// The load phase a gateway line implies, never going backwards. Lines are matched by their words.
fn load_phase(line: &str, current: &'static str) -> &'static str {
    let lower = line.to_ascii_lowercase();
    let dense_first = word_at(&lower, &["dense", "backbone", "shared"])
        .is_some_and(|at| word_at(&lower[at..], &["load", "read", "weights"]).is_some());
    let dense_second = word_at(&lower, &["load"])
        .is_some_and(|at| lower[at..].contains("dense") || lower[at..].contains("weights"));
    let experts =
        word_at(&lower, &["warm", "pin", "prefetch"]).is_some() || lower.contains("hot set");
    let mut next = current;
    if dense_first || dense_second {
        next = "dense";
    }
    if experts {
        next = "experts";
    }
    let rank = |phase: &str| PHASES.iter().position(|p| *p == phase).unwrap_or(0);
    if rank(next) > rank(current) {
        next
    } else {
        current
    }
}

fn elapsed_ms(since: Instant) -> u64 {
    since.elapsed().as_millis() as u64
}

fn spawn_reader<R>(stream: R, progress: Arc<Mutex<Progress>>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim();
            if !line.is_empty() {
                locked(&progress).absorb(line);
            }
        }
    });
}

/// Waits for the process to end and records how it did.
fn spawn_waiter(mut child: Child, progress: Arc<Mutex<Progress>>) {
    tokio::spawn(async move {
        let code = child.wait().await.ok().and_then(|status| status.code());
        locked(&progress).exit = Some(code);
    });
}

/// A model the gateway is serving, and what the app keeps about it.
#[derive(Debug, Clone)]
pub struct Served {
    pub model: String,
    pub port: u16,
    pub slow: bool,
    /// The catalog id and model folder, for the speed history and the hot-set backup.
    pub catalog: Option<(String, PathBuf)>,
}

/// One start: what runs, under which plan and environment.
pub struct Request<'a> {
    pub rt: &'a Runtime,
    pub model_dir: &'a Path,
    pub model: &'a str,
    pub catalog_id: Option<&'a str>,
    pub plan: &'a Value,
    pub lossy: bool,
    pub physical: usize,
    /// The engine-wide environment, under the plan's own variables.
    pub env: Vec<(String, String)>,
}

/// The gateway process that is running now.
struct Live {
    pid: u32,
    progress: Arc<Mutex<Progress>>,
}

/// The gateway process: one at a time, on loopback, stopped on app exit.
pub struct ColibriServer {
    live: Mutex<Option<Live>>,
    served: Mutex<Option<Served>>,
    /// Bumped on every stop, so a load that was overtaken notices.
    generation: AtomicU64,
    http: reqwest::Client,
}

impl Default for ColibriServer {
    fn default() -> Self {
        Self::new()
    }
}

impl ColibriServer {
    pub fn new() -> Self {
        Self {
            live: Mutex::new(None),
            served: Mutex::new(None),
            generation: AtomicU64::new(0),
            http: reqwest::Client::builder()
                .timeout(Duration::from_millis(1500))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Starts the gateway on a free port and waits until it answers /health. `on_phase` gets each load phase.
    pub async fn start(&self, req: Request<'_>, on_phase: &(dyn Fn(Value) + Sync)) -> Value {
        self.stop().await;
        let generation = self.generation.load(Ordering::SeqCst);
        let port = free_port();
        let spawn = spawn_plan(
            build_launch(&req.rt.python, &req.rt.script, req.model_dir, port, 1),
            port,
            req.model,
        );
        let mut overrides = req.env;
        overrides.extend(plan_environment(
            req.plan,
            req.rt.variant == "cuda",
            req.physical,
            false,
            req.lossy,
        ));
        let child = hidden_command(&spawn.program, spawn.args.as_slice(), |command| {
            if let Some(cwd) = &spawn.cwd {
                command.current_dir(cwd);
            }
            command.envs(spawn.env.iter().map(|(k, v)| (k, v)));
            command.envs(overrides.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        })
        .spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(error) => return spawn_failure(&error, req.model),
        };

        let progress = Arc::new(Mutex::new(Progress::new()));
        if let Some(out) = child.stdout.take() {
            spawn_reader(out, Arc::clone(&progress));
        }
        if let Some(err) = child.stderr.take() {
            spawn_reader(err, Arc::clone(&progress));
        }
        let pid = child.id().unwrap_or(0);
        spawn_waiter(child, Arc::clone(&progress));
        *locked(&self.live) = Some(Live {
            pid,
            progress: Arc::clone(&progress),
        });

        let started = Instant::now();
        let mut shown = "engine";
        loop {
            let (phase, exit, idle, listening) = {
                let p = locked(&progress);
                (p.phase, p.exit, p.last_activity.elapsed(), p.listening)
            };
            if phase != shown {
                shown = phase;
                on_phase(json!({ "phase": phase, "elapsedMs": elapsed_ms(started) }));
            }
            if self.generation.load(Ordering::SeqCst) != generation {
                return json!({
                    "success": false,
                    "error": "Another model was started before this one finished loading",
                    "kind": "another-model",
                });
            }
            if let Some(code) = exit {
                // Give the last lines a moment to land: they say why.
                tokio::time::sleep(Duration::from_millis(20)).await;
                let (failure, recent) = {
                    let p = locked(&progress);
                    (
                        output_failure(&p, req.model),
                        p.recent.iter().cloned().collect::<Vec<_>>(),
                    )
                };
                *locked(&self.live) = None;
                return failure
                    .unwrap_or_else(|| exit_failure(req.model, &exit_text(code), &recent));
            }
            if listening && self.get_json(port, "/health", 1500).await.is_some() {
                let catalog = req
                    .catalog_id
                    .filter(|_| !req.model_dir.as_os_str().is_empty())
                    .map(|id| (id.to_owned(), req.model_dir.to_path_buf()));
                *locked(&self.served) = Some(Served {
                    model: req.model.to_owned(),
                    port,
                    slow: is_slow_plan(req.plan),
                    catalog,
                });
                on_phase(json!({ "phase": "ready", "elapsedMs": elapsed_ms(started) }));
                return json!({
                    "success": true,
                    "port": port,
                    "baseUrl": format!("http://127.0.0.1:{port}/v1"),
                    "loadMs": elapsed_ms(started),
                });
            }
            if idle > LOAD_IDLE {
                self.stop().await;
                return json!({
                    "success": false,
                    "error": format!("{} took too long to load. Try again, or choose a smaller model.", req.model),
                    "kind": "load-timeout",
                    "params": { "model": req.model },
                });
            }
            tokio::time::sleep(POLL).await;
        }
    }

    /// Stops the gateway and forgets what it served. A load in progress ends as overtaken.
    pub async fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *locked(&self.served) = None;
        let live = locked(&self.live).take();
        if let Some(live) = live {
            let exited = locked(&live.progress).exit.is_some();
            kill_tree(live.pid, exited).await;
        }
    }

    /// Keeps the learned hot set of the served catalog model outside its folder.
    pub fn save_usage(&self, user_data: &Path) {
        let served = locked(&self.served).clone();
        if let Some((id, dir)) = served.and_then(|s| s.catalog) {
            tier_stats::backup_usage(user_data, &id, &dir);
        }
    }

    /// The model being served, or None.
    pub fn served(&self) -> Option<Served> {
        locked(&self.served).clone()
    }

    /// The expert heat map and hit counts; null without an answer. Counts only: the gateway sends no text.
    pub async fn experts(&self) -> Value {
        let Some(port) = self.served().map(|s| s.port) else {
            return Value::Null;
        };
        self.get_json(port, "/experts", 3000)
            .await
            .unwrap_or(Value::Null)
    }

    pub async fn health(&self) -> Value {
        let Some(port) = self.served().map(|s| s.port) else {
            return Value::Null;
        };
        self.get_json(port, "/health", 1500)
            .await
            .map(|body| telemetry_from(&body))
            .unwrap_or(Value::Null)
    }

    async fn get_json(&self, port: u16, route: &str, timeout_ms: u64) -> Option<Value> {
        let res = self
            .http
            .get(format!("http://127.0.0.1:{port}{route}"))
            .timeout(Duration::from_millis(timeout_ms))
            .send()
            .await
            .ok()?;
        if !res.status().is_success() {
            return None;
        }
        res.json::<Value>().await.ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A network stand-in: text for every GET, one body for every download.
    struct FakeNet {
        text: String,
        body: Vec<u8>,
        calls: AtomicUsize,
    }

    impl Downloader for FakeNet {
        async fn get_text(&self, _url: &str, _accept: Option<&str>) -> Result<String, BinaryError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.text.clone())
        }
        async fn download(
            &self,
            _url: &str,
            dest: &Path,
            on_bytes: &(dyn Fn(u64) + Sync),
        ) -> Result<(), BinaryError> {
            on_bytes(self.body.len() as u64);
            fs::write(dest, &self.body)?;
            Ok(())
        }
    }

    /// Unpacks into `dest/<folder>/openai_server.py`, the shape of a colibri archive.
    struct FakeExtract;

    impl Extractor for FakeExtract {
        async fn extract(&self, _archive: &Path, dest: &Path) -> Result<(), BinaryError> {
            let inner = dest.join("colibri-v9");
            fs::create_dir_all(&inner)?;
            fs::write(inner.join("openai_server.py"), "# gateway")?;
            Ok(())
        }
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn release(name: &str) -> Release {
        Release {
            tag_name: "v9".into(),
            draft: false,
            prerelease: false,
            assets: vec![
                Asset {
                    name: name.into(),
                    browser_download_url: format!("https://github.com/x/{name}"),
                    size: 0,
                },
                Asset {
                    name: "SHA256SUMS.txt".into(),
                    browser_download_url: "https://github.com/x/SHA256SUMS.txt".into(),
                    size: 0,
                },
            ],
        }
    }

    fn noop(_: Value) {}

    #[test]
    fn urls_are_https_and_allow_listed_hosts_only() {
        assert!(allowed_url("https://github.com/a/b.zip"));
        assert!(allowed_url("https://objects.githubusercontent.com/x"));
        assert!(allowed_url("https://www.python.org/ftp/x.zip"));
        assert!(!allowed_url("http://github.com/a"));
        assert!(!allowed_url("https://github.com.evil.example/a"));
        assert!(!allowed_url("https://evil.example/github.com"));
    }

    #[test]
    fn picks_cuda_only_when_capable_and_present() {
        let assets = vec![
            Asset {
                name: "colibri-v9-windows-x86_64.zip".into(),
                browser_download_url: String::new(),
                size: 0,
            },
            Asset {
                name: "colibri-v9-windows-x86_64-cuda.zip".into(),
                browser_download_url: String::new(),
                size: 0,
            },
            Asset {
                name: "SHA256SUMS.txt".into(),
                browser_download_url: String::new(),
                size: 0,
            },
        ];
        let cuda = pick_assets(&assets, true, true);
        assert_eq!(cuda.variant, "cuda");
        assert!(cuda.main.unwrap().name.ends_with("x86_64.zip"));
        assert_eq!(pick_assets(&assets, true, false).variant, "vulkan");
        assert!(pick_assets(&assets, false, true).main.is_none());
        assert!(cuda.sums.is_some());
    }

    #[test]
    fn compute_capability_is_the_highest_card() {
        assert_eq!(parse_compute_capability("8.9\n7.5\n"), 8.9);
        assert_eq!(parse_compute_capability(""), 0.0);
        assert_eq!(parse_compute_capability("junk\n"), 0.0);
    }

    #[tokio::test]
    async fn install_verifies_then_switches_current() {
        let dir = tempfile::tempdir().unwrap();
        let body = b"archive bytes".to_vec();
        let name = "colibri-v9-windows-x86_64.zip";
        let net = FakeNet {
            text: format!("{}  {name}\n", sha(&body)),
            body,
            calls: AtomicUsize::new(0),
        };
        let done = install(
            dir.path(),
            &net,
            &FakeExtract,
            Some(release(name)),
            false,
            &noop,
        )
        .await
        .unwrap();
        assert_eq!(done.tag, "v9");
        assert_eq!(done.variant, "vulkan");
        let state = read_state(dir.path());
        assert_eq!(state.current.as_deref(), Some("v9"));
        assert_eq!(state.variant.as_deref(), Some("vulkan"));
        assert!(
            version_dir(dir.path(), "v9")
                .join("openai_server.py")
                .exists()
        );
        assert!(!root(dir.path()).join(".stage-v9").exists());
    }

    #[tokio::test]
    async fn install_refuses_a_checksum_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let name = "colibri-v9-windows-x86_64.zip";
        let net = FakeNet {
            text: format!("{}  {name}\n", "0".repeat(64)),
            body: b"x".to_vec(),
            calls: AtomicUsize::new(0),
        };
        let err = install(
            dir.path(),
            &net,
            &FakeExtract,
            Some(release(name)),
            false,
            &noop,
        )
        .await
        .unwrap_err();
        assert_eq!(err, format!("Checksum mismatch for {name}"));
        assert!(read_state(dir.path()).current.is_none());
    }

    #[tokio::test]
    async fn install_fails_without_a_matching_asset() {
        let dir = tempfile::tempdir().unwrap();
        let net = FakeNet {
            text: String::new(),
            body: vec![],
            calls: AtomicUsize::new(0),
        };
        let mut empty = release("other.zip");
        empty.assets.clear();
        let err = install(dir.path(), &net, &FakeExtract, Some(empty), false, &noop)
            .await
            .unwrap_err();
        assert_eq!(err, "No colibri release matches this platform");
        assert_eq!(net.calls.load(Ordering::SeqCst), 0);
    }

    fn make_version(dir: &Path, tag: &str) {
        fs::create_dir_all(version_dir(dir, tag)).unwrap();
        fs::write(version_dir(dir, tag).join("openai_server.py"), "").unwrap();
    }

    #[test]
    fn rollback_swaps_current_and_previous() {
        let dir = tempfile::tempdir().unwrap();
        make_version(dir.path(), "v1");
        make_version(dir.path(), "v2");
        write_state(
            dir.path(),
            &State {
                current: Some("v2".into()),
                previous: Some("v1".into()),
                variant: Some("cuda".into()),
            },
        )
        .unwrap();
        assert_eq!(rollback(dir.path()).as_deref(), Some("v1"));
        let state = read_state(dir.path());
        assert_eq!(state.current.as_deref(), Some("v1"));
        assert_eq!(state.previous.as_deref(), Some("v2"));
        assert_eq!(state.variant.as_deref(), Some("cuda"));
    }

    #[test]
    fn rollback_without_an_installed_previous_is_none() {
        let dir = tempfile::tempdir().unwrap();
        make_version(dir.path(), "v2");
        write_state(
            dir.path(),
            &State {
                current: Some("v2".into()),
                previous: Some("v1".into()),
                variant: None,
            },
        )
        .unwrap();
        assert_eq!(rollback(dir.path()), None);
        assert_eq!(read_state(dir.path()).current.as_deref(), Some("v2"));
    }

    #[test]
    fn prune_keeps_current_previous_python_and_stage() {
        let dir = tempfile::tempdir().unwrap();
        for tag in ["v0", "v1", "v2"] {
            make_version(dir.path(), tag);
        }
        fs::create_dir_all(python_dir(dir.path())).unwrap();
        fs::create_dir_all(root(dir.path()).join(".stage-v3")).unwrap();
        write_state(
            dir.path(),
            &State {
                current: Some("v2".into()),
                previous: Some("v1".into()),
                variant: None,
            },
        )
        .unwrap();
        prune(dir.path());
        assert!(!version_dir(dir.path(), "v0").exists());
        assert!(version_dir(dir.path(), "v1").exists());
        assert!(version_dir(dir.path(), "v2").exists());
        assert!(python_dir(dir.path()).exists());
        assert!(root(dir.path()).join(".stage-v3").exists());
    }

    #[test]
    fn plan_environment_follows_the_plan() {
        let plan = json!({
            "ram": { "denseGB": 3.5, "expertCacheGB": 4.2 },
            "vram": { "expertGB": 2.7 },
            "disk": { "coldGB": 10, "mirrors": ["a", "b"] },
        });
        let env: std::collections::HashMap<_, _> = plan_environment(&plan, true, 6, true, true)
            .into_iter()
            .collect();
        assert_eq!(env["RAM_GB"], "7");
        assert_eq!(env["CUDA_EXPERT_GB"], "2");
        assert_eq!(env["PILOT"], "1");
        assert_eq!(env["DIRECT"], "1");
        assert_eq!(env["CACHE_ROUTE"], "1");
        assert_eq!(env["TOPP"], "0.7");
        assert_eq!(env["COLI_MODEL_MIRROR"], "a;b");
        assert_eq!(env["OMP_NUM_THREADS"], "6");
        assert_eq!(env["PYTHONUTF8"], "1");
    }

    #[test]
    fn load_failures_map_to_renderer_kinds() {
        let failed = load_failure("nomem", "need 9 GB", "m");
        assert_eq!(failed["kind"], "colibri-nomem");
        assert_eq!(failed["error"], "colibri could not load m: nomem need 9 GB");
        assert_eq!(load_failure("oom", "", "m")["kind"], "stopped-loading");
        assert_eq!(blocked_failure("m")["kind"], "colibri-blocked");
    }

    #[test]
    fn exit_failure_names_code_and_last_lines() {
        let lines: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();
        let failed = exit_failure("m", "3221225477", &lines);
        assert_eq!(
            failed["error"],
            "colibri stopped while loading m (exit code 3221225477): b | c | d"
        );
        assert_eq!(failed["params"]["code"], "3221225477");
        assert_eq!(
            exit_failure("m", "signal", &[])["error"],
            "colibri stopped while loading m (exit code signal)"
        );
    }

    #[test]
    fn output_failure_reads_load_fail_and_block() {
        let mut progress = Progress::new();
        progress.absorb("junk");
        assert!(output_failure(&progress, "m").is_none());
        progress.absorb("engine load failed: kind=nomem need 9 GB");
        assert_eq!(
            output_failure(&progress, "m").unwrap()["kind"],
            "colibri-nomem"
        );
        let mut blocked = Progress::new();
        blocked.absorb("blocked by Application Control policy");
        assert_eq!(
            output_failure(&blocked, "m").unwrap()["kind"],
            "colibri-blocked"
        );
    }

    #[test]
    fn load_phase_moves_forward_only() {
        assert_eq!(load_phase("loading dense weights", "engine"), "dense");
        assert_eq!(load_phase("pinned hot set 40%", "dense"), "experts");
        assert_eq!(load_phase("loading dense weights", "experts"), "experts");
        assert_eq!(load_phase("listening", "engine"), "engine");
    }

    #[test]
    fn telemetry_defaults_and_null_without_health() {
        assert!(telemetry_from(&Value::Null).is_null());
        let record = telemetry_from(
            &json!({ "status": "ok", "tiers": { "vram": 1, "ram": 2, "disk": 3, "vram_gb": 4.0, "ram_gb": 5.0 } }),
        );
        assert_eq!(record["tiers"]["ramExperts"], 2);
        assert_eq!(record["scheduler"]["capacity"], 1);
        assert_eq!(record["scheduler"]["active"], 0);
    }

    #[test]
    fn runtime_needs_the_gateway_and_python() {
        let dir = tempfile::tempdir().unwrap();
        make_version(dir.path(), "v2");
        write_state(
            dir.path(),
            &State {
                current: Some("v2".into()),
                previous: None,
                variant: None,
            },
        )
        .unwrap();
        assert!(runtime(dir.path()).is_none());
        fs::create_dir_all(python_dir(dir.path())).unwrap();
        fs::write(python_dir(dir.path()).join("python.exe"), "").unwrap();
        let found = prepare_runtime(dir.path()).unwrap();
        assert_eq!(found.variant, "vulkan");
        let pth = fs::read_to_string(python_dir(dir.path()).join(PY_PTH)).unwrap();
        assert!(pth.starts_with("python312.zip\r\n.\r\n"));
    }
}
