//! One server process over stdio. A reader task answers requests and notices exits as they happen, so a crash while
//! nothing is asked still leaves the log and the server list right.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::js::{stringify, to_js_string, trim, truthy, utf16_len, utf16_prefix};
use crate::lines::{LineBuffer, Parsed, parse_line};
use crate::log::{Level, Log};
use crate::names::scope_for;
use crate::process::{Event, Process};

/// Stderr kept as text for the handshake error, and as lines for a crash report.
const MAX_STDERR_CHARS: usize = 8000;
const RING_LINES: usize = 200;
const RING_LINE_CHARS: usize = 500;

/// How long stopping may wait for the reader to finish before it is left behind.
const JOIN_LIMIT: Duration = Duration::from_secs(10);

type Waiter = oneshot::Sender<Result<Value, String>>;

#[derive(Default)]
struct Stderr {
    text: String,
    ring: VecDeque<String>,
}

/// What the reader task and the callers share about one process.
struct Shared {
    id: String,
    scope: String,
    log: Arc<dyn Log>,
    pending: Mutex<HashMap<u64, Waiter>>,
    stderr: Mutex<Stderr>,
    stopping: AtomicBool,
    exited: AtomicBool,
    exit_logged: AtomicBool,
    failure: Mutex<Option<String>>,
}

impl Shared {
    fn pending(&self) -> MutexGuard<'_, HashMap<u64, Waiter>> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn stderr(&self) -> MutexGuard<'_, Stderr> {
        self.stderr.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn failure(&self) -> MutexGuard<'_, Option<String>> {
        self.failure.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn emit(&self, level: Level, message: &str, data: Value) {
        self.log.line(level, &self.scope, message, data);
    }

    fn stderr_dump(&self) -> String {
        self.stderr()
            .ring
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// The client's end of one process: requests go out, answers come back by id, and exits are logged once.
pub struct Conn<P: Process> {
    shared: Arc<Shared>,
    process: Arc<P>,
    next_id: u64,
    reader: Option<JoinHandle<()>>,
}

impl<P: Process> Conn<P> {
    /// Takes over a started process and begins reading its output. Needs a running tokio runtime.
    pub fn spawn(id: &str, process: P, log: Arc<dyn Log>) -> Self {
        let shared = Arc::new(Shared {
            id: id.to_owned(),
            scope: scope_for(id),
            log,
            pending: Mutex::new(HashMap::new()),
            stderr: Mutex::new(Stderr::default()),
            stopping: AtomicBool::new(false),
            exited: AtomicBool::new(false),
            exit_logged: AtomicBool::new(false),
            failure: Mutex::new(None),
        });
        let process = Arc::new(process);
        let reader = tokio::spawn(pump(shared.clone(), process.clone()));

        Self {
            shared,
            process,
            next_id: 1,
            reader: Some(reader),
        }
    }

    /// Whether the process is still there to talk to.
    pub fn is_live(&self) -> bool {
        !self.shared.stopping.load(Ordering::SeqCst) && !self.shared.exited.load(Ordering::SeqCst)
    }

    /// The reason the process failed without ending, if it has.
    pub fn failure(&self) -> Option<String> {
        self.shared.failure().clone()
    }

    /// Whether a crash has already been logged, so a failed handshake does not log it a second time.
    pub fn exit_logged(&self) -> bool {
        self.shared.exit_logged.load(Ordering::SeqCst)
    }

    /// The stderr kept so far, as text.
    pub fn stderr_text(&self) -> String {
        self.shared.stderr().text.clone()
    }

    /// The last stderr lines, for a crash report.
    pub fn stderr_dump(&self) -> String {
        self.shared.stderr_dump()
    }

    /// Sends a request and waits for its answer. A reply that does not come within `limit` is an error and is dropped if it arrives late.
    pub async fn request(
        &mut self,
        method: &str,
        params: Value,
        limit: Duration,
    ) -> Result<Value, String> {
        if !self.is_live() {
            return Err(self.not_running());
        }

        let message_id = self.next_id;
        self.next_id += 1;

        let (sender, receiver) = oneshot::channel();
        self.shared.pending().insert(message_id, sender);

        // The reader may have seen the exit after the check above and drained before this waiter was added.
        if !self.is_live() {
            self.shared.pending().remove(&message_id);
            return Err(self.not_running());
        }

        let line = format!(
            "{}\n",
            stringify(
                &json!({"jsonrpc": "2.0", "id": message_id, "method": method, "params": params})
            )
        );
        // A server that stops reading its stdin would hold the write, and every other call behind it, for good.
        match timeout(limit, self.process.write_line(line)).await {
            Ok(true) => {}
            Ok(false) => {
                self.shared.pending().remove(&message_id);
                return Err(self.not_running());
            }
            Err(_) => {
                self.shared.pending().remove(&message_id);
                return Err(format!(
                    "The {} server did not answer {method} in time.",
                    self.shared.id
                ));
            }
        }

        match timeout(limit, receiver).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => Err(format!("The {} server stopped.", self.shared.id)),
            Err(_) => {
                self.shared.pending().remove(&message_id);
                Err(format!(
                    "The {} server did not answer {method} in time.",
                    self.shared.id
                ))
            }
        }
    }

    /// Sends a notification. Nothing comes back, so nothing is waited for.
    pub async fn notify(&self, method: &str, params: Value) {
        if !self.is_live() {
            return;
        }

        let line = format!(
            "{}\n",
            stringify(&json!({"jsonrpc": "2.0", "method": method, "params": params}))
        );
        self.process.write_line(line).await;
    }

    /// Marks the process as being stopped on purpose, so its exit is logged as a stop and not a crash, and ends its stdin.
    pub fn detach(&self) {
        self.shared.stopping.store(true, Ordering::SeqCst);
        self.process.stop();
    }

    /// Stops the process and waits for its exit to be logged.
    pub async fn stop(&mut self) {
        self.detach();
        self.join().await;
    }

    /// Waits for the reader task to finish, for at most `JOIN_LIMIT`. A reader that will not finish is left behind.
    pub async fn join(&mut self) {
        if let Some(reader) = self.reader.take() {
            let _ = timeout(JOIN_LIMIT, reader).await;
        }
    }

    fn not_running(&self) -> String {
        format!("The {} server is not running.", self.shared.id)
    }
}

/// Reads the process until it exits. Everything the process writes is handled here, in order.
async fn pump<P: Process>(shared: Arc<Shared>, process: Arc<P>) {
    let mut lines = LineBuffer::default();

    loop {
        match process.next_event().await {
            Event::Stdout(chunk) => {
                for line in lines.push(&chunk) {
                    handle_line(&shared, &line);
                }
            }
            Event::Stderr(chunk) => record_stderr(&shared, &chunk),
            Event::Failed(reason) => fail(&shared, &reason),
            Event::Exited(code) => {
                finish(&shared, code);
                return;
            }
        }
    }
}

fn handle_line(shared: &Shared, raw: &str) {
    match parse_line(raw) {
        Parsed::Blank => {}
        Parsed::Message { value, bytes } => {
            shared.emit(
                Level::Debug,
                "message in",
                json!({"server": shared.id, "transport": "stdio", "bytes": bytes}),
            );
            // TS quirk: a null message throws on its id, so the reference logs the line a second time as junk.
            if value.is_null() {
                shared.emit(
                    Level::Debug,
                    "non-json line",
                    json!({"server": shared.id, "transport": "stdio", "bytes": bytes}),
                );
            } else {
                deliver(shared, &value);
            }
        }
        Parsed::Junk { bytes } => shared.emit(
            Level::Debug,
            "non-json line",
            json!({"server": shared.id, "transport": "stdio", "bytes": bytes}),
        ),
    }
}

/// Hands an answer to the request waiting for its id. Messages without an id, and answers nobody waits for, are dropped.
fn deliver(shared: &Shared, message: &Value) {
    // A message with a method is the server asking something of its own, not an answer to a call of ours.
    if message.get("method").is_some() {
        return;
    }
    let Some(id) = message
        .get("id")
        .filter(|id| !id.is_null())
        .and_then(message_id)
    else {
        return;
    };

    let Some(waiter) = shared.pending().remove(&id) else {
        return;
    };

    let outcome = match message.get("error").filter(|error| truthy(Some(error))) {
        Some(error) => Err(error_text(error)),
        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
    };

    // The waiter may have given up just now; then nobody is left to hear the answer.
    let _ = waiter.send(outcome);
}

fn message_id(value: &Value) -> Option<u64> {
    value
        .as_f64()
        .filter(|id| id.fract() == 0.0 && *id >= 0.0)
        .map(|id| id as u64)
}

fn error_text(error: &Value) -> String {
    match error.get("message").filter(|text| truthy(Some(text))) {
        Some(text) => to_js_string(text),
        None => "The server reported an error.".to_owned(),
    }
}

fn record_stderr(shared: &Shared, chunk: &str) {
    let mut guard = shared.stderr();
    let stderr = &mut *guard;

    for line in chunk.split('\n') {
        let trimmed = trim(line);
        if trimmed.is_empty() {
            continue;
        }
        stderr
            .ring
            .push_back(utf16_prefix(trimmed, RING_LINE_CHARS));
        if stderr.ring.len() > RING_LINES {
            stderr.ring.pop_front();
        }
    }

    if utf16_len(&stderr.text) < MAX_STDERR_CHARS {
        stderr.text.push_str(chunk);
    }
}

/// A process error that did not end it: logged, and every waiting request is told why. The process itself is left as it is.
fn fail(shared: &Shared, reason: &str) {
    shared.emit(
        Level::Error,
        "process error",
        json!({"server": shared.id, "transport": "stdio", "reason": reason}),
    );
    *shared.failure() = Some(reason.to_owned());

    let waiting: Vec<Waiter> = shared.pending().drain().map(|(_, waiter)| waiter).collect();
    for waiter in waiting {
        let _ = waiter.send(Err(reason.to_owned()));
    }
}

/// The exit: logged as a crash unless a stop asked for it, then every waiting request is told the process is gone.
fn finish(shared: &Shared, code: Option<i32>) {
    shared.exited.store(true, Ordering::SeqCst);
    let code_value = code.map_or(Value::Null, |code| json!(code));

    if shared.stopping.load(Ordering::SeqCst) {
        shared.emit(
            Level::Info,
            "server stopped",
            json!({"server": shared.id, "transport": "stdio", "code": code_value}),
        );
    } else {
        shared.exit_logged.store(true, Ordering::SeqCst);
        shared.log.line(
            Level::Error,
            "proc.mcp",
            "server exited unexpectedly",
            json!({
                "server": shared.id,
                "transport": "stdio",
                "code": code_value,
                "stderr": shared.stderr_dump(),
            }),
        );
    }

    let code_text = code.map_or_else(|| "null".to_owned(), |code| code.to_string());
    let waiting: Vec<Waiter> = shared.pending().drain().map(|(_, waiter)| waiter).collect();
    for waiter in waiting {
        let _ = waiter.send(Err(format!(
            "The {} server stopped (exit code {code_text}).",
            shared.id
        )));
    }
}
