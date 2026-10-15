//! In-process tests of the router. A fake backend and env are driven with `tower::ServiceExt::oneshot`, so no socket
//! is opened. These cover what the TypeScript server tests assert and what needs state: busy replies, cancellation,
//! and keeping the key out of the logs.

use std::convert::Infallible;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use draggy_api::server::{
    Backend, BackendError, CompletionRequest, DEFAULT_PORT, Env, HOST, MAX_BODY_BYTES, Message,
    Reply, Role, Sink, Usage, generate_key, listen_failure, router,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio::sync::{Notify, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;
use tracing::field::{Field, Visit};
use tracing::span;
use tracing::{Event, Metadata, Subscriber};

const KEY: &str = "draggy-test-key-0123456789";
const PORT: u16 = DEFAULT_PORT;
const HELLO: &str = r#"{"model":"qwen3:8b","messages":[{"role":"user","content":"Hi"}]}"#;

/// Long enough that a hang fails the test instead of stalling the run.
const PATIENCE: Duration = Duration::from_secs(5);

#[derive(Clone)]
struct FakeEnv {
    key: String,
}

impl Env for FakeEnv {
    fn api_key(&self) -> String {
        self.key.clone()
    }

    fn now_unix(&self) -> i64 {
        1_700_000_000
    }

    fn fill_random(&self, buffer: &mut [u8]) {
        buffer.fill(0xab);
    }
}

fn env() -> FakeEnv {
    FakeEnv {
        key: KEY.to_owned(),
    }
}

/// Answers from a fixed script, and records every request it is given.
#[derive(Clone)]
struct Scripted {
    models: Vec<String>,
    model_failure: bool,
    outcome: Result<Reply, String>,
    seen: Arc<Mutex<Vec<CompletionRequest>>>,
}

impl Scripted {
    fn answering(content: &str) -> Self {
        Self {
            models: vec!["qwen3:8b".to_owned()],
            model_failure: false,
            outcome: Ok(Reply {
                model: "qwen3:8b".to_owned(),
                content: content.to_owned(),
                usage: Usage {
                    prompt_tokens: 12,
                    response_tokens: 2,
                },
            }),
            seen: Arc::default(),
        }
    }

    fn failing(message: &str) -> Self {
        Self {
            outcome: Err(message.to_owned()),
            ..Self::answering("")
        }
    }

    fn seen(&self) -> Vec<CompletionRequest> {
        self.seen
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl Backend for Scripted {
    async fn list_models(&self) -> Result<Vec<String>, BackendError> {
        if self.model_failure {
            return Err(BackendError {
                message: "disk".to_owned(),
            });
        }
        Ok(self.models.clone())
    }

    async fn generate(
        &self,
        request: CompletionRequest,
        sink: Sink,
        _cancel: CancellationToken,
    ) -> Result<Reply, BackendError> {
        self.seen
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(request);
        sink.model("qwen3:8b");
        sink.text("Hel");
        sink.text("lo");
        match &self.outcome {
            Ok(reply) => Ok(reply.clone()),
            Err(message) => Err(BackendError {
                message: message.clone(),
            }),
        }
    }
}

/// Holds each reply until the test releases it. Reports each start, and each reply that is cancelled.
#[derive(Clone)]
struct Gated {
    started: mpsc::UnboundedSender<()>,
    release: watch::Receiver<bool>,
    cancelled: Arc<Notify>,
}

impl Backend for Gated {
    async fn list_models(&self) -> Result<Vec<String>, BackendError> {
        Ok(Vec::new())
    }

    async fn generate(
        &self,
        _request: CompletionRequest,
        _sink: Sink,
        cancel: CancellationToken,
    ) -> Result<Reply, BackendError> {
        let _ = self.started.send(());
        let mut release = self.release.clone();
        tokio::select! {
            _ = release.wait_for(|open| *open) => Ok(Reply {
                model: "qwen3:8b".to_owned(),
                content: "ok".to_owned(),
                usage: Usage::default(),
            }),
            () = cancel.cancelled() => {
                self.cancelled.notify_one();
                Err(BackendError { message: "cancelled".to_owned() })
            }
        }
    }
}

/// Never answers, and ignores the cancel signal, so its reply keeps its slot for good.
#[derive(Clone)]
struct Stuck {
    started: mpsc::UnboundedSender<()>,
}

impl Backend for Stuck {
    async fn list_models(&self) -> Result<Vec<String>, BackendError> {
        Ok(Vec::new())
    }

    async fn generate(
        &self,
        _request: CompletionRequest,
        _sink: Sink,
        _cancel: CancellationToken,
    ) -> Result<Reply, BackendError> {
        let _ = self.started.send(());
        std::future::pending().await
    }
}

fn request(method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(path);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    builder
        .body(Body::from(body.to_owned()))
        .unwrap_or_else(|error| panic!("bad test request: {error}"))
}

/// A request from a local client that holds the key, as the reference's own tests send one.
fn local(method: &str, path: &str, body: &str) -> Request<Body> {
    let auth = format!("Bearer {KEY}");
    request(
        method,
        path,
        &[
            ("host", "127.0.0.1:11500"),
            ("authorization", &auth),
            ("content-type", "application/json"),
        ],
        body,
    )
}

async fn send(app: Router, request: Request<Body>) -> (StatusCode, axum::http::HeaderMap, String) {
    let response = app
        .oneshot(request)
        .await
        .unwrap_or_else(|never: Infallible| match never {});
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .map(|collected| collected.to_bytes())
        .unwrap_or_default();
    (
        status,
        headers,
        String::from_utf8_lossy(&bytes).into_owned(),
    )
}

fn json_of(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|error| panic!("not JSON ({error}): {text}"))
}

/// The `data:` frames of a stream, without their blank-line separators.
fn frames(stream: &str) -> Vec<&str> {
    stream
        .split("\n\n")
        .filter(|frame| !frame.is_empty())
        .collect()
}

/// A body whose serialised size is exactly `size` bytes.
fn body_of_size(size: usize) -> String {
    let prefix = r#"{"model":"m","messages":[{"role":"user","content":""#;
    let suffix = r#""}]}"#;
    let text = "x".repeat(size - prefix.len() - suffix.len());
    format!("{prefix}{text}{suffix}")
}

fn is_completion_id(id: &str) -> bool {
    id.strip_prefix("chatcmpl-")
        .is_some_and(|hex| hex.len() == 24 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[test]
fn generated_keys_are_long_url_safe_and_never_the_same_twice() {
    let first = generate_key(&[1; 24]);
    let suffix = first.strip_prefix("draggy-").unwrap_or_default();

    assert_eq!(suffix.len(), 32);
    assert!(
        suffix
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    );
    assert_ne!(generate_key(&[2; 24]), first);
}

#[tokio::test]
async fn lists_the_installed_models() {
    let app = router(PORT, Scripted::answering("unused"), env());

    let (status, _, text) = send(app, local("GET", "/v1/models", "")).await;
    let body = json_of(&text);

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["id"], "qwen3:8b");
    assert_eq!(body["data"][0]["owned_by"], "local");
}

#[tokio::test]
async fn answers_a_completion_in_one_piece_and_hands_the_backend_the_request() {
    let backend = Scripted::answering("Hello!");
    let app = router(PORT, backend.clone(), env());

    let (status, _, text) = send(app, local("POST", "/v1/chat/completions", HELLO)).await;
    let body = json_of(&text);

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["choices"][0]["message"]["content"], "Hello!");
    assert_eq!(body["usage"]["total_tokens"], 14);
    assert!(is_completion_id(body["id"].as_str().unwrap_or_default()));
    assert_eq!(
        backend.seen(),
        vec![CompletionRequest {
            model: "qwen3:8b".to_owned(),
            messages: vec![Message {
                role: Role::User,
                content: "Hi".to_owned(),
            }],
            stream: false,
        }]
    );
}

#[tokio::test]
async fn streams_the_completion_as_it_is_written_and_ends_with_done() {
    let app = router(PORT, Scripted::answering("Hello"), env());
    let body = r#"{"model":"qwen3:8b","stream":true,"messages":[{"role":"user","content":"Hi"}]}"#;

    let (status, headers, text) = send(app, local("POST", "/v1/chat/completions", body)).await;
    let events = frames(&text);

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-type"], "text/event-stream");
    assert_eq!(headers["connection"], "keep-alive");
    assert_eq!(events.last().copied(), Some("data: [DONE]"));

    let chunks: Vec<Value> = events[..events.len() - 1]
        .iter()
        .map(|event| json_of(event.strip_prefix("data: ").unwrap_or_default()))
        .collect();
    let streamed: String = chunks
        .iter()
        .filter_map(|chunk| chunk["choices"][0]["delta"]["content"].as_str())
        .collect();
    assert_eq!(streamed, "Hello");
    assert_eq!(
        chunks
            .last()
            .map(|chunk| chunk["choices"][0]["finish_reason"].clone()),
        Some(json!("stop"))
    );
    assert!(chunks.iter().all(|chunk| chunk["model"] == "qwen3:8b"));
    let id = chunks[0]["id"].as_str().unwrap_or_default();
    assert!(is_completion_id(id));
    assert!(chunks.iter().all(|chunk| chunk["id"] == id));
}

#[tokio::test]
async fn refuses_without_the_key_and_from_web_pages_even_with_it() {
    let app = router(PORT, Scripted::answering("unused"), env());

    let (no_key, _, _) = send(
        app.clone(),
        request(
            "POST",
            "/v1/chat/completions",
            &[("host", "127.0.0.1:11500")],
            HELLO,
        ),
    )
    .await;
    let auth = format!("Bearer {KEY}");
    let (web_page, _, _) = send(
        app,
        request(
            "POST",
            "/v1/chat/completions",
            &[
                ("host", "127.0.0.1:11500"),
                ("authorization", &auth),
                ("origin", "https://example.com"),
            ],
            HELLO,
        ),
    )
    .await;

    assert_eq!(no_key, StatusCode::UNAUTHORIZED);
    assert_eq!(web_page, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn refuses_a_request_that_names_another_host() {
    let app = router(PORT, Scripted::answering("unused"), env());
    let auth = format!("Bearer {KEY}");

    let (status, _, text) = send(
        app,
        request(
            "POST",
            "/v1/chat/completions",
            &[("host", "attacker.example:11500"), ("authorization", &auth)],
            HELLO,
        ),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json_of(&text)["error"]["type"], "authentication_error");
}

#[tokio::test]
async fn refuses_what_it_does_not_serve_bodies_that_are_not_json_and_empty_messages() {
    let app = router(PORT, Scripted::answering("unused"), env());

    let (unknown, _, _) = send(app.clone(), local("GET", "/v1/embeddings", "")).await;
    let (not_json, _, text) = send(
        app.clone(),
        local("POST", "/v1/chat/completions", "{not json"),
    )
    .await;
    let (empty, _, empty_text) = send(
        app,
        local("POST", "/v1/chat/completions", r#"{"messages":[]}"#),
    )
    .await;

    assert_eq!(unknown, StatusCode::NOT_FOUND);
    assert_eq!(not_json, StatusCode::BAD_REQUEST);
    assert_eq!(
        json_of(&text)["error"]["message"],
        "The body is not valid JSON."
    );
    assert_eq!(empty, StatusCode::BAD_REQUEST);
    assert_eq!(
        json_of(&empty_text)["error"]["message"],
        "messages must be a non-empty array."
    );
}

#[tokio::test]
async fn refuses_a_body_one_byte_over_the_limit_and_takes_one_exactly_at_it() {
    let app = router(PORT, Scripted::answering("ok"), env());

    let (over, _, _) = send(
        app.clone(),
        local(
            "POST",
            "/v1/chat/completions",
            &body_of_size(MAX_BODY_BYTES + 1),
        ),
    )
    .await;
    let (at_limit, _, _) = send(
        app,
        local(
            "POST",
            "/v1/chat/completions",
            &body_of_size(MAX_BODY_BYTES),
        ),
    )
    .await;

    assert_eq!(over, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(at_limit, StatusCode::OK);
}

#[tokio::test]
async fn asks_a_client_to_wait_when_two_replies_are_already_being_made() {
    let (started_tx, mut started_rx) = mpsc::unbounded_channel();
    let (release_tx, release_rx) = watch::channel(false);
    let backend = Gated {
        started: started_tx,
        release: release_rx,
        cancelled: Arc::default(),
    };
    let app = router(PORT, backend, env());

    let first = tokio::spawn(
        app.clone()
            .oneshot(local("POST", "/v1/chat/completions", HELLO)),
    );
    let second = tokio::spawn(
        app.clone()
            .oneshot(local("POST", "/v1/chat/completions", HELLO)),
    );
    for _ in 0..2 {
        tokio::time::timeout(PATIENCE, started_rx.recv())
            .await
            .unwrap_or_else(|_| panic!("replies did not start"));
    }

    let (busy, _, text) = send(app, local("POST", "/v1/chat/completions", HELLO)).await;
    assert_eq!(busy, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(json_of(&text)["error"]["type"], "rate_limit_error");

    release_tx.send_replace(true);
    for handle in [first, second] {
        let response = handle
            .await
            .unwrap_or_else(|error| panic!("reply task failed: {error}"))
            .unwrap_or_else(|never: Infallible| match never {});
        assert_eq!(response.status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn stops_generating_when_a_streamed_reply_is_dropped() {
    let (started_tx, _started_rx) = mpsc::unbounded_channel();
    let (_release_tx, release_rx) = watch::channel(false);
    let cancelled = Arc::new(Notify::new());
    let backend = Gated {
        started: started_tx,
        release: release_rx,
        cancelled: cancelled.clone(),
    };
    let app = router(PORT, backend, env());
    let body = r#"{"model":"qwen3:8b","stream":true,"messages":[{"role":"user","content":"Hi"}]}"#;

    let response = app
        .oneshot(local("POST", "/v1/chat/completions", body))
        .await
        .unwrap_or_else(|never: Infallible| match never {});
    assert_eq!(response.status(), StatusCode::OK);
    drop(response);

    tokio::time::timeout(PATIENCE, cancelled.notified())
        .await
        .unwrap_or_else(|_| panic!("the reply kept running after the client left"));
}

#[tokio::test]
async fn stops_generating_when_a_whole_reply_is_abandoned() {
    let (started_tx, mut started_rx) = mpsc::unbounded_channel();
    let (_release_tx, release_rx) = watch::channel(false);
    let cancelled = Arc::new(Notify::new());
    let backend = Gated {
        started: started_tx,
        release: release_rx,
        cancelled: cancelled.clone(),
    };
    let app = router(PORT, backend, env());

    let pending = tokio::spawn(app.oneshot(local("POST", "/v1/chat/completions", HELLO)));
    tokio::time::timeout(PATIENCE, started_rx.recv())
        .await
        .unwrap_or_else(|_| panic!("reply did not start"));
    pending.abort();

    tokio::time::timeout(PATIENCE, cancelled.notified())
        .await
        .unwrap_or_else(|_| panic!("the reply kept running after the client left"));
}

#[tokio::test]
async fn an_abandoned_reply_keeps_its_slot_until_generate_settles() {
    let (started_tx, mut started_rx) = mpsc::unbounded_channel();
    let app = router(
        PORT,
        Stuck {
            started: started_tx,
        },
        env(),
    );

    for _ in 0..2 {
        let abandoned = tokio::spawn(app.clone().oneshot(local(
            "POST",
            "/v1/chat/completions",
            HELLO,
        )));
        tokio::time::timeout(PATIENCE, started_rx.recv())
            .await
            .unwrap_or_else(|_| panic!("reply did not start"));
        abandoned.abort();
        let _ = abandoned.await;
    }

    let (busy, _, text) = send(app, local("POST", "/v1/chat/completions", HELLO)).await;
    assert_eq!(busy, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(json_of(&text)["error"]["type"], "rate_limit_error");
}

#[test]
fn the_socket_is_meant_for_loopback_only_and_a_taken_port_says_so() {
    let address: std::net::IpAddr = HOST
        .parse()
        .unwrap_or_else(|error| panic!("HOST is not an address: {error}"));
    assert!(address.is_loopback());

    let taken = std::io::Error::from(std::io::ErrorKind::AddrInUse);
    assert_eq!(
        listen_failure(&taken, PORT),
        "Port 11500 is already in use."
    );
    assert_eq!(
        listen_failure(&std::io::Error::other("no route"), PORT),
        "no route"
    );
}

#[tokio::test]
async fn a_failed_reply_is_a_server_error_with_its_message() {
    let app = router(PORT, Scripted::failing("Out of memory."), env());

    let (status, _, text) = send(app, local("POST", "/v1/chat/completions", HELLO)).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(json_of(&text)["error"]["message"], "Out of memory.");
    assert_eq!(json_of(&text)["error"]["type"], "server_error");
}

#[tokio::test]
async fn a_streamed_failure_is_an_error_event_and_never_done() {
    let app = router(PORT, Scripted::failing("Out of memory."), env());
    let body = r#"{"model":"qwen3:8b","stream":true,"messages":[{"role":"user","content":"Hi"}]}"#;

    let (status, _, text) = send(app, local("POST", "/v1/chat/completions", body)).await;
    let events = frames(&text);

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        events.last().copied(),
        Some(r#"data: {"error":{"message":"Out of memory.","type":"server_error"}}"#)
    );
    assert!(!text.contains("[DONE]"));
}

#[tokio::test]
async fn a_failed_model_list_is_a_server_error() {
    let mut backend = Scripted::answering("unused");
    backend.model_failure = true;
    let app = router(PORT, backend, env());

    let (status, _, text) = send(app, local("GET", "/v1/models", "")).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        json_of(&text)["error"]["message"],
        "The server hit an error."
    );
}

/// Keeps every event as its target and the text of each field, so a test can search what was logged.
#[derive(Clone, Default)]
struct Capture(Arc<Mutex<String>>);

impl Capture {
    fn text(&self) -> String {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl Subscriber for Capture {
    fn enabled(&self, _: &Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _: &span::Attributes<'_>) -> span::Id {
        span::Id::from_u64(1)
    }

    fn record(&self, _: &span::Id, _: &span::Record<'_>) {}

    fn record_follows_from(&self, _: &span::Id, _: &span::Id) {}

    fn event(&self, event: &Event<'_>) {
        let mut line = format!("{} ", event.metadata().target());
        event.record(&mut Fields(&mut line));
        line.push('\n');
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push_str(&line);
    }

    fn enter(&self, _: &span::Id) {}

    fn exit(&self, _: &span::Id) {}
}

struct Fields<'a>(&'a mut String);

impl Visit for Fields<'_> {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.push_str(&format!("{}={value:?} ", field.name()));
    }
}

#[test]
fn the_key_never_reaches_the_logs() {
    let capture = Capture::default();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap_or_else(|error| panic!("cannot build a runtime: {error}"));
    let auth = format!("Bearer {KEY}");

    // With one dispatcher alive, tracing decides a call site's interest from whichever thread reaches it first, so
    // a parallel test with no subscriber can hide our lines. A second dispatcher makes it ask every live one.
    let _second = tracing::Dispatch::new(tracing::subscriber::NoSubscriber::default());
    tracing::subscriber::with_default(capture.clone(), || {
        runtime.block_on(async {
            let app = router(PORT, Scripted::failing("Out of memory."), env());
            let _ = send(
                app.clone(),
                request("GET", "/v1/models", &[("host", "127.0.0.1:11500")], ""),
            )
            .await;
            let _ = send(
                app.clone(),
                request(
                    "POST",
                    "/v1/chat/completions",
                    &[
                        ("host", "127.0.0.1:11500"),
                        ("authorization", "Bearer wrong-key-value"),
                    ],
                    HELLO,
                ),
            )
            .await;
            let _ = send(
                app.clone(),
                request(
                    "POST",
                    "/v1/chat/completions",
                    &[("host", "127.0.0.1:11500"), ("authorization", &auth)],
                    "{not json",
                ),
            )
            .await;
            let _ = send(app, local("POST", "/v1/chat/completions", HELLO)).await;
        });
    });

    let logged = capture.text();
    assert!(logged.contains("net.api"), "nothing was logged: {logged:?}");
    assert!(
        logged.contains("request refused"),
        "no refusal logged: {logged:?}"
    );
    assert!(!logged.contains(KEY), "the key reached the logs");
    assert!(
        !logged.contains(&KEY[..16]),
        "part of the key reached the logs"
    );
}
