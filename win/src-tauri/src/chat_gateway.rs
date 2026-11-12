//! The chat gateway: the renderer's `draggy-ai://chat` requests go to an axum server on 127.0.0.1 at a random port,
//! behind a bearer token made at launch. Ports win/electron/providers/gateway.cjs; the answers come from
//! `draggy_providers::gateway`. A reply streams from a blocking task, and a reader that leaves stops the engine.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::{Body, Bytes, to_bytes};
use axum::extract::{Request, State};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE, ORIGIN};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use draggy_api::server::{HOST, generate_key, same_key};

use draggy_providers::gateway::{Gateway, GatewayRequest, ReplySink, Sleeper};
use draggy_providers::http::TransportError;
use draggy_providers::registry::Registry;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

use crate::AppState;
use crate::ipc::providers::account::claude_chat::{self, ClaudeChat};
use crate::ipc::providers::account::codex_chat::{self as codex_chat_runtime, CodexChat};
use crate::ipc::providers::adapters::{AppHttp, AppKeys, AppKv};

const GATEWAY_URL: &str = "draggy-ai://chat";
const UNKNOWN_URL: &str = "draggy-ai://unknown";
const CHAT_PATH: &str = "/chat";
const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;
const QUEUE: usize = 32;
const RENDERER_ORIGIN: &str = "http://draggy.localhost";
const DEV_ORIGIN: &str = "http://127.0.0.1:5173";
const DEFAULT_ENGINE_PORT: u16 = 11435;
const DRAGGY_AI_SOURCES: [&str; 2] = ["draggy-ai:", "http://draggy-ai.localhost"];

/// What the renderer needs to reach the gateway.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GatewayInfo {
    pub url: String,
    pub token: String,
}

/// The engine's port, read for each request.
pub type EnginePort = Arc<dyn Fn() -> Pin<Box<dyn Future<Output = u16> + Send>> + Send + Sync>;

/// Answers one request into the sink. Arguments: the request, the engine port, the sink and a check that the reader
/// has gone. Runs on a blocking thread, as `Gateway::serve` blocks.
pub type Serve = Arc<
    dyn Fn(
            &GatewayRequest,
            u16,
            &mut dyn ReplySink,
            &dyn Fn() -> bool,
        ) -> Result<(), TransportError>
        + Send
        + Sync,
>;

/// The listening socket and the token, made before the window so the CSP can name the port.
pub struct Listener {
    socket: std::net::TcpListener,
    port: u16,
    token: String,
}

impl Listener {
    pub fn port(&self) -> u16 {
        self.port
    }
}

/// Binds a random loopback port and makes this launch's token.
pub fn bind() -> io::Result<Listener> {
    let socket = std::net::TcpListener::bind((HOST, 0))?;
    let port = socket.local_addr()?.port();
    socket.set_nonblocking(true)?;
    let mut random = [0u8; 24];
    getrandom::fill(&mut random).map_err(|error| io::Error::other(error.to_string()))?;
    Ok(Listener {
        socket,
        port,
        token: generate_key(&random),
    })
}

/// The running gateway. Kept in app state so `gateway_info` can answer and exit can stop it.
pub struct ChatGateway {
    info: GatewayInfo,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl ChatGateway {
    pub fn info(&self) -> &GatewayInfo {
        &self.info
    }

    pub fn stop(&self) {
        self.task.abort();
        claude_chat::stop_all();
        codex_chat_runtime::stop_all();
    }
}

/// Serves the gateway on the bound socket until stopped.
pub fn start(listener: Listener, engine_port: EnginePort, serve: Serve) -> ChatGateway {
    let info = GatewayInfo {
        url: format!("http://{HOST}:{}", listener.port),
        token: listener.token.clone(),
    };
    let router = router(listener.token, engine_port, serve);
    let socket = listener.socket;
    let task = tauri::async_runtime::spawn(async move {
        let Ok(socket) = tokio::net::TcpListener::from_std(socket) else {
            return;
        };
        let _ = axum::serve(socket, router).await;
    });
    ChatGateway { info, task }
}

/// Tells the renderer where the gateway is and the token it must present. Only the main window may call it.
#[tauri::command]
pub fn gateway_info(gateway: tauri::State<'_, ChatGateway>) -> GatewayInfo {
    gateway.info().clone()
}

/// The HTTP side: checks the bearer token, reads the body and streams the gateway's answer back.
struct Core {
    token: String,
    engine_port: EnginePort,
    serve: Serve,
}

pub fn router(token: String, engine_port: EnginePort, serve: Serve) -> Router {
    Router::new().fallback(handle).with_state(Arc::new(Core {
        token,
        engine_port,
        serve,
    }))
}

/// What the blocking side sends: the status and headers first, then body chunks.
enum Event {
    Head {
        status: u16,
        headers: BTreeMap<String, String>,
    },
    Chunk(Vec<u8>),
}

/// Writes into the channel the response body reads from. A closed channel tells the gateway to stop the engine.
struct ChannelSink(mpsc::Sender<Event>);

impl ReplySink for ChannelSink {
    fn head(&mut self, status: u16, headers: &BTreeMap<String, String>) {
        let mut headers = headers.clone();
        // The renderer's preflight carries the bearer header, which the gateway's own allow list leaves out.
        if let Some(allow) = headers.get_mut("access-control-allow-headers") {
            allow.push_str(", authorization");
        }
        let _ = self.0.blocking_send(Event::Head { status, headers });
    }

    fn chunk(&mut self, bytes: &[u8]) -> bool {
        self.0.blocking_send(Event::Chunk(bytes.to_vec())).is_ok()
    }
}

/// Waits between retries, and stops waiting once the reader has gone.
struct Waits<'a> {
    gone: &'a dyn Fn() -> bool,
}

impl Sleeper for Waits<'_> {
    fn wait(&self, ms: u64) -> bool {
        let until = std::time::Instant::now() + Duration::from_millis(ms);
        loop {
            if (self.gone)() {
                return false;
            }
            let now = std::time::Instant::now();
            if now >= until {
                return true;
            }
            std::thread::sleep((until - now).min(Duration::from_millis(100)));
        }
    }
}

async fn handle(State(core): State<Arc<Core>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    if parts.method != Method::OPTIONS && !authorized(&parts.headers, &core.token) {
        return refuse(StatusCode::UNAUTHORIZED, "Missing or wrong gateway token.");
    }
    let body = match to_bytes(body, MAX_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return refuse(
                StatusCode::PAYLOAD_TOO_LARGE,
                "The request body is too large.",
            );
        }
    };

    let gateway_request = GatewayRequest {
        method: parts.method.as_str().to_owned(),
        url: if parts.uri.path() == CHAT_PATH {
            GATEWAY_URL.to_owned()
        } else {
            UNKNOWN_URL.to_owned()
        },
        origin: header_text(&parts.headers, ORIGIN.as_str()),
        request_id: header_text(&parts.headers, "x-request-id"),
        content_type: header_text(&parts.headers, CONTENT_TYPE.as_str()),
        body: String::from_utf8_lossy(&body).into_owned(),
    };

    let port = (core.engine_port)().await;
    let (tx, mut rx) = mpsc::channel::<Event>(QUEUE);
    let reader = tx.clone();
    let serve = Arc::clone(&core.serve);
    tauri::async_runtime::spawn_blocking(move || {
        let gone = move || reader.is_closed();
        let mut sink = ChannelSink(tx);
        // The gateway's own errors reach the reader as a cut or empty reply; nothing here logs the body.
        let _ = serve(&gateway_request, port, &mut sink, &gone);
    });

    let Some(Event::Head { status, headers }) = rx.recv().await else {
        return refuse(
            StatusCode::BAD_GATEWAY,
            "The gateway could not reach the provider.",
        );
    };
    let chunks = futures_util::stream::unfold(rx, |mut rx| async move {
        match rx.recv().await {
            Some(Event::Chunk(bytes)) => Some((Ok::<Bytes, Infallible>(Bytes::from(bytes)), rx)),
            _ => None,
        }
    });
    let mut response = Response::new(Body::from_stream(chunks));
    *response.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
    for (name, value) in headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(&value),
        ) {
            response.headers_mut().insert(name, value);
        }
    }
    response
}

/// The bearer token the renderer sends, compared in constant time.
fn authorized(headers: &HeaderMap, token: &str) -> bool {
    let Some(value) = header_text(headers, AUTHORIZATION.as_str()) else {
        return false;
    };
    let Some((scheme, given)) = value.split_once(' ') else {
        return false;
    };
    scheme.eq_ignore_ascii_case("bearer") && same_key(given.trim(), token)
}

fn header_text(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn refuse(status: StatusCode, message: &str) -> Response {
    let body = json!({ "error": { "kind": "provider-unknown-error", "message": message } });
    (
        status,
        [(CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}

/// The engine's port, read from the chat server's supervisor each time a request comes in.
pub fn engine_port(app: AppHandle) -> EnginePort {
    Arc::new(move || {
        let app = app.clone();
        Box::pin(async move {
            let Some(state) = app.try_state::<AppState>() else {
                return DEFAULT_ENGINE_PORT;
            };
            let llama = state.engines.llama().await;
            llama.status().port
        })
    })
}

/// Answers a request the way the gateway does, over the app's registry, keys and network.
pub fn production_serve(app: AppHandle) -> Serve {
    Arc::new(move |request, port, sink, gone| {
        let Some(state) = app.try_state::<AppState>() else {
            return Err(TransportError {
                message: "The app is still starting.".to_owned(),
                cause_message: None,
                code: None,
            });
        };
        let registry = Registry::new(
            AppKv {
                storage: state.storage.handle(),
                diag: Some(Arc::clone(&state.diag)),
            },
            AppKeys { app: app.clone() },
            crate::ipc::providers::active_catalog(),
        );
        let allowed = |origin: &str| {
            origin == RENDERER_ORIGIN || (cfg!(debug_assertions) && origin == DEV_ORIGIN)
        };
        let clock = || {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_millis() as u64)
        };
        let sleeper = Waits { gone };
        let engine = move || port;
        let claude = ClaudeChat::new(app.clone());
        let codex = CodexChat::new(app.clone());
        let accounts: [(&str, &dyn draggy_providers::gateway::AccountRuntime); 2] =
            [("claude", &claude), ("codex", &codex)];
        let gateway = Gateway {
            registry: &registry,
            http: &AppHttp,
            sleeper: &sleeper,
            accounts: &accounts,
            allowed_origin: &allowed,
            engine_port: &engine,
            clock: &clock,
        };
        gateway.serve(request, sink)
    })
}

/// The renderer's connect-src with the draggy-ai entries replaced by the gateway's origin and nothing else.
pub fn connect_src_with_gateway(policy: &str, port: u16) -> String {
    let origin = format!("http://{HOST}:{port}");
    policy
        .split(';')
        .map(str::trim)
        .filter(|directive| !directive.is_empty())
        .map(|directive| {
            let Some(rest) = directive.strip_prefix("connect-src") else {
                return directive.to_owned();
            };
            let mut sources: Vec<&str> = rest
                .split_whitespace()
                .filter(|source| !DRAGGY_AI_SOURCES.contains(source))
                .collect();
            sources.push(&origin);
            format!("connect-src {}", sources.join(" "))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Points the app's CSP at the gateway's port. Errors when the CSP is not a plain policy string.
pub fn restrict_csp<R: tauri::Runtime>(
    context: &mut tauri::Context<R>,
    port: u16,
) -> Result<(), String> {
    use tauri::utils::config::Csp;
    let security = &mut context.config_mut().app.security;
    for slot in [&mut security.csp, &mut security.dev_csp] {
        match slot {
            Some(Csp::Policy(policy)) => *policy = connect_src_with_gateway(policy, port),
            Some(_) => return Err("the CSP is not a policy string".to_owned()),
            None => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    const TOKEN: &str = "draggy-test-token";

    fn engine() -> EnginePort {
        Arc::new(|| Box::pin(async { 1 }))
    }

    /// Serves the router on a loopback port and returns its base URL.
    async fn spawn(serve: Serve) -> String {
        let socket = tokio::net::TcpListener::bind((HOST, 0))
            .await
            .expect("bind");
        let port = socket.local_addr().expect("addr").port();
        let app = router(TOKEN.to_owned(), engine(), serve);
        tokio::spawn(async move {
            let _ = axum::serve(socket, app).await;
        });
        format!("http://{HOST}:{port}")
    }

    fn post(base: &str) -> reqwest::RequestBuilder {
        reqwest::Client::new()
            .post(format!("{base}/chat"))
            .bearer_auth(TOKEN)
            .body(r#"{"model":"gguf:a.gguf"}"#)
    }

    #[tokio::test]
    async fn passes_the_engine_reply_through() {
        let seen = Arc::new(Mutex::new(None::<GatewayRequest>));
        let capture = Arc::clone(&seen);
        let serve: Serve = Arc::new(move |request, port, sink, _| {
            *capture.lock().unwrap() = Some(request.clone());
            assert_eq!(port, 1);
            let mut headers = BTreeMap::new();
            headers.insert("x-engine".to_owned(), "yes".to_owned());
            sink.head(201, &headers);
            sink.chunk(b"hello");
            Ok(())
        });
        let base = spawn(serve).await;
        let response = post(&base).send().await.expect("send");
        assert_eq!(response.status(), 201);
        assert_eq!(response.headers()["x-engine"], "yes");
        assert_eq!(response.text().await.expect("text"), "hello");

        let request = seen.lock().unwrap().take().expect("served");
        assert_eq!(request.url, GATEWAY_URL);
        assert_eq!(request.method, "POST");
        assert_eq!(request.body, r#"{"model":"gguf:a.gguf"}"#);
    }

    #[tokio::test]
    async fn streams_each_chunk_before_the_reply_ends() {
        let (gate_tx, gate_rx) = std::sync::mpsc::channel::<()>();
        let gate_rx = Mutex::new(gate_rx);
        let serve: Serve = Arc::new(move |_, _, sink, _| {
            sink.head(200, &BTreeMap::new());
            sink.chunk(b"one");
            let _ = gate_rx.lock().unwrap().recv();
            sink.chunk(b"two");
            Ok(())
        });
        let base = spawn(serve).await;
        let mut response = post(&base).send().await.expect("send");
        assert_eq!(
            response.chunk().await.expect("chunk").as_deref(),
            Some(&b"one"[..])
        );
        gate_tx.send(()).expect("release");
        assert_eq!(
            response.chunk().await.expect("chunk").as_deref(),
            Some(&b"two"[..])
        );
    }

    #[tokio::test]
    async fn stops_the_engine_when_the_reader_leaves() {
        let stopped = Arc::new(AtomicBool::new(false));
        let writes = Arc::new(AtomicUsize::new(0));
        let (done, writes_seen) = (Arc::clone(&stopped), Arc::clone(&writes));
        let serve: Serve = Arc::new(move |_, _, sink, _| {
            sink.head(200, &BTreeMap::new());
            for _ in 0..1000 {
                writes_seen.fetch_add(1, Ordering::SeqCst);
                if !sink.chunk(b"tick") {
                    done.store(true, Ordering::SeqCst);
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Ok(())
        });
        let base = spawn(serve).await;
        let mut response = post(&base).send().await.expect("send");
        assert!(response.chunk().await.expect("chunk").is_some());
        drop(response);

        for _ in 0..500 {
            if stopped.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(stopped.load(Ordering::SeqCst), "the engine was not stopped");
        assert!(writes.load(Ordering::SeqCst) < 1000);
    }

    #[tokio::test]
    async fn refuses_a_missing_or_wrong_bearer_before_serving() {
        let called = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&called);
        let serve: Serve = Arc::new(move |_, _, _, _| {
            flag.store(true, Ordering::SeqCst);
            Ok(())
        });
        let base = spawn(serve).await;
        let client = reqwest::Client::new();
        let missing = client
            .post(format!("{base}/chat"))
            .body("{}")
            .send()
            .await
            .expect("send");
        assert_eq!(missing.status(), 401);
        let wrong = client
            .post(format!("{base}/chat"))
            .bearer_auth("draggy-other")
            .body("{}")
            .send()
            .await
            .expect("send");
        assert_eq!(wrong.status(), 401);
        assert!(!called.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn answers_with_a_bad_gateway_when_nothing_is_written() {
        let base = spawn(Arc::new(|_, _, _, _| Ok(()))).await;
        let response = post(&base).send().await.expect("send");
        assert_eq!(response.status(), 502);
    }

    #[tokio::test]
    async fn keeps_the_bearer_header_in_the_preflight_allow_list() {
        let serve: Serve = Arc::new(|_, _, sink, _| {
            let mut headers = BTreeMap::new();
            headers.insert(
                "access-control-allow-headers".to_owned(),
                "content-type, x-request-id".to_owned(),
            );
            sink.head(204, &headers);
            Ok(())
        });
        let base = spawn(serve).await;
        let response = reqwest::Client::new()
            .request(reqwest::Method::OPTIONS, format!("{base}/chat"))
            .send()
            .await
            .expect("send");
        assert_eq!(response.status(), 204);
        assert!(
            response.headers()["access-control-allow-headers"]
                .to_str()
                .expect("text")
                .ends_with("authorization")
        );
    }

    #[test]
    fn reads_the_bearer_scheme_without_case() {
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("bearer draggy-test-token"),
        );
        assert!(authorized(&headers, TOKEN));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Basic draggy-test-token"),
        );
        assert!(!authorized(&headers, TOKEN));
        assert!(!authorized(&HeaderMap::new(), TOKEN));
    }

    #[test]
    fn replaces_only_the_draggy_ai_sources_in_connect_src() {
        let policy = "default-src 'self' draggy:; connect-src 'self' ipc: draggy-ai: http://draggy-ai.localhost blob:;";
        let patched = connect_src_with_gateway(policy, 4321);
        assert!(patched.contains("connect-src 'self' ipc: blob: http://127.0.0.1:4321"));
        assert!(patched.contains("default-src 'self' draggy:"));
        assert!(!patched.contains("draggy-ai"));
        assert!(!patched.contains("*"));
    }

    #[test]
    fn a_fresh_listener_has_a_launch_token_and_a_loopback_port() {
        let listener = bind().expect("bind");
        assert!(listener.port() > 0);
        assert!(listener.token.starts_with("draggy-"));
        assert!(listener.token.len() > 20);
    }
}
