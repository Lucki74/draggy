//! Runs the golden fixtures in `shared/fixtures/apiserver` through the port. The vitest runner in
//! `src/__tests__/fixtures/apiserver.test.ts` runs the same inputs through electron/apiServer.cjs, with the request
//! listener invoked directly and a fixed clock, so both must agree.

use std::collections::HashMap;
use std::convert::Infallible;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use axum::body::Body;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, Request, Uri};
use axum::response::Response;
use draggy_api::server::{
    Backend, BackendError, CompletionRequest, Env, Reply, Sink, Usage, check_request, chunk_line,
    completion_body, generate_key, models_body, read_completion_request, router, same_key,
};
use draggy_testkit::{cases, files};
use http_body_util::BodyExt;
use serde_json::{Map, Value, json};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

/// Turns of the event loop a step waits for before it gives up. The TypeScript runner waits the same number.
const TURNS: usize = 1000;

/// One test per fixture file, so a failure names its file. Each new file must be listed here, or the guard below fails.
macro_rules! fixture_tests {
    ($($test:ident => $file:literal),* $(,)?) => {
        const KNOWN_FILES: &[&str] = &[$($file),*];

        $(
            #[test]
            fn $test() {
                check_file($file);
            }
        )*
    };
}

fixture_tests! {
    access => "access.json",
    request => "request.json",
    bodies => "bodies.json",
    http => "http.json",
    ops => "ops.json",
}

#[test]
fn every_fixture_file_has_a_runner() {
    let unknown: Vec<String> = files("apiserver")
        .into_iter()
        .filter(|file| !KNOWN_FILES.contains(&file.as_str()))
        .collect();
    assert!(unknown.is_empty(), "no Rust runner for {unknown:?}");
}

/// Runs every case of one file and reports all the differences at once, not just the first.
fn check_file(file: &str) {
    let mut failures = Vec::new();
    for case in cases("apiserver", file) {
        let name = case["name"].as_str().unwrap_or_default();
        let actual = run(file, &case["input"]);
        if actual != case["expected"] {
            failures.push(format!(
                "{name}\n  expected {}\n  actual   {actual}",
                case["expected"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{file}: {} case(s) differ\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn run(file: &str, input: &Value) -> Value {
    match file {
        "access.json" => run_access(input),
        "request.json" => run_request(input),
        "bodies.json" => run_bodies(input),
        "http.json" => in_runtime(serve(input)),
        "ops.json" => in_runtime(run_steps(input)),
        other => panic!("no Rust runner for {other}"),
    }
}

fn in_runtime<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap_or_else(|error| panic!("cannot build a runtime: {error}"))
        .block_on(future)
}

/// A string field, or the empty string when it is missing or null, as the reference reads it.
fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().map(|item| text(item).to_owned()).collect())
        .unwrap_or_default()
}

fn run_access(input: &Value) -> Value {
    match input["op"].as_str() {
        Some("sameKey") => json!(same_key(text(&input["given"]), text(&input["expected"]))),
        Some("checkRequest") => {
            let headers = header_map(&input["headers"]);
            let port = u16::try_from(input["port"].as_u64().unwrap_or(0)).unwrap_or(0);
            match check_request(&headers, port, text(&input["key"])) {
                Some(refusal) => {
                    json!({"status": refusal.status.as_u16(), "message": refusal.message})
                }
                None => Value::Null,
            }
        }
        Some("generateKey") => {
            let bytes: Vec<u8> = input["bytes"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|byte| u8::try_from(byte.as_u64().unwrap_or(0)).unwrap_or(0))
                .collect();
            let random: [u8; 24] = bytes.try_into().unwrap_or_else(|rejected: Vec<u8>| {
                panic!("a key takes 24 bytes, got {}", rejected.len())
            });
            json!(generate_key(&random))
        }
        other => panic!("unknown access op {other:?}"),
    }
}

fn run_request(input: &Value) -> Value {
    match read_completion_request(&input["body"]) {
        Ok(request) => json!({"request": request}),
        Err(error) => json!({"error": error.to_string()}),
    }
}

fn run_bodies(input: &Value) -> Value {
    let raw = match input["op"].as_str() {
        Some("chunkLine") => chunk_line(
            text(&input["id"]),
            text(&input["model"]),
            input["created"].as_i64().unwrap_or(0),
            input["content"].as_str(),
            match input["finish"].as_str() {
                Some("stop") => Some("stop"),
                _ => None,
            },
        ),
        Some("completionBody") => completion_body(
            text(&input["id"]),
            text(&input["model"]),
            input["created"].as_i64().unwrap_or(0),
            text(&input["content"]),
            usage(&input["usage"]),
        ),
        Some("modelsBody") => models_body(
            &strings(&input["names"]),
            input["created"].as_i64().unwrap_or(0),
        ),
        other => panic!("unknown bodies op {other:?}"),
    };
    Value::String(raw)
}

/// Token counts from the reference's `usage` object. A missing or null object reads as zero.
fn usage(value: &Value) -> Usage {
    Usage {
        prompt_tokens: value["promptTokens"].as_u64().unwrap_or(0),
        response_tokens: value["responseTokens"].as_u64().unwrap_or(0),
    }
}

/// The headers the reference sets that a client can tell apart. An absent one reads as null.
const RELEVANT_HEADERS: [&str; 4] = [
    "content-type",
    "cache-control",
    "x-content-type-options",
    "connection",
];

fn fixture_env(config: &Value, input: &Value) -> FixtureEnv {
    FixtureEnv {
        key: text(&config["key"]).to_owned(),
        now: input["now"].as_i64().unwrap_or(0),
    }
}

fn fixture_port(config: &Value) -> u16 {
    u16::try_from(config["port"].as_u64().unwrap_or(0)).unwrap_or(0)
}

/// One request through the router, with the same fixed config and clock as the TypeScript runner.
async fn serve(input: &Value) -> Value {
    let config = &input["config"];
    let backend = FixtureBackend::new(config, input["reply"].clone());
    let app = router(fixture_port(config), backend, fixture_env(config, input));
    let response = app
        .oneshot(build_request(&input["request"]))
        .await
        .unwrap_or_else(|never: Infallible| match never {});
    shape(response).await
}

/// The status, the relevant headers and the body of a finished response, as the TypeScript runner reports them.
async fn shape(response: Response) -> Value {
    let status = response.status().as_u16();
    let headers: Map<String, Value> = RELEVANT_HEADERS
        .iter()
        .map(|name| ((*name).to_owned(), header_value(&response, name)))
        .collect();
    let is_stream = header_value(&response, "content-type") == json!("text/event-stream");
    let bytes = response
        .into_body()
        .collect()
        .await
        .map(|collected| collected.to_bytes())
        .unwrap_or_default();

    let raw = normalise_ids(&String::from_utf8_lossy(&bytes));
    let body = if is_stream {
        Value::String(raw)
    } else {
        serde_json::from_str::<Value>(&raw).unwrap_or(Value::String(raw))
    };
    json!({"status": status, "headers": headers, "body": body})
}

/// An ordered list of steps against one server, as the TypeScript runner runs them. A `send` with a `hold` does not
/// finish until its client leaves (`until_cancelled`) or ever (`ignore_cancel`), and reports `pending` while it runs.
/// An `abandon` closes the client of a pending request, and a `report` lists every reply the model was asked for.
async fn run_steps(input: &Value) -> Value {
    let config = &input["config"];
    let backend = FixtureBackend::new(config, input["reply"].clone());
    let app = router(
        fixture_port(config),
        backend.clone(),
        fixture_env(config, input),
    );
    let mut outputs = Vec::new();
    let mut pending: HashMap<String, (JoinHandle<Response>, usize)> = HashMap::new();

    for step in input["steps"].as_array().into_iter().flatten() {
        let name = text(&step["as"]).to_owned();
        match step["op"].as_str() {
            Some("send") => {
                let hold = step["hold"].as_str();
                backend.set_hold(hold);
                let before = backend.call_count();
                let request = build_request(&step["request"]);
                let app = app.clone();
                let task = tokio::spawn(async move {
                    app.oneshot(request)
                        .await
                        .unwrap_or_else(|never: Infallible| match never {})
                });
                for _ in 0..TURNS {
                    if task.is_finished() || (hold.is_some() && backend.call_count() > before) {
                        break;
                    }
                    tokio::task::yield_now().await;
                }

                if task.is_finished() {
                    let response = task
                        .await
                        .unwrap_or_else(|error| panic!("reply task failed: {error}"));
                    outputs.push(shape(response).await);
                } else if backend.call_count() > before {
                    pending.insert(name, (task, backend.call_count() - 1));
                    outputs.push(json!({"pending": true}));
                } else {
                    outputs.push(json!({"timeout": true}));
                }
            }
            Some("abandon") => {
                let (task, index) = pending
                    .remove(&name)
                    .unwrap_or_else(|| panic!("no pending request {name}"));
                task.abort();
                let _ = task.await;
                let cancelled = backend.cancelled(index);
                for _ in 0..TURNS {
                    if backend.settled(index) {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
                outputs.push(json!({"cancelled": cancelled, "settled": backend.settled(index)}));
            }
            Some("report") => outputs.push(json!({"calls": backend.report()})),
            other => panic!("unknown step {other:?}"),
        }
    }
    Value::Array(outputs)
}

fn header_value(response: &Response<Body>, name: &str) -> Value {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map_or(Value::Null, |value| json!(value))
}

fn build_request(spec: &Value) -> Request<Body> {
    let method = Method::from_bytes(text(&spec["method"]).as_bytes())
        .unwrap_or_else(|error| panic!("bad method: {error}"));
    let uri: Uri = text(&spec["url"])
        .parse()
        .unwrap_or_else(|error| panic!("bad url: {error}"));
    let payload = match spec["userContentPadding"].as_u64() {
        Some(length) => padded_body(usize::try_from(length).unwrap_or(usize::MAX)),
        None => text(&spec["body"]).to_owned(),
    };
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .body(Body::from(payload))
        .unwrap_or_else(|error| panic!("bad request: {error}"));
    *request.headers_mut() = header_map(&spec["headers"]);
    request
}

/// The body the TypeScript runner builds for `userContentPadding`: a completion whose user message is `length` characters long.
fn padded_body(length: usize) -> String {
    format!(
        "{{\"model\":\"qwen3:8b\",\"messages\":[{{\"role\":\"user\",\"content\":\"{}\"}}]}}",
        "x".repeat(length)
    )
}

/// Header values are Latin-1 text in the fixtures, as Node decodes them, so each character is one byte.
fn header_map(value: &Value) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(entries) = value.as_object() {
        for (name, value) in entries {
            let name = HeaderName::from_bytes(name.as_bytes())
                .unwrap_or_else(|error| panic!("bad header name {name}: {error}"));
            let bytes: Vec<u8> = text(value)
                .chars()
                .map(|c| {
                    u8::try_from(u32::from(c))
                        .unwrap_or_else(|_| panic!("header text is Latin-1 only: {c:?}"))
                })
                .collect();
            let value = HeaderValue::from_bytes(&bytes)
                .unwrap_or_else(|error| panic!("bad header value for {name}: {error}"));
            headers.append(name, value);
        }
    }
    headers
}

/// Replaces each completion id, which is random, with a placeholder, as the TypeScript runner does.
fn normalise_ids(raw: &str) -> String {
    const PREFIX: &str = "chatcmpl-";
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(at) = rest.find(PREFIX) {
        out.push_str(&rest[..at]);
        let tail = &rest[at + PREFIX.len()..];
        let is_id = tail.as_bytes().get(..24).is_some_and(|hex| {
            hex.iter()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
        });
        if is_id {
            out.push_str("chatcmpl-<random>");
            rest = &tail[24..];
        } else {
            out.push_str(PREFIX);
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

/// Which replies the fixture holds open. A sequence sets it before each send.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Hold {
    Open,
    IgnoreCancel,
    UntilCancelled,
}

/// One reply the model was asked for: the request it was handed, its cancel signal, and whether it has settled.
struct Call {
    request: CompletionRequest,
    cancel: CancellationToken,
    settled: bool,
}

/// The model in the fixture. It announces a name, sends its text chunks, then answers or fails. It can also hold a reply
/// open, and records every reply it was asked for.
#[derive(Clone)]
struct FixtureBackend {
    models: Vec<String>,
    models_fail: bool,
    reply: Value,
    hold: Arc<Mutex<Hold>>,
    calls: Arc<Mutex<Vec<Call>>>,
}

impl FixtureBackend {
    fn new(config: &Value, reply: Value) -> Self {
        Self {
            models: strings(&config["models"]),
            models_fail: config["modelsFail"].as_bool().unwrap_or(false),
            reply,
            hold: Arc::new(Mutex::new(Hold::Open)),
            calls: Arc::default(),
        }
    }

    fn set_hold(&self, hold: Option<&str>) {
        *lock(&self.hold) = match hold {
            Some("ignore_cancel") => Hold::IgnoreCancel,
            Some("until_cancelled") => Hold::UntilCancelled,
            _ => Hold::Open,
        };
    }

    fn call_count(&self) -> usize {
        lock(&self.calls).len()
    }

    fn cancelled(&self, index: usize) -> bool {
        lock(&self.calls)
            .get(index)
            .is_some_and(|call| call.cancel.is_cancelled())
    }

    fn settled(&self, index: usize) -> bool {
        lock(&self.calls)
            .get(index)
            .is_some_and(|call| call.settled)
    }

    fn report(&self) -> Vec<Value> {
        lock(&self.calls)
            .iter()
            .map(|call| {
                json!({
                    "request": call.request,
                    "cancelled": call.cancel.is_cancelled(),
                    "settled": call.settled,
                })
            })
            .collect()
    }

    async fn answer(
        &self,
        hold: Hold,
        sink: &Sink,
        cancel: &CancellationToken,
    ) -> Result<Reply, BackendError> {
        match hold {
            Hold::IgnoreCancel => std::future::pending::<()>().await,
            Hold::UntilCancelled => {
                cancel.cancelled().await;
                return Err(BackendError {
                    message: "cancelled".to_owned(),
                });
            }
            Hold::Open => {}
        }
        if let Some(name) = self.reply["announce"].as_str() {
            sink.model(name);
        }
        for chunk in self.reply["chunks"].as_array().into_iter().flatten() {
            sink.text(text(chunk));
        }
        if let Some(message) = self.reply["error"].as_str() {
            return Err(BackendError {
                message: message.to_owned(),
            });
        }
        Ok(Reply {
            model: text(&self.reply["model"]).to_owned(),
            content: text(&self.reply["content"]).to_owned(),
            usage: usage(&self.reply["usage"]),
        })
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Backend for FixtureBackend {
    async fn list_models(&self) -> Result<Vec<String>, BackendError> {
        if self.models_fail {
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
        cancel: CancellationToken,
    ) -> Result<Reply, BackendError> {
        let hold = *lock(&self.hold);
        let index = {
            let mut calls = lock(&self.calls);
            calls.push(Call {
                request,
                cancel: cancel.clone(),
                settled: false,
            });
            calls.len() - 1
        };
        let outcome = self.answer(hold, &sink, &cancel).await;
        if let Some(call) = lock(&self.calls).get_mut(index) {
            call.settled = true;
        }
        outcome
    }
}

/// The key and the clock of the fixture. Random bytes are fixed, and the completion ids they make are normalised.
struct FixtureEnv {
    key: String,
    now: i64,
}

impl Env for FixtureEnv {
    fn api_key(&self) -> String {
        self.key.clone()
    }

    fn now_unix(&self) -> i64 {
        self.now
    }

    fn fill_random(&self, buffer: &mut [u8]) {
        buffer.fill(0xab);
    }
}
