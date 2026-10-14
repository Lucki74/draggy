//! The gateway every model request goes through. A provider's model is routed to its adapter, its request is sent
//! to that instance's own address, and its answer comes back in llama-server's shape. A runtime-backed account has
//! no address, so its answer comes from the account runtime. The built-in engine is passed through untouched.
//! Answers are written to a `ReplySink` as they are made, so a stream reaches the renderer chunk by chunk and a
//! reader that goes away stops the upstream request.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};
use tracing::{debug, warn};
use url::Url;

use crate::adapters::anthropic;
use crate::adapters::common::Stream;
use crate::adapters::gemini;
use crate::adapters::ollama;
use crate::adapters::openai;
use crate::errors::{from_network, from_response_text, is_retryable};
use crate::http::{
    ByteStream, HttpClient, HttpHead, HttpRequest, Method, TransportError, read_text,
};
use crate::js::truthy;
use crate::registry::{InstanceConnection, Keystore, KvStore, Registry};
use crate::sse::{Delta, SseWriter, completion};
use crate::types::{
    ChatRequest, Completion, FinishReason, ProviderError, ProviderState, StreamEvent, Usage,
};

pub const ENGINE_PATH: &str = "/v1/chat/completions";
const MAX_RETRIES: u64 = 2;
// A provider asking for a longer wait than this has a turn fail now rather than sit silent for minutes.
const MAX_WAIT_MS: f64 = 60_000.0;
// Bodies are re-streamed, so the upstream's framing headers no longer describe what is sent.
const DROPPED_HEADERS: [&str; 5] = [
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
];
const REFUSED_ORIGIN: &str = "This origin may not use the gateway.";
const NOT_CONFIGURED: &str = "That address is not a configured provider's.";

/// Waits between retries. The shell sleeps; tests record the waits. False when the reader went away during the wait.
pub trait Sleeper {
    fn wait(&self, ms: u64) -> bool;
}

/// One request the gateway received from the renderer, as the handler reads it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GatewayRequest {
    pub method: String,
    pub url: String,
    pub origin: Option<String>,
    pub request_id: Option<String>,
    /// The Content-Type the renderer sent; the engine is given it back as it came.
    pub content_type: Option<String>,
    pub body: String,
}

/// What the gateway answers: a status, the headers the renderer reads, and the body as text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatewayReply {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

/// Where a reply goes as it is made: its status and headers first, then its body a chunk at a time.
pub trait ReplySink {
    fn head(&mut self, status: u16, headers: &BTreeMap<String, String>);
    /// Takes one chunk. Returns false once the reader has gone, which tells the gateway to stop the upstream.
    fn chunk(&mut self, bytes: &[u8]) -> bool;
}

/// A reply collected whole, for a caller that does not stream.
#[derive(Default)]
struct ReplyBuffer {
    status: u16,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

impl ReplySink for ReplyBuffer {
    fn head(&mut self, status: u16, headers: &BTreeMap<String, String>) {
        self.status = status;
        self.headers = headers.clone();
    }

    fn chunk(&mut self, bytes: &[u8]) -> bool {
        self.body.extend_from_slice(bytes);
        true
    }
}

/// Writes a reply that is known whole: its head, then its body as one chunk.
fn send_reply(sink: &mut dyn ReplySink, reply: GatewayReply) {
    sink.head(reply.status, &reply.headers);
    sink.chunk(reply.body.as_bytes());
}

/// The call an account runtime gets: the renderer's body, the instance it is for, and the model it names.
pub struct AccountCall<'a> {
    pub body: &'a Value,
    pub connection: &'a InstanceConnection,
    pub model_id: &'a str,
}

/// Where an account runtime writes what it says, in the same terms the adapters use.
pub trait AccountSink {
    fn delta(&mut self, delta: Delta);
    fn finish(&mut self, reason: FinishReason, usage: Usage);
    fn provider_state(&mut self, state: &ProviderState);
    /// True once the reader has gone; a runtime checks it between its steps and stops, as the reference's signal does.
    fn cancelled(&self) -> bool {
        false
    }
}

/// A failure an account runtime names: the provider's failure, and the reset time when the runtime gave one.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountFailure {
    pub failure: ProviderError,
    pub resets_at: Option<Value>,
}

impl From<ProviderError> for AccountFailure {
    fn from(failure: ProviderError) -> Self {
        Self {
            failure,
            resets_at: None,
        }
    }
}

/// An account's runtime: it streams into the sink and returns Err with the failure it ends on.
pub trait AccountRuntime {
    fn stream(
        &self,
        call: &AccountCall<'_>,
        sink: &mut dyn AccountSink,
    ) -> Result<(), Box<AccountFailure>>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Adapter {
    OpenAi,
    Ollama,
    Anthropic,
    Gemini,
}

fn adapter_of(protocol: &str) -> Option<Adapter> {
    match protocol {
        "openai" => Some(Adapter::OpenAi),
        "ollama" => Some(Adapter::Ollama),
        "anthropic" => Some(Adapter::Anthropic),
        "gemini" => Some(Adapter::Gemini),
        _ => None,
    }
}

/// The model a request names; empty when the body is not JSON, which the engine then answers itself.
pub fn requested_model(text: &str) -> String {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|body| body.get("model").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_default()
}

/// `@instance/model`, split at the first slash: model ids such as OpenRouter's carry slashes of their own.
pub fn parse_ref(model: &str) -> Option<(&str, &str)> {
    let slash = model.find('/')?;
    (slash > 1).then(|| (&model[1..slash], &model[slash + 1..]))
}

fn cors_headers(origin: &str) -> BTreeMap<String, String> {
    let allow = if origin.is_empty() { "*" } else { origin };
    BTreeMap::from([
        ("access-control-allow-origin".to_owned(), allow.to_owned()),
        (
            "access-control-allow-methods".to_owned(),
            "POST, OPTIONS".to_owned(),
        ),
        (
            "access-control-allow-headers".to_owned(),
            "content-type, x-request-id".to_owned(),
        ),
        ("vary".to_owned(), "Origin".to_owned()),
    ])
}

fn json_headers(extra: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut headers = extra.clone();
    headers.insert("content-type".to_owned(), "application/json".to_owned());
    headers
}

/// The headers of a stream: the CORS ones, plus the event-stream type that no caching may alter.
fn stream_headers(cors: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut headers = cors.clone();
    headers.insert("content-type".to_owned(), "text/event-stream".to_owned());
    headers.insert("cache-control".to_owned(), "no-cache".to_owned());
    headers
}

fn error_reply(status: u16, message: &str, headers: &BTreeMap<String, String>) -> GatewayReply {
    let body = json!({ "error": { "kind": "provider-unknown-error", "message": message } });
    GatewayReply {
        status,
        headers: json_headers(headers),
        body: serde_json::to_string(&body).unwrap_or_default(),
    }
}

/// A failure with the provider's label, as the renderer reads it.
fn named(failure: &ProviderError, label: &str) -> Value {
    let mut value = serde_json::to_value(failure).unwrap_or(Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert("provider".to_owned(), json!(label));
    }
    value
}

/// An account's failure with its label and, when the runtime gave one, the time its limit resets.
fn named_account(failure: &AccountFailure, label: &str) -> Value {
    let mut value = named(&failure.failure, label);
    if let (Some(object), Some(resets_at)) = (value.as_object_mut(), &failure.resets_at) {
        object.insert("resetsAt".to_owned(), resets_at.clone());
    }
    value
}

fn frame(payload: &Value) -> String {
    format!(
        "data: {}\n\n",
        serde_json::to_string(payload).unwrap_or_default()
    )
}

/// The SSE answer, written through the shared writer and handed to the sink frame by frame. A failure names its
/// provider, which the writer's own frame does not, so that one frame is replaced once the writer has recorded the
/// failure's kind.
struct SseAnswer<'a, C: FnMut() -> u64> {
    writer: SseWriter<C>,
    sink: &'a mut dyn ReplySink,
    reader_gone: bool,
}

impl<'a, C: FnMut() -> u64> SseAnswer<'a, C> {
    fn new(clock: C, sink: &'a mut dyn ReplySink) -> Self {
        Self {
            writer: SseWriter::new(clock),
            sink,
            reader_gone: false,
        }
    }

    fn flush(&mut self) {
        for frame in self.writer.take_frames() {
            self.write(&frame);
        }
    }

    fn write(&mut self, text: &str) {
        if self.reader_gone {
            return;
        }
        if !self.sink.chunk(text.as_bytes()) {
            // The reader has gone: nothing more is written, and the upstream is told to stop.
            self.abort();
        }
    }

    fn reader_gone(&self) -> bool {
        self.reader_gone
    }

    /// The reader went away between frames: nothing more is written, not even the closing frames.
    fn abort(&mut self) {
        self.reader_gone = true;
        self.writer.stop("abort");
    }

    fn error(&mut self, failure: &ProviderError, label: &str) {
        self.error_named(failure, named(failure, label));
    }

    fn error_named(&mut self, failure: &ProviderError, named: Value) {
        if self.writer.is_closed() {
            return;
        }
        self.writer.error(failure);
        let _bare = self.writer.take_frames();
        self.write(&frame(&json!({ "error": named })));
    }

    fn retry(&mut self, attempt: u64, wait_ms: f64) {
        self.writer
            .retry(attempt, MAX_RETRIES, Some(wait_ms as u64));
        self.flush();
    }

    fn done(&mut self) {
        self.writer.done();
        self.flush();
    }
}

impl<C: FnMut() -> u64> AccountSink for SseAnswer<'_, C> {
    fn delta(&mut self, delta: Delta) {
        self.writer.delta(delta);
        self.flush();
    }

    fn finish(&mut self, reason: FinishReason, usage: Usage) {
        self.writer.finish(Some(reason), usage);
        self.flush();
    }

    fn provider_state(&mut self, state: &ProviderState) {
        self.writer.provider_state(state);
        self.flush();
    }

    fn cancelled(&self) -> bool {
        self.reader_gone
    }
}

/// An account's answer collected into one completion, for a request that did not ask to stream.
#[derive(Default)]
struct Collected {
    content: String,
    reasoning: String,
    tool_calls: Vec<Value>,
    finish: Option<FinishReason>,
    usage: Usage,
    provider_state: Option<ProviderState>,
}

impl AccountSink for Collected {
    fn delta(&mut self, delta: Delta) {
        self.content
            .push_str(delta.content.as_deref().unwrap_or(""));
        self.reasoning
            .push_str(delta.reasoning.as_deref().unwrap_or(""));
        // Each call is rebuilt as the reference rebuilds it: its id, its type and its function, and no index.
        for call in delta.tool_calls {
            let mut value = Map::new();
            if let Some(id) = call.get("id") {
                value.insert("id".to_owned(), id.clone());
            }
            value.insert("type".to_owned(), json!("function"));
            if let Some(function) = call.get("function") {
                value.insert("function".to_owned(), function.clone());
            }
            self.tool_calls.push(Value::Object(value));
        }
    }

    fn finish(&mut self, reason: FinishReason, usage: Usage) {
        self.finish = Some(reason);
        self.usage = usage;
    }

    fn provider_state(&mut self, state: &ProviderState) {
        self.provider_state = Some(state.clone());
    }
}

impl Collected {
    fn completion(&self) -> Value {
        let mut out = completion(
            &self.content,
            &self.reasoning,
            &self.tool_calls,
            self.finish.unwrap_or(FinishReason::Stop),
            self.usage,
        );
        if let Some(state) = &self.provider_state {
            out["provider_state"] = json!(state);
        }
        out
    }
}

/// How a request ended without an answer: a failure to name, or the reader gone while the retry rule was waiting.
enum Stopped {
    Failed(ProviderError),
    ReaderGone,
}

/// The gateway, over the registry, the network and the account runtimes it may reach.
pub struct Gateway<'a, K: KvStore, S: Keystore, H: HttpClient> {
    pub registry: &'a Registry<K, S>,
    pub http: &'a H,
    pub sleeper: &'a dyn Sleeper,
    pub accounts: &'a [(&'a str, &'a dyn AccountRuntime)],
    pub allowed_origin: &'a dyn Fn(&str) -> bool,
    pub engine_port: &'a dyn Fn() -> u16,
    pub clock: &'a dyn Fn() -> u64,
}

impl<K: KvStore, S: Keystore, H: HttpClient> Gateway<'_, K, S, H> {
    /// Answers one request into the sink. An `Err` is a network failure the renderer sees as its fetch failing; when
    /// it comes after the head, the reply is cut off there.
    pub fn serve(
        &self,
        request: &GatewayRequest,
        sink: &mut dyn ReplySink,
    ) -> Result<(), TransportError> {
        let origin = request
            .origin
            .as_deref()
            .filter(|origin| !origin.is_empty());
        if let Some(origin) = origin
            && !(self.allowed_origin)(origin)
        {
            warn!(target: "providers.gateway", "refused an origin");
            send_reply(sink, error_reply(403, REFUSED_ORIGIN, &BTreeMap::new()));
            return Ok(());
        }
        let cors = cors_headers(origin.unwrap_or(""));
        if request.method == "OPTIONS" {
            send_reply(
                sink,
                GatewayReply {
                    status: 204,
                    headers: cors,
                    body: String::new(),
                },
            );
            return Ok(());
        }
        // The reference compares the URL's host, which keeps a port, so `chat:8080` is not the chat endpoint.
        let is_chat = Url::parse(&request.url)
            .is_ok_and(|url| url.host_str() == Some("chat") && url.port().is_none());
        if request.method != "POST" || !is_chat {
            send_reply(sink, error_reply(404, "Unknown gateway endpoint.", &cors));
            return Ok(());
        }

        let cid = request.request_id.as_deref().filter(|id| !id.is_empty());
        let model = requested_model(&request.body);
        // A remote reference never reaches the engine, whether or not its provider exists.
        if model.starts_with('@') {
            self.route_remote(&model, &request.body, &cors, cid, sink);
            return Ok(());
        }
        self.passthrough(request, &cors, cid, sink)
            .inspect_err(|_| {
                warn!(target: "providers.gateway", "engine unreachable");
            })
    }

    /// Answers one request and returns the whole reply, for a caller that does not stream.
    pub fn handle(&self, request: &GatewayRequest) -> Result<GatewayReply, TransportError> {
        let mut buffer = ReplyBuffer::default();
        self.serve(request, &mut buffer)?;
        Ok(GatewayReply {
            status: buffer.status,
            headers: buffer.headers,
            body: String::from_utf8_lossy(&buffer.body).into_owned(),
        })
    }

    /// The built-in engine's answer, as it came: status, headers less the framing ones, and the body chunk by chunk.
    /// A reader that goes away cancels the engine's request.
    fn passthrough(
        &self,
        request: &GatewayRequest,
        cors: &BTreeMap<String, String>,
        cid: Option<&str>,
        sink: &mut dyn ReplySink,
    ) -> Result<(), TransportError> {
        let url = format!("http://127.0.0.1:{}{ENGINE_PATH}", (self.engine_port)());
        let mut headers = BTreeMap::from([(
            "content-type".to_owned(),
            request
                .content_type
                .clone()
                .unwrap_or_else(|| "application/json".to_owned()),
        )]);
        if let Some(cid) = cid {
            headers.insert("x-request-id".to_owned(), cid.to_owned());
        }
        let (head, mut body) = self.http.open(&HttpRequest {
            method: Method::Post,
            url,
            headers,
            body: Some(request.body.clone()),
            timeout_ms: None,
        })?;
        let mut out: BTreeMap<String, String> = head
            .headers
            .iter()
            .filter(|(key, _)| !DROPPED_HEADERS.contains(&key.to_ascii_lowercase().as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        out.extend(cors.iter().map(|(key, value)| (key.clone(), value.clone())));
        sink.head(head.status, &out);
        while let Some(chunk) = body.next_chunk()? {
            if !sink.chunk(&chunk) {
                body.cancel();
                break;
            }
        }
        Ok(())
    }

    fn route_remote(
        &self,
        model: &str,
        text: &str,
        cors: &BTreeMap<String, String>,
        cid: Option<&str>,
        sink: &mut dyn ReplySink,
    ) {
        let parsed = parse_ref(model);
        let connection =
            parsed.and_then(|(instance_id, _)| self.registry.connection_for(instance_id));
        let not_set_up = |sink: &mut dyn ReplySink| {
            send_reply(
                sink,
                error_reply(
                    404,
                    &format!("No enabled provider is set up for {model}."),
                    cors,
                ),
            );
        };
        let (Some(connection), Some((_, model_id))) = (connection, parsed) else {
            return not_set_up(sink);
        };
        if !connection.instance.enabled || model_id.is_empty() {
            return not_set_up(sink);
        }
        let protocol = connection
            .entry
            .as_ref()
            .map(|entry| entry.protocol.as_str())
            .filter(|protocol| !protocol.is_empty())
            .unwrap_or("openai")
            .to_owned();
        let is_account = connection
            .entry
            .as_ref()
            .is_some_and(|entry| entry.kind == "account");
        let account = if is_account {
            self.accounts
                .iter()
                .find(|(name, _)| *name == protocol)
                .map(|(_, runtime)| *runtime)
        } else {
            None
        };
        let adapter = if account.is_some() {
            None
        } else {
            adapter_of(&protocol)
        };
        if account.is_none() && adapter.is_none() {
            return send_reply(
                sink,
                error_reply(404, &format!("No adapter for {model}."), cors),
            );
        }
        let Ok(body) = serde_json::from_str::<Value>(text) else {
            return send_reply(sink, error_reply(400, "The request is not JSON.", cors));
        };
        let label = connection.instance.label.clone();
        if let Some(runtime) = account {
            return self.route_account(runtime, &body, &connection, model_id, cors, &label, sink);
        }
        let Some(adapter) = adapter else {
            return send_reply(
                sink,
                error_reply(404, &format!("No adapter for {model}."), cors),
            );
        };
        // Rust-only: the reference hands any parsed object to the adapter; a body the typed request cannot read is refused.
        let Ok(chat) = serde_json::from_value::<ChatRequest>(body.clone()) else {
            return send_reply(sink, error_reply(400, "The request is not JSON.", cors));
        };
        let connection_view = connection.adapter();
        let request = match adapter {
            Adapter::OpenAi => openai::build_request(&chat, &connection_view, model_id),
            Adapter::Ollama => ollama::build_request(&chat, &connection_view, model_id),
            Adapter::Anthropic => anthropic::build_request(&chat, &connection_view, model_id),
            Adapter::Gemini => gemini::build_request(&chat, &connection_view, model_id),
        };
        let allowed = self
            .registry
            .enabled_base_urls()
            .iter()
            .any(|base| request.url == *base || request.url.starts_with(&format!("{base}/")));
        if !allowed {
            return send_reply(sink, error_reply(403, NOT_CONFIGURED, cors));
        }
        debug!(target: "providers.gateway", provider = %connection.instance.id, protocol = %protocol, stream = truthy(body.get("stream")), "routing to provider");
        let instance_id = connection.instance.id.clone();
        if truthy(body.get("stream")) {
            return self.stream_answer(adapter, &instance_id, &request, cid, cors, &label, sink);
        }
        self.answer_once(adapter, &instance_id, &request, cid, cors, &label, sink);
    }

    /// One upstream request with the retry rule; `on_retry` sees each wait before it starts. Returns the answer's
    /// head with its body still to read, or the failure once the rule gives up.
    fn fetch_with_retries(
        &self,
        request: &HttpRequest,
        cid: Option<&str>,
        mut on_retry: impl FnMut(u64, f64) -> bool,
    ) -> Result<(HttpHead, Box<dyn ByteStream>), Stopped> {
        let mut attempt = 0u64;
        loop {
            // Our id travels upstream so a provider that echoes it back can be matched; the adapter's own headers win.
            let mut headers = BTreeMap::new();
            if let Some(cid) = cid {
                headers.insert("x-request-id".to_owned(), cid.to_owned());
            }
            headers.extend(request.headers.clone());
            let attempt_request = HttpRequest {
                headers,
                ..request.clone()
            };
            let (head, mut body) = match self.http.open(&attempt_request) {
                Ok(opened) => opened,
                Err(error) => {
                    warn!(target: "providers.gateway", attempt, "provider unreachable");
                    return Err(Stopped::Failed(from_network(&error)));
                }
            };
            if head.ok() {
                debug!(target: "providers.gateway", attempt, status = head.status, "provider responded");
                return Ok((head, body));
            }
            // A refusal's text is read whole, since the failure is named from it; a body that cannot be read leaves it empty.
            let text = read_text(&mut *body).unwrap_or_default();
            let failure = from_response_text(head.status, &text, &head.headers, (self.clock)());
            warn!(target: "providers.gateway", status = head.status, attempt, kind = ?failure.kind, "provider refused");
            let wait_ms = match failure.retry_after {
                Some(seconds) => seconds * 1000.0,
                None => 1000.0 * 2f64.powi(i32::try_from(attempt).unwrap_or(i32::MAX)),
            };
            if attempt >= MAX_RETRIES || !is_retryable(&failure) || wait_ms > MAX_WAIT_MS {
                return Err(Stopped::Failed(failure));
            }
            // A reader gone before the retry, or during its wait, gets no second request, as the reference's aborted signal.
            if !on_retry(attempt + 1, wait_ms) || !self.sleeper.wait(wait_ms as u64) {
                return Err(Stopped::ReaderGone);
            }
            attempt += 1;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn stream_answer(
        &self,
        adapter: Adapter,
        instance_id: &str,
        request: &HttpRequest,
        cid: Option<&str>,
        cors: &BTreeMap<String, String>,
        label: &str,
        sink: &mut dyn ReplySink,
    ) {
        sink.head(200, &stream_headers(cors));
        let clock = self.clock;
        let mut out = SseAnswer::new(clock, sink);
        let fetched = self.fetch_with_retries(request, cid, |attempt, wait_ms| {
            out.retry(attempt, wait_ms);
            !out.reader_gone()
        });
        let (_, mut body) = match fetched {
            Ok(opened) => opened,
            Err(Stopped::Failed(failure)) => {
                out.error(&failure, label);
                out.done();
                return;
            }
            Err(Stopped::ReaderGone) => {
                out.abort();
                return;
            }
        };
        let mut stream = adapter_stream(adapter, instance_id);
        let failure = pump(&mut *body, &mut *stream, &mut out);
        if let Some(failure) = failure {
            out.error(&failure, label);
        }
        out.done();
    }

    #[allow(clippy::too_many_arguments)]
    fn answer_once(
        &self,
        adapter: Adapter,
        instance_id: &str,
        request: &HttpRequest,
        cid: Option<&str>,
        cors: &BTreeMap<String, String>,
        label: &str,
        sink: &mut dyn ReplySink,
    ) {
        let fetched = self.fetch_with_retries(request, cid, |_, _| true);
        let (_, mut body) = match fetched {
            Ok(opened) => opened,
            Err(Stopped::Failed(failure)) => {
                return send_reply(sink, failed_once(&failure, label, cors));
            }
            // A whole reply has no reader to lose, so only a sleeper can report this; nothing is written.
            Err(Stopped::ReaderGone) => return,
        };
        let text = match read_text(&mut *body) {
            Ok(text) => text,
            Err(error) => {
                return send_reply(sink, failed_once(&from_network(&error), label, cors));
            }
        };
        let json: Value = match serde_json::from_str(&text) {
            Ok(json) => json,
            Err(error) => {
                return send_reply(
                    sink,
                    failed_once(
                        &from_network(&TransportError {
                            message: error.to_string(),
                            cause_message: None,
                            code: None,
                        }),
                        label,
                        cors,
                    ),
                );
            }
        };
        let answer = match adapter {
            Adapter::OpenAi => openai::translate_json(&json),
            Adapter::Ollama => Ok(ollama::translate_json(&json)),
            Adapter::Anthropic => anthropic::translate_json(&json, Some(instance_id)),
            Adapter::Gemini => gemini::translate_json(&json, Some(instance_id)),
        };
        match answer {
            Ok(answer) => {
                let mut out = completion_value(&answer);
                if let Some(state) = answer.provider_state {
                    out["provider_state"] = json!(state);
                }
                send_reply(
                    sink,
                    GatewayReply {
                        status: 200,
                        headers: json_headers(cors),
                        body: out.to_string(),
                    },
                );
            }
            Err(failure) => send_reply(sink, failed_once(&failure, label, cors)),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn route_account(
        &self,
        runtime: &dyn AccountRuntime,
        body: &Value,
        connection: &InstanceConnection,
        model_id: &str,
        cors: &BTreeMap<String, String>,
        label: &str,
        sink: &mut dyn ReplySink,
    ) {
        let call = AccountCall {
            body,
            connection,
            model_id,
        };
        if truthy(body.get("stream")) {
            sink.head(200, &stream_headers(cors));
            let mut out = SseAnswer::new(self.clock, sink);
            if let Err(failure) = runtime.stream(&call, &mut out) {
                out.error_named(&failure.failure, named_account(&failure, label));
            }
            out.done();
            return;
        }
        let mut collected = Collected::default();
        match runtime.stream(&call, &mut collected) {
            Ok(()) => send_reply(
                sink,
                GatewayReply {
                    status: 200,
                    headers: json_headers(cors),
                    body: collected.completion().to_string(),
                },
            ),
            Err(failure) => {
                let body = json!({ "error": named_account(&failure, label) });
                send_reply(
                    sink,
                    GatewayReply {
                        status: 502,
                        headers: json_headers(cors),
                        body: body.to_string(),
                    },
                );
            }
        }
    }
}

/// Reads the upstream body into the answer until it ends, fails or the reader goes. Returns the failure it ended on.
fn pump<C: FnMut() -> u64>(
    body: &mut dyn ByteStream,
    stream: &mut dyn StreamDriver,
    out: &mut SseAnswer<'_, C>,
) -> Option<ProviderError> {
    loop {
        let (events, ended) = match body.next_chunk() {
            Ok(Some(chunk)) => (stream.push(&chunk), false),
            Ok(None) => (stream.finish(), true),
            Err(error) => return Some(from_network(&error)),
        };
        for event in events {
            if let Some(failure) = write_event(out, event) {
                return Some(failure);
            }
        }
        if out.reader_gone() {
            body.cancel();
            return None;
        }
        if ended {
            return None;
        }
    }
}

/// Writes one decoded event as llama-server's stream carries it. An upstream failure is returned instead.
fn write_event<C: FnMut() -> u64>(
    out: &mut SseAnswer<'_, C>,
    event: StreamEvent,
) -> Option<ProviderError> {
    match event {
        StreamEvent::TextDelta { text } => out.delta(Delta {
            content: Some(text),
            ..Delta::default()
        }),
        StreamEvent::ReasoningDelta { text } => out.delta(Delta {
            reasoning: Some(text),
            ..Delta::default()
        }),
        StreamEvent::ToolCallDelta {
            index,
            id,
            name,
            arguments,
        } => {
            let mut function = Map::new();
            if let Some(name) = name {
                function.insert("name".to_owned(), json!(name));
            }
            function.insert("arguments".to_owned(), json!(arguments));
            let mut call = Map::new();
            call.insert("index".to_owned(), json!(index));
            if let Some(id) = id {
                call.insert("id".to_owned(), json!(id));
            }
            call.insert("type".to_owned(), json!("function"));
            call.insert("function".to_owned(), Value::Object(function));
            out.delta(Delta {
                tool_calls: vec![Value::Object(call)],
                ..Delta::default()
            });
        }
        StreamEvent::ProviderState { state } => out.provider_state(&state),
        StreamEvent::Finish { reason, usage } => out.finish(reason, usage),
        StreamEvent::Error { error } => return Some(error),
    }
    None
}

fn adapter_stream(adapter: Adapter, instance_id: &str) -> Box<dyn StreamDriver> {
    match adapter {
        Adapter::OpenAi => Box::new(Driver(openai::stream())),
        Adapter::Ollama => Box::new(Driver(ollama::stream())),
        Adapter::Anthropic => Box::new(Driver(anthropic::stream(Some(instance_id)))),
        Adapter::Gemini => Box::new(Driver(gemini::stream(Some(instance_id)))),
    }
}

/// The part of a stream the gateway drives, whichever adapter's decoder sits behind it.
trait StreamDriver {
    fn push(&mut self, bytes: &[u8]) -> Vec<StreamEvent>;
    fn finish(&mut self) -> Vec<StreamEvent>;
}

struct Driver<D: crate::adapters::common::Decoder>(Stream<D>);

impl<D: crate::adapters::common::Decoder> StreamDriver for Driver<D> {
    fn push(&mut self, bytes: &[u8]) -> Vec<StreamEvent> {
        self.0.push(bytes)
    }

    fn finish(&mut self) -> Vec<StreamEvent> {
        self.0.finish()
    }
}

fn failed_once(
    failure: &ProviderError,
    label: &str,
    cors: &BTreeMap<String, String>,
) -> GatewayReply {
    let status = match failure.status {
        Some(status) if status >= 400 => status,
        _ => 502,
    };
    GatewayReply {
        status,
        headers: json_headers(cors),
        body: json!({ "error": named(failure, label) }).to_string(),
    }
}

/// A complete answer in llama-server's shape, as the adapters' completions are written.
fn completion_value(answer: &Completion) -> Value {
    let calls: Vec<Value> = answer
        .tool_calls
        .iter()
        .map(|call| {
            let mut function = Map::new();
            function.insert("name".to_owned(), json!(call.name));
            function.insert("arguments".to_owned(), json!(call.arguments));
            let mut value = Map::new();
            if let Some(id) = &call.id {
                value.insert("id".to_owned(), json!(id));
            }
            value.insert("type".to_owned(), json!("function"));
            value.insert("function".to_owned(), Value::Object(function));
            Value::Object(value)
        })
        .collect();
    completion(
        &answer.content,
        &answer.reasoning,
        &calls,
        answer.finish,
        answer.usage,
    )
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};
    use std::collections::{HashMap, VecDeque};
    use std::rc::Rc;

    use super::*;
    use crate::catalog::Catalog;
    use crate::http::{ByteStream, HttpHead, HttpResponse, Method};
    use crate::registry::{AddArgs, Patch};

    #[derive(Default)]
    struct Kv(HashMap<String, String>);

    impl KvStore for Kv {
        fn get(&self, key: &str) -> Option<String> {
            self.0.get(key).cloned()
        }
        fn set(&mut self, key: &str, value: &str) {
            self.0.insert(key.to_owned(), value.to_owned());
        }
    }

    #[derive(Default)]
    struct Vault(HashMap<String, String>);

    impl Keystore for Vault {
        fn available(&self) -> bool {
            true
        }
        fn get(&self, owner: &str) -> Option<String> {
            self.0.get(owner).cloned()
        }
        fn set(&mut self, owner: &str, key: Option<&str>) -> bool {
            match key {
                Some(key) => self.0.insert(owner.to_owned(), key.to_owned()),
                None => self.0.remove(owner),
            };
            true
        }
        fn remove(&mut self, owner: &str) {
            self.0.remove(owner);
        }
    }

    /// The engine as a fake: it records each request and answers with one fixed reply, or refuses the connection.
    struct Engine {
        reachable: bool,
        sent: RefCell<Vec<(String, Option<String>)>>,
    }

    impl HttpClient for Engine {
        fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError> {
            self.sent
                .borrow_mut()
                .push((request.url.clone(), request.body.clone()));
            if !self.reachable {
                return Err(TransportError {
                    message: "refused".to_owned(),
                    cause_message: None,
                    code: None,
                });
            }
            Ok(HttpResponse {
                status: 500,
                headers: BTreeMap::from([("x-engine".to_owned(), "llama".to_owned())]),
                body: "{\"error\":{\"code\":500}}".to_owned(),
            })
        }
    }

    struct Immediate;

    impl Sleeper for Immediate {
        fn wait(&self, _ms: u64) -> bool {
            true
        }
    }

    fn registry() -> Registry<Kv, Vault> {
        let mut registry = Registry::new(Kv::default(), Vault::default(), Catalog::bundled());
        registry
            .add(AddArgs {
                provider_type: "ollama".to_owned(),
                base_url: None,
                label: None,
                headers: None,
            })
            .ok();
        registry
    }

    fn request(method: &str, url: &str, origin: Option<&str>, body: &str) -> GatewayRequest {
        GatewayRequest {
            method: method.to_owned(),
            url: url.to_owned(),
            origin: origin.map(str::to_owned),
            request_id: None,
            content_type: None,
            body: body.to_owned(),
        }
    }

    #[test]
    fn reads_the_model_and_splits_a_reference_at_its_first_slash() {
        assert_eq!(requested_model("not json"), "");
        assert_eq!(requested_model("{\"model\":\"@a/b/c\"}"), "@a/b/c");
        assert_eq!(parse_ref("@a/b/c"), Some(("a", "b/c")));
        assert_eq!(parse_ref("@/x"), None);
        assert_eq!(parse_ref("@x"), None);
    }

    #[test]
    fn passes_the_engine_through_unchanged_at_whichever_port_it_is_on() {
        let registry = registry();
        let engine = Engine {
            reachable: true,
            sent: RefCell::new(Vec::new()),
        };
        let port = Cell::new(9_u16);
        let allowed = |origin: &str| origin == "app://draggy";
        let engine_port = || port.get();
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &engine,
            sleeper: &Immediate,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let body = "{\"model\":\"m.gguf\"}";
        let reply = gateway.handle(&request(
            "POST",
            "draggy-ai://chat",
            Some("app://draggy"),
            body,
        ));
        let reply = reply.expect("the engine answers");
        assert_eq!(reply.status, 500);
        assert_eq!(
            reply.headers.get("x-engine").map(String::as_str),
            Some("llama")
        );
        assert_eq!(reply.body, "{\"error\":{\"code\":500}}");
        assert_eq!(
            engine.sent.borrow()[0],
            (
                "http://127.0.0.1:9/v1/chat/completions".to_owned(),
                Some(body.to_owned())
            )
        );
        port.set(12);
        assert!(
            gateway
                .handle(&request("POST", "draggy-ai://chat", None, body))
                .is_ok()
        );
        assert_eq!(
            engine.sent.borrow()[1].0,
            "http://127.0.0.1:12/v1/chat/completions"
        );
    }

    #[test]
    fn an_unreachable_engine_is_a_network_failure_for_the_renderer() {
        let registry = registry();
        let engine = Engine {
            reachable: false,
            sent: RefCell::new(Vec::new()),
        };
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &engine,
            sleeper: &Immediate,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        assert!(
            gateway
                .handle(&request(
                    "POST",
                    "draggy-ai://chat",
                    None,
                    "{\"model\":\"m\"}"
                ))
                .is_err()
        );
    }

    #[test]
    fn refuses_a_foreign_origin_and_answers_only_its_own_endpoint() {
        let registry = registry();
        let engine = Engine {
            reachable: true,
            sent: RefCell::new(Vec::new()),
        };
        let allowed = |origin: &str| origin == "app://draggy";
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &engine,
            sleeper: &Immediate,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let refused = gateway.handle(&request(
            "POST",
            "draggy-ai://chat",
            Some("https://evil.example"),
            "{}",
        ));
        assert_eq!(refused.map(|r| r.status), Ok(403));
        let preflight = gateway.handle(&request(
            "OPTIONS",
            "draggy-ai://chat",
            Some("app://draggy"),
            "",
        ));
        assert_eq!(
            preflight.map(|r| (
                r.status,
                r.headers.get("access-control-allow-origin").cloned()
            )),
            Ok((204, Some("app://draggy".to_owned())))
        );
        let other = gateway.handle(&request(
            "POST",
            "draggy-ai://models",
            Some("app://draggy"),
            "{}",
        ));
        assert_eq!(other.map(|r| r.status), Ok(404));
        assert!(engine.sent.borrow().is_empty());
        assert_eq!(Method::Post.as_str(), "POST");
    }

    /// A body that hands out its chunks one at a time, and records each pull and any cancel.
    struct Chunked {
        chunks: VecDeque<Vec<u8>>,
        pulls: Rc<Cell<u32>>,
        cancelled: Rc<Cell<bool>>,
    }

    impl ByteStream for Chunked {
        fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
            self.pulls.set(self.pulls.get() + 1);
            Ok(self.chunks.pop_front())
        }

        fn cancel(&mut self) {
            self.cancelled.set(true);
            self.chunks.clear();
        }
    }

    /// The network as a streaming client: every request opens a body with the same chunks, and is recorded.
    struct Streamed {
        status: u16,
        chunks: Vec<Vec<u8>>,
        sent: RefCell<Vec<HttpRequest>>,
        pulls: Rc<Cell<u32>>,
        cancelled: Rc<Cell<bool>>,
    }

    impl Streamed {
        fn new(status: u16, chunks: &[&str]) -> Self {
            Self {
                status,
                chunks: chunks.iter().map(|c| c.as_bytes().to_vec()).collect(),
                sent: RefCell::new(Vec::new()),
                pulls: Rc::new(Cell::new(0)),
                cancelled: Rc::new(Cell::new(false)),
            }
        }
    }

    impl HttpClient for Streamed {
        fn send(&self, _request: &HttpRequest) -> Result<HttpResponse, TransportError> {
            Err(TransportError {
                message: "not buffered".to_owned(),
                cause_message: None,
                code: None,
            })
        }

        fn open(
            &self,
            request: &HttpRequest,
        ) -> Result<(HttpHead, Box<dyn ByteStream>), TransportError> {
            self.sent.borrow_mut().push(request.clone());
            let head = HttpHead {
                status: self.status,
                headers: BTreeMap::from([(
                    "content-type".to_owned(),
                    "text/event-stream".to_owned(),
                )]),
            };
            let body = Chunked {
                chunks: self.chunks.clone().into(),
                pulls: Rc::clone(&self.pulls),
                cancelled: Rc::clone(&self.cancelled),
            };
            Ok((head, Box::new(body)))
        }
    }

    /// A reader that takes `accept` chunks and then goes away, as a renderer does when it stops reading.
    struct Reader {
        accept: usize,
        head: Option<u16>,
        chunks: Vec<String>,
    }

    impl ReplySink for Reader {
        fn head(&mut self, status: u16, _headers: &BTreeMap<String, String>) {
            self.head = Some(status);
        }

        fn chunk(&mut self, bytes: &[u8]) -> bool {
            self.chunks
                .push(String::from_utf8_lossy(bytes).into_owned());
            self.chunks.len() < self.accept
        }
    }

    /// An account runtime that streams deltas, and stops at once when its reader has gone.
    struct Turn {
        deltas: usize,
        sent: Cell<usize>,
    }

    impl AccountRuntime for Turn {
        fn stream(
            &self,
            _call: &AccountCall<'_>,
            sink: &mut dyn AccountSink,
        ) -> Result<(), Box<AccountFailure>> {
            for index in 0..self.deltas {
                if sink.cancelled() {
                    break;
                }
                self.sent.set(self.sent.get() + 1);
                sink.delta(Delta {
                    content: Some(format!("part {index}")),
                    ..Delta::default()
                });
            }
            Ok(())
        }
    }

    /// Adds one enabled instance of a catalog type and returns its registry and id.
    fn enabled(provider_type: &str) -> (Registry<Kv, Vault>, String) {
        let mut registry = Registry::new(Kv::default(), Vault::default(), Catalog::bundled());
        let added = registry
            .add(AddArgs {
                provider_type: provider_type.to_owned(),
                base_url: None,
                label: None,
                headers: None,
            })
            .expect("the catalog type adds");
        registry
            .update(
                &added.id,
                Patch {
                    enabled: Some(true),
                    ..Patch::default()
                },
            )
            .expect("the instance enables");
        (registry, added.id)
    }

    fn ollama_line(text: &str) -> String {
        format!("{{\"message\":{{\"content\":\"{text}\"}},\"done\":false}}\n")
    }

    #[test]
    fn the_engine_is_read_chunk_by_chunk_and_stopped_when_the_reader_goes() {
        let registry = registry();
        let net = Streamed::new(200, &["data: 1\n\n", "data: 2\n\n", "data: 3\n\n"]);
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &net,
            sleeper: &Immediate,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let mut reader = Reader {
            accept: 2,
            head: None,
            chunks: Vec::new(),
        };
        let served = gateway.serve(
            &request(
                "POST",
                "draggy-ai://chat",
                None,
                "{\"model\":\"m.gguf\",\"stream\":true}",
            ),
            &mut reader,
        );
        assert_eq!(served, Ok(()));
        assert_eq!(reader.head, Some(200));
        assert_eq!(reader.chunks, vec!["data: 1\n\n", "data: 2\n\n"]);
        assert!(net.cancelled.get(), "the engine's request is aborted");
        assert_eq!(net.pulls.get(), 2, "the third chunk is never read");
    }

    #[test]
    fn the_engine_gets_the_content_type_the_renderer_sent() {
        let registry = registry();
        let net = Streamed::new(200, &["{}"]);
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &net,
            sleeper: &Immediate,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let mut sent = request("POST", "draggy-ai://chat", None, "{\"model\":\"m\"}");
        sent.content_type = Some("text/plain;charset=UTF-8".to_owned());
        assert!(gateway.handle(&sent).is_ok());
        assert_eq!(
            net.sent.borrow()[0]
                .headers
                .get("content-type")
                .map(String::as_str),
            Some("text/plain;charset=UTF-8")
        );
    }

    #[test]
    fn a_remote_stream_is_written_as_it_arrives_and_stops_the_provider_when_the_reader_goes() {
        let (registry, id) = enabled("ollama");
        let net = Streamed::new(
            200,
            &[
                &ollama_line("Hi"),
                &ollama_line(" there"),
                &ollama_line("!"),
            ],
        );
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &net,
            sleeper: &Immediate,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let mut reader = Reader {
            accept: 2,
            head: None,
            chunks: Vec::new(),
        };
        let body = format!("{{\"model\":\"@{id}/m\",\"stream\":true}}");
        let served = gateway.serve(
            &request("POST", "draggy-ai://chat", None, &body),
            &mut reader,
        );
        assert_eq!(served, Ok(()));
        assert_eq!(reader.head, Some(200));
        assert_eq!(reader.chunks.len(), 2, "two frames reached the reader");
        assert!(reader.chunks[0].contains("Hi"));
        assert!(net.cancelled.get(), "the provider's request is aborted");
        assert_eq!(
            net.pulls.get(),
            2,
            "the provider's last chunk is never read"
        );
    }

    /// Answers each request with the next scripted status, Retry-After and body, and counts the requests sent.
    #[derive(Default)]
    struct Replies {
        queue: RefCell<VecDeque<(u16, String)>>,
        sent: Cell<u32>,
    }

    impl HttpClient for Replies {
        fn send(&self, _request: &HttpRequest) -> Result<HttpResponse, TransportError> {
            Err(TransportError {
                message: "not buffered".to_owned(),
                cause_message: None,
                code: None,
            })
        }

        fn open(
            &self,
            _request: &HttpRequest,
        ) -> Result<(HttpHead, Box<dyn ByteStream>), TransportError> {
            self.sent.set(self.sent.get() + 1);
            let (status, body) = self
                .queue
                .borrow_mut()
                .pop_front()
                .unwrap_or((200, String::new()));
            let mut headers =
                BTreeMap::from([("content-type".to_owned(), "text/event-stream".to_owned())]);
            if status == 429 {
                headers.insert("retry-after".to_owned(), "0".to_owned());
            }
            let body = Chunked {
                chunks: VecDeque::from([body.into_bytes()]),
                pulls: Rc::new(Cell::new(0)),
                cancelled: Rc::new(Cell::new(false)),
            };
            Ok((HttpHead { status, headers }, Box::new(body)))
        }
    }

    /// Records each wait and reports the reader gone during it, as a renderer that stops reading does.
    #[derive(Default)]
    struct LeavesOnWait {
        waits: Cell<u32>,
    }

    impl Sleeper for LeavesOnWait {
        fn wait(&self, _ms: u64) -> bool {
            self.waits.set(self.waits.get() + 1);
            false
        }
    }

    const RATE_LIMITED: &str = "{\"error\":{\"message\":\"Rate limit reached\"}}";

    #[test]
    fn a_retry_is_not_sent_when_the_reader_goes_during_its_wait() {
        let (registry, id) = enabled("ollama");
        let net = Replies::default();
        net.queue
            .borrow_mut()
            .extend([(429, RATE_LIMITED.to_owned()), (200, ollama_line("Hi"))]);
        let sleeper = LeavesOnWait::default();
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &net,
            sleeper: &sleeper,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let mut reader = Reader {
            accept: usize::MAX,
            head: None,
            chunks: Vec::new(),
        };
        let body = format!("{{\"model\":\"@{id}/m\",\"stream\":true}}");
        let served = gateway.serve(
            &request("POST", "draggy-ai://chat", None, &body),
            &mut reader,
        );
        assert_eq!(served, Ok(()));
        assert_eq!(sleeper.waits.get(), 1, "the retry waited once");
        assert_eq!(
            net.sent.get(),
            1,
            "the retry is not sent after the reader went"
        );
        assert_eq!(reader.chunks.len(), 1, "only the retry frame was written");
        assert!(reader.chunks[0].contains("retry"));
        assert!(!reader.chunks[0].contains("Hi"));
    }

    #[test]
    fn a_retry_is_not_waited_for_when_the_reader_goes_at_its_frame() {
        let (registry, id) = enabled("ollama");
        let net = Replies::default();
        net.queue
            .borrow_mut()
            .extend([(429, RATE_LIMITED.to_owned()), (200, ollama_line("Hi"))]);
        let sleeper = LeavesOnWait::default();
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &net,
            sleeper: &sleeper,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let mut reader = Reader {
            accept: 0,
            head: None,
            chunks: Vec::new(),
        };
        let body = format!("{{\"model\":\"@{id}/m\",\"stream\":true}}");
        let served = gateway.serve(
            &request("POST", "draggy-ai://chat", None, &body),
            &mut reader,
        );
        assert_eq!(served, Ok(()));
        assert_eq!(sleeper.waits.get(), 0, "no wait once the reader has gone");
        assert_eq!(net.sent.get(), 1, "no second request");
    }

    #[test]
    fn an_account_runtime_stops_its_turn_when_the_reader_goes() {
        let (registry, id) = enabled("chatgpt");
        let turn = Turn {
            deltas: 3,
            sent: Cell::new(0),
        };
        let runtimes: [(&str, &dyn AccountRuntime); 1] = [("codex", &turn)];
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let net = Streamed::new(200, &[]);
        let gateway = Gateway {
            registry: &registry,
            http: &net,
            sleeper: &Immediate,
            accounts: &runtimes,
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let mut reader = Reader {
            accept: 1,
            head: None,
            chunks: Vec::new(),
        };
        let body = format!("{{\"model\":\"@{id}/gpt\",\"stream\":true}}");
        assert_eq!(
            gateway.serve(
                &request("POST", "draggy-ai://chat", None, &body),
                &mut reader
            ),
            Ok(())
        );
        assert_eq!(
            turn.sent.get(),
            1,
            "the runtime stops after the reader leaves"
        );
        assert!(
            net.sent.borrow().is_empty(),
            "an account never reaches the network"
        );
    }

    #[test]
    fn a_collected_account_tool_call_drops_its_index() {
        let (registry, id) = enabled("chatgpt");
        struct Calls;
        impl AccountRuntime for Calls {
            fn stream(
                &self,
                _call: &AccountCall<'_>,
                sink: &mut dyn AccountSink,
            ) -> Result<(), Box<AccountFailure>> {
                sink.delta(Delta {
                    tool_calls: vec![json!({
                        "index": 0,
                        "id": "call-1",
                        "type": "function",
                        "function": { "name": "read", "arguments": "{}" }
                    })],
                    ..Delta::default()
                });
                sink.finish(FinishReason::ToolCalls, Usage::default());
                Ok(())
            }
        }
        let runtimes: [(&str, &dyn AccountRuntime); 1] = [("codex", &Calls)];
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let net = Streamed::new(200, &[]);
        let gateway = Gateway {
            registry: &registry,
            http: &net,
            sleeper: &Immediate,
            accounts: &runtimes,
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let body = format!("{{\"model\":\"@{id}/gpt\"}}");
        let reply = gateway
            .handle(&request("POST", "draggy-ai://chat", None, &body))
            .expect("the account answers");
        let answer: Value = serde_json::from_str(&reply.body).expect("the answer is JSON");
        let call = &answer["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(call["id"], "call-1");
        assert_eq!(call["type"], "function");
        assert!(call.get("index").is_none(), "the reference drops the index");
    }

    #[test]
    fn a_chat_address_with_a_port_is_not_the_chat_endpoint() {
        let registry = registry();
        let net = Streamed::new(200, &[]);
        let allowed = |_: &str| true;
        let engine_port = || 9_u16;
        let clock = || 0_u64;
        let gateway = Gateway {
            registry: &registry,
            http: &net,
            sleeper: &Immediate,
            accounts: &[],
            allowed_origin: &allowed,
            engine_port: &engine_port,
            clock: &clock,
        };
        let reply = gateway.handle(&request("POST", "draggy-ai://chat:8080/", None, "{}"));
        assert_eq!(reply.map(|r| r.status), Ok(404));
        assert!(net.sent.borrow().is_empty());
    }
}
