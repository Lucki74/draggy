//! Facade over the core crates, and the UniFFI boundary the native shells call (plan section 3.3):
//!
//! - streams cross as the `TurnObserver` callback interface, batched at 16 ms by the agent loop;
//! - entry points are `async` where they wait on the network, and run off the caller's thread;
//! - records are flat values; the only shared objects are the opaque `Session` and `CancelToken` handles;
//! - cancelling goes through `CancelToken`, which stops the turn and the tools it is running.

pub mod adblock;
pub mod cancel;
pub mod cost;
pub mod documents;
pub mod engine;
pub mod error;
pub mod installer;
pub mod load_stage;
pub mod mcp;
pub mod mcp_tools;
pub mod model;
pub mod models;
pub mod net;
pub mod observer;
pub mod plan;
pub mod records;
pub mod research;
pub mod research_library;
pub mod session;
pub mod skills;
pub mod task_tools;
pub mod tools;
pub mod update;
pub mod web;
pub mod web_tools;

pub use cancel::CancelToken;
pub use documents::read_document;
pub use engine::{EngineHost, EngineInfo, EngineState, LocalEngine};
pub use error::CoreError;
pub use installer::{
    EngineInstaller, InstallObserver, InstallProgressRecord, InstalledEngineRecord,
};
pub use load_stage::{LoadObserver, LoadStageKind, LoadStageRecord};
pub use mcp::{
    McpInputRecord, McpManager, McpServerConfigRecord, McpServerRecord, McpServerStateRecord,
    McpToolRecord, mcp_catalogue,
};
pub use models::{
    DownloadObserver, DownloadProgressRecord, InstalledModelRecord, LibraryModelRecord,
    ModelLibrary,
};
pub use observer::{ApprovalHandler, TurnObserver};
pub use records::{
    ApprovalChoice, ApprovalRecord, ImageRecord, LiveArgRecord, LiveArgsRecord, LiveRecord,
    MessageRecord, MetricsRecord, PermissionModeRecord, PlanStepRecord, SessionConfig, StepRecord,
    TaskRecord, TurnEventRecord, TurnOutcome, WebConfigRecord,
};
pub use research_library::{PastRunRecord, ResearchStore};
pub use session::Session;
pub use skills::{SkillRecord, install_skill, list_skills, remove_skill};
pub use update::{
    UpdateChecker, UpdateObserver, UpdateProgressRecord, UpdateRecord, parse_sha256sums,
};
pub use web::{web_address_allowed, web_address_refusal};

uniffi::setup_scaffolding!();

static LOGGING: std::sync::OnceLock<std::sync::Arc<draggy_diagnostics::Diagnostics>> =
    std::sync::OnceLock::new();

/// Starts the core's log files (`app.log`, `debug.log`, `events.jsonl`) in `dir` and sends every `tracing` event
/// there. Levels come from `LOG_LEVEL`, `APP_LOG_LEVEL` and `DEBUG_LOG_LEVEL`, as in the Windows app. Only the
/// first call does anything, and it returns true when `tracing` events now reach the files.
#[uniffi::export]
pub fn init_logging(dir: String) -> bool {
    use draggy_diagnostics::{Config, Diagnostics, SystemClock, TracingBridge};
    use std::sync::Arc;
    let mut fresh = false;
    LOGGING.get_or_init(|| {
        fresh = true;
        let pid = draggy_tools::spawn::current_pid();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|time| time.as_millis() as u32)
            .unwrap_or_default();
        let session = format!("{:08x}", stamp ^ pid.rotate_left(16));
        let config = Config::from_env(|key| std::env::var(key).ok(), session, pid, true, None);
        Arc::new(Diagnostics::open(
            dir,
            config,
            Arc::new(SystemClock::default()),
        ))
    });
    fresh
        && LOGGING
            .get()
            .is_some_and(|diagnostics| TracingBridge::new(Arc::clone(diagnostics)).install())
}

/// The core's version, for the shell's About box and for support reports.
#[uniffi::export]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
