//! The user's terminals and the model's background tasks, both on ConPTY. One host for the app, stopped on exit.

pub mod pipe;
pub mod pty;
pub mod sanitize;
pub mod shells;
pub mod tasks;

use std::sync::LazyLock;

pub static TERMINALS: LazyLock<pty::Host> = LazyLock::new(pty::Host::default);

/// Kills every terminal and background task before the app exits.
pub fn stop_all() {
    TERMINALS.stop_all();
    if let Some(manager) = tasks::TASKS.get() {
        manager.stop_all();
    }
}
