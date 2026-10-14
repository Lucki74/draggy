//! The explicit stop handle: Escape cancels the turn and every tool it is running.

use std::sync::Arc;

use draggy_agent::task_manager::CancelSignal;

/// A handle the shell keeps for one turn. Cancelling it is immediate and can be done from any thread.
#[derive(uniffi::Object, Debug, Default)]
pub struct CancelToken {
    signal: CancelSignal,
}

#[uniffi::export]
impl CancelToken {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Stops the turn at its next checkpoint. Calling it again does nothing.
    pub fn cancel(&self) {
        self.signal.abort();
    }

    pub fn is_cancelled(&self) -> bool {
        self.signal.is_aborted()
    }
}

impl CancelToken {
    /// The signal the agent loop watches. It shares the flag with this handle.
    pub fn signal(&self) -> &CancelSignal {
        &self.signal
    }
}
