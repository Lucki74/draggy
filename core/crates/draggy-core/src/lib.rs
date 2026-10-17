//! Facade over the core crates, and the UniFFI boundary the native shells call (plan section 3.3):
//!
//! - streams cross as the `TurnObserver` callback interface, batched at 16 ms by the agent loop;
//! - entry points are `async` where they wait on the network, and run off the caller's thread;
//! - records are flat values; the only shared objects are the opaque `Session` and `CancelToken` handles;
//! - cancelling goes through `CancelToken`, which stops the turn and the tools it is running.

pub mod cancel;
pub mod engine;
pub mod error;
pub mod installer;
pub mod model;
pub mod models;
pub mod net;
pub mod observer;
pub mod records;
pub mod session;
pub mod tools;
pub mod update;

pub use cancel::CancelToken;
pub use engine::{EngineHost, EngineInfo, EngineState, LocalEngine};
pub use error::CoreError;
pub use installer::{
    EngineInstaller, InstallObserver, InstallProgressRecord, InstalledEngineRecord,
};
pub use models::{
    DownloadObserver, DownloadProgressRecord, InstalledModelRecord, LibraryModelRecord,
    ModelLibrary,
};
pub use observer::{ApprovalHandler, TurnObserver};
pub use records::{
    ApprovalChoice, ApprovalRecord, LiveRecord, MessageRecord, MetricsRecord, PermissionModeRecord,
    SessionConfig, StepRecord, TurnEventRecord, TurnOutcome,
};
pub use session::Session;
pub use update::{UpdateChecker, UpdateRecord};

uniffi::setup_scaffolding!();

/// The core's version, for the shell's About box and for support reports.
#[uniffi::export]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
