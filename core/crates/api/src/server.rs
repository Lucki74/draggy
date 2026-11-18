//! The local OpenAI-compatible API.
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
//! - A request that is refused for its body never waits for a slot. Slots are taken only once the body is accepted.
//! - A part with no `type`, or a falsy one, is read as text, and its `text` is converted as `String()` converts it.
//! - Bodies decode as UTF-8 with replacement characters, as `Buffer.toString` does.
//! - Header bytes are read as Latin-1, as Node decodes them, and the Bearer whitespace is JavaScript's `\s`.
//! - A reply holds its slot until generate settles, even after its client has left, so abandoned replies still count.
//!
//! # Model mode
//!
//! A request with `tools`, `response_format`, a non-text part or a tool message goes to `Backend::forward` as the
//! client wrote it, apart from `model`. `draggy-agent` always gets agent mode, and the rest follow `Env::default_mode`.
//! A request waits up to `Env::queue_wait` for a slot, then gets 429 with `Retry-After`.

use std::collections::VecDeque;
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::body::{Body, Bytes, to_bytes};
use axum::extract::{Request, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
    ACCESS_CONTROL_MAX_AGE, AUTHORIZATION, CACHE_CONTROL, CONNECTION, CONTENT_TYPE, HOST as HOST_HEADER,
    ORIGIN, RETRY_AFTER, VARY, X_CONTENT_TYPE_OPTIONS,
};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures_util::stream::{self, Stream, StreamExt};
use http_body_util::LengthLimitError;
use serde::Serialize;
use serde_json::{Value, json};
use subtle::ConstantTimeEq;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc};
use tokio_util::sync::{CancellationToken, DropGuard};

use crate::dialect::{self, Dialect, Done, Keep, Opts};
use crate::log::{LogEntry, Note, Tokens, client_of};
use crate::ollama;
use crate::messages;
use crate::responses;
use crate::routes;
use crate::search::{self, Failure, Hit, Plan};
use crate::settings::{self, ApiSettings};
use crate::store::{Store, Stored};

/// The only address the reference listens on.
pub const HOST: &str = "127.0.0.1";

/// The port used when the caller does not choose one.
pub const DEFAULT_PORT: u16 = 11500;

/// Largest body an agent-mode request may have. A conversation, not a file upload.
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

/// The model name that always selects agent mode.
pub const AGENT_MODEL: &str = "draggy-agent";

const RETRY_AFTER_SECONDS: &str = "10";

const REPLY_FAILED: &str = "The reply failed.";
const SERVER_ERROR: &str = "The server hit an error.";
const INVALID_JSON: &str = "The body is not valid JSON.";
const TOO_LARGE: &str = "The request is too large.";
const NOT_AVAILABLE: &str = "Model mode is not available here.";
const BUSY: &str = "Draggy is already answering other requests. Try again shortly.";
const DONE_FRAME: &str = "data: [DONE]\n\n";

/// Produces replies and names the models that can be asked for. The app supplies the local engine.
pub trait Backend: Send + Sync + 'static {
    /// The models that can be asked for.
    fn list_models(&self) -> impl Future<Output = Result<Vec<ModelEntry>, BackendError>> + Send;

    /// Makes one reply. Text goes out through `sink` as it is made, and the model name once it is known.
    fn generate(
        &self,
        request: CompletionRequest,
        sink: Sink,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<Reply, BackendError>> + Send;

    /// Maps the model a client named to one that can answer, and gets it ready. A default such as "gpt-4o" maps to
    /// the model in use.
    fn prepare_model(
        &self,
        requested: &str,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<String, BackendError>> + Send {
        let _ = (requested, cancel);
        async {
            Err(BackendError {
                message: NOT_AVAILABLE.to_owned(),
            })
        }
    }

    /// Sends a model-mode body, with `model` already set, to the model and returns its answer as it comes.
    fn forward(
        &self,
        body: Value,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<ForwardReply, BackendError>> + Send {
        let _ = (body, cancel);
        async {
            Err(BackendError {
                message: NOT_AVAILABLE.to_owned(),
            })
        }
    }

    /// Like `forward`, for a legacy text completion body. The answer is the engine's own `/v1/completions` reply.
    fn forward_completions(
        &self,
        body: Value,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<ForwardReply, BackendError>> + Send {
        let _ = (body, cancel);
        async {
            Err(BackendError {
                message: NOT_AVAILABLE.to_owned(),
            })
        }
    }

    /// Searches the web for the built-in web search tool of the Responses and Messages routes.
    fn web_search(
        &self,
        query: &str,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<Vec<Hit>, BackendError>> + Send {
        let _ = (query, cancel);
        async {
            Err(BackendError {
                message: NOT_AVAILABLE.to_owned(),
            })
        }
    }

    /// Vectors for `inputs`, each a string or an array of token ids, from the embedding model nearest `model`.
    fn embed(
        &self,
        model: &str,
        inputs: Vec<Value>,
        cancel: CancellationToken,
    ) -> impl Future<Output = Result<Embedded, BackendError>> + Send {
        let _ = (model, inputs, cancel);
        async {
            Err(BackendError {
                message: "Embeddings are not available here.".to_owned(),
            })
        }
    }
}

/// Vectors in the order of the inputs, and the model that made them.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Embedded {
    pub model: String,
    pub vectors: Vec<Vec<f32>>,
}

/// Raw bytes of a model's answer. An error ends the stream.
pub type ByteStream = Pin<Box<dyn Stream<Item = Result<Bytes, BackendError>> + Send>>;

/// The model's answer to a forwarded body: its status and its bytes, SSE when the client asked for a stream.
pub struct ForwardReply {
    pub status: u16,
    pub body: ByteStream,
}

/// One model as `GET /v1/models` lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelEntry {
    pub id: String,
    pub owned_by: String,
    pub context_length: Option<u64>,
    /// Words such as `tools` and `vision`.
    pub capabilities: Vec<String>,
}

impl ModelEntry {
    /// A model on this computer, with nothing else known about it.
    pub fn local(id: &str) -> Self {
        Self {
            id: id.to_owned(),
            owned_by: "local".to_owned(),
            context_length: None,
            capabilities: Vec::new(),
        }
    }
}

/// Which path answers a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Draggy's agent loop with web tools.
    Agent,
    /// The model itself, with the client's body passed on.
    Model,
}

/// The key, the clock and the random bytes. The app reads them from its settings and the OS.
pub trait Env: Send + Sync + 'static {
    /// The key a request must present. An empty key refuses every request.
    fn api_key(&self) -> String;

    /// Seconds since the Unix epoch.
    fn now_unix(&self) -> i64;

    /// Fills `buffer` with random bytes, used for completion ids.
    fn fill_random(&self, buffer: &mut [u8]);

    /// The mode for a plain request that asks for neither.
    fn default_mode(&self) -> Mode {
        Mode::Agent
    }

    /// The settings now in force, read for every request so a change applies without a restart.
    /// Keeps one served request in the log. Called only while `logRequests` is on.
    fn record(&self, entry: LogEntry) {
        let _ = entry;
    }

    fn settings(&self) -> ApiSettings {
        ApiSettings::default()
    }

    /// How long a request waits for a free slot.
    fn queue_wait(&self) -> Duration {
        self.settings().queue_wait()
    }
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
    #[error("messages[{0}].role must be system, developer, user, assistant or tool.")]
    BadModelRole(usize),
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
        slots: Arc::new(Slots::new(settings::DEFAULT_MAX_PARALLEL as usize)),
        store: Arc::default(),
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
    check_access(headers, port, key, &ApiSettings::default(), "")
}

/// `check_request` with the settings: an Origin listed in `allowed_origins` passes, and `/api/` needs no key when
/// `ollama_no_key` is set.
pub fn check_access(
    headers: &HeaderMap,
    port: u16,
    key: &str,
    settings: &ApiSettings,
    path: &str,
) -> Option<Refusal> {
    // A browser sends Origin on a cross-site request, and only a page the user listed may call.
    if headers.contains_key(ORIGIN) && allowed_origin(headers, settings).is_none() {
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

    if settings.ollama_no_key && path.starts_with("/api/") {
        return None;
    }

    let authorization = headers
        .get(AUTHORIZATION)
        .map(header_text)
        .unwrap_or_default();
    if bearer_token(&authorization).is_some_and(|token| same_key(token, key)) {
        return None;
    }
    // Anthropic clients send the key in x-api-key.
    let api_key = headers.get("x-api-key").map(header_text).unwrap_or_default();
    if same_key(api_key.trim_matches(is_js_space), key) {
        return None;
    }
    Some(Refusal {
        status: StatusCode::UNAUTHORIZED,
        message: "Missing or wrong API key.",
    })
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
    let entries: Vec<ModelEntry> = names.iter().map(|name| ModelEntry::local(name)).collect();
    entries_body(&entries, created)
}

/// The list of models with what is known about each.
pub fn entries_body(entries: &[ModelEntry], created: i64) -> String {
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
        owned_by: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        context_length: Option<u64>,
        #[serde(skip_serializing_if = "<[String]>::is_empty")]
        capabilities: &'a [String],
    }
    to_json(&List {
        object: "list",
        data: entries
            .iter()
            .map(|entry| Entry {
                id: &entry.id,
                object: "model",
                created,
                owned_by: &entry.owned_by,
                context_length: entry.context_length,
                capabilities: &entry.capabilities,
            })
            .collect(),
    })
}

/// Which path answers a body. `draggy-agent` forces the agent, and anything the agent cannot carry goes to the model.
pub fn route(body: &Value, default: Mode) -> Mode {
    if body.get("model").and_then(Value::as_str) == Some(AGENT_MODEL) {
        return Mode::Agent;
    }
    if needs_model(body) { Mode::Model } else { default }
}

fn needs_model(body: &Value) -> bool {
    let has_tools = body
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| !tools.is_empty());
    let has_format = body.get("response_format").is_some_and(|f| !f.is_null());
    if has_tools || has_format {
        return true;
    }
    body.get("messages")
        .and_then(Value::as_array)
        .is_some_and(|messages| messages.iter().any(message_needs_model))
}

fn message_needs_model(message: &Value) -> bool {
    if message.get("role").and_then(Value::as_str) == Some("tool") {
        return true;
    }
    if message.get("tool_calls").is_some_and(|calls| !calls.is_null()) {
        return true;
    }
    message
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|parts| parts.iter().any(is_non_text_part))
}

/// A light check of a model-mode body. Everything else in it is the model's to judge.
pub fn check_model_body(body: &Value) -> Result<(), CompletionError> {
    if !body.is_object() {
        return Err(CompletionError::NotObject);
    }
    let messages = match body.get("messages").and_then(Value::as_array) {
        Some(messages) if !messages.is_empty() => messages,
        _ => return Err(CompletionError::NoMessages),
    };
    for (index, message) in messages.iter().enumerate() {
        match message.get("role").and_then(Value::as_str) {
            Some("system" | "developer" | "user" | "assistant" | "tool") => {}
            _ => return Err(CompletionError::BadModelRole(index)),
        }
    }
    Ok(())
}

/// Clients that speak the newer name get the older one too, as engines read that one.
pub(crate) fn alias_max_tokens(body: &mut Value) {
    let Some(object) = body.as_object_mut() else {
        return;
    };
    let unset = object.get("max_tokens").is_none_or(Value::is_null);
    if unset && let Some(limit) = object.get("max_completion_tokens").filter(|v| !v.is_null()) {
        let limit = limit.clone();
        object.insert("max_tokens".to_owned(), limit);
    }
}

/// Encodes a value the server builds itself, which cannot fail for these shapes.
fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|error| {
        tracing::error!(target: "net.api", error = %error, "encode failed");
        String::new()
    })
}

pub(crate) struct Shared<B, E> {
    pub(crate) backend: Arc<B>,
    pub(crate) env: Arc<E>,
    port: u16,
    slots: Arc<Slots>,
    /// The Responses kept for `previous_response_id` and the `GET` routes.
    pub(crate) store: Arc<Mutex<Store>>,
}

/// The reply slots, whose number can change while requests hold some.
struct Slots {
    semaphore: Arc<Semaphore>,
    /// The size now wanted, and slots still held that must be dropped instead of reused.
    state: Mutex<(usize, usize)>,
}

impl Slots {
    fn new(size: usize) -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(size)),
            state: Mutex::new((size, 0)),
        }
    }

    fn resize(&self, size: usize) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let (current, debt) = *state;
        if size > current {
            let cancelled = debt.min(size - current);
            self.semaphore.add_permits(size - current - cancelled);
            *state = (size, debt - cancelled);
        } else if size < current {
            let wanted = current - size;
            let forgotten = self.semaphore.forget_permits(wanted);
            *state = (size, debt + (wanted - forgotten));
        }
    }
}

/// A held slot. Given back on drop, or retired when the slots have shrunk.
pub(crate) struct Permit {
    inner: Option<OwnedSemaphorePermit>,
    slots: Arc<Slots>,
}

impl Drop for Permit {
    fn drop(&mut self) {
        let Some(permit) = self.inner.take() else {
            return;
        };
        let mut state = self.slots.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.1 > 0 {
            state.1 -= 1;
            permit.forget();
        }
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

/// The Origin header when it is exactly one the user listed.
fn allowed_origin(headers: &HeaderMap, settings: &ApiSettings) -> Option<String> {
    let origin = headers.get(ORIGIN).map(header_text)?;
    settings
        .allowed_origins
        .contains(&origin)
        .then_some(origin)
}

fn host_matches(headers: &HeaderMap, port: u16) -> bool {
    let host = headers
        .get(HOST_HEADER)
        .map(header_text)
        .unwrap_or_default()
        .to_ascii_lowercase();
    host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
}

fn with_cors(response: &mut Response, origin: &str) {
    if let Ok(value) = HeaderValue::from_str(origin) {
        response.headers_mut().insert(ACCESS_CONTROL_ALLOW_ORIGIN, value);
        response.headers_mut().append(VARY, HeaderValue::from_static("Origin"));
    }
}

/// Answers a preflight: 204 for a listed origin on this host, 403 for anything else. The key is not asked for.
fn preflight(headers: &HeaderMap, port: u16, settings: &ApiSettings) -> Response {
    let origin = allowed_origin(headers, settings);
    let (Some(origin), true) = (origin, host_matches(headers, port)) else {
        let mut response = error_response(
            StatusCode::FORBIDDEN,
            "Requests from web pages are not accepted.",
            "authentication_error",
        );
        response.headers_mut().append(VARY, HeaderValue::from_static("Origin"));
        return response;
    };
    let mut response = StatusCode::NO_CONTENT.into_response();
    let out = response.headers_mut();
    out.insert(ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, DELETE, OPTIONS"));
    out.insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("authorization, content-type, x-api-key, anthropic-version, openai-beta"),
    );
    out.insert(ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
    with_cors(&mut response, &origin);
    response
}

async fn handle<B: Backend, E: Env>(
    State(shared): State<Arc<Shared<B, E>>>,
    mut request: Request,
) -> Response {
    let settings = shared.env.settings();
    if request.method() == Method::OPTIONS {
        return preflight(request.headers(), shared.port, &settings);
    }
    let origin = allowed_origin(request.headers(), &settings);
    let started = std::time::Instant::now();
    let note = Note::default();
    request.extensions_mut().insert(note.clone());
    let method = request.method().to_string();
    let path = routed_path(request.uri().path());
    let client = client_of(
        request
            .headers()
            .get(axum::http::header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .unwrap_or(""),
    );
    let env = shared.env.clone();
    let mut response = handle_request(shared, request).await;
    if let Some(origin) = origin {
        with_cors(&mut response, &origin);
    }
    if settings.log_requests {
        let (model, mode) = note.read();
        let tokens = response.extensions().get::<Tokens>().copied().unwrap_or(Tokens(0, 0));
        env.record(LogEntry {
            time: env.now_unix(),
            method,
            path,
            model,
            mode: mode.to_owned(),
            status: response.status().as_u16(),
            duration_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            prompt_tokens: tokens.0,
            completion_tokens: tokens.1,
            client,
        });
    }
    response
}

async fn handle_request<B: Backend, E: Env>(
    shared: Arc<Shared<B, E>>,
    request: Request,
) -> Response {
    let (parts, body) = request.into_parts();
    let key = shared.env.api_key();
    let settings = shared.env.settings();
    let path = routed_path(parts.uri.path());
    let dialect = match path.as_str() {
        "/v1/responses" => Some(Dialect::Responses),
        "/v1/messages" | "/v1/messages/count_tokens" => Some(Dialect::Messages),
        "/api/chat" => Some(Dialect::OllamaChat),
        "/api/generate" => Some(Dialect::OllamaGenerate),
        _ => None,
    };
    // Errors on any Ollama path use Ollama's shape.
    let shape = if path.starts_with("/api/") { Some(Dialect::OllamaChat) } else { dialect };
    let counting = path == "/v1/messages/count_tokens";
    if let Some(refusal) = check_access(&parts.headers, shared.port, &key, &settings, &path) {
        tracing::debug!(target: "net.api", status = refusal.status.as_u16(), "request refused");
        return shaped_error(shape, refusal.status, refusal.message, "authentication_error");
    }

    if parts.method == Method::GET && path == "/v1/models" {
        return models_response(&shared).await;
    }
    if parts.method == Method::GET
        && let Some(id) = path.strip_prefix("/v1/models/").filter(|id| !id.is_empty() && !id.contains('/'))
    {
        return model_response(&shared, id, &settings).await;
    }
    if parts.method == Method::GET
        && let Some(response) = routes::ollama_get(&shared, &path).await
    {
        return response;
    }
    if let Some(response) = routes::responses_route(&shared, &parts.method, &path, parts.uri.query()) {
        return response;
    }
    let posted = matches!(
        path.as_str(),
        "/v1/chat/completions" | "/v1/embeddings" | "/v1/completions" | "/api/show" | "/api/embed" | "/api/embeddings"
    );
    if parts.method != Method::POST || (!posted && dialect.is_none()) {
        return shaped_error(
            shape,
            StatusCode::NOT_FOUND,
            "Only /v1/chat/completions and /v1/models are served here.",
            "invalid_request_error",
        );
    }
    let bytes = match to_bytes(body, settings.max_body_bytes()).await {
        Ok(bytes) => bytes,
        Err(error) => {
            let too_large = error.into_inner().is::<LengthLimitError>();
            let (status, message) = if too_large {
                (StatusCode::PAYLOAD_TOO_LARGE, TOO_LARGE)
            } else {
                (StatusCode::BAD_REQUEST, INVALID_JSON)
            };
            tracing::debug!(target: "net.api", status = status.as_u16(), "body rejected");
            return shaped_error(shape, status, message, "invalid_request_error");
        }
    };
    // Past the agent's limit only a model-mode body is read at all.
    let oversize = bytes.len() > MAX_BODY_BYTES;

    let text = String::from_utf8_lossy(&bytes);
    let mut parsed = match serde_json::from_str::<Value>(&text) {
        Ok(parsed) => parsed,
        Err(_) => {
            let (status, message) = if oversize {
                (StatusCode::PAYLOAD_TOO_LARGE, TOO_LARGE)
            } else {
                (StatusCode::BAD_REQUEST, INVALID_JSON)
            };
            tracing::debug!(target: "net.api", status = status.as_u16(), "body rejected");
            return shaped_error(shape, status, message, "invalid_request_error");
        }
    };

    // Responses and Messages bodies become chat bodies and always go to the model.
    let mut opts = Opts::default();
    if let Some(dialect) = dialect {
        if dialect.is_ollama()
            && let Some(reply) = ollama::load_reply(
                dialect == Dialect::OllamaGenerate,
                &parsed,
                parsed.get("model").and_then(Value::as_str).unwrap_or(""),
                shared.env.now_unix(),
            )
        {
            return json_response(StatusCode::OK, reply.to_string());
        }
        opts.web_search = search::requested(dialect, &parsed);
        let converted = if dialect == Dialect::Responses {
            match responses_chat(&shared, &parsed, &mut opts) {
                Ok(chat) => Ok(chat),
                Err(other) => match *other {
                    Ok(response) => return response,
                    Err(message) => Err(message),
                },
            }
        } else {
            dialect::to_chat(dialect, &parsed)
        };
        match converted {
            Ok(chat) => parsed = chat,
            Err(message) => {
                return shaped_error(Some(dialect), StatusCode::BAD_REQUEST, &message, "invalid_request_error");
            }
        }
        if counting {
            let tokens = messages::count_tokens(&parsed);
            return json_response(StatusCode::OK, json!({"input_tokens": tokens}).to_string());
        }
    }

    let renamed = parsed
        .get("model")
        .and_then(Value::as_str)
        .and_then(|name| settings::resolve_alias(name, &settings.aliases))
        .map(str::to_owned);
    if let Some(name) = renamed {
        parsed["model"] = Value::String(name);
    }
    let mode = if dialect.is_some() {
        Mode::Model
    } else {
        route(&parsed, shared.env.default_mode())
    };
    if let Some(note) = parts.extensions.get::<Note>() {
        let model = parsed.get("model").and_then(Value::as_str).unwrap_or("");
        note.set(model, if mode == Mode::Model { "model" } else { "agent" });
    }
    if oversize && mode != Mode::Model {
        tracing::debug!(target: "net.api", status = 413, "body rejected");
        return error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            TOO_LARGE,
            "invalid_request_error",
        );
    }

    match path.as_str() {
        "/v1/embeddings" => return routes::embeddings(&shared, &parsed).await,
        "/v1/completions" => return routes::completions(&shared, parsed, &settings).await,
        "/api/show" => return routes::ollama_show(&shared, &parsed, &settings).await,
        "/api/embed" => return routes::ollama_embed(&shared, &parsed, false).await,
        "/api/embeddings" => return routes::ollama_embed(&shared, &parsed, true).await,
        _ => {}
    }

    if mode == Mode::Model {
        if let Err(error) = check_model_body(&parsed) {
            return shaped_error(
                shape,
                StatusCode::BAD_REQUEST,
                &error.to_string(),
                "invalid_request_error",
            );
        }
        settings::prepend_system(&mut parsed, &settings.system_prompt);
        let permit = match take_slot(&shared, dialect).await {
            Ok(permit) => permit,
            Err(busy) => return busy,
        };
        return forward_model(&shared, parsed, permit, &settings, (dialect, opts)).await;
    }

    settings::prepend_system(&mut parsed, &settings.system_prompt);
    match read_completion_request(&parsed) {
        Ok(request) => {
            let permit = match take_slot(&shared, None).await {
                Ok(permit) => permit,
                Err(busy) => return busy,
            };
            complete(&shared, request, permit).await
        }
        Err(error) => error_response(
            StatusCode::BAD_REQUEST,
            &error.to_string(),
            "invalid_request_error",
        ),
    }
}

/// The chat request for a Responses body. A body that continues a kept response carries that chat first.
/// `Err(Ok(_))` is an answer to send as it is.
fn responses_chat<B: Backend, E: Env>(
    shared: &Shared<B, E>,
    body: &Value,
    opts: &mut Opts,
) -> Result<Value, Box<Result<Response, String>>> {
    let previous = body.get("previous_response_id").and_then(Value::as_str).filter(|id| !id.is_empty());
    let prior = match previous {
        Some(id) => {
            let store = shared.store.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            match store.get(id) {
                Some(stored) => stored.messages.clone(),
                None => {
                    let message = format!("Previous response with id '{id}' not found.");
                    return Err(Box::new(Ok(routes::not_found(&message, "previous_response_id", "previous_response_not_found"))));
                }
            }
        }
        None => Vec::new(),
    };
    let chat = responses::to_chat_after(body, &prior).map_err(|message| Box::new(Err(message)))?;
    opts.meta = responses::meta(body);
    if body.get("store") != Some(&Value::Bool(false)) {
        opts.keep = Some(Keep {
            messages: responses::kept_messages(body, &chat),
            input: responses::input_items(body),
        });
    }
    Ok(chat)
}

/// Keeps a finished response with the chat that led to it.
fn remember(store: &Mutex<Store>, keep: Keep, response: Value) {
    let Some(id) = response["id"].as_str().map(str::to_owned) else {
        return;
    };
    let mut messages = keep.messages;
    messages.extend(responses::assistant_messages(&response));
    let stored = Stored { messages, input: keep.input, response };
    store.lock().unwrap_or_else(std::sync::PoisonError::into_inner).put(&id, stored);
}

/// Waits for a free slot, and answers 429 with `Retry-After` when none comes in time.
#[allow(clippy::result_large_err)]
pub(crate) async fn take_slot<B: Backend, E: Env>(
    shared: &Shared<B, E>,
    dialect: Option<Dialect>,
) -> Result<Permit, Response> {
    let wait = shared.env.queue_wait();
    let slots = shared.slots.clone();
    slots.resize(shared.env.settings().max_parallel);
    let semaphore = slots.semaphore.clone();
    // A zero wait answers at once instead of waiting for a timer.
    let permit = if wait.is_zero() {
        semaphore.try_acquire_owned().ok()
    } else {
        tokio::time::timeout(wait, semaphore.acquire_owned())
            .await
            .ok()
            .and_then(Result::ok)
    };
    match permit {
        Some(inner) => Ok(Permit {
            inner: Some(inner),
            slots,
        }),
        None => {
            let mut response =
                shaped_error(dialect, StatusCode::TOO_MANY_REQUESTS, BUSY, "rate_limit_error");
            response
                .headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from_static(RETRY_AFTER_SECONDS));
            Err(response)
        }
    }
}

async fn models_response<B: Backend, E: Env>(shared: &Shared<B, E>) -> Response {
    match shared.backend.list_models().await {
        Ok(mut entries) => {
            entries.push(ModelEntry {
                id: AGENT_MODEL.to_owned(),
                owned_by: "draggy".to_owned(),
                context_length: None,
                capabilities: Vec::new(),
            });
            json_response(
                StatusCode::OK,
                entries_body(&entries, shared.env.now_unix()),
            )
        }
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

/// One model of `GET /v1/models`, by id. An alias finds the model it names.
async fn model_response<B: Backend, E: Env>(
    shared: &Shared<B, E>,
    id: &str,
    settings: &ApiSettings,
) -> Response {
    let Ok(mut entries) = shared.backend.list_models().await else {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, SERVER_ERROR, "server_error");
    };
    entries.push(ModelEntry {
        id: AGENT_MODEL.to_owned(),
        owned_by: "draggy".to_owned(),
        context_length: None,
        capabilities: Vec::new(),
    });
    let wanted = settings::resolve_alias(id, &settings.aliases).unwrap_or(id);
    match entries.iter().find(|entry| entry.id == wanted) {
        Some(entry) => {
            let list = entries_body(std::slice::from_ref(entry), shared.env.now_unix());
            let one = serde_json::from_str::<Value>(&list)
                .ok()
                .and_then(|list| list.pointer("/data/0").cloned())
                .unwrap_or(Value::Null);
            json_response(StatusCode::OK, one.to_string())
        }
        None => error_response(
            StatusCode::NOT_FOUND,
            &format!("The model '{id}' does not exist."),
            "invalid_request_error",
        ),
    }
}

async fn complete<B: Backend, E: Env>(
    shared: &Shared<B, E>,
    request: CompletionRequest,
    permit: Permit,
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
    let backend = shared.backend.clone();
    tokio::spawn(async move {
        let outcome = backend.generate(request, sink, cancel).await;
        drop(permit);
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
pub(crate) fn failure_message(error: &BackendError) -> String {
    if error.message.is_empty() {
        REPLY_FAILED.to_owned()
    } else {
        error.message.clone()
    }
}

pub(crate) fn completion_id<E: Env>(env: &E) -> String {
    let mut random = [0u8; 12];
    env.fill_random(&mut random);
    let hex: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("chatcmpl-{hex}")
}

pub(crate) fn json_response(status: StatusCode, body: String) -> Response {
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

pub(crate) fn error_response(status: StatusCode, message: &str, kind: &str) -> Response {
    json_response(status, error_body(message, kind))
}

/// An error in the shape the route's clients read.
pub(crate) fn shaped_error(dialect: Option<Dialect>, status: StatusCode, message: &str, kind: &str) -> Response {
    json_response(status, dialect::error_json(dialect, status, message, kind))
}

/// Sends a model-mode body to the model and gives its answer back, fixing only what a client trips on.
async fn forward_model<B: Backend, E: Env>(
    shared: &Shared<B, E>,
    mut body: Value,
    permit: Permit,
    settings: &ApiSettings,
    route: (Option<Dialect>, Opts),
) -> Response {
    let (dialect, mut opts) = route;
    opts.thinking = settings.send_reasoning;
    let stream = body.get("stream") == Some(&Value::Bool(true));
    let include_usage = body.pointer("/stream_options/include_usage") == Some(&Value::Bool(true));
    alias_max_tokens(&mut body);
    settings::apply_sampling(&mut body, &settings.sampling);
    let strip = !settings.send_reasoning;
    let requested = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    tracing::debug!(target: "net.api", stream, "model request");
    let started = std::time::Instant::now();

    // Dropping the handler's future, or the stream below, cancels the request.
    let cancel = CancellationToken::new();
    let guard = cancel.clone().drop_guard();

    let model = match shared.backend.prepare_model(&requested, cancel.clone()).await {
        Ok(model) => model,
        Err(error) => return model_failure(&error, dialect),
    };
    body["model"] = Value::String(model.clone());

    let mut searched = None;
    if let (Some(max), Some(_)) = (opts.web_search, dialect) {
        let plan = Plan { max, enabled: settings.agent_web_tools };
        match search::rounds(shared.backend.as_ref(), body.clone(), &plan, &cancel).await {
            Ok(rounded) => {
                opts.searches = rounded.searches;
                searched = Some(rounded.chat);
            }
            Err(Failure::Backend(error)) => return model_failure(&error, dialect),
            Err(Failure::Upstream(status, bytes)) => {
                let status = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
                let id = completion_id(shared.env.as_ref());
                let created = shared.env.now_unix();
                let ids = (id.as_str(), model.as_str(), created);
                let asked = (started.elapsed(), &opts);
                return dialect_response(dialect.unwrap_or(Dialect::Messages), status, &bytes, ids, asked, |_| {});
            }
        }
    }

    let reply = match searched {
        Some(chat) => ForwardReply {
            status: 200,
            body: if stream { search::as_stream(&chat) } else { search::as_bytes(&chat) },
        },
        None => match shared.backend.forward(body, cancel.clone()).await {
            Ok(reply) => reply,
            Err(error) => return model_failure(&error, dialect),
        },
    };
    let id = completion_id(shared.env.as_ref());
    let created = shared.env.now_unix();
    let status = StatusCode::from_u16(reply.status).unwrap_or(StatusCode::BAD_GATEWAY);

    if !(stream && status.is_success()) {
        let mut bytes = Vec::new();
        let mut upstream = reply.body;
        while let Some(chunk) = upstream.next().await {
            match chunk {
                Ok(chunk) => bytes.extend_from_slice(&chunk),
                Err(error) => return model_failure(&error, dialect),
            }
        }
        let _ = guard.disarm();
        drop(permit);
        if let Some(dialect) = dialect {
            let store = shared.store.clone();
            let keep = opts.keep.clone();
            let kept = move |response: &Value| {
                if let Some(keep) = keep {
                    remember(&store, keep, response.clone());
                }
            };
            return dialect_response(dialect, status, &bytes, (&id, &model, created), (started.elapsed(), &opts), kept);
        }
        return buffered_response(status, &bytes, &id, &model, created, strip);
    }

    if let Some(dialect) = dialect {
        let translator = dialect::translator_with(dialect, &id, &model, created, &opts);
        let store = shared.store.clone();
        let done: Option<Done> = opts.keep.clone().map(|keep| -> Done {
            Box::new(move |response| {
                if let Some(response) = response {
                    remember(&store, keep, response);
                }
            })
        });
        let body = Body::from_stream(dialect::translated_stream(reply.body, translator, guard, permit, done));
        return if dialect.is_ollama() { ndjson_response(body) } else { sse_response(body) };
    }

    let relay = Relay {
        upstream: reply.body,
        buffer: Vec::new(),
        pending: VecDeque::new(),
        id,
        created,
        model,
        include_usage,
        strip,
        last_usage: None,
        usage_sent: false,
        finished: false,
        cancel: Some(guard),
        permit: Some(permit),
    };
    sse_response(Body::from_stream(stream::unfold(relay, next_relayed)))
}

fn ndjson_response(body: Body) -> Response {
    (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "application/x-ndjson"),
            (CACHE_CONTROL, "no-store"),
            (X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        body,
    )
        .into_response()
}

pub(crate) fn sse_response(body: Body) -> Response {
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

/// A whole answer for a Responses or Messages client.
fn dialect_response(
    dialect: Dialect,
    status: StatusCode,
    bytes: &[u8],
    ids: (&str, &str, i64),
    asked: (std::time::Duration, &Opts),
    kept: impl FnOnce(&Value),
) -> Response {
    let (elapsed, opts) = asked;
    if status.is_success() {
        let reply = serde_json::from_slice::<Value>(bytes)
            .ok()
            .and_then(|chat| dialect::whole_reply_with(dialect, &chat, ids, opts))
            .map(|mut reply| {
                if dialect.is_ollama() {
                    reply["total_duration"] = Value::from(u64::try_from(elapsed.as_nanos()).unwrap_or(u64::MAX));
                }
                reply
            });
        let tokens = serde_json::from_slice::<Value>(bytes).map_or((0, 0), |chat| dialect::usage_of(&chat));
        return match reply {
            Some(reply) => {
                kept(&reply);
                let mut response = json_response(status, reply.to_string());
                response.extensions_mut().insert(Tokens(tokens.0, tokens.1));
                response
            }
            None => shaped_error(
                Some(dialect),
                StatusCode::BAD_GATEWAY,
                "The model's reply could not be read.",
                "server_error",
            ),
        };
    }
    shaped_error(
        Some(dialect),
        status,
        &dialect::upstream_message(bytes),
        error_kind(status),
    )
}

pub(crate) fn model_failure(error: &BackendError, dialect: Option<Dialect>) -> Response {
    tracing::warn!(target: "net.api", "model request failed");
    shaped_error(
        dialect,
        StatusCode::INTERNAL_SERVER_ERROR,
        &failure_message(error),
        "server_error",
    )
}

/// The `type` OpenAI clients read from an error, by status.
pub(crate) fn error_kind(status: StatusCode) -> &'static str {
    match status.as_u16() {
        401 | 403 => "authentication_error",
        429 => "rate_limit_error",
        400..=499 => "invalid_request_error",
        _ => "server_error",
    }
}

/// A whole answer. A success gets the fields a client expects, and an error gets the shape clients show.
pub(crate) fn buffered_response(
    status: StatusCode,
    bytes: &[u8],
    id: &str,
    model: &str,
    created: i64,
    strip: bool,
) -> Response {
    let parsed = serde_json::from_slice::<Value>(bytes);
    if status.is_success() {
        return match parsed {
            Ok(mut value) => {
                patch_completion(&mut value, id, model, created);
                if strip {
                    settings::strip_reasoning(&mut value);
                }
                let (prompt, completion) = dialect::usage_of(&value);
                let mut response = json_response(status, value.to_string());
                response.extensions_mut().insert(Tokens(prompt, completion));
                response
            }
            Err(_) => error_response(
                StatusCode::BAD_GATEWAY,
                "The model's reply could not be read.",
                "server_error",
            ),
        };
    }
    let kind = error_kind(status);
    let value = match parsed {
        Ok(mut value) if value.get("error").is_some_and(Value::is_object) => {
            if let Some(error) = value.get_mut("error").and_then(Value::as_object_mut) {
                if !error.get("message").is_some_and(Value::is_string) {
                    error.insert("message".to_owned(), Value::String(REPLY_FAILED.to_owned()));
                }
                if !error.get("type").is_some_and(Value::is_string) {
                    error.insert("type".to_owned(), Value::String(kind.to_owned()));
                }
            }
            value
        }
        _ => {
            let text = String::from_utf8_lossy(bytes);
            let message = text.trim();
            let message = if message.is_empty() || message.len() > 500 {
                REPLY_FAILED
            } else {
                message
            };
            return json_response(status, error_body(message, kind));
        }
    };
    json_response(status, value.to_string())
}

/// Fills in what a whole answer must carry. The model is the one asked for, and a missing finish reason reads `stop`.
fn patch_completion(value: &mut Value, id: &str, model: &str, created: i64) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if object.contains_key("error") && !object.contains_key("choices") {
        return;
    }
    if !object.get("id").is_some_and(|v| v.as_str().is_some_and(|s| !s.is_empty())) {
        object.insert("id".to_owned(), Value::String(id.to_owned()));
    }
    object.insert("object".to_owned(), Value::String("chat.completion".to_owned()));
    object.insert("model".to_owned(), Value::String(model.to_owned()));
    if !object.get("created").is_some_and(Value::is_number) {
        object.insert("created".to_owned(), Value::from(created));
    }
    let Some(choices) = object.get_mut("choices").and_then(Value::as_array_mut) else {
        return;
    };
    for choice in choices {
        let Some(choice) = choice.as_object_mut() else {
            continue;
        };
        if choice.get("finish_reason").is_none_or(Value::is_null) {
            let calls = choice
                .get("message")
                .and_then(|message| message.get("tool_calls"))
                .and_then(Value::as_array)
                .is_some_and(|calls| !calls.is_empty());
            let reason = if calls { "tool_calls" } else { "stop" };
            choice.insert("finish_reason".to_owned(), Value::String(reason.to_owned()));
        }
    }
}

/// A model's stream on its way to the client: events are passed on, with `[DONE]` and a usage chunk made sure of.
struct Relay {
    upstream: ByteStream,
    buffer: Vec<u8>,
    pending: VecDeque<Bytes>,
    id: String,
    created: i64,
    model: String,
    include_usage: bool,
    strip: bool,
    last_usage: Option<Value>,
    usage_sent: bool,
    finished: bool,
    cancel: Option<DropGuard>,
    permit: Option<Permit>,
}

impl Relay {
    fn take_events(&mut self, upstream_ended: bool) {
        while let Some(event) = split_event(&mut self.buffer) {
            self.event(&String::from_utf8_lossy(&event));
        }
        if upstream_ended && !self.buffer.is_empty() {
            let rest = std::mem::take(&mut self.buffer);
            self.event(&String::from_utf8_lossy(&rest));
        }
    }

    fn event(&mut self, raw: &str) {
        let lines: Vec<&str> = raw.split('\n').map(|l| l.trim_end_matches('\r')).collect();
        let data: Vec<&str> = lines
            .iter()
            .filter_map(|line| line.strip_prefix("data:"))
            .collect();
        if data.len() != 1 {
            if !raw.trim().is_empty() {
                self.pending.push_back(Bytes::from(format!("{raw}\n\n")));
            }
            return;
        }
        let payload = data[0].trim();
        if payload == "[DONE]" {
            return;
        }
        let Ok(mut value) = serde_json::from_str::<Value>(payload) else {
            self.pending.push_back(Bytes::from(format!("{raw}\n\n")));
            return;
        };
        self.patch(&mut value);
        if self.strip {
            settings::strip_reasoning(&mut value);
        }
        let mut out: String = lines
            .iter()
            .filter(|line| !line.starts_with("data:") && !line.is_empty())
            .map(|line| format!("{line}\n"))
            .collect();
        out.push_str(&format!("data: {value}\n\n"));
        self.pending.push_back(Bytes::from(out));
    }

    fn patch(&mut self, value: &mut Value) {
        let Some(object) = value.as_object_mut() else {
            return;
        };
        if object.contains_key("error") && !object.contains_key("choices") {
            return;
        }
        if !object.get("id").is_some_and(|v| v.as_str().is_some_and(|s| !s.is_empty())) {
            object.insert("id".to_owned(), Value::String(self.id.clone()));
        }
        object.insert(
            "object".to_owned(),
            Value::String("chat.completion.chunk".to_owned()),
        );
        object.insert("model".to_owned(), Value::String(self.model.clone()));
        if !object.get("created").is_some_and(Value::is_number) {
            object.insert("created".to_owned(), Value::from(self.created));
        }
        if let Some(usage) = object.get("usage").filter(|usage| usage.is_object()) {
            self.last_usage = Some(usage.clone());
            let empty = object
                .get("choices")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty);
            if empty {
                self.usage_sent = true;
            }
        }
    }

    fn fail(&mut self, message: &str) {
        tracing::warn!(target: "net.api", streamed = true, "model stream failed");
        self.pending.push_back(Bytes::from(format!(
            "data: {}\n\n",
            error_body(message, "server_error")
        )));
        self.pending.push_back(Bytes::from(DONE_FRAME));
        self.end();
    }

    /// The upstream is over: owe the client its usage chunk when it asked for one, then `[DONE]`.
    fn finish(&mut self) {
        if self.include_usage && !self.usage_sent {
            let usage = self.last_usage.take().unwrap_or_else(|| {
                serde_json::json!({"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
            });
            let chunk = serde_json::json!({
                "id": self.id,
                "object": "chat.completion.chunk",
                "created": self.created,
                "model": self.model,
                "choices": [],
                "usage": usage,
            });
            self.pending
                .push_back(Bytes::from(format!("data: {chunk}\n\n")));
        }
        self.pending.push_back(Bytes::from(DONE_FRAME));
        self.end();
    }

    fn end(&mut self) {
        self.finished = true;
        if let Some(guard) = self.cancel.take() {
            let _ = guard.disarm();
        }
        self.permit = None;
    }
}

/// Cuts the first complete SSE event off the front of the buffer, whether lines end in LF or CRLF.
pub(crate) fn split_event(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let lf = buffer.windows(2).position(|w| w == b"\n\n").map(|i| (i, 2));
    let crlf = buffer
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| (i, 4));
    let (at, width) = match (lf, crlf) {
        (Some(a), Some(b)) => {
            if a.0 <= b.0 {
                a
            } else {
                b
            }
        }
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return None,
    };
    let event = buffer[..at].to_vec();
    buffer.drain(..at + width);
    Some(event)
}

async fn next_relayed(mut relay: Relay) -> Option<(Result<Bytes, Infallible>, Relay)> {
    loop {
        if let Some(frame) = relay.pending.pop_front() {
            return Some((Ok(frame), relay));
        }
        if relay.finished {
            return None;
        }
        match relay.upstream.next().await {
            Some(Ok(bytes)) => {
                relay.buffer.extend_from_slice(&bytes);
                relay.take_events(false);
            }
            Some(Err(error)) => {
                relay.take_events(true);
                relay.fail(&failure_message(&error));
            }
            None => {
                relay.take_events(true);
                relay.finish();
            }
        }
    }
}
