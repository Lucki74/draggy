//! The local engine as the shells drive it: start `llama-server` on a model file, read its state, stop it.
//!
//! The launch decisions (arguments, window size, port, health wait, failure wording) live in `draggy-engine`. This
//! file only supplies the real process runner and health probe, and flattens the result for the boundary.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use draggy_engine::command::ProcessRunner;
use draggy_engine::cpu_topology;
use draggy_engine::llama_health::{HttpProbe, SystemClock};
use draggy_engine::llama_process::{Host, LlamaSupervisor, LoadWatch, StartRequest};
use draggy_engine::platform::Os;

use crate::error::CoreError;
use crate::load_stage::{LoadObserver, LoadStageRecord, LoadTracker};

/// A server that is up.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct EngineInfo {
    /// The OpenAI-compatible base, such as `http://127.0.0.1:8080/v1`.
    pub base_url: String,
    /// The model name the server answers to: the model file's name.
    pub model: String,
    /// The window the server runs at. None when a server that was already running was adopted.
    pub context_tokens: Option<u64>,
    /// Whether the model's vision projector was refused, so images will not work.
    pub projector_refused: bool,
}

/// What the engine is doing now.
#[derive(uniffi::Record, Debug, Clone, PartialEq, Eq)]
pub struct EngineState {
    pub running: bool,
    pub base_url: String,
    pub model: Option<String>,
    pub context_tokens: u64,
}

/// How the machine looks to the launch. The shell knows the figures the OS gives best (unified memory on a Mac).
#[derive(uniffi::Record, Debug, Clone, PartialEq)]
pub struct EngineHost {
    pub total_ram_bytes: u64,
    /// Memory the GPU may use, in GiB. 0 sizes the launch for the CPU.
    pub gpu_memory_gb: f64,
}

/// Bytes of RAM the process holds, or None when the system will not say.
fn resident_bytes(pid: u32) -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let statm = std::fs::read_to_string(format!("/proc/{pid}/statm")).ok()?;
        let pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
        Some(pages * 4096)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let args = ["-o", "rss=", "-p", &pid.to_string()].map(String::from);
        let out = draggy_tools::spawn::output_blocking("ps", &args).ok()?;
        let kib: u64 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
        Some(kib * 1024)
    }
}

/// Feeds one load's lines and RAM share to a tracker and passes the steps on to the shell.
#[derive(Debug)]
struct LoadFeed {
    tracker: Mutex<LoadTracker>,
    observer: Arc<dyn LoadObserver>,
    clock: Instant,
    done: AtomicBool,
    pid: AtomicU32,
}

impl std::fmt::Debug for dyn LoadObserver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LoadObserver")
    }
}

impl LoadFeed {
    fn emit(&self, record: Option<LoadStageRecord>) {
        if let Some(record) = record {
            self.observer.on_stage(record);
        }
    }

    fn tracker(&self) -> std::sync::MutexGuard<'_, LoadTracker> {
        self.tracker
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl LoadWatch for LoadFeed {
    fn spawned(&self, pid: u32) {
        self.pid.store(pid, Ordering::SeqCst);
        let first = self.tracker().spawned();
        self.emit(first);
    }

    fn line(&self, line: &str) {
        let now = u64::try_from(self.clock.elapsed().as_millis()).unwrap_or(u64::MAX);
        let record = self.tracker().line(line, now);
        self.emit(record);
    }
}

#[derive(uniffi::Object)]
pub struct LocalEngine {
    supervisor: LlamaSupervisor<HttpProbe, SystemClock, ProcessRunner>,
}

fn host_os() -> Os {
    if cfg!(target_os = "macos") {
        Os::MacOs
    } else if cfg!(target_os = "windows") {
        Os::Windows
    } else {
        Os::Linux
    }
}

fn engine_error(message: impl Into<String>) -> CoreError {
    CoreError::Engine {
        message: message.into(),
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl LocalEngine {
    #[uniffi::constructor]
    pub fn new(host: EngineHost) -> Self {
        let logical = std::thread::available_parallelism().map_or(1, usize::from);
        // The physical count is unknown here, so the launch sizes its threads from the logical one.
        let topology = cpu_topology::from_counts(logical, 0);
        let host = Host {
            os: host_os(),
            topology,
            total_ram_bytes: host.total_ram_bytes,
            inherited_env: std::env::vars().collect(),
        };
        Self {
            supervisor: LlamaSupervisor::new(HttpProbe, SystemClock::new(), ProcessRunner, host),
        }
    }

    /// Starts `model` (a GGUF file) with the `llama-server` binary at `binary`, and waits until it answers. Starting
    /// the same model again joins the load that is under way; another model replaces the one running. `observer`
    /// hears the load's steps.
    pub async fn start(
        &self,
        binary: String,
        model: String,
        context_tokens: Option<u64>,
        gpu_memory_gb: f64,
        observer: Option<Arc<dyn LoadObserver>>,
    ) -> Result<EngineInfo, CoreError> {
        if binary.trim().is_empty() || model.trim().is_empty() {
            return Err(CoreError::Invalid {
                message: "Starting the engine needs the engine program and a model file."
                    .to_owned(),
            });
        }
        let model_path = PathBuf::from(&model);
        let mut request = StartRequest::new(binary, model_path.clone());
        request.context = context_tokens;
        request.vram_gb = gpu_memory_gb;
        let before = self.supervisor.status();
        let extending = before.running
            && before.model.as_deref() == Some(model_path.as_path())
            && context_tokens.is_some_and(|window| window > before.context_size);
        let feed = observer.map(|observer| {
            let name = model_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let bytes = std::fs::metadata(&model_path).map_or(0, |meta| meta.len());
            Arc::new(LoadFeed {
                tracker: Mutex::new(LoadTracker::new(name, bytes, extending)),
                observer,
                clock: Instant::now(),
                done: AtomicBool::new(false),
                pid: AtomicU32::new(0),
            })
        });
        if let Some(feed) = &feed {
            request.load_watch = Some(feed.clone());
            let poll = Arc::clone(feed);
            tokio::spawn(async move {
                while !poll.done.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    let pid = poll.pid.load(Ordering::SeqCst);
                    if pid == 0 {
                        continue;
                    }
                    let bytes = tokio::task::spawn_blocking(move || resident_bytes(pid))
                        .await
                        .ok()
                        .flatten();
                    if let Some(bytes) = bytes {
                        let record = poll.tracker().resident(bytes);
                        poll.emit(record);
                    }
                }
            });
        }
        let started = self.supervisor.start(request).await;
        if let Some(feed) = &feed {
            feed.done.store(true, Ordering::SeqCst);
        }
        let started = started.map_err(|failure| engine_error(failure.error))?;
        let status = self.supervisor.status();
        Ok(EngineInfo {
            base_url: status.base_url,
            model: model_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or(model),
            context_tokens: started.context_size,
            projector_refused: started.projector_refused,
        })
    }

    /// Stops the server, if one is running.
    pub async fn stop(&self) {
        self.supervisor.stop().await;
    }

    pub fn state(&self) -> EngineState {
        let status = self.supervisor.status();
        EngineState {
            running: status.running,
            base_url: status.base_url,
            model: status.model.as_deref().map(|path| {
                path.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default()
            }),
            context_tokens: status.context_size,
        }
    }
}
