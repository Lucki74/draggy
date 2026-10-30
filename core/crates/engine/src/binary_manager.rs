//! Installs and locates the llama.cpp engine: release asset choice, GPU runner, download, adoption and the folder swap.
//! Network, unpacking and process calls go through traits. Port of electron/binaryManager.cjs.

use std::fs;
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use chrono::{DateTime, SecondsFormat};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::command::{CommandRunner, ProcessSpec, run_text};
use crate::js;
use crate::platform::{Arch, Os, Platform};
use crate::vram_probe::parse_nvidia_info;
use draggy_web::policy::UrlPolicy;

pub const RELEASES_URL: &str =
    "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10";
pub const ENGINE_LABEL: &str = "AI Engine";
pub const META_FILE: &str = "engine.json";
const NVIDIA_LINUX_DRIVER: [&str; 5] = [
    "/usr/lib/x86_64-linux-gnu/libcuda.so.1",
    "/usr/lib/aarch64-linux-gnu/libcuda.so.1",
    "/usr/lib64/libcuda.so.1",
    "/usr/lib/libcuda.so.1",
    "/usr/lib/wsl/lib/libcuda.so.1",
];

static BASE_LIBRARY: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)\.(dll|so(\.[0-9]+)*|dylib|metallib)$").ok());
static ENGINE_LIBRARY: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"(?i)^(lib)?(ggml|llama|mtmd)[^\\/]*\.(dll|so(\.[0-9]+)*|dylib|metallib)$").ok()
});
static RUNNER_FOLDER: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)^(cuda_v[0-9]+|vulkan|rocm|hip|metal)$").ok());
static MACOS_ARCHIVE: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"-bin-macos-").ok());
static VARIANT: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"-bin-(?:win|ubuntu)-(.+?)-(?:x64|arm64)\.").ok());
static BUILD_TAG: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"^b([0-9]+)$").ok());
static CUDA_ARCHIVE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^llama-(b[0-9]+)-bin-\w+-cuda-([0-9.]+)-x64").ok());

/// Whether a file name matches one of the static patterns above. A pattern that failed to compile matches nothing.
fn is_match(pattern: &LazyLock<Option<Regex>>, text: &str) -> bool {
    pattern.as_ref().is_some_and(|re| re.is_match(text))
}

/// One file of a release.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Asset {
    pub name: String,
    pub browser_download_url: String,
    /// GitHub's published digest, "sha256:<hex>".
    pub digest: Option<String>,
    pub size: u64,
}

/// One llama.cpp release as GitHub lists it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Release {
    pub tag_name: String,
    pub draft: bool,
    pub published_at: Option<String>,
    pub assets: Vec<Asset>,
}

/// What the GPU offers the engine: its memory, whether an NVIDIA driver is there, and whether it is new enough for CUDA 13.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GpuProfile {
    pub vram_gb: f64,
    pub nvidia: bool,
    pub cuda13: bool,
}

/// The release files chosen for a machine. `variant` is None when there is no main archive.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Picked<'a> {
    pub main: Option<&'a Asset>,
    pub extra: Option<&'a Asset>,
    pub variant: Option<String>,
}

/// The GPU runner found beside the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GpuRunner {
    pub runner_dir: PathBuf,
    pub backend_dll: Option<PathBuf>,
    pub runner_type: &'static str,
}

/// The environment the engine runs in, and the server it runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineEnvironment {
    pub env: Vec<(String, String)>,
    pub runner_dir: PathBuf,
    pub runner_type: &'static str,
    pub binary_path: Option<PathBuf>,
}

/// Whether the engine folder holds a usable install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineState {
    pub present: bool,
    pub complete: bool,
    pub binary_path: PathBuf,
    pub runner_type: &'static str,
}

/// A download that unpacked into `out_dir`, with the release tag and build variant it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadedEngine {
    pub out_dir: PathBuf,
    pub tag: String,
    pub variant: String,
}

/// Progress of a download, as the UI shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct DownloadProgress {
    pub percent: f64,
    pub completed: u64,
    pub total: u64,
    pub phase: &'static str,
    pub label: &'static str,
}

/// The result of making sure an engine is installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetupOutcome {
    Ready {
        binary_path: PathBuf,
        runner_type: &'static str,
    },
    NotReady {
        error: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum BinaryError {
    #[error("URL refused by outbound security policy")]
    UrlRefused,
    #[error("Checksum mismatch for {0}")]
    Checksum(String),
    #[error("No llama.cpp release matches this platform")]
    NoRelease,
    #[error("Engine files are incomplete")]
    Incomplete,
    #[error("{0} has no GPU backend for this machine")]
    NoGpuBackend(String),
    #[error("{0} does not start on this machine")]
    DoesNotStart(String),
    #[error("{0}")]
    Transfer(String),
    #[error("could not read the release list: {0}")]
    Parse(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// Fetches text and files over the network. Real code checks each URL with the outbound policy before it connects.
pub trait Downloader: Sync {
    fn get_text(
        &self,
        url: &str,
        accept: Option<&str>,
    ) -> impl Future<Output = Result<String, BinaryError>> + Send;
    /// Writes the body to `dest`, calling `on_bytes` with each chunk's length.
    fn download(
        &self,
        url: &str,
        dest: &Path,
        on_bytes: &(dyn Fn(u64) + Sync),
    ) -> impl Future<Output = Result<(), BinaryError>> + Send;
}

/// Unpacks an archive into a folder.
pub trait Extractor: Sync {
    fn extract(
        &self,
        archive: &Path,
        dest: &Path,
    ) -> impl Future<Output = Result<(), BinaryError>> + Send;
}

/// Unpacks archives with the system tar, which reads zip on Windows 10+ and tar.gz everywhere.
pub struct TarExtractor<'a, R: CommandRunner> {
    runner: &'a R,
    tar: PathBuf,
}

impl<'a, R: CommandRunner> TarExtractor<'a, R> {
    /// The tar this OS ships: tar.exe in System32 on Windows, tar on the path elsewhere.
    pub fn for_platform(runner: &'a R, platform: &Platform) -> Self {
        let tar = if platform.os == Os::Windows {
            PathBuf::from(platform.env.or("SystemRoot", r"C:\Windows"))
                .join("System32")
                .join("tar.exe")
        } else {
            PathBuf::from("tar")
        };
        Self { runner, tar }
    }
}

impl<R: CommandRunner> Extractor for TarExtractor<'_, R> {
    async fn extract(&self, archive: &Path, dest: &Path) -> Result<(), BinaryError> {
        fs::create_dir_all(dest)?;
        let spec = ProcessSpec {
            program: self.tar.clone(),
            args: vec![
                "-xf".to_owned(),
                archive.to_string_lossy().into_owned(),
                "-C".to_owned(),
                dest.to_string_lossy().into_owned(),
            ],
            cwd: None,
            env: None,
            timeout: Duration::from_millis(600_000),
        };
        match self.runner.run(spec).await {
            Some(output) if output.success => Ok(()),
            _ => Err(BinaryError::Transfer(
                "could not unpack the engine archive".to_owned(),
            )),
        }
    }
}

/// Everything the install needs from outside: the process runner, the transfers, the outbound URL policy and the clock.
pub struct Toolkit<'a, R: CommandRunner, D: Downloader, X: Extractor> {
    pub runner: &'a R,
    pub downloader: &'a D,
    pub extractor: &'a X,
    pub policy: &'a Mutex<UrlPolicy>,
    pub clock: &'a (dyn Fn() -> i64 + Sync),
}

/// The folders where the engine might already be, most specific first.
fn join_all(base: &str, parts: &[&str]) -> PathBuf {
    parts
        .iter()
        .fold(PathBuf::from(base), |path, part| path.join(part))
}

/// Folders that may already hold a llama-server, most specific first.
pub fn candidate_dirs(platform: &Platform) -> Vec<PathBuf> {
    let env = &platform.env;
    let mut dirs = if platform.os == Os::Windows {
        vec![
            join_all(
                env.get("LOCALAPPDATA"),
                &["Programs", "Ollama", "lib", "ollama"],
            ),
            join_all(
                env.or("ProgramFiles", r"C:\Program Files"),
                &["Ollama", "lib", "ollama"],
            ),
            join_all(
                env.or("ProgramFiles(x86)", r"C:\Program Files (x86)"),
                &["Ollama", "lib", "ollama"],
            ),
            join_all(env.get("LOCALAPPDATA"), &["Programs", "llama.cpp"]),
        ]
    } else {
        // DRAGGY_FS_ROOT re-roots the system folders so a test does not pick up an engine installed on its host.
        let root = env.or("DRAGGY_FS_ROOT", "/");
        vec![
            join_all(root, &["usr", "local", "bin"]),
            join_all(root, &["usr", "bin"]),
            join_all(env.get("HOME"), &[".local", "bin"]),
            join_all(root, &["usr", "local", "lib", "ollama"]),
            join_all(root, &["usr", "lib", "ollama"]),
            join_all(
                root,
                &["Applications", "Ollama.app", "Contents", "Resources"],
            ),
        ]
    };
    dirs.extend(
        env.get("PATH")
            .split(platform.delimiter())
            .filter(|dir| !dir.is_empty())
            .map(PathBuf::from),
    );
    dirs
}

/// Looks for llama-server in the app's own engine folder, then in the folders in [`candidate_dirs`].
pub fn find_llama_binary(platform: &Platform, user_data: Option<&Path>) -> Option<PathBuf> {
    let name = platform.server_name();
    if let Some(dir) = user_data {
        let custom = platform.engine_dir(dir).join(name);
        if custom.exists() {
            tracing::info!(target: "engine.binary", "found llama-server in user data");
            return Some(custom);
        }
    }
    for dir in candidate_dirs(platform) {
        let file = dir.join(name);
        if file.exists() {
            tracing::info!(target: "engine.binary", "found llama-server on PATH");
            return Some(file);
        }
    }
    tracing::debug!(target: "engine.binary", "no llama-server binary discovered");
    None
}

/// The release asset a machine is steered to at first, before the release list is read.
pub fn recommended_release_asset(platform: &Platform, vram_gb: f64) -> &'static str {
    let asset = match platform.os {
        Os::Windows if vram_gb > 0.0 => "llama-server-cuda-x64",
        Os::MacOs => "llama-server-metal-arm64",
        _ => "llama-server-vulkan-x64",
    };
    tracing::debug!(target: "engine.binary", asset, vram_gb, "recommended asset");
    asset
}

/// Whether the outbound URL policy allows a download URL. Public hosts only.
pub fn validate_download_url(url: &str, policy: &Mutex<UrlPolicy>) -> bool {
    let allowed = policy
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .is_fetchable_url(url, false);
    tracing::debug!(target: "engine.binary", allowed, "download url checked");
    allowed
}

/// Whether a download URL may be fetched: https, and allowed by the outbound URL policy.
pub fn check_download_url(url: &str, policy: &Mutex<UrlPolicy>) -> Result<(), BinaryError> {
    if url.starts_with("https:") && validate_download_url(url, policy) {
        Ok(())
    } else {
        Err(BinaryError::UrlRefused)
    }
}

/// Whether an NVIDIA driver is installed. AMD and Intel cards report VRAM too but cannot run CUDA.
pub fn has_nvidia_driver(platform: &Platform, system_root: &Path) -> bool {
    if platform.os == Os::Windows {
        return system_root.join("System32").join("nvcuda.dll").exists();
    }
    NVIDIA_LINUX_DRIVER
        .iter()
        .any(|file| Path::new(file).exists())
}

/// Where one runner lives on one OS: its sub-folder names and the library that proves the backend is there.
pub struct RunnerSpec {
    pub folders: &'static [&'static str],
    pub marker: &'static str,
}

/// One GPU backend the engine folder can hold. A `None` spec means the runner does not exist on that OS.
pub struct RunnerRow {
    pub runner_type: &'static str,
    pub windows: Option<RunnerSpec>,
    pub linux: Option<RunnerSpec>,
    /// Needs an NVIDIA driver and video memory to load.
    pub needs_nvidia: bool,
    /// AMD ROCm or HIP. Windows only looks for it when the user opted in; Linux always has.
    pub rocm: bool,
}

/// Every runner in preference order. This is the only place runner names are written; `shared/fixtures/engine/runner-table.json`
/// pins it for the Windows shell too. Opting into ROCm moves the rocm row ahead of vulkan.
pub const RUNNER_TABLE: &[RunnerRow] = &[
    RunnerRow {
        runner_type: "cuda",
        windows: Some(RunnerSpec {
            folders: &["cuda_v12", "cuda_v13"],
            marker: "ggml-cuda.dll",
        }),
        linux: Some(RunnerSpec {
            folders: &["cuda_v12", "cuda_v13"],
            marker: "libggml-cuda.so",
        }),
        needs_nvidia: true,
        rocm: false,
    },
    RunnerRow {
        runner_type: "vulkan",
        windows: Some(RunnerSpec {
            folders: &["vulkan"],
            marker: "ggml-vulkan.dll",
        }),
        linux: Some(RunnerSpec {
            folders: &["vulkan"],
            marker: "libggml-vulkan.so",
        }),
        needs_nvidia: false,
        rocm: false,
    },
    RunnerRow {
        runner_type: "rocm",
        windows: Some(RunnerSpec {
            folders: &["hip", "rocm"],
            marker: "ggml-hip.dll",
        }),
        linux: Some(RunnerSpec {
            folders: &["rocm"],
            marker: "libggml-hip.so",
        }),
        needs_nvidia: false,
        rocm: true,
    },
];

/// What the user chose about GPU backends. Everything off keeps the default order.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RunnerOptions {
    /// `gpu.rocm`: allow ROCm on Linux and HIP on Windows, ahead of Vulkan.
    pub rocm: bool,
}

static ROCM_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

impl RunnerOptions {
    /// The options the shell last set with [`set_runner_options`]. Everything is off until it does.
    pub fn current() -> Self {
        Self {
            rocm: ROCM_ENABLED.load(Ordering::Relaxed),
        }
    }
}

/// Records the user's GPU backend choices (`gpu.rocm`) for the engine installer and updater.
pub fn set_runner_options(options: RunnerOptions) {
    ROCM_ENABLED.store(options.rocm, Ordering::Relaxed);
}

/// Picks the GPU backend the engine folder can run, with the options the shell set.
pub fn detect_gpu_runner(
    platform: &Platform,
    llama_dir: &Path,
    vram_gb: f64,
    nvidia: bool,
) -> GpuRunner {
    detect_gpu_runner_with(
        platform,
        llama_dir,
        vram_gb,
        nvidia,
        RunnerOptions::current(),
    )
}

/// Picks the GPU backend the engine folder can run. Sub-folder layouts come from Ollama installs, flat ones from llama.cpp releases.
/// The first row of [`RUNNER_TABLE`] whose folder or marker is present wins.
pub fn detect_gpu_runner_with(
    platform: &Platform,
    llama_dir: &Path,
    vram_gb: f64,
    nvidia: bool,
    options: RunnerOptions,
) -> GpuRunner {
    let found = |dir: PathBuf, dll: Option<&str>, runner_type: &'static str| GpuRunner {
        backend_dll: dll.map(|name| dir.join(name)),
        runner_dir: dir,
        runner_type,
    };
    if platform.os == Os::MacOs {
        return found(llama_dir.to_path_buf(), None, "metal");
    }
    let windows = platform.os == Os::Windows;
    // AMD and Intel report VRAM too; without an NVIDIA driver a CUDA runner cannot load.
    let cuda_usable = vram_gb > 0.0 && nvidia;

    let mut rows: Vec<&RunnerRow> = RUNNER_TABLE.iter().collect();
    if options.rocm {
        // CUDA, then ROCm or HIP, then the rest. The sort is stable.
        rows.sort_by_key(|row| match (row.needs_nvidia, row.rocm) {
            (true, _) => 0,
            (_, true) => 1,
            _ => 2,
        });
    }
    for row in rows {
        let spec = if windows { &row.windows } else { &row.linux };
        let Some(spec) = spec else { continue };
        if row.needs_nvidia && !cuda_usable {
            continue;
        }
        // Windows HIP exists only for users who asked for it; an Ollama `rocm` folder must not change their runner.
        if row.rocm && windows && !options.rocm {
            continue;
        }
        if windows {
            // Folders before the flat library, as the release layouts put them.
            for name in spec.folders {
                let dir = llama_dir.join(name);
                if dir.is_dir() {
                    return found(dir, Some(spec.marker), row.runner_type);
                }
            }
            if llama_dir.join(spec.marker).exists() {
                return found(llama_dir.to_path_buf(), Some(spec.marker), row.runner_type);
            }
        } else {
            for name in spec.folders {
                let dir = llama_dir.join(name);
                if dir.is_dir() {
                    return found(dir, Some(spec.marker), row.runner_type);
                }
                if llama_dir.join(spec.marker).exists() {
                    return found(llama_dir.to_path_buf(), Some(spec.marker), row.runner_type);
                }
            }
        }
    }
    found(llama_dir.to_path_buf(), None, "cpu")
}

/// The environment the engine needs to find its GPU backend. The binary is returned too, so callers resolve everything once.
pub fn engine_environment(
    platform: &Platform,
    user_data: &Path,
    vram_gb: f64,
    explicit: Option<&Path>,
    nvidia: bool,
) -> EngineEnvironment {
    let binary_path = explicit
        .map(Path::to_path_buf)
        .or_else(|| find_llama_binary(platform, Some(user_data)));
    // Runners sit beside the binary that runs, which may be an Ollama install rather than the app folder.
    let llama_dir = binary_path
        .as_ref()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| platform.engine_dir(user_data));
    let runner = detect_gpu_runner(platform, &llama_dir, vram_gb, nvidia);

    let mut dirs: Vec<String> = Vec::new();
    for dir in [&runner.runner_dir, &llama_dir] {
        let text = dir.to_string_lossy().into_owned();
        if !dirs.contains(&text) {
            dirs.push(text);
        }
    }
    let delimiter = platform.delimiter().to_string();
    let mut path_parts = dirs.clone();
    path_parts.push(platform.env.get("PATH").to_owned());
    let mut env = vec![("PATH".to_owned(), path_parts.join(&delimiter))];
    if platform.os != Os::Windows {
        let mut library_parts = dirs.clone();
        library_parts.push(platform.env.get("LD_LIBRARY_PATH").to_owned());
        let library_parts: Vec<String> = library_parts
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect();
        env.push(("LD_LIBRARY_PATH".to_owned(), library_parts.join(&delimiter)));
    }
    if let Some(dll) = &runner.backend_dll
        && runner.runner_dir != llama_dir
    {
        env.push((
            "GGML_BACKEND_PATH".to_owned(),
            dll.to_string_lossy().into_owned(),
        ));
    }

    EngineEnvironment {
        env,
        runner_dir: runner.runner_dir,
        runner_type: runner.runner_type,
        binary_path,
    }
}

/// True once the engine folder holds the server and, on a GPU machine, a GPU backend.
pub fn engine_state(
    platform: &Platform,
    llama_dir: &Path,
    vram_gb: f64,
    nvidia: bool,
) -> EngineState {
    let binary_path = llama_dir.join(platform.server_name());
    let runner_type = detect_gpu_runner(platform, llama_dir, vram_gb, nvidia).runner_type;
    let present = binary_path.exists();
    let wants_gpu = vram_gb > 0.0 && platform.os != Os::MacOs;
    EngineState {
        present,
        complete: present && (runner_type != "cpu" || !wants_gpu),
        binary_path,
        runner_type,
    }
}

/// What is installed: release tag and build variant, written beside the engine. Missing or unreadable reads as empty.
pub fn read_engine_meta(llama_dir: &Path) -> Map<String, Value> {
    match fs::read_to_string(llama_dir.join(META_FILE))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

/// Records what is installed. A folder that cannot be written only loses the record.
pub fn write_engine_meta(llama_dir: &Path, meta: &Map<String, Value>) {
    let text = serde_json::to_string_pretty(meta).unwrap_or_default();
    if let Err(error) = fs::write(llama_dir.join(META_FILE), text) {
        tracing::warn!(target: "engine.binary", kind = ?error.kind(), "could not record engine details");
    }
}

/// The build flavour named in a release archive: "cuda-12.4", "vulkan", "cpu", or "metal" on macOS.
pub fn variant_of(asset_name: &str) -> String {
    if is_match(&MACOS_ARCHIVE, asset_name) {
        return "metal".to_owned();
    }
    VARIANT
        .as_ref()
        .and_then(|re| re.captures(asset_name))
        .and_then(|captures| captures.get(1))
        .map_or_else(|| "cpu".to_owned(), |m| m.as_str().to_owned())
}

/// The build number of a tag such as "b11146", or 0.
pub fn build_number(tag: &str) -> u64 {
    BUILD_TAG
        .as_ref()
        .and_then(|re| re.captures(tag))
        .and_then(|captures| captures.get(1))
        .and_then(|m| m.as_str().parse::<u64>().ok())
        .unwrap_or(0)
}

/// A folder is worth copying only if the server sits beside its own libraries.
fn is_self_contained(platform: &Platform, dir: &Path) -> bool {
    if !dir.join(platform.server_name()).exists() {
        return false;
    }
    fs::read_dir(dir).is_ok_and(|entries| {
        entries
            .filter_map(Result::ok)
            .any(|entry| is_match(&ENGINE_LIBRARY, &entry.file_name().to_string_lossy()))
    })
}

/// Copies a folder tree, overwriting files that are already there.
pub fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Removes a folder tree; a folder that is not there is not an error.
pub fn remove_tree(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// Copies a local install's server, libraries and GPU runners into `stage_dir`. Returns the folder used, or None.
pub fn adopt_local_engine(
    platform: &Platform,
    llama_dir: &Path,
    stage_dir: &Path,
) -> io::Result<Option<PathBuf>> {
    for source in candidate_dirs(platform) {
        if source == llama_dir || !is_self_contained(platform, &source) {
            continue;
        }
        tracing::info!(target: "engine.binary", "adopting local engine");
        fs::create_dir_all(stage_dir)?;
        for entry in fs::read_dir(&source)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let from = entry.path();
            let to = stage_dir.join(&name);
            let file_type = entry.file_type()?;
            if file_type.is_dir() && is_match(&RUNNER_FOLDER, &name) {
                copy_tree(&from, &to)?;
            } else if file_type.is_file()
                && (name == platform.server_name() || is_match(&BASE_LIBRARY, &name))
            {
                fs::copy(&from, &to)?;
            }
        }
        return Ok(Some(source));
    }
    Ok(None)
}

/// Moves a finished staging folder into place, keeping anything already there. A replacement swaps whole folders, so a
/// locked file leaves the old engine untouched rather than half-overwritten.
pub fn install_staged(
    platform: &Platform,
    stage_dir: &Path,
    llama_dir: &Path,
    replace: bool,
) -> io::Result<()> {
    if let Some(parent) = llama_dir.parent() {
        fs::create_dir_all(parent)?;
    }
    if replace && llama_dir.exists() {
        let old = PathBuf::from(format!("{}.old", llama_dir.display()));
        remove_tree(&old)?;
        fs::rename(llama_dir, &old)?;
        if let Err(error) = fs::rename(stage_dir, llama_dir) {
            fs::rename(&old, llama_dir)?;
            return Err(error);
        }
        remove_tree(&old)?;
    } else if !llama_dir.exists() {
        fs::rename(stage_dir, llama_dir)?;
    } else {
        copy_tree(stage_dir, llama_dir)?;
        remove_tree(stage_dir)?;
    }
    make_executable(&llama_dir.join(platform.server_name()), platform.os)
}

#[cfg(unix)]
pub fn make_executable(server: &Path, os: Os) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    if os == Os::Windows {
        return Ok(());
    }
    fs::set_permissions(server, fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
pub fn make_executable(_server: &Path, _os: Os) -> io::Result<()> {
    Ok(())
}

/// The asset names chosen for this machine. CUDA 13 goes to Blackwell cards with a new enough driver; older cards stay
/// on 12, since the 13 builds dropped the oldest architectures.
pub fn pick_release_assets<'a>(
    os: Os,
    arch: Arch,
    assets: &'a [Asset],
    profile: &GpuProfile,
) -> Picked<'a> {
    pick_release_assets_with(os, arch, assets, profile, RunnerOptions::current())
}

/// [`pick_release_assets`] with the options given. With `gpu.rocm` on, a card without an NVIDIA driver takes the ROCm
/// archive when the release has one, ahead of Vulkan.
pub fn pick_release_assets_with<'a>(
    os: Os,
    arch: Arch,
    assets: &'a [Asset],
    profile: &GpuProfile,
    options: RunnerOptions,
) -> Picked<'a> {
    let by_name = |pattern: &str| -> Option<&'a Asset> {
        let re = Regex::new(pattern).ok()?;
        assets.iter().find(|asset| re.is_match(&asset.name))
    };
    let with_variant = |main: Option<&'a Asset>, extra: Option<&'a Asset>| Picked {
        main,
        extra,
        variant: main.map(|asset| variant_of(&asset.name)),
    };
    let arm = arch == Arch::Arm64;
    let cpu = if arm { "arm64" } else { "x64" };

    if os == Os::MacOs {
        return with_variant(
            by_name(&format!(r"^llama-b[0-9]+-bin-macos-{cpu}\.tar\.gz$")),
            None,
        );
    }

    let windows = os == Os::Windows;
    let os_name = if windows { "win" } else { "ubuntu" };
    let ext = if windows { "zip" } else { r"tar\.gz" };
    if profile.vram_gb > 0.0 && profile.nvidia && !arm {
        let majors: &[&str] = if profile.cuda13 {
            &["13", "12"]
        } else {
            &["12"]
        };
        for major in majors {
            let main = by_name(&format!(
                r"^llama-(b[0-9]+)-bin-{os_name}-cuda-{major}\.[0-9.]+-x64\.{ext}$"
            ));
            let (build, version) = main
                .and_then(|asset| CUDA_ARCHIVE.as_ref()?.captures(&asset.name))
                .map(|captures| {
                    (
                        captures.get(1).map_or("", |m| m.as_str()).to_owned(),
                        captures.get(2).map_or("", |m| m.as_str()).to_owned(),
                    )
                })
                .unwrap_or_default();
            // Windows names the runtime without the build number, Linux with it.
            let runtime_name = if windows {
                format!("cudart-llama-bin-win-cuda-{version}-x64.zip")
            } else {
                format!("cudart-llama-{build}-bin-ubuntu-cuda-{version}-x64.tar.gz")
            };
            let runtime = if version.is_empty() {
                None
            } else {
                assets.iter().find(|asset| asset.name == runtime_name)
            };
            if let (Some(main), Some(runtime)) = (main, runtime) {
                return with_variant(Some(main), Some(runtime));
            }
        }
    }

    if options.rocm && profile.vram_gb > 0.0 && !profile.nvidia {
        if let Some(rocm) = pick_rocm_asset(os, arch, assets) {
            return with_variant(Some(rocm), None);
        }
    }

    if windows {
        if arm {
            return with_variant(by_name(r"^llama-b[0-9]+-bin-win-cpu-arm64\.zip$"), None);
        }
        let vulkan = by_name(r"^llama-b[0-9]+-bin-win-vulkan-x64\.zip$");
        if profile.vram_gb > 0.0 && vulkan.is_some() {
            return with_variant(vulkan, None);
        }
        return with_variant(by_name(r"^llama-b[0-9]+-bin-win-cpu-x64\.zip$"), None);
    }

    let variant = if profile.vram_gb > 0.0 { "vulkan-" } else { "" };
    with_variant(
        by_name(&format!(
            r"^llama-b[0-9]+-bin-ubuntu-{variant}{cpu}\.tar\.gz$"
        )),
        None,
    )
}

/// The ROCm archive for an AMD card, used only when `gpu.rocm` is on. x64 Windows and Ubuntu publish one; nothing else does.
pub fn pick_rocm_asset(os: Os, arch: Arch, assets: &[Asset]) -> Option<&Asset> {
    if arch != Arch::X64 {
        return None;
    }
    let pattern = match os {
        Os::Windows => r"^llama-b[0-9]+-bin-win-rocm-[0-9.]+-x64\.zip$",
        Os::Linux => r"^llama-b[0-9]+-bin-ubuntu-rocm-[0-9.]+-x64\.tar\.gz$",
        Os::MacOs => return None,
    };
    let re = Regex::new(pattern).ok()?;
    assets.iter().find(|asset| re.is_match(&asset.name))
}

/// The reason a build was chosen, in a few words, for the log.
pub fn why_picked(profile: &GpuProfile, variant: Option<&str>) -> &'static str {
    if profile.vram_gb <= 0.0 {
        return "no gpu memory found, so the cpu build";
    }
    let variant = variant.unwrap_or("");
    if variant.contains("cuda") {
        return if profile.cuda13 {
            "nvidia gpu with a driver new enough for cuda 13"
        } else {
            "nvidia gpu with cuda 12"
        };
    }
    if variant.contains("vulkan") {
        return if profile.nvidia {
            "nvidia gpu, but no matching cuda runtime in the release"
        } else {
            "gpu without an nvidia driver, so vulkan"
        };
    }
    "cpu build"
}

/// The GPU profile for a card with `vram_gb` of memory. CUDA 13 needs compute capability 10 or more and driver 580 or newer.
pub async fn gpu_profile(
    runner: &impl CommandRunner,
    vram_gb: f64,
    nvidia_driver: bool,
) -> GpuProfile {
    let nvidia = vram_gb > 0.0 && nvidia_driver;
    let info = if nvidia {
        run_text(
            runner,
            "nvidia-smi",
            &[
                "--query-gpu=compute_cap,driver_version",
                "--format=csv,noheader",
            ],
            5000,
        )
        .await
        .as_deref()
        .and_then(parse_nvidia_info)
    } else {
        None
    };
    let cuda13 =
        info.is_some_and(|info| info.compute_capability >= 10.0 && info.driver_major >= 580);
    GpuProfile {
        vram_gb,
        nvidia,
        cuda13,
    }
}

/// GET of a JSON document from an allowed URL.
pub async fn fetch_json<T, D>(
    downloader: &D,
    policy: &Mutex<UrlPolicy>,
    url: &str,
) -> Result<T, BinaryError>
where
    T: serde::de::DeserializeOwned,
    D: Downloader,
{
    check_download_url(url, policy)?;
    let text = downloader
        .get_text(url, Some("application/vnd.github+json"))
        .await?;
    serde_json::from_str(&text).map_err(|error| BinaryError::Parse(error.to_string()))
}

fn sha256_hex(path: &Path) -> io::Result<String> {
    let bytes = fs::read(path)?;
    Ok(hex::encode(Sha256::digest(&bytes)))
}

/// The folder an archive unpacked into, stepping into a single wrapper folder when there is one.
fn unwrap_dir(dir: &Path) -> io::Result<PathBuf> {
    let entries: Vec<fs::DirEntry> = fs::read_dir(dir)?.filter_map(Result::ok).collect();
    if let [only] = entries.as_slice()
        && only.file_type()?.is_dir()
    {
        return Ok(only.path());
    }
    Ok(dir.to_path_buf())
}

/// Downloads the engine for this machine from `wanted`, or from the newest release that has one. Checks the published
/// sha256, unpacks each archive and returns the folder with the release tag and build variant.
pub async fn download_engine<R, D, X>(
    kit: &Toolkit<'_, R, D, X>,
    platform: &Platform,
    stage_dir: &Path,
    profile: GpuProfile,
    wanted: Option<&Release>,
    progress: &(dyn Fn(DownloadProgress) + Sync),
) -> Result<DownloadedEngine, BinaryError>
where
    R: CommandRunner,
    D: Downloader,
    X: Extractor,
{
    let pick = |release: &Release| {
        pick_release_assets(platform.os, platform.arch, &release.assets, &profile)
            .main
            .is_some()
    };
    let release = match wanted {
        Some(release) => release.clone(),
        None => {
            let releases: Vec<Release> =
                fetch_json(kit.downloader, kit.policy, RELEASES_URL).await?;
            // llama.cpp flags every build a prerelease, so only drafts are skipped.
            releases
                .into_iter()
                .find(|entry| !entry.draft && pick(entry))
                .ok_or(BinaryError::NoRelease)?
        }
    };
    let picked = pick_release_assets(platform.os, platform.arch, &release.assets, &profile);
    let (Some(main), variant) = (picked.main, picked.variant.clone().unwrap_or_default()) else {
        return Err(BinaryError::NoRelease);
    };
    let assets: Vec<&Asset> = [Some(main), picked.extra].into_iter().flatten().collect();
    let total: u64 = assets.iter().map(|asset| asset.size).sum();
    tracing::info!(
        target: "engine.binary",
        tag = release.tag_name.as_str(),
        variant = variant.as_str(),
        why = why_picked(&profile, Some(&variant)),
        vram_gb = profile.vram_gb,
        nvidia = profile.nvidia,
        cuda13 = profile.cuda13,
        "build picked"
    );

    let completed = AtomicU64::new(0);
    let last_emit = AtomicU64::new(0);
    let on_bytes = |bytes: u64| {
        let done = completed.fetch_add(bytes, Ordering::Relaxed) + bytes;
        let now = u64::try_from((kit.clock)()).unwrap_or(0);
        let last = last_emit.load(Ordering::Relaxed);
        if now.saturating_sub(last) < 100 && done < total {
            return;
        }
        last_emit.store(now, Ordering::Relaxed);
        let percent = if total > 0 {
            js::to_fixed1(done as f64 / total as f64 * 100.0)
        } else {
            0.0
        };
        progress(DownloadProgress {
            percent,
            completed: done,
            total,
            phase: "downloading",
            label: ENGINE_LABEL,
        });
    };

    fs::create_dir_all(stage_dir)?;
    let work_dir = stage_dir.join("_work");
    fs::create_dir_all(&work_dir)?;
    let out_dir = stage_dir.join("engine");
    fs::create_dir_all(&out_dir)?;
    for (index, asset) in assets.iter().enumerate() {
        let archive = work_dir.join(&asset.name);
        check_download_url(&asset.browser_download_url, kit.policy)?;
        kit.downloader
            .download(&asset.browser_download_url, &archive, &on_bytes)
            .await?;
        verify_digest(asset, &archive)?;
        let unpacked = work_dir.join(format!("x{index}"));
        fs::create_dir_all(&unpacked)?;
        kit.extractor.extract(&archive, &unpacked).await?;
        copy_tree(&unwrap_dir(&unpacked)?, &out_dir)?;
    }
    progress(DownloadProgress {
        percent: 100.0,
        completed: total,
        total,
        phase: "extracting",
        label: ENGINE_LABEL,
    });
    Ok(DownloadedEngine {
        out_dir,
        tag: release.tag_name,
        variant,
    })
}

/// Checks the archive against GitHub's published digest when there is one.
fn verify_digest(asset: &Asset, archive: &Path) -> Result<(), BinaryError> {
    let expected = asset
        .digest
        .as_deref()
        .unwrap_or("")
        .trim_start_matches("sha256:");
    if expected.is_empty() {
        tracing::info!(target: "engine.binary", asset = asset.name.as_str(), "no published checksum");
        return Ok(());
    }
    if sha256_hex(archive)? != expected {
        tracing::error!(target: "engine.binary", asset = asset.name.as_str(), "checksum mismatch");
        return Err(BinaryError::Checksum(asset.name.clone()));
    }
    tracing::info!(target: "engine.binary", asset = asset.name.as_str(), "checksum verified");
    Ok(())
}

/// Makes sure the engine and its GPU runner sit inside the user data folder: adopts a local install or downloads one.
/// A bare server without a GPU runner still runs, so it stays usable when a later step fails.
pub async fn ensure_engine_ready<R, D, X>(
    kit: &Toolkit<'_, R, D, X>,
    platform: &Platform,
    user_data: &Path,
    vram_gb: f64,
    nvidia: bool,
    progress: &(dyn Fn(DownloadProgress) + Sync),
) -> SetupOutcome
where
    R: CommandRunner,
    D: Downloader,
    X: Extractor,
{
    let llama_dir = platform.engine_dir(user_data);
    let ready = |state: EngineState| SetupOutcome::Ready {
        binary_path: state.binary_path,
        runner_type: state.runner_type,
    };
    let state = engine_state(platform, &llama_dir, vram_gb, nvidia);
    if state.complete {
        return ready(state);
    }

    let stage_dir = PathBuf::from(format!("{}.staging", llama_dir.display()));
    if let Err(error) = remove_tree(&stage_dir) {
        return SetupOutcome::NotReady {
            error: error.to_string(),
        };
    }
    let result = run_setup(
        kit, platform, &llama_dir, &stage_dir, vram_gb, nvidia, progress,
    )
    .await;
    let outcome = match result {
        Ok(()) => {
            let state = engine_state(platform, &llama_dir, vram_gb, nvidia);
            tracing::info!(target: "engine.binary", runner = state.runner_type, "engine ready");
            ready(state)
        }
        Err(error) => {
            tracing::error!(target: "engine.binary", error = %error, "engine setup failed");
            // A bare server without a GPU runner still runs, so it stays usable.
            let state = engine_state(platform, &llama_dir, vram_gb, nvidia);
            if state.present {
                ready(state)
            } else {
                SetupOutcome::NotReady {
                    error: error.to_string(),
                }
            }
        }
    };
    if let Err(error) = remove_tree(&stage_dir) {
        tracing::warn!(target: "engine.binary", kind = ?error.kind(), "staging folder not removed");
    }
    outcome
}

async fn run_setup<R, D, X>(
    kit: &Toolkit<'_, R, D, X>,
    platform: &Platform,
    llama_dir: &Path,
    stage_dir: &Path,
    vram_gb: f64,
    nvidia: bool,
    progress: &(dyn Fn(DownloadProgress) + Sync),
) -> Result<(), BinaryError>
where
    R: CommandRunner,
    D: Downloader,
    X: Extractor,
{
    let now = (kit.clock)();
    let installed_at = iso_from_ms(now);
    let mut meta = Map::new();
    let staged_root = match adopt_local_engine(platform, llama_dir, stage_dir)? {
        Some(source) => {
            meta.insert("variant".to_owned(), Value::from("adopted"));
            meta.insert("installedAt".to_owned(), Value::from(installed_at));
            meta.insert(
                "source".to_owned(),
                Value::from(source.to_string_lossy().into_owned()),
            );
            stage_dir.to_path_buf()
        }
        None => {
            tracing::info!(target: "engine.binary", "no local engine to adopt, downloading a prebuilt release");
            let profile = gpu_profile(kit.runner, vram_gb, nvidia).await;
            let downloaded =
                download_engine(kit, platform, stage_dir, profile, None, progress).await?;
            meta.insert("tag".to_owned(), Value::from(downloaded.tag));
            meta.insert("variant".to_owned(), Value::from(downloaded.variant));
            meta.insert("installedAt".to_owned(), Value::from(installed_at));
            downloaded.out_dir
        }
    };
    if !staged_root.join(platform.server_name()).exists() {
        return Err(BinaryError::Incomplete);
    }
    write_engine_meta(&staged_root, &meta);
    install_staged(platform, &staged_root, llama_dir, false)?;
    Ok(())
}

/// The UTC time as the reference writes it: "2026-09-24T12:00:00.000Z".
pub fn iso_from_ms(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .map(|time| time.to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_default()
}

/// Milliseconds since the epoch for an RFC 3339 time, or None. Anything JavaScript's `Date.parse` takes beyond that is not read.
pub fn ms_from_iso(text: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|time| time.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> Asset {
        Asset {
            name: name.to_owned(),
            ..Asset::default()
        }
    }

    #[test]
    fn variant_and_build_are_read_from_the_names() {
        assert_eq!(variant_of("llama-b9-bin-win-vulkan-x64.zip"), "vulkan");
        assert_eq!(variant_of("llama-b9-bin-ubuntu-x64.tar.gz"), "cpu");
        assert_eq!(variant_of("llama-b9-bin-macos-arm64.tar.gz"), "metal");
        assert_eq!(
            variant_of("llama-b9-bin-ubuntu-cuda-12.8-x64.tar.gz"),
            "cuda-12.8"
        );
        assert_eq!(build_number("b11146"), 11146);
        assert_eq!(build_number("v0.5.0"), 0);
    }

    #[test]
    fn a_build_is_explained_in_a_few_words() {
        let cpu = GpuProfile {
            vram_gb: 0.0,
            nvidia: false,
            cuda13: false,
        };
        assert!(why_picked(&cpu, Some("cpu")).contains("no gpu memory"));
        let blackwell = GpuProfile {
            vram_gb: 8.0,
            nvidia: true,
            cuda13: true,
        };
        assert!(why_picked(&blackwell, Some("cuda-13.1")).contains("cuda 13"));
        let old = GpuProfile {
            vram_gb: 8.0,
            nvidia: true,
            cuda13: false,
        };
        assert!(why_picked(&old, Some("cuda-12.4")).contains("cuda 12"));
        let amd = GpuProfile {
            vram_gb: 8.0,
            nvidia: false,
            cuda13: false,
        };
        assert!(why_picked(&amd, Some("vulkan")).contains("vulkan"));
    }

    #[test]
    fn gpu_rocm_takes_the_rocm_archive_only_when_on() {
        let assets: Vec<Asset> = [
            "llama-b1-bin-ubuntu-vulkan-x64.tar.gz",
            "llama-b1-bin-ubuntu-rocm-10.0-x64.tar.gz",
        ]
        .into_iter()
        .map(asset)
        .collect();
        let amd = GpuProfile {
            vram_gb: 16.0,
            nvidia: false,
            cuda13: false,
        };
        let name = |options| {
            pick_release_assets_with(Os::Linux, Arch::X64, &assets, &amd, options)
                .main
                .map(|a| a.name.as_str())
        };
        assert_eq!(
            name(RunnerOptions::default()),
            Some("llama-b1-bin-ubuntu-vulkan-x64.tar.gz")
        );
        assert_eq!(
            name(RunnerOptions { rocm: true }),
            Some("llama-b1-bin-ubuntu-rocm-10.0-x64.tar.gz")
        );
    }

    #[test]
    fn the_rocm_archive_is_picked_only_where_one_exists() {
        let assets: Vec<Asset> = [
            "llama-b1-bin-win-cpu-x64.zip",
            "llama-b1-bin-win-rocm-10.0-x64.zip",
            "llama-b1-bin-ubuntu-rocm-10.0-x64.tar.gz",
        ]
        .into_iter()
        .map(asset)
        .collect();
        let name = |os, arch| pick_rocm_asset(os, arch, &assets).map(|a| a.name.as_str());
        assert_eq!(
            name(Os::Windows, Arch::X64),
            Some("llama-b1-bin-win-rocm-10.0-x64.zip")
        );
        assert_eq!(
            name(Os::Linux, Arch::X64),
            Some("llama-b1-bin-ubuntu-rocm-10.0-x64.tar.gz")
        );
        assert_eq!(name(Os::Linux, Arch::Arm64), None);
        assert_eq!(name(Os::MacOs, Arch::Arm64), None);
    }

    #[test]
    fn windows_takes_cuda_with_its_runtime_only_with_a_driver() {
        let assets: Vec<Asset> = [
            "llama-b1-bin-win-cpu-x64.zip",
            "llama-b1-bin-win-vulkan-x64.zip",
            "llama-b1-bin-win-cuda-12.4-x64.zip",
            "cudart-llama-bin-win-cuda-12.4-x64.zip",
        ]
        .into_iter()
        .map(asset)
        .collect();
        let with = GpuProfile {
            vram_gb: 8.0,
            nvidia: true,
            cuda13: false,
        };
        let picked = pick_release_assets(Os::Windows, Arch::X64, &assets, &with);
        assert_eq!(
            picked.main.map(|a| a.name.as_str()),
            Some("llama-b1-bin-win-cuda-12.4-x64.zip")
        );
        assert_eq!(
            picked.extra.map(|a| a.name.as_str()),
            Some("cudart-llama-bin-win-cuda-12.4-x64.zip")
        );
        assert_eq!(picked.variant.as_deref(), Some("cuda-12.4"));
        let without = GpuProfile {
            vram_gb: 8.0,
            nvidia: false,
            cuda13: false,
        };
        let picked = pick_release_assets(Os::Windows, Arch::X64, &assets, &without);
        assert!(picked.main.is_some_and(|a| a.name.contains("vulkan")));
    }

    #[test]
    fn a_missing_archive_gives_no_variant() {
        let picked = pick_release_assets(
            Os::MacOs,
            Arch::X64,
            &[],
            &GpuProfile {
                vram_gb: 0.0,
                nvidia: false,
                cuda13: false,
            },
        );
        assert_eq!(picked, Picked::default());
    }

    #[test]
    fn iso_times_round_trip_in_the_reference_format() {
        assert_eq!(iso_from_ms(1_000), "1970-01-01T00:00:01.000Z");
        assert_eq!(ms_from_iso("1970-01-01T00:00:01.000Z"), Some(1_000));
        assert_eq!(ms_from_iso("not a date"), None);
    }
}
