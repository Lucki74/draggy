//! The quit handshake: ask the window to save what it holds, wait for its answer or a timeout, then
//! exit.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::Notify;

use crate::ipc;

/// Rust asks the window to save on the first channel; the window answers on the second.
pub const FLUSH_CHANNEL: &str = "app:flush-saves";
pub const FLUSHED_CHANNEL: &str = "app:saves-flushed";

/// A quit that hangs on a stuck window is worse than losing its last unsaved change.
pub const FLUSH_TIMEOUT: Duration = Duration::from_millis(3000);

#[derive(Default)]
pub struct Quit {
    flushed: Notify,
    started: AtomicBool,
}

impl Quit {
    /// The window's answer. One that nobody waits for is dropped.
    pub fn note_flushed(&self) {
        self.flushed.notify_waiters();
    }

    /// True once, for the first close request; later ones find the flush already running.
    pub fn begin(&self) -> bool {
        !self.started.swap(true, Ordering::SeqCst)
    }

    /// Runs `ask`, then waits for the answer. True only when the window answered in time. The wait
    /// is registered before `ask`, so an instant answer is not lost.
    pub async fn flush_with(&self, timeout: Duration, ask: impl FnOnce()) -> bool {
        let answered = self.flushed.notified();
        tokio::pin!(answered);
        answered.as_mut().enable();
        ask();
        tokio::time::timeout(timeout, answered).await.is_ok()
    }

    pub async fn flush(&self, app: &AppHandle) -> bool {
        self.flush_with(FLUSH_TIMEOUT, || {
            ipc::emit(app, FLUSH_CHANNEL, Value::Null);
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn resolves_true_when_the_window_answers() {
        let quit = Arc::new(Quit::default());
        let answer = Arc::clone(&quit);
        let answered = quit
            .flush_with(Duration::from_secs(5), move || answer.note_flushed())
            .await;
        assert!(answered);
    }

    #[tokio::test]
    async fn resolves_false_on_timeout() {
        let quit = Quit::default();
        assert!(!quit.flush_with(Duration::from_millis(20), || {}).await);
    }

    #[test]
    fn only_the_first_close_starts_a_flush() {
        let quit = Quit::default();
        assert!(quit.begin());
        assert!(!quit.begin());
    }
}
