//! The local OpenAI-compatible API, ported from electron/apiServer.cjs.
//!
//! `router` answers the requests the reference answers. The reply comes from a `Backend`, and the key, the clock and
//! the random bytes from an `Env`, so tests drive the router in process with fakes.
//!
//! # Not ported
//!
//! - Binding, serving and stopping the socket. The caller binds `HOST` on the port and serves the router.
//! - The `request done` timing line and the completion timer. Refusals, rejected bodies and failures are logged.
//! - Lone-surrogate escapes. `JSON.parse` accepts `"\ud83d"` and serde_json does not, so this answers 400 where the reference answers 200.
//! - Numbers beyond the f64 range, such as `1e400`. `JSON.parse` reads `Infinity`, serde_json refuses it, so this answers 400.
//! - Nesting deeper than 128 levels. serde_json stops there and answers 400, where the reference reads any depth.
//! - Omitted `model` and `content` fields in a reply. `Reply` always has both, so the reference's omitted-field case cannot arise.
//!
//! # Reference quirks kept
//!
//! - An array body passes the object check and fails on `messages`, not on the body.
//! - The busy check runs before the body is read, and the count rises after it parses, so a burst can briefly pass the limit.
//! - A part with no `type`, or a falsy one, is read as text, and its `text` is converted as `String()` converts it.
//! - Bodies decode as UTF-8 with replacement characters, as `Buffer.toString` does.
//! - Header bytes are read as Latin-1, as Node decodes them, and the Bearer whitespace is JavaScript's `\s`.
//! - A reply holds its slot until generate settles, even after its client has left, so abandoned replies still count.

use std::collections::VecDeque;
use std::convert::Infallible;
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::body::{Body, Bytes, to_bytes};
use axum::extract::{Request, State};
use axum::http::header::{
    AUTHORIZATION, CACHE_CONTROL, CONNECTION, CONTENT_TYPE, HOST as HOST_HEADER, ORIGIN,
    X_CONTENT_TYPE_OPTIONS,
};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures_util::stream;
use http_body_util::LengthLimitError;
use serde::Serialize;
use serde_json::Value;
use subtle::ConstantTimeEq;
use tokio::sync::mpsc;
use tokio_util::sync::{CancellationToken, DropGuard};

/// The only address the reference listens on.
pub const HOST: &str = "127.0.0.1";

/// The port used when the caller does not choose one.
pub const DEFAULT_PORT: u16 = 11500;

/// Largest request body accepted. A conversation, not a file upload.
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

/// Replies generated at once. Past this a client is asked to wait.
pub const MAX_CONCURRENT: usize = 2;

const REPLY_FAILED: &str = "The reply failed.";
const SERVER_ERROR: &str = "The server hit an error.";
const INVALID_JSON: &str = "The body is not valid JSON.";
const BUSY: &str = "Draggy is already answering other requests. Try again shortly.";
const DONE_FRAME: &str = "data: [DONE]\n\n";

/// Produces replies and names the models that can be asked for. The app supplies the local engine.
pub trait Backend: Send + Sync + 'static {
    /// The names of the models that can be asked for.
    fn list_models(&self) -> impl Future<Output = Result<Vec<String>, BackendError>> + Send;

    /// Makes one reply. Text goes out through `sink` as it is made, and the model name once it is known.
    fn generate(
        &self,
        request: CompletionRequest,
        sink: Sink,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<Reply, BackendError>> + Send;
}

/// The key, the clock and the random bytes. The app reads them from its settings and the OS.
pub trait Env: Send + Sync + 'static {
    /// The key a request must present. An empty key refuses every request.
    fn api_key(&self) -> String;

    /// Seconds since the Unix epoch.
    fn now_unix(&self) -> i64;

    /// Fills `buffer` with random bytes, used for completion ids.
    fn fill_random(&self, buffer: &mut [u8]);
}

/// One finished reply.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Reply {
    pub model: String,
    pub content: String,
    pub usage: Usage,
}

/// Token counts reported with a reply. Missing counts read as zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub response_tokens: u64,
}

/// A failure inside the backend. The message reaches the client, so it must not carry secrets.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct BackendError {
    pub message: String,
}

/// Carries a reply's text and model name back to the router as they are made.
pub struct Sink(mpsc::UnboundedSender<Update>);

impl Sink {
    /// The model that is answering, once known.
    pub fn model(&self, name: &str) {
        self.send(Update::Model(name.to_owned()));
    }

    /// One piece of the reply text.
    pub fn text(&self, chunk: &str) {
        self.send(Update::Text(chunk.to_owned()));
    }

    fn send(&self, update: Update) {
        // A closed channel means the client has left, so nothing is waiting for this text.
        let _ = self.0.send(update);
    }
}

enum Update {
    Model(String),
    Text(String),
    Finished(Result<Reply, BackendError>),
}

/// A chat completion request, read and checked. `developer` roles are read as `system`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub stream: bool,
}

/// One message of a completion request, with its text content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

/// The roles this endpoint takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

/// Why a completion request was refused. The display text is the message sent back to the client.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CompletionError {
    #[error("The body must be a JSON object.")]
    NotObject,
    #[error("messages must be a non-empty array.")]
    NoMessages,
    #[error("messages[{0}].role must be system, user or assistant.")]
    BadRole(usize),
    #[error("messages[{0}] has a part that is not text, which this endpoint does not take yet.")]
    NotText(usize),
    #[error("messages[{0}].content must be a string or an array of text parts.")]
    BadContent(usize),
    #[error("messages needs at least one user message.")]
    NoUser,
}

/// A refusal to answer: the status and the message to send with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Refusal {
    pub status: StatusCode,
    pub message: &'static str,
}

/// The router for one server on `port`. The caller binds `HOST` and serves it.
pub fn router<B: Backend, E: Env>(port: u16, backend: B, env: E) -> Router {
    let shared = Arc::new(Shared {
        backend: Arc::new(backend),
        env: Arc::new(env),
        port,
        active: Arc::new(AtomicUsize::new(0)),
    });
    Router::<Arc<Shared<B, E>>>::new()
        .fallback(handle::<B, E>)
        .with_state(shared)
}

/// What the caller tells the user when the socket cannot be bound. A port already in use gets its number in the message.
pub fn listen_failure(error: &std::io::Error, port: u16) -> String {
    if error.kind() == std::io::ErrorKind::AddrInUse {
        format!("Port {port} is already in use.")
    } else {
        error.to_string()
    }
}

/// A new key from 24 random bytes: `draggy-` and 32 base64url characters.
pub fn generate_key(random: &[u8; 24]) -> String {
    format!("draggy-{}", URL_SAFE_NO_PAD.encode(random))
}

/// Compares keys in constant time, and never matches an empty key.
pub fn same_key(given: &str, expected: &str) -> bool {
    let (given, expected) = (given.as_bytes(), expected.as_bytes());
    if given.len() != expected.len() || expected.is_empty() {
        return false;
    }
    given.ct_eq(expected).into()
}

/// Whether a request may be answered at all. `None` lets it through, otherwise the refusal to send.
pub fn check_request(headers: &HeaderMap, port: u16, key: &str) -> Option<Refusal> {
    // A browser always sends Origin on a cross-site request, and no legitimate client is a web page.
    if headers.contains_key(ORIGIN) {
        return Some(Refusal {
            status: StatusCode::FORBIDDEN,
            message: "Requests from web pages are not accepted.",
        });
    }

    let host = headers
        .get(HOST_HEADER)
        .map(header_text)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}") {
        return Some(Refusal {
            status: StatusCode::FORBIDDEN,
            message: "This endpoint only answers on 127.0.0.1.",
        });
    }

    let authorization = headers
        .get(AUTHORIZATION)
        .map(header_text)
        .unwrap_or_default();
    match bearer_token(&authorization) {
        Some(token) if same_key(token, key) => None,
        _ => Some(Refusal {
            status: StatusCode::UNAUTHORIZED,
            message: "Missing or wrong API key.",
        }),
    }
}

/// A header value as the reference reads it. Node decodes header bytes as Latin-1, one character per byte.
fn header_text(value: &HeaderValue) -> String {
    value
        .as_bytes()
        .iter()
        .map(|&byte| char::from(byte))
        .collect()
}

/// The token that `/^Bearer\s+(.+)$/i` captures, trimmed. `None` when the header does not match that pattern.
fn bearer_token(header: &str) -> Option<&str> {
    let scheme = header.get(..6)?;
    let rest = header.get(6..)?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    // `\s+` takes the white space in front, but the token keeps at least one character of its own.
    let lead = rest.find(|c: char| !is_js_space(c)).unwrap_or(rest.len());
    let split = if lead == rest.len() {
        rest.char_indices()
            .next_back()
            .map_or(0, |(index, _)| index)
    } else {
        lead
    };
    if split == 0 {
        return None;
    }
    let token = rest.get(split..)?;
    // The token is `.+`, which does not cross a line break.
    if token.contains(is_line_terminator) {
        return None;
    }
    Some(token.trim_matches(is_js_space))
}

/// The characters that JavaScript's `\s` and `trim` remove: white space and line terminators.
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// The characters that `.` does not match in a regular expression.
fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// The path the reference routes on. WHATWG URL parsing reads a leading `//` as a host, and resolves `.` and `..`.
fn routed_path(target: &str) -> String {
    let separator = |c: char| c == '/' || c == '\\';
    let mut path = target;
    if path.starts_with(separator) && path[1..].starts_with(separator) {
        path = path[2..]
            .find(separator)
            .map_or("", |index| &path[2 + index..]);
    }
    let body = path.strip_prefix(separator).unwrap_or(path);

    let parts: Vec<&str> = body.split(separator).collect();
    let last = parts.len() - 1;
    let mut segments: Vec<&str> = Vec::with_capacity(parts.len());
    for (index, part) in parts.iter().enumerate() {
        if is_single_dot(part) {
            if index == last {
                segments.push("");
            }
        } else if is_double_dot(part) {
            segments.pop();
            if index == last {
                segments.push("");
            }
        } else {
            segments.push(part);
        }
    }
    format!("/{}", segments.join("/"))
}

fn is_single_dot(segment: &str) -> bool {
    segment == "." || segment.eq_ignore_ascii_case("%2e")
}

fn is_double_dot(segment: &str) -> bool {
    ["..", ".%2e", "%2e.", "%2e%2e"]
        .iter()
        .any(|dots| segment.eq_ignore_ascii_case(dots))
}

/// Reads a chat completion request, or says what is wrong with it. Non-text parts are refused, not dropped.
pub fn read_completion_request(body: &Value) -> Result<CompletionRequest, CompletionError> {
    // TS quirk: an array passes the object check and fails on `messages`, not here.
    if !matches!(body, Value::Object(_) | Value::Array(_)) {
        return Err(CompletionError::NotObject);
    }

    let entries = match body.get("messages").and_then(Value::as_array) {
        Some(entries) if !entries.is_empty() => entries,
        _ => return Err(CompletionError::NoMessages),
    };

    let mut messages = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        let role = match entry.get("role").and_then(Value::as_str) {
            Some("system" | "developer") => Role::System,
            Some("user") => Role::User,
            Some("assistant") => Role::Assistant,
            _ => return Err(CompletionError::BadRole(index)),
        };

        let content = match entry.get("content") {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(text)) => text.clone(),
            Some(Value::Array(parts)) => {
                if parts.iter().any(is_non_text_part) {
                    return Err(CompletionError::NotText(index));
                }
                parts.iter().map(part_text).collect()
            }
            Some(_) => return Err(CompletionError::BadContent(index)),
        };

        messages.push(Message { role, content });
    }

    if !messages.iter().any(|message| message.role == Role::User) {
        return Err(CompletionError::NoUser);
    }

    Ok(CompletionRequest {
        model: body
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned(),
        messages,
        stream: body.get("stream") == Some(&Value::Bool(true)),
    })
}

/// A part is refused when it names a type that is truthy and is not "text". A missing or falsy type passes.
fn is_non_text_part(part: &Value) -> bool {
    match part.get("type") {
        Some(kind) => truthy(kind) && kind.as_str() != Some("text"),
        None => false,
    }
}

/// JavaScript truthiness for a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// The text of one part, read as `String(part?.text ?? "")` reads it.
fn part_text(part: &Value) -> String {
    match part.get("text") {
        None | Some(Value::Null) => String::new(),
        Some(text) => js_string(text),
    }
}

/// `String(value)` for a JSON value, as a text part is converted.
fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => js_number(number.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() {
                    String::new()
                } else {
                    js_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// `Number.prototype.toString` for a double: shortest digits, in fixed or exponent form as JavaScript picks.
fn js_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }

    let sign = if value < 0.0 { "-" } else { "" };
    // `{:e}` gives the shortest digits that round-trip, such as `1.5e-7`.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .unwrap_or((scientific.as_str(), "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let point = exponent + 1;
    let count = digits.len() as i32;

    let body = if count <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - count) as usize))
    } else if 0 < point && point <= 21 {
        format!(
            "{}.{}",
            &digits[..point as usize],
            &digits[point as usize..]
        )
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let e = point - 1;
        let e_sign = if e < 0 { "-" } else { "+" };
        if digits.len() == 1 {
            format!("{digits}e{e_sign}{}", e.abs())
        } else {
            format!("{}.{}e{e_sign}{}", &digits[..1], &digits[1..], e.abs())
        }
    };
    format!("{sign}{body}")
}

/// An error body in the shape OpenAI clients know how to show.
pub fn error_body(message: &str, kind: &str) -> String {
    #[derive(Serialize)]
    struct Envelope<'a> {
        error: Detail<'a>,
    }
    #[derive(Serialize)]
    struct Detail<'a> {
        message: &'a str,
        #[serde(rename = "type")]
        kind: &'a str,
    }
    to_json(&Envelope {
        error: Detail { message, kind },
    })
}

/// One streamed delta, as an SSE line. `content` of `None` sends an empty delta.
pub fn chunk_line(
    id: &str,
    model: &str,
    created: i64,
    content: Option<&str>,
    finish: Option<&'static str>,
) -> String {
    #[derive(Serialize)]
    struct Chunk<'a> {
        id: &'a str,
        object: &'static str,
        created: i64,
        model: &'a str,
        choices: [Choice<'a>; 1],
    }
    #[derive(Serialize)]
    struct Choice<'a> {
        index: u8,
        delta: Delta<'a>,
        finish_reason: Option<&'static str>,
    }
    #[derive(Serialize)]
    struct Delta<'a> {
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<&'a str>,
    }
    let chunk = Chunk {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [Choice {
            index: 0,
            delta: Delta { content },
            finish_reason: finish,
        }],
    };
    format!("data: {}\n\n", to_json(&chunk))
}

/// A whole reply in one piece, with its token usage.
pub fn completion_body(id: &str, model: &str, created: i64, content: &str, usage: Usage) -> String {
    #[derive(Serialize)]
    struct Completion<'a> {
        id: &'a str,
        object: &'static str,
        created: i64,
        model: &'a str,
        choices: [Choice<'a>; 1],
        usage: Counts,
    }
    #[derive(Serialize)]
    struct Choice<'a> {
        index: u8,
        message: Message<'a>,
        finish_reason: &'static str,
    }
    #[derive(Serialize)]
    struct Message<'a> {
        role: &'static str,
        content: &'a str,
    }
    #[derive(Serialize)]
    struct Counts {
        prompt_tokens: u64,
        completion_tokens: u64,
        total_tokens: u64,
    }
    to_json(&Completion {
        id,
        object: "chat.completion",
        created,
        model,
        choices: [Choice {
            index: 0,
            message: Message {
                role: "assistant",
                content,
            },
            finish_reason: "stop",
        }],
        usage: Counts {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.response_tokens,
            total_tokens: usage.prompt_tokens.saturating_add(usage.response_tokens),
        },
    })
}

/// The list of models, in the shape `GET /v1/models` answers with.
pub fn models_body(names: &[String], created: i64) -> String {
    #[derive(Serialize)]
    struct List<'a> {
        object: &'static str,
        data: Vec<Entry<'a>>,
    }
    #[derive(Serialize)]
    struct Entry<'a> {
        id: &'a str,
        object: &'static str,
        created: i64,
        owned_by: &'static str,
    }
    to_json(&List {
        object: "list",
        data: names
            .iter()
            .map(|name| Entry {
                id: name,
                object: "model",
                created,
                owned_by: "local",
            })
            .collect(),
    })
}

/// Encodes a value the server builds itself, which cannot fail for these shapes.
fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|error| {
        tracing::error!(target: "net.api", error = %error, "encode failed");
        String::new()
    })
}

struct Shared<B, E> {
    backend: Arc<B>,
    env: Arc<E>,
    port: u16,
    active: Arc<AtomicUsize>,
}

/// Counts one reply in progress, and gives the slot back when dropped.
struct ActiveGuard(Arc<AtomicUsize>);

impl ActiveGuard {
    fn enter(counter: Arc<AtomicUsize>) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self(counter)
    }
}

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// What a streamed reply still has to send, and the state that outlives the handler.
struct Frames {
    rx: mpsc::UnboundedReceiver<Update>,
    pending: VecDeque<String>,
    id: String,
    created: i64,
    model: String,
    finished: bool,
    cancel: Option<DropGuard>,
}

impl Frames {
    fn apply(&mut self, update: Option<Update>) {
        match update {
            Some(Update::Model(name)) => self.model = name,
            Some(Update::Text(text)) => {
                if !text.is_empty() {
                    self.pending.push_back(chunk_line(
                        &self.id,
                        &self.model,
                        self.created,
                        Some(&text),
                        None,
                    ));
                }
            }
            Some(Update::Finished(Ok(reply))) => {
                let model = if reply.model.is_empty() {
                    self.model.clone()
                } else {
                    reply.model
                };
                self.pending.push_back(chunk_line(
                    &self.id,
                    &model,
                    self.created,
                    None,
                    Some("stop"),
                ));
                self.pending.push_back(DONE_FRAME.to_owned());
                self.end();
            }
            Some(Update::Finished(Err(error))) => self.fail(&failure_message(&error)),
            None => self.fail(REPLY_FAILED),
        }
    }

    fn fail(&mut self, message: &str) {
        tracing::warn!(target: "net.api", streamed = true, "chat completion failed");
        self.pending
            .push_back(format!("data: {}\n\n", error_body(message, "server_error")));
        self.end();
    }

    /// The reply is over, so a client that leaves from now on cancels nothing.
    fn end(&mut self) {
        self.finished = true;
        if let Some(guard) = self.cancel.take() {
            let _ = guard.disarm();
        }
    }
}

async fn handle<B: Backend, E: Env>(
    State(shared): State<Arc<Shared<B, E>>>,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    let key = shared.env.api_key();
    if let Some(refusal) = check_request(&parts.headers, shared.port, &key) {
        tracing::debug!(target: "net.api", status = refusal.status.as_u16(), "request refused");
        return error_response(refusal.status, refusal.message, "authentication_error");
    }

    let path = routed_path(parts.uri.path());
    if parts.method == Method::GET && path == "/v1/models" {
        return models_response(&shared).await;
    }
    if parts.method != Method::POST || path != "/v1/chat/completions" {
        return error_response(
            StatusCode::NOT_FOUND,
            "Only /v1/chat/completions and /v1/models are served here.",
            "invalid_request_error",
        );
    }
    if shared.active.load(Ordering::SeqCst) >= MAX_CONCURRENT {
        return error_response(StatusCode::TOO_MANY_REQUESTS, BUSY, "rate_limit_error");
    }

    let bytes = match to_bytes(body, MAX_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(error) => {
            let too_large = error.into_inner().is::<LengthLimitError>();
            let (status, message) = if too_large {
                (StatusCode::PAYLOAD_TOO_LARGE, "The request is too large.")
            } else {
                (StatusCode::BAD_REQUEST, INVALID_JSON)
            };
            tracing::debug!(target: "net.api", status = status.as_u16(), "body rejected");
            return error_response(status, message, "invalid_request_error");
        }
    };

    let text = String::from_utf8_lossy(&bytes);
    let parsed = match serde_json::from_str::<Value>(&text) {
        Ok(parsed) => parsed,
        Err(_) => {
            tracing::debug!(target: "net.api", status = 400, "body rejected");
            return error_response(
                StatusCode::BAD_REQUEST,
                INVALID_JSON,
                "invalid_request_error",
            );
        }
    };

    match read_completion_request(&parsed) {
        Ok(request) => complete(&shared, request).await,
        Err(error) => error_response(
            StatusCode::BAD_REQUEST,
            &error.to_string(),
            "invalid_request_error",
        ),
    }
}

async fn models_response<B: Backend, E: Env>(shared: &Shared<B, E>) -> Response {
    match shared.backend.list_models().await {
        Ok(names) => json_response(StatusCode::OK, models_body(&names, shared.env.now_unix())),
        Err(_) => {
            tracing::error!(target: "net.api", "model list failed");
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                SERVER_ERROR,
                "server_error",
            )
        }
    }
}

async fn complete<B: Backend, E: Env>(
    shared: &Shared<B, E>,
    request: CompletionRequest,
) -> Response {
    let stream = request.stream;
    let chars: usize = request
        .messages
        .iter()
        .map(|message| message.content.encode_utf16().count())
        .sum();
    tracing::debug!(target: "net.api", stream, messages = request.messages.len(), chars, "chat completion");

    let id = completion_id(shared.env.as_ref());
    let created = shared.env.now_unix();
    let model = request.model.clone();

    // Dropping the response, or the handler's future, cancels the reply, as a closed socket does in the reference.
    let cancel = CancellationToken::new();
    let cancel_on_drop = cancel.clone().drop_guard();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sink = Sink(tx.clone());
    // The slot is held until generate settles, even once the client has left, as the reference holds it.
    let active = ActiveGuard::enter(shared.active.clone());
    let backend = shared.backend.clone();
    tokio::spawn(async move {
        let outcome = backend.generate(request, sink, cancel).await;
        drop(active);
        // Only a client that has left drops the receiver, and then nobody is waiting for the outcome.
        let _ = tx.send(Update::Finished(outcome));
    });

    if !stream {
        let outcome = next_outcome(&mut rx).await;
        let _ = cancel_on_drop.disarm();
        return match outcome {
            Some(Ok(reply)) => json_response(
                StatusCode::OK,
                completion_body(&id, &reply.model, created, &reply.content, reply.usage),
            ),
            Some(Err(error)) => {
                tracing::warn!(target: "net.api", streamed = false, "chat completion failed");
                error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &failure_message(&error),
                    "server_error",
                )
            }
            None => {
                tracing::warn!(target: "net.api", streamed = false, "chat completion failed");
                error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    REPLY_FAILED,
                    "server_error",
                )
            }
        };
    }

    let frames = Frames {
        rx,
        pending: VecDeque::new(),
        id,
        created,
        model,
        finished: false,
        cancel: Some(cancel_on_drop),
    };
    let body = Body::from_stream(stream::unfold(frames, next_frame));
    (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "text/event-stream"),
            (CACHE_CONTROL, "no-store"),
            (CONNECTION, "keep-alive"),
            (X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body,
    )
        .into_response()
}

async fn next_outcome(
    rx: &mut mpsc::UnboundedReceiver<Update>,
) -> Option<Result<Reply, BackendError>> {
    while let Some(update) = rx.recv().await {
        if let Update::Finished(outcome) = update {
            return Some(outcome);
        }
    }
    None
}

async fn next_frame(mut frames: Frames) -> Option<(Result<Bytes, Infallible>, Frames)> {
    loop {
        if let Some(frame) = frames.pending.pop_front() {
            return Some((Ok(Bytes::from(frame)), frames));
        }
        if frames.finished {
            return None;
        }
        let update = frames.rx.recv().await;
        frames.apply(update);
    }
}

/// The message to send for a failed reply. An empty message reads as no message at all.
fn failure_message(error: &BackendError) -> String {
    if error.message.is_empty() {
        REPLY_FAILED.to_owned()
    } else {
        error.message.clone()
    }
}

fn completion_id<E: Env>(env: &E) -> String {
    let mut random = [0u8; 12];
    env.fill_random(&mut random);
    let hex: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("chatcmpl-{hex}")
}

fn json_response(status: StatusCode, body: String) -> Response {
    (
        status,
        [
            (CONTENT_TYPE, "application/json"),
            (CACHE_CONTROL, "no-store"),
            (X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Body::from(body),
    )
        .into_response()
}

fn error_response(status: StatusCode, message: &str, kind: &str) -> Response {
    json_response(status, error_body(message, kind))
}
