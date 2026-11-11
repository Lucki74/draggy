//! The user's terminals and the model's background tasks, both on ConPTY. One host for the app, stopped on exit.

pub mod pty;
pub mod sanitize;
pub mod shells;

use std::sync::LazyLock;

pub static TERMINALS: LazyLock<pty::Host> = LazyLock::new(pty::Host::default);

/// Kills every terminal before the app exits.
pub fn stop_all() {
    TERMINALS.stop_all();
}
