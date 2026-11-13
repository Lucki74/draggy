//! The user's terminals and the model's background tasks, both on ConPTY. One host for the app, stopped on exit.

pub mod commands;
pub mod elevate;
pub mod pipe;
pub mod pty;
pub mod sandbox;
pub mod sanitize;
pub mod shells;
pub mod tasks;

use std::sync::{Arc, LazyLock, OnceLock};

use draggy_diagnostics::Diagnostics;

pub static TERMINALS: LazyLock<pty::Host> = LazyLock::new(pty::Host::default);
static DIAG: OnceLock<Arc<Diagnostics>> = OnceLock::new();

/// Gives the terminal code the app's log writer, once at startup.
pub fn install_diagnostics(diag: Arc<Diagnostics>) {
    let _ = DIAG.set(diag);
}

/// The app's log writer, once startup has installed it.
pub fn diag() -> Option<&'static Diagnostics> {
    DIAG.get().map(Arc::as_ref)
}

/// Kills every terminal and background task before the app exits.
pub fn stop_all() {
    commands::stop_all();
    TERMINALS.stop_all();
    if let Some(manager) = tasks::TASKS.get() {
        manager.stop_all();
    }
}
