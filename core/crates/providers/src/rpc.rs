//! JSON-RPC over a child's stdio, as a sans-IO state machine: bytes in, lines out, with the clock passed in. The
//! reference's `createRpc` reads the child's pipes and times calls out; here the shell feeds and ticks it.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{Map, Value, json};
use tracing::{debug, warn};

use crate::js::{to_string, truthy};

pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const NEWLINE: u8 = b'\n';
const REDACTED: &str = "[redacted]";
const CLOSED_MESSAGE: &str = "The runtime closed its connection";
const INTERNAL_CODE: i64 = -32603;

/// Why a call failed: the connection went away, the wait ran out, or the runtime answered with an error.
#[derive(Debug, Clone, PartialEq)]
pub enum RpcCode {
    Closed,
    Timeout,
    Remote(Option<i64>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct RpcError {
    pub message: String,
    pub code: RpcCode,
    pub data: Option<Value>,
}

impl fmt::Display for RpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for RpcError {}

/// One item from the byte stream: a whole line, or the size of a line dropped for being over the limit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Framed {
    Line(String),
    Oversize(usize),
}

/// Splits bytes into lines. A line over the limit is dropped whole, so a runaway never grows the buffer.
#[derive(Debug, Clone)]
pub struct LineFramer {
    max: usize,
    pieces: Vec<u8>,
    skipping: bool,
}

impl LineFramer {
    pub fn new(max: usize) -> Self {
        Self {
            max,
            pieces: Vec::new(),
            skipping: false,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<Framed> {
        let mut out = Vec::new();
        let mut rest = chunk;
        while let Some(at) = rest.iter().position(|&b| b == NEWLINE) {
            let head = &rest[..at];
            rest = &rest[at + 1..];
            let total = self.pieces.len() + head.len();
            if self.skipping || total > self.max {
                if !self.skipping {
                    out.push(Framed::Oversize(total));
                }
                self.skipping = false;
            } else if total > 0 {
                let mut bytes = std::mem::take(&mut self.pieces);
                bytes.extend_from_slice(head);
                out.push(Framed::Line(String::from_utf8_lossy(&bytes).into_owned()));
            }
            self.pieces.clear();
        }
        if self.skipping || rest.is_empty() {
            return out;
        }
        if self.pieces.len() + rest.len() > self.max {
            out.push(Framed::Oversize(self.pieces.len() + rest.len()));
            self.pieces.clear();
            self.skipping = true;
            return out;
        }
        self.pieces.extend_from_slice(rest);
        out
    }
}

/// Every token-shaped run a runtime's log line can carry, replaced whole. A pattern that fails to compile
/// replaces the whole line, so a bad pattern never lets a token through.
struct Patterns {
    field: Regex,
    param: Regex,
    bearer: Regex,
    jwt: Regex,
    key: Regex,
    google: Regex,
    opaque: Regex,
}

fn patterns() -> Option<&'static Patterns> {
    static CELL: OnceLock<Option<Patterns>> = OnceLock::new();
    CELL.get_or_init(|| {
        Some(Patterns {
            field: Regex::new(
                r#"(?i)("(?:[0-9a-z_-]*token|[0-9a-z_-]*secret|api_?key|authorization|password|code|state)"\s*:\s*)"(?:[^"\\]|\\.)*""#,
            )
            .ok()?,
            param: Regex::new(r"(?i)\b((?:code|state|[0-9a-z_-]*token|key|client_secret)=)[^&\s\x22'<>]+").ok()?,
            bearer: Regex::new(r"(?i)\b(Bearer|Basic)\s+[^\s\x22',]+").ok()?,
            jwt: Regex::new(r"\beyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+(?:\.[0-9A-Za-z_-]*)?").ok()?,
            key: Regex::new(r"\b(?:sk|pk|rk)-[0-9A-Za-z_-]{8,}").ok()?,
            google: Regex::new(r"\bya29\.[0-9A-Za-z_-]+").ok()?,
            opaque: Regex::new(r"[A-Za-z0-9_\-+/]{32,}={0,2}").ok()?,
        })
    })
    .as_ref()
}

/// A path's folders are short; a token's run of letters and digits is not.
fn opaque(part: &str) -> bool {
    part.len() >= 24
        && part.bytes().any(|b| b.is_ascii_alphabetic())
        && part.bytes().any(|b| b.is_ascii_digit())
}

/// Strips every token-shaped thing from a runtime's log line; nothing of a token is kept, not even a prefix.
pub fn redact(text: &str) -> String {
    let Some(p) = patterns() else {
        return REDACTED.to_owned();
    };
    let field = p
        .field
        .replace_all(text, format!("${{1}}\"{REDACTED}\"").as_str());
    let param = p
        .param
        .replace_all(&field, format!("${{1}}{REDACTED}").as_str());
    let bearer = p
        .bearer
        .replace_all(&param, format!("${{1}} {REDACTED}").as_str());
    let jwt = p.jwt.replace_all(&bearer, REDACTED);
    let key = p.key.replace_all(&jwt, REDACTED);
    let google = p.google.replace_all(&key, REDACTED);
    p.opaque
        .replace_all(&google, |caps: &regex::Captures<'_>| {
            let run = &caps[0];
            if run.split('/').any(opaque) {
                REDACTED.to_owned()
            } else {
                run.to_owned()
            }
        })
        .into_owned()
}

/// A stderr line in the form the log keeps: redacted, or the byte count when it was over the limit.
pub fn stderr_line(framed: Framed) -> String {
    match framed {
        Framed::Line(line) => redact(&line),
        Framed::Oversize(bytes) => format!("[a line of {bytes} bytes]"),
    }
}

/// The options a client is made with. `handles_requests` says whether the caller answers the runtime's own requests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RpcOptions {
    pub jsonrpc: bool,
    pub timeout_ms: u64,
    pub max_line_bytes: usize,
    pub handles_requests: bool,
}

impl Default for RpcOptions {
    fn default() -> Self {
        Self {
            jsonrpc: false,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            max_line_bytes: DEFAULT_MAX_LINE_BYTES,
            handles_requests: false,
        }
    }
}

/// What the client tells its owner, in the order it happened.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Notification {
        method: String,
        params: Option<Value>,
    },
    Request {
        id: Value,
        method: String,
        params: Option<Value>,
    },
    Settled {
        id: u64,
        result: Result<Value, RpcError>,
    },
    Log(String),
    Closed(RpcError),
}

struct Waiting {
    method: String,
    wait_ms: u64,
    deadline: u64,
}

/// One JSON-RPC connection. `call` returns the id it assigned; the answer arrives later as `Event::Settled`.
pub struct Rpc {
    options: RpcOptions,
    next_id: u64,
    now: u64,
    pending: BTreeMap<u64, Waiting>,
    closed: Option<RpcError>,
    framer: LineFramer,
    outbox: Vec<String>,
    events: Vec<Event>,
}

impl Rpc {
    pub fn new(options: RpcOptions) -> Self {
        let framer = LineFramer::new(options.max_line_bytes);
        Self {
            options,
            next_id: 1,
            now: 0,
            pending: BTreeMap::new(),
            closed: None,
            framer,
            outbox: Vec::new(),
            events: Vec::new(),
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closed.is_some()
    }

    /// Sends a call. A call after the connection closed is refused and takes no id.
    pub fn call(
        &mut self,
        method: &str,
        params: Option<Value>,
        timeout_ms: Option<u64>,
    ) -> Result<u64, RpcError> {
        if let Some(closed) = &self.closed {
            return Err(closed.clone());
        }
        let id = self.next_id;
        self.next_id += 1;
        let wait_ms = timeout_ms.unwrap_or(self.options.timeout_ms);
        self.pending.insert(
            id,
            Waiting {
                method: method.to_owned(),
                wait_ms,
                deadline: self.now + wait_ms,
            },
        );
        let mut message = Map::new();
        message.insert("id".to_owned(), json!(id));
        message.insert("method".to_owned(), json!(method));
        if let Some(params) = params {
            message.insert("params".to_owned(), params);
        }
        self.write(message);
        Ok(id)
    }

    /// Sends a notification. Returns false, and sends nothing, once the connection is closed.
    pub fn notify(&mut self, method: &str, params: Option<Value>) -> bool {
        if self.is_closed() {
            return false;
        }
        let mut message = Map::new();
        message.insert("method".to_owned(), json!(method));
        if let Some(params) = params {
            message.insert("params".to_owned(), params);
        }
        self.write(message);
        true
    }

    /// Answers one of the runtime's requests, with its result or its error. A missing code is an internal error.
    pub fn answer(&mut self, id: Value, result: Result<Value, (Option<i64>, String)>) {
        let message = match result {
            Ok(value) => json!({ "id": id, "result": value }),
            Err((code, text)) => {
                json!({ "id": id, "error": { "code": code.unwrap_or(INTERNAL_CODE), "message": text } })
            }
        };
        self.write_value(message);
    }

    /// Feeds bytes read from the runtime's stdout.
    pub fn feed(&mut self, bytes: &[u8]) {
        for framed in self.framer.push(bytes) {
            match framed {
                Framed::Line(line) => self.receive(&line),
                Framed::Oversize(bytes) => {
                    debug!(target: "providers.rpc", bytes, "dropped line over limit");
                    self.events.push(Event::Log(format!(
                        "dropped a line of {bytes} bytes over the limit"
                    )));
                }
            }
        }
    }

    /// Moves the clock on and gives up on every call whose wait has run out, earliest first.
    pub fn advance(&mut self, ms: u64) {
        self.now += ms;
        let mut due: Vec<(u64, u64)> = self
            .pending
            .iter()
            .filter(|(_, waiting)| waiting.deadline <= self.now)
            .map(|(id, waiting)| (waiting.deadline, *id))
            .collect();
        due.sort();
        for (_, id) in due {
            let Some(waiting) = self.pending.remove(&id) else {
                continue;
            };
            warn!(target: "providers.rpc", id, method = %waiting.method, wait_ms = waiting.wait_ms, "call timed out");
            let error = RpcError {
                message: format!("{} got no answer in {} ms", waiting.method, waiting.wait_ms),
                code: RpcCode::Timeout,
                data: None,
            };
            self.events.push(Event::Settled {
                id,
                result: Err(error),
            });
        }
    }

    /// The connection ended: every waiting call fails, and no later call is sent.
    pub fn close(&mut self) {
        self.close_with(CLOSED_MESSAGE);
    }

    /// The stream failed: the waiting calls fail with the error's own message, as the reference's error handler gives it.
    pub fn close_with(&mut self, message: &str) {
        if self.closed.is_some() {
            return;
        }
        let reason = RpcError {
            message: message.to_owned(),
            code: RpcCode::Closed,
            data: None,
        };
        debug!(target: "providers.rpc", pending = self.pending.len(), "connection closed");
        for id in std::mem::take(&mut self.pending).into_keys() {
            self.events.push(Event::Settled {
                id,
                result: Err(reason.clone()),
            });
        }
        self.closed = Some(reason.clone());
        self.events.push(Event::Closed(reason));
    }

    pub fn take_outbox(&mut self) -> Vec<String> {
        std::mem::take(&mut self.outbox)
    }

    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    fn receive(&mut self, line: &str) {
        let message: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => {
                // The line is not logged: it may be half of an auth payload.
                let chars = line.encode_utf16().count();
                debug!(target: "providers.rpc", chars, "dropped line not json");
                self.events.push(Event::Log(format!(
                    "dropped a line that is not JSON ({chars} chars)"
                )));
                return;
            }
        };
        let Some(object) = message.as_object() else {
            return;
        };
        if let Some(method) = object.get("method").and_then(Value::as_str) {
            let method = method.to_owned();
            let params = object.get("params").cloned();
            match object.get("id") {
                Some(id) if !id.is_null() => self.incoming_request(id.clone(), method, params),
                _ => self.events.push(Event::Notification { method, params }),
            }
            return;
        }
        let Some(id) = object.get("id").and_then(Value::as_u64) else {
            return;
        };
        if self.pending.remove(&id).is_none() {
            return;
        }
        // The reference reads a falsy error as no error at all, so a null or empty one still settles with its result.
        let result = match object.get("error").filter(|error| truthy(Some(error))) {
            Some(error) => {
                let message = error
                    .get("message")
                    .filter(|text| truthy(Some(text)))
                    .map(to_string)
                    .unwrap_or_else(|| "Request failed".to_owned());
                debug!(target: "providers.rpc", id, "answer with error");
                Err(RpcError {
                    message,
                    code: RpcCode::Remote(error.get("code").and_then(Value::as_i64)),
                    data: error.get("data").cloned(),
                })
            }
            None => Ok(object.get("result").cloned().unwrap_or(Value::Null)),
        };
        self.events.push(Event::Settled { id, result });
    }

    fn incoming_request(&mut self, id: Value, method: String, params: Option<Value>) {
        if self.options.handles_requests {
            self.events.push(Event::Request { id, method, params });
            return;
        }
        self.write_value(json!({ "id": id, "error": { "code": -32601, "message": format!("{method} is not handled") } }));
    }

    fn write(&mut self, message: Map<String, Value>) {
        self.write_value(Value::Object(message));
    }

    fn write_value(&mut self, message: Value) {
        if self.is_closed() {
            return;
        }
        let mut message = message;
        if self.options.jsonrpc
            && let Some(object) = message.as_object_mut()
        {
            object.insert("jsonrpc".to_owned(), json!("2.0"));
        }
        // Serialising a JSON value cannot fail, so an empty line stands in for the impossible case.
        let text = serde_json::to_string(&message).unwrap_or_default();
        self.outbox.push(format!("{text}\n"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stderr_lines_are_redacted_and_an_oversize_line_is_only_counted() {
        assert_eq!(
            stderr_line(Framed::Line("first line".to_owned())),
            "first line"
        );
        assert_eq!(
            stderr_line(Framed::Line(
                "open https://auth.openai.com/oauth?state=Zx81Kq0&x=1".to_owned()
            )),
            "open https://auth.openai.com/oauth?state=[redacted]&x=1"
        );
        assert_eq!(
            stderr_line(Framed::Oversize(70_000)),
            "[a line of 70000 bytes]"
        );
    }

    #[test]
    fn a_call_is_refused_once_the_connection_closed_and_a_late_answer_is_ignored() {
        let mut rpc = Rpc::new(RpcOptions::default());
        let id = rpc.call("slow", None, Some(10)).unwrap_or_default();
        rpc.advance(20);
        rpc.feed(format!("{{\"id\":{id},\"result\":{{}}}}\n").as_bytes());
        let events = rpc.take_events();
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(e, Event::Settled { .. }))
                .count(),
            1
        );
        rpc.close();
        assert!(rpc.call("after", None, None).is_err());
    }
}
