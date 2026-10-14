//! Starts, watches and stops the llama-server process, with the launch order and the fallbacks for a refused projector or draft.
//! Process starts go through `draggy_tools::spawn`; health and time are injected. Port of electron/llamaProcess.cjs.

use std::collections::{BTreeMap, VecDeque};
use std::fs::{self, File};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use draggy_models::draft_model::Drafts;
use draggy_models::gguf::read_header;
use draggy_models::mmproj::Projectors;
use draggy_models::shards::{parse_shard, shard_names};
use draggy_tools::spawn::{kill_tree, spawn_hidden};
use regex::Regex;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::watch;

use crate::binary_manager::EngineEnvironment;
use crate::command::CommandRunner;
use crate::cpu_topology::CpuTopology;
use crate::failure::classify_failure;
use crate::llama_args::{
    DEFAULT_CONTEXT, DraftCandidate, HeaderFacts, LaunchInput, ModelTraits, MoeStream, Speculation,
    build_env, determine_kv_cache, plan_launch, ready_timeout_ms, requested_context, serves_window,
};
use crate::llama_draft_stats::{self, DraftSettings};
use crate::llama_flags::{FlagCache, engine_flags};
use crate::llama_health::{Clock, HealthProbe, same_model_file, wait_for_ready};
use crate::llama_output::{Signal, failure_reason, read_line};
use crate::platform::Os;

/// The port a server listens on when the caller names none.
pub const DEFAULT_PORT: u16 = 11435;
/// The last stderr lines the reply's failure is worked out from.
const RECENT_LINES: usize = 40;
/// The longer tail kept for the crash block in the log.
const RING_LINES: usize = 200;
/// How long a check for a server already on the port may take.
const PORT_CHECK: Duration = Duration::from_millis(1000);

static PROJECTOR_REFUSED: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)multimodal|mmproj|clip_init|mtmd").ok());
static DRAFT_REFUSED: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?i)draft|speculative").ok());

type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// The machine the server runs on, as the launch reads it: the OS, the cores, the RAM and the environment it inherits.
#[derive(Debug, Clone)]
pub struct Host {
    pub os: Os,
    pub topology: CpuTopology,
    pub total_ram_bytes: u64,
    pub inherited_env: Vec<(String, String)>,
}

/// One request to start a model: where its engine and model are, and how the launch is to be sized.
#[derive(Debug, Clone)]
pub struct StartRequest {
    pub binary: PathBuf,
    pub model: PathBuf,
    /// The window the caller asks for; None lets the running model's window stand.
    pub context: Option<u64>,
    pub port: Option<u16>,
    pub gpu_layers: Option<i64>,
    pub user_data: Option<PathBuf>,
    pub vram_gb: f64,
    /// The GPU backend the engine resolved, which sizes the launch. Ignored without a user-data folder. With one, the
    /// caller must pass it: without it the launch runs with no engine environment and no runner type.
    pub engine: Option<EngineEnvironment>,
    pub skip_projector: bool,
    pub skip_draft: bool,
    pub threads: Option<i64>,
    pub speculative: bool,
    pub exact_context: bool,
    pub moe_stream: Option<MoeStream>,
}

impl StartRequest {
    /// A request with the reference's defaults: speculation on, no GPU layer count, no forced window.
    pub fn new(binary: impl Into<PathBuf>, model: impl Into<PathBuf>) -> Self {
        Self {
            binary: binary.into(),
            model: model.into(),
            context: None,
            port: None,
            gpu_layers: None,
            user_data: None,
            vram_gb: 0.0,
            engine: None,
            skip_projector: false,
            skip_draft: false,
            threads: None,
            speculative: true,
            exact_context: false,
            moe_stream: None,
        }
    }
}

/// A server that is up: its port, the window it runs at (None when the server was adopted rather than started), and
/// whether the caller has to know its projector was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Started {
    pub port: u16,
    pub context_size: Option<u64>,
    pub already_running: bool,
    pub projector_refused: bool,
}

/// Why a start did not produce a server. The kind is what the app words for the reader.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    PartsMissing,
    PortInUse,
    EngineMissing,
    StoppedLoading,
    AnotherModel,
    LoadTimeout,
}

impl FailureKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PartsMissing => "parts-missing",
            Self::PortInUse => "port-in-use",
            Self::EngineMissing => "engine-missing",
            Self::StoppedLoading => "stopped-loading",
            Self::AnotherModel => "another-model",
            Self::LoadTimeout => "load-timeout",
        }
    }
}

/// A start that failed: its kind, the English message, and the values the app words its own message from.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{error}")]
pub struct StartFailure {
    pub kind: FailureKind,
    pub error: String,
    pub params: BTreeMap<&'static str, String>,
}

pub type StartResult = Result<Started, StartFailure>;

/// Layers of the model on the GPU, from the engine's load log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Offload {
    pub layers: u64,
    pub total: u64,
}

/// What the supervisor reports about the server it holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
    pub model: Option<PathBuf>,
    pub context_size: u64,
    pub offload: Option<Offload>,
    pub speculation: Speculation,
    pub base_url: String,
}

/// How a server process ended: its exit code, or the name of the signal that ended it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Exit {
    code: Option<i32>,
    signal: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stream {
    Out,
    Err,
}

/// What the output reader needs to say about a line: the model, the folder, and whether drafting is on.
#[derive(Debug, Clone)]
struct Watch {
    model: PathBuf,
    user_data: Option<PathBuf>,
    drafting: bool,
    moe: bool,
}

/// One spawned server. Its state is shared with the tasks that read its output and watch its exit.
#[derive(Debug, Clone)]
struct Run {
    id: u64,
    pid: Option<u32>,
    /// Set once the process has exited, whoever stopped it.
    exit: Arc<Mutex<Option<Exit>>>,
    /// Set only when the process exited while it was still the one the supervisor holds, as the reference's crashed.
    crashed: Arc<Mutex<Option<Exit>>>,
    healthy: Arc<AtomicBool>,
    recent: Arc<Mutex<VecDeque<String>>>,
    ring: Arc<Mutex<VecDeque<String>>>,
    watch: Watch,
}

/// A start that is still loading weights, so a second request for the same model joins it.
struct Starting {
    id: u64,
    model: PathBuf,
    context: u64,
    results: watch::Sender<Option<StartResult>>,
}

struct State {
    process: Option<Run>,
    model: Option<PathBuf>,
    port: u16,
    context: u64,
    offload: Option<Offload>,
    speculation: Speculation,
    starting: Option<Starting>,
    next_id: u64,
}

impl State {
    fn new() -> Self {
        Self {
            process: None,
            model: None,
            port: DEFAULT_PORT,
            context: DEFAULT_CONTEXT,
            offload: None,
            speculation: Speculation::Off,
            starting: None,
            next_id: 0,
        }
    }
}

struct Inner<P, C, R> {
    probe: P,
    clock: C,
    runner: R,
    host: Host,
    flags: FlagCache,
    projectors: Mutex<Projectors>,
    drafts: Mutex<Drafts>,
    state: Mutex<State>,
    crashes: AtomicU64,
}

/// Frees a start's slot however the start ends, so a start dropped mid-load does not leave later ones waiting on it.
struct StartSlot<P, C, R> {
    inner: Arc<Inner<P, C, R>>,
    id: u64,
}

impl<P, C, R> Drop for StartSlot<P, C, R> {
    fn drop(&mut self) {
        let mut state = lock(&self.inner.state);
        if state
            .starting
            .as_ref()
            .is_some_and(|start| start.id == self.id)
        {
            state.starting = None;
        }
    }
}

/// Holds at most one llama-server. Starting another model stops the one running, and a second request for a model
/// that is loading waits for that load instead of starting it again.
pub struct LlamaSupervisor<P, C, R> {
    inner: Arc<Inner<P, C, R>>,
}

impl<P, C, R> Clone for LlamaSupervisor<P, C, R> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn model_dir(model: &Path) -> PathBuf {
    model
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
}

fn file_len(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|meta| meta.len())
}

/// The model's size, and what its header says. A file that cannot be read has no size and no traits.
fn facts(model: &Path) -> (Option<u64>, ModelTraits) {
    let Ok(meta) = fs::metadata(model) else {
        return (None, ModelTraits::default());
    };
    let header = File::open(model)
        .ok()
        .and_then(|mut file| read_header(&mut file).ok());
    let facts = header.as_ref().map(HeaderFacts::from);
    (
        Some(meta.len()),
        ModelTraits::from_facts(facts.as_ref(), &file_name(model)),
    )
}

/// The parts of a split model the folder lacks, with the number of parts it has. None for a single file or a
/// complete split.
fn missing_parts(model: &Path) -> Option<(usize, Vec<String>)> {
    let name = file_name(model);
    parse_shard(&name)?;
    let names = shard_names(&name);
    let dir = model_dir(model);
    let missing: Vec<String> = names
        .iter()
        .filter(|part| !dir.join(part).exists())
        .cloned()
        .collect();
    (!missing.is_empty()).then_some((names.len(), missing))
}

fn parts_missing(base: &str, total: usize, missing: &[String]) -> StartFailure {
    let list = missing.join(", ");
    let verb = if missing.len() == 1 { "is" } else { "are" };
    StartFailure {
        kind: FailureKind::PartsMissing,
        error: format!(
            "{base} is one of {total} parts and {count} {verb} missing ({list}). Delete it and download the model again to get every part.",
            count = missing.len()
        ),
        params: BTreeMap::from([("model", base.to_owned()), ("parts", list)]),
    }
}

fn port_taken(port: u16, served: &str, base: &str) -> StartFailure {
    let served_name = file_name(Path::new(&served.replace('\\', "/")));
    StartFailure {
        kind: FailureKind::PortInUse,
        error: format!("Port {port} is held by another engine serving {served_name}, not {base}."),
        params: BTreeMap::from([("model", base.to_owned())]),
    }
}

fn another_model() -> StartFailure {
    StartFailure {
        kind: FailureKind::AnotherModel,
        error: "Another model was started before this one finished loading".to_owned(),
        params: BTreeMap::new(),
    }
}

/// The failure for a binary that did not start: a missing one is named as such, anything else is the system's reason.
fn spawn_failure(base: &str, binary: &Path, error: &std::io::Error) -> StartFailure {
    if error.kind() == std::io::ErrorKind::NotFound {
        return StartFailure {
            kind: FailureKind::EngineMissing,
            error: "llama-server binary not found".to_owned(),
            params: BTreeMap::from([("model", base.to_owned())]),
        };
    }
    let code = errno_code(error);
    let reason = if code.is_empty() {
        error.to_string()
    } else {
        format!("spawn {} {code}", binary.display())
    };
    StartFailure {
        kind: FailureKind::StoppedLoading,
        error: format!("The model engine could not start for {base}: {reason}"),
        params: BTreeMap::from([
            ("model", base.to_owned()),
            ("code", code),
            ("reason", reason),
            ("log", String::new()),
        ]),
    }
}

/// The errno name the reference reads off a failed spawn, such as EACCES or ENOEXEC; empty when the OS gave none.
#[cfg(unix)]
fn errno_code(error: &std::io::Error) -> String {
    let Some(number) = error.raw_os_error() else {
        return String::new();
    };
    match nix::errno::Errno::from_raw(number) {
        nix::errno::Errno::UnknownErrno => "UNKNOWN".to_owned(),
        known => format!("{known:?}"),
    }
}

#[cfg(not(unix))]
fn errno_code(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => "EACCES".to_owned(),
        _ => String::new(),
    }
}

fn engine_of(request: &StartRequest) -> Option<&EngineEnvironment> {
    if request.user_data.is_some() {
        request.engine.as_ref()
    } else {
        None
    }
}

fn runner_name(request: &StartRequest) -> Option<&'static str> {
    engine_of(request).map(|engine| engine.runner_type)
}

fn is_current<P, C, R>(inner: &Inner<P, C, R>, id: u64) -> bool {
    lock(&inner.state)
        .process
        .as_ref()
        .is_some_and(|run| run.id == id)
}

fn is_alive<P, C, R>(inner: &Inner<P, C, R>, id: u64) -> bool {
    lock(&inner.state)
        .process
        .as_ref()
        .is_some_and(|run| run.id == id && lock(&run.exit).is_none())
}

fn snapshot(lines: &Mutex<VecDeque<String>>) -> Vec<String> {
    lock(lines).iter().cloned().collect()
}

/// The name of the signal that ended a process, as the reference prints it. Only Unix has signals.
#[cfg(unix)]
fn signal_name(status: &impl std::os::unix::process::ExitStatusExt) -> Option<String> {
    let number = status.signal()?;
    Some(
        nix::sys::signal::Signal::try_from(number)
            .map_or_else(|_| number.to_string(), |signal| signal.as_str().to_owned()),
    )
}

#[cfg(not(unix))]
fn signal_name<T>(_status: &T) -> Option<String> {
    None
}

fn describe(value: Option<i32>, signal: Option<&String>) -> String {
    match (value, signal) {
        (Some(code), _) => code.to_string(),
        (None, Some(name)) => name.clone(),
        (None, None) => "null".to_owned(),
    }
}

impl<P, C, R> LlamaSupervisor<P, C, R>
where
    P: HealthProbe,
    C: Clock,
    R: CommandRunner + Send + 'static,
{
    pub fn new(probe: P, clock: C, runner: R, host: Host) -> Self {
        Self {
            inner: Arc::new(Inner {
                probe,
                clock,
                runner,
                host,
                flags: FlagCache::new(),
                projectors: Mutex::new(Projectors::new()),
                drafts: Mutex::new(Drafts::new()),
                state: Mutex::new(State::new()),
                crashes: AtomicU64::new(0),
            }),
        }
    }

    /// Starts the model, or joins a start of the same model that is already loading. The caller's engine decides the
    /// GPU backend; this decides the arguments, the port, and what happens when the process does not come up.
    pub async fn start(&self, request: StartRequest) -> StartResult {
        let inner = &self.inner;
        let model = request.model.clone();
        let (bytes, traits) = facts(&model);
        let runner = runner_name(&request);
        let requested = {
            let state = lock(&inner.state);
            let starting = state
                .starting
                .as_ref()
                .filter(|start| start.model == model)
                .map(|start| start.context);
            let running = (state.process.is_some()
                && state.model.as_deref() == Some(model.as_path()))
            .then_some(state.context);
            requested_context(request.context, starting, running)
        };
        let effective = determine_kv_cache(
            bytes,
            requested,
            request.vram_gb,
            &traits,
            request.exact_context,
            runner,
        )
        .effective_context;

        let joined = {
            let state = lock(&inner.state);
            state
                .starting
                .as_ref()
                .filter(|start| {
                    start.model == model
                        && serves_window(start.context, effective, request.exact_context)
                })
                .map(|start| start.results.subscribe())
        };
        if let Some(mut results) = joined {
            return await_result(&mut results).await;
        }

        let (results, _) = watch::channel::<Option<StartResult>>(None);
        let id = {
            let mut state = lock(&inner.state);
            state.next_id += 1;
            let id = state.next_id;
            state.starting = Some(Starting {
                id,
                model: model.clone(),
                context: effective,
                results: results.clone(),
            });
            id
        };
        let slot = StartSlot {
            inner: Arc::clone(inner),
            id,
        };
        let outcome = launch(Arc::clone(inner), request, requested).await;
        drop(slot);
        results.send_replace(Some(outcome.clone()));
        outcome
    }

    /// Stops the server, if one is running, and waits for the kill to be sent.
    pub async fn stop(&self) {
        stop_now(&self.inner).await;
    }

    /// The server's state. The port and window are the last ones used, as the reference keeps them after a stop.
    pub fn status(&self) -> ServerStatus {
        let state = lock(&self.inner.state);
        ServerStatus {
            running: state
                .process
                .as_ref()
                .is_some_and(|run| lock(&run.exit).is_none()),
            port: state.port,
            model: state.model.clone(),
            context_size: state.context,
            offload: state.offload,
            speculation: state.speculation,
            base_url: format!("http://127.0.0.1:{}/v1", state.port),
        }
    }

    /// How many servers died after they had loaded. The caller reports these in its diagnostics.
    pub fn engine_crashes(&self) -> u64 {
        self.inner.crashes.load(Ordering::SeqCst)
    }
}

async fn await_result(results: &mut watch::Receiver<Option<StartResult>>) -> StartResult {
    let finished = results
        .wait_for(Option::is_some)
        .await
        .ok()
        .and_then(|value| (*value).clone());
    finished.unwrap_or_else(|| Err(another_model()))
}

/// Adopts a server already on the port when it is ours to adopt, and refuses one that holds another model. None when
/// nothing answers on the port, or when this supervisor already holds a process of its own.
async fn existing_on_port<P, C, R>(
    inner: &Inner<P, C, R>,
    port: u16,
    model: &Path,
) -> Option<StartResult>
where
    P: HealthProbe,
{
    if !inner.probe.healthy(port, PORT_CHECK).await {
        return None;
    }
    let base = file_name(model);
    let served = inner.probe.served_model(port, PORT_CHECK).await;
    if let Some(served) = served.filter(|served| !same_model_file(served, &model.to_string_lossy()))
    {
        tracing::warn!(target: "engine.llama", port, served = %served, "port held by another model");
        return Some(Err(port_taken(port, &served, &base)));
    }
    {
        let mut state = lock(&inner.state);
        if state.process.is_some() {
            return None;
        }
        state.model = Some(model.to_path_buf());
        state.port = port;
    }
    tracing::info!(target: "engine.llama", port, "adopting external server");
    Some(Ok(Started {
        port,
        context_size: None,
        already_running: false,
        projector_refused: false,
    }))
}

/// Stops the running server, if any. Its state is cleared at once; the kill is sent before this returns.
async fn stop_now<P, C, R>(inner: &Inner<P, C, R>) {
    let run = {
        let mut state = lock(&inner.state);
        let Some(run) = state.process.take() else {
            return;
        };
        state.model = None;
        run
    };
    tracing::info!(target: "engine.llama", pid = ?run.pid, "terminating server");
    let exited = lock(&run.exit).is_some();
    if let Some(pid) = run.pid {
        kill_tree(pid, exited).await;
    }
    tracing::info!(target: "engine.llama", "server process tree terminated");
}

/// One attempt at a launch. A refused projector or draft is retried without it, once.
fn launch<P, C, R>(
    inner: Arc<Inner<P, C, R>>,
    request: StartRequest,
    requested: u64,
) -> BoxFuture<StartResult>
where
    P: HealthProbe,
    C: Clock,
    R: CommandRunner + Send + 'static,
{
    Box::pin(launch_once(inner, request, requested))
}

async fn launch_once<P, C, R>(
    inner: Arc<Inner<P, C, R>>,
    request: StartRequest,
    requested: u64,
) -> StartResult
where
    P: HealthProbe,
    C: Clock,
    R: CommandRunner + Send + 'static,
{
    let model = request.model.clone();
    let base = file_name(&model);
    let port = request.port.unwrap_or(DEFAULT_PORT);
    let dir = model_dir(&model);

    // llama-server opens the other parts itself and exits at once when one is absent.
    if let Some((total, missing)) = missing_parts(&model) {
        tracing::error!(target: "engine.llama", missing = %missing.join(", "), "split model incomplete");
        return Err(parts_missing(&base, total, &missing));
    }

    let (bytes, traits) = facts(&model);
    let runner = runner_name(&request);
    let exact = request.exact_context;
    let kv = determine_kv_cache(bytes, requested, request.vram_gb, &traits, exact, runner);

    let reusable = {
        let state = lock(&inner.state);
        state.process.is_some()
            && state.model.as_deref() == Some(model.as_path())
            && serves_window(state.context, kv.effective_context, exact)
    };
    if reusable && inner.probe.healthy(port, PORT_CHECK).await {
        tracing::info!(target: "engine.llama", port, "reusing running instance");
        let projector_refused = lock(&inner.projectors).was_refused(&dir, &base);
        let context = lock(&inner.state).context;
        return Ok(Started {
            port,
            context_size: Some(context),
            already_running: true,
            projector_refused,
        });
    }
    if lock(&inner.state).process.is_some() {
        tracing::info!(target: "engine.llama", "stopping previous instance before starting new model");
        stop_now(&inner).await;
    }
    if let Some(result) = existing_on_port(&inner, port, &model).await {
        return result;
    }

    let mut overrides = engine_of(&request)
        .map(|engine| engine.env.clone())
        .unwrap_or_default();
    overrides.extend([
        ("LLAMA_ARG_FLASH_ATTN".to_owned(), "on".to_owned()),
        (
            "LLAMA_ARG_CACHE_TYPE_K".to_owned(),
            kv.cache_type.to_owned(),
        ),
        (
            "LLAMA_ARG_CACHE_TYPE_V".to_owned(),
            kv.cache_type.to_owned(),
        ),
    ]);
    let engine_env = build_env(&inner.host.inherited_env, &overrides);
    let flags = engine_flags(
        &inner.runner,
        &inner.flags,
        &request.binary,
        &engine_env,
        request.user_data.as_deref(),
    )
    .await;
    let supports = |flag: &str| flags.as_ref().is_some_and(|set| set.contains(flag));

    let draft_companion = if request.skip_draft {
        None
    } else {
        lock(&inner.drafts).find_companion_draft(&dir, &base)
    };
    let tuning = llama_draft_stats::draft_settings(request.user_data.as_deref(), &model);
    let draft_path = draft_companion.clone().filter(|_| tuning.enabled);
    if draft_companion.is_some() && !tuning.enabled {
        log_draft_off(&base, &tuning);
    }
    let projector = if request.skip_projector {
        None
    } else {
        lock(&inner.projectors).find_companion(&dir, &base)
    };

    let model_text = model.to_string_lossy().into_owned();
    let draft_text = draft_path
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    let projector_text = projector
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    let draft = draft_text.as_deref().map(|path| DraftCandidate {
        path,
        bytes: draft_path.as_deref().and_then(file_len),
        max: Some(tuning.max),
    });
    let plan = plan_launch(
        &LaunchInput {
            model: &model_text,
            model_bytes: bytes,
            traits: &traits,
            context: requested,
            exact_context: exact,
            vram_gb: request.vram_gb,
            windows: inner.host.os == Os::Windows,
            runner,
            port,
            gpu_layers: request.gpu_layers,
            requested_threads: request.threads,
            topology: inner.host.topology,
            total_ram_bytes: inner.host.total_ram_bytes,
            speculative: request.speculative,
            draft,
            moe_stream: request.moe_stream.as_ref(),
            projector: projector_text.as_deref(),
        },
        &supports,
    );
    if plan.draft_dropped_for_fit {
        tracing::info!(target: "engine.llama", model = %base, "draft model off: it would push layers off the gpu");
    }
    if plan.stream_unsupported {
        tracing::warn!(target: "engine.llama", "expert streaming planned but this build lacks --moe-stream-cache");
    }
    tracing::info!(
        target: "engine.llama",
        model = %base,
        port,
        context = plan.context,
        kv_cache = plan.cache_type,
        gpu_layers = ?request.gpu_layers,
        runner = runner.unwrap_or("none"),
        moe = traits.moe,
        ubatch = plan.ubatch,
        threads = plan.threads,
        threads_batch = plan.threads_batch,
        speculative = plan.speculation.as_str(),
        fit_target = ?plan.fit_target,
        "starting llama-server"
    );
    tracing::debug!(target: "engine.llama", binary = %request.binary.display(), args = %plan.args.join(" "), "spawning");

    if let Some(result) = existing_on_port(&inner, port, &model).await {
        return result;
    }
    // Another start may have spawned while the awaits above ran; it is stopped here so the slot never holds two.
    loop {
        let held = lock(&inner.state).process.is_some();
        if !held {
            break;
        }
        stop_now(&inner).await;
    }

    let cwd = request
        .binary
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(Path::to_path_buf);
    let spawn_env = engine_env.clone();
    let mut child = match spawn_hidden(&request.binary, plan.args.as_slice(), |command| {
        if let Some(dir) = &cwd {
            command.current_dir(dir);
        }
        command
            .env_clear()
            .envs(spawn_env.iter().map(|(key, value)| (key, value)));
    }) {
        Ok(child) => child,
        Err(error) => {
            tracing::error!(target: "engine.llama", error = %error, "failed to spawn llama-server");
            return Err(spawn_failure(&base, &request.binary, &error));
        }
    };

    let run = {
        let mut state = lock(&inner.state);
        state.next_id += 1;
        let run = Run {
            id: state.next_id,
            pid: child.id(),
            exit: Arc::new(Mutex::new(None)),
            crashed: Arc::new(Mutex::new(None)),
            healthy: Arc::new(AtomicBool::new(false)),
            recent: Arc::new(Mutex::new(VecDeque::new())),
            ring: Arc::new(Mutex::new(VecDeque::new())),
            watch: Watch {
                model: model.clone(),
                user_data: request.user_data.clone(),
                drafting: plan.draft_in_use,
                moe: traits.moe,
            },
        };
        state.process = Some(run.clone());
        state.model = Some(model.clone());
        state.port = port;
        state.context = plan.context;
        state.offload = None;
        state.speculation = plan.speculation;
        run
    };
    if let Some(pipe) = child.stdout.take() {
        tokio::spawn(read_output(
            Arc::clone(&inner),
            pipe,
            run.clone(),
            Stream::Out,
        ));
    }
    if let Some(pipe) = child.stderr.take() {
        tokio::spawn(read_output(
            Arc::clone(&inner),
            pipe,
            run.clone(),
            Stream::Err,
        ));
    }
    let waiter = async move {
        match child.wait().await {
            Ok(status) => Exit {
                code: status.code(),
                signal: signal_name(&status),
            },
            Err(error) => {
                tracing::debug!(target: "engine.llama", error = %error, "server wait failed");
                Exit {
                    code: None,
                    signal: None,
                }
            }
        }
    };
    tokio::spawn(watch_exit(Arc::clone(&inner), run.clone(), waiter));

    let ready_start = inner.clock.elapsed_ms();
    let watched = Arc::clone(&inner);
    let run_id = run.id;
    let ready = wait_for_ready(
        &inner.probe,
        &inner.clock,
        port,
        ready_timeout_ms(bytes),
        move || is_alive(&watched, run_id),
    )
    .await;
    let waited_ms = inner.clock.elapsed_ms().saturating_sub(ready_start);

    if !ready {
        let crash = lock(&run.crashed).clone();
        if let Some(exit) = crash {
            inner.crashes.fetch_add(1, Ordering::SeqCst);
            let recent = snapshot(&run.recent);
            let recent_text = recent.join("\n");
            let reason = failure_reason(&recent);
            if let Some(projector) = projector.as_ref().filter(|_| {
                PROJECTOR_REFUSED
                    .as_ref()
                    .is_some_and(|re| re.is_match(&recent_text))
            }) {
                tracing::warn!(target: "engine.llama", model = %base, reason = %reason, "image projector refused; starting without it");
                lock(&inner.projectors).mark_refused(projector);
                let skipped = StartRequest {
                    skip_projector: true,
                    ..request.clone()
                };
                let fallback = launch(Arc::clone(&inner), skipped, requested).await;
                return fallback.map(|started| Started {
                    projector_refused: true,
                    ..started
                });
            }
            let draft_used = if plan.draft_in_use {
                draft_path.clone()
            } else {
                None
            };
            if let Some(draft) = draft_used.as_ref().filter(|_| {
                DRAFT_REFUSED
                    .as_ref()
                    .is_some_and(|re| re.is_match(&recent_text))
            }) {
                tracing::warn!(target: "engine.llama", model = %base, reason = %reason, "draft model refused; starting without it");
                lock(&inner.drafts).mark_refused(draft);
                if let Some(user_data) = &request.user_data {
                    llama_draft_stats::record_refusal(user_data, &model);
                }
                let skipped = StartRequest {
                    skip_draft: true,
                    ..request.clone()
                };
                return launch(Arc::clone(&inner), skipped, requested).await;
            }
            let lines: Vec<&str> = recent.iter().map(String::as_str).collect();
            let cause = classify_failure(&lines);
            let code = describe(exit.code, exit.signal.as_ref());
            tracing::error!(target: "engine.llama", waited_ms, reason = %reason, "llama-server stopped while loading");
            let ring: Vec<String> = snapshot(&run.ring);
            tracing::error!(
                target: "proc.engine",
                cause,
                code = %code,
                model = %base,
                stderr = %ring.join("\n"),
                "llama exited while loading"
            );
            let suffix = if reason.is_empty() {
                String::new()
            } else {
                format!(": {reason}")
            };
            return Err(StartFailure {
                kind: FailureKind::StoppedLoading,
                error: format!(
                    "The model engine stopped while loading {base} (exit code {code}){suffix}"
                ),
                params: BTreeMap::from([
                    ("model", base.clone()),
                    ("code", code),
                    ("reason", reason),
                    ("log", recent_text),
                ]),
            });
        }
        if !is_current(&inner, run.id) {
            tracing::info!(target: "engine.llama", "start abandoned: engine stopped or given another model");
            return Err(another_model());
        }
        tracing::error!(target: "engine.llama", waited_ms, "server failed health check");
        stop_now(&inner).await;
        return Err(StartFailure {
            kind: FailureKind::LoadTimeout,
            error: format!("{base} took too long to load. Try again, or choose a smaller model."),
            params: BTreeMap::from([("model", base.clone())]),
        });
    }

    run.healthy.store(true, Ordering::SeqCst);
    tracing::info!(target: "engine.llama", port, waited_ms, "llama-server ready");
    Ok(Started {
        port,
        context_size: Some(plan.context),
        already_running: false,
        projector_refused: false,
    })
}

fn log_draft_off(base: &str, tuning: &DraftSettings) {
    let percent = (tuning.rate.unwrap_or(0.0) * 100.0).round();
    tracing::info!(target: "engine.llama", model = %base, percent, "draft model off: acceptance too low to pay for itself");
}

/// Reads one pipe of the server line by line, as the reference does, and reports what each line says.
async fn read_output<P, C, R>(
    inner: Arc<Inner<P, C, R>>,
    pipe: impl AsyncRead + Unpin,
    run: Run,
    stream: Stream,
) where
    P: HealthProbe,
    C: Clock,
    R: CommandRunner + Send + 'static,
{
    let mut segments = BufReader::new(pipe).split(b'\n');
    loop {
        match segments.next_segment().await {
            Ok(Some(bytes)) => {
                let line = String::from_utf8_lossy(&bytes).trim().to_owned();
                if !line.is_empty() {
                    handle_line(&inner, &run, stream, &line);
                }
            }
            Ok(None) => break,
            Err(error) => {
                tracing::debug!(target: "engine.llama", error = %error, "server output read failed");
                break;
            }
        }
    }
}

fn handle_line<P, C, R>(inner: &Inner<P, C, R>, run: &Run, stream: Stream, line: &str) {
    tracing::debug!(
        target: "engine.llama",
        stream = if stream == Stream::Out { "out" } else { "err" },
        line,
        "server output"
    );
    if stream == Stream::Err {
        let mut recent = lock(&run.recent);
        recent.push_back(line.to_owned());
        if recent.len() > RECENT_LINES {
            recent.pop_front();
        }
        let mut ring = lock(&run.ring);
        ring.push_back(line.to_owned());
        if ring.len() > RING_LINES {
            ring.pop_front();
        }
    }
    match read_line(line) {
        Some(Signal::Offload { layers, total }) => {
            lock(&inner.state).offload = Some(Offload { layers, total });
            if layers < total && !run.watch.moe {
                tracing::warn!(
                    target: "engine.llama",
                    layers,
                    total,
                    "only some layers fit on the gpu; the rest run at system ram speed"
                );
            }
        }
        Some(Signal::PromptEvaluated { ms, tokens }) => {
            tracing::debug!(target: "engine.llama", ms, tokens, "prompt evaluated");
        }
        Some(Signal::PromptCacheReused {
            how,
            similarity,
            kept,
        }) => {
            tracing::debug!(target: "engine.llama", how = %how, similarity, kept, "prompt cache reused");
        }
        Some(Signal::DraftAcceptance(sample)) => {
            if let (true, Some(user_data)) = (run.watch.drafting, run.watch.user_data.as_deref()) {
                let rate = (sample.rate * 1000.0).round() / 1000.0;
                tracing::debug!(
                    target: "engine.llama",
                    rate,
                    accepted = sample.accepted,
                    generated = sample.generated,
                    "draft acceptance"
                );
                llama_draft_stats::record(user_data, &run.watch.model, sample);
            }
        }
        None => {}
    }
}

/// Records how the server exited once `exit` resolves. An exit after it answered its health check is a crash, and is
/// logged with its cause.
async fn watch_exit<P, C, R>(
    inner: Arc<Inner<P, C, R>>,
    run: Run,
    exit: impl Future<Output = Exit> + Send,
) where
    P: HealthProbe,
    C: Clock,
    R: CommandRunner + Send + 'static,
{
    let exit = exit.await;
    // The state is settled before the exit is published, so a waiting launch never sees an exit it cannot classify.
    let current = {
        let mut state = lock(&inner.state);
        let current = state.process.as_ref().is_some_and(|held| held.id == run.id);
        if current {
            *lock(&run.crashed) = Some(exit.clone());
            state.process = None;
            state.model = None;
        }
        current
    };
    *lock(&run.exit) = Some(exit.clone());
    tracing::info!(target: "engine.llama", code = ?exit.code, signal = ?exit.signal, "llama-server exited");
    if current && run.healthy.load(Ordering::SeqCst) {
        inner.crashes.fetch_add(1, Ordering::SeqCst);
        let ring = snapshot(&run.ring);
        let lines: Vec<&str> = ring.iter().map(String::as_str).collect();
        tracing::error!(
            target: "proc.engine",
            cause = classify_failure(&lines),
            code = ?exit.code,
            signal = ?exit.signal,
            model = %file_name(&run.watch.model),
            stderr = %ring.join("\n"),
            "llama exited after loading"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_complete_split_or_a_single_file_has_no_missing_parts() {
        let dir = tempfile::tempdir().expect("temp dir");
        for name in ["m-00001-of-00002.gguf", "m-00002-of-00002.gguf"] {
            fs::write(dir.path().join(name), "x").expect("part");
        }
        assert!(missing_parts(&dir.path().join("m-00001-of-00002.gguf")).is_none());
        assert!(missing_parts(&dir.path().join("single.gguf")).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_spawn_error_carries_the_system_code_and_names_the_binary() {
        let error = std::io::Error::from_raw_os_error(13);
        assert_eq!(errno_code(&error), "EACCES");
        assert_eq!(errno_code(&std::io::Error::from_raw_os_error(8)), "ENOEXEC");
        assert_eq!(errno_code(&std::io::Error::other("no code")), "");
        let failure = spawn_failure("seer.gguf", Path::new("/engine/llama-server"), &error);
        assert_eq!(failure.kind, FailureKind::StoppedLoading);
        assert_eq!(
            failure.params["reason"],
            "spawn /engine/llama-server EACCES"
        );
    }

    #[test]
    fn a_split_with_a_part_gone_names_it() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(dir.path().join("m-00001-of-00002.gguf"), "x").expect("part");
        let (total, missing) =
            missing_parts(&dir.path().join("m-00001-of-00002.gguf")).expect("missing");
        assert_eq!(total, 2);
        assert_eq!(missing, vec!["m-00002-of-00002.gguf".to_owned()]);
    }
}
