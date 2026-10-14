//! The seam between the client and a server process. Tests script one. The real child needs piped stdin, which the tools crate
//! does not offer yet, so no stdio launcher is wired here.

use std::future::Future;

use serde_json::{Map, Value};

/// What a process has produced since the last look, in the order it happened.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// A chunk of stdout. It need not end on a line boundary.
    Stdout(String),
    /// A chunk of stderr.
    Stderr(String),
    /// The process ended, with its exit code when it has one.
    Exited(Option<i32>),
    /// The process failed without ending, such as a broken pipe. Requests waiting on it are told why.
    Failed(String),
}

/// One running server. Methods take `&self` so a reader task and the callers can share it.
pub trait Process: Send + Sync + 'static {
    /// Writes one line to stdin. False once stdin is closed or the process has ended.
    fn write_line(&self, line: String) -> impl Future<Output = bool> + Send;
    /// The next event. After `Exited`, the reader stops asking.
    fn next_event(&self) -> impl Future<Output = Event> + Send;
    /// Ends stdin and stops the process tree. An `Exited` event follows.
    fn stop(&self);
}

/// Starts server processes. Every start goes through here, so the real implementation can hold the spawn policy.
pub trait Launcher {
    type Process: Process;

    /// The program's name for the log, such as `node`. Never its path.
    fn program_name(&self) -> String;

    /// Starts the server with its arguments and environment.
    fn spawn(&self, args: &[String], env: &Map<String, Value>) -> Result<Self::Process, String>;
}
