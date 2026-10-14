//! Streams cross as a callback interface, batched by the agent loop at one frame (16 ms), never one call per token.

use draggy_agent::agent_loop::{TurnEvent, TurnObserver as LoopObserver};
use std::sync::Arc;

use crate::records::{ApprovalChoice, ApprovalRecord, TurnEventRecord};

/// Implemented by the shell. Swift wraps it into an `AsyncStream`; the Linux shell forwards it to the main loop.
#[uniffi::export(with_foreign)]
pub trait TurnObserver: Send + Sync {
    /// A batch: the latest snapshot of each kind, in the order they last changed.
    fn on_events(&self, events: Vec<TurnEventRecord>);
}

/// Hands the loop's batches to the shell's observer as flat records.
pub struct Bridge(pub Arc<dyn TurnObserver>);

impl LoopObserver for Bridge {
    fn on_events(&mut self, events: &[TurnEvent]) {
        self.0
            .on_events(events.iter().map(TurnEventRecord::from).collect());
    }
}

/// Answers a tool call that needs the user. Called on the turn's own thread, so it may block until the user decides;
/// the shell must not answer from its main thread. A turn with no handler refuses such calls instead.
#[uniffi::export(with_foreign)]
pub trait ApprovalHandler: Send + Sync {
    fn ask(&self, request: ApprovalRecord) -> ApprovalChoice;
}
