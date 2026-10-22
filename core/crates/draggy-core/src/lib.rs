//! Facade over the core crates, and the UniFFI boundary the native shells call (plan section 3.3):
//!
//! - streams cross as the `TurnObserver` callback interface, batched at 16 ms by the agent loop;
//! - entry points are `async` where they wait on the network, and run off the caller's thread;
//! - records are flat values; the only shared objects are the opaque `Session` and `CancelToken` handles;
//! - cancelling goes through `CancelToken`, which stops the turn and the tools it is running.

pub mod agy_host;
pub mod cancel;
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
pub mod records;
pub mod session;
pub mod skills;
pub mod tools;
pub mod update;
pub mod web;
pub mod web_tools;

pub use agy_host::{AgyAccount, AgyStatus, agy_terms_warning};
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
    AgyConfigRecord, ApprovalChoice, ApprovalRecord, ImageRecord, LiveRecord, MessageRecord,
    MetricsRecord, PermissionModeRecord, SessionConfig, StepRecord, TurnEventRecord, TurnOutcome,
    WebConfigRecord,
};
pub use session::Session;
pub use update::{UpdateChecker, UpdateRecord};
pub use web::{web_address_allowed, web_address_refusal};

uniffi::setup_scaffolding!();

/// The core's version, for the shell's About box and for support reports.
#[uniffi::export]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
