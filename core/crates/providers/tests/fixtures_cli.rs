//! Runs the CLI-runtime and gateway fixtures (`shared/fixtures/providers/providers-cli-*.json` and
//! `providers-gateway-*.json`) against the Rust port. Each case names its driver in `input.fn`. Stateful drivers
//! (rpc, threads, gateway) replay an ordered list of operations; the fakes stand in for storage, the keystore, the
//! network, the account runtimes and the MCP endpoint. Numbers compare as numbers, and object keys sort.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::rc::Rc;

use draggy_providers::account::env::{account_env, private_home};
use draggy_providers::account::supervisor::{Instance, State, Supervisor};
use draggy_providers::account::threads::Threads;
use draggy_providers::catalog::Catalog;
use draggy_providers::claude;
use draggy_providers::claude::binary as claude_binary;
use draggy_providers::codex;
use draggy_providers::codex::binary as codex_binary;
use draggy_providers::gateway::{
    AccountCall, AccountFailure, AccountRuntime, AccountSink, Gateway, GatewayRequest, Sleeper,
};
use draggy_providers::http::{ByteStream, HttpClient, HttpRequest, HttpResponse, TransportError};
use draggy_providers::install_fs::{
    Download, FileView, InstallFs, Progress, SingleFlight, sha256_hex,
};
use draggy_providers::registry::{AddArgs, Keystore, KvStore, Patch, Registry};
use draggy_providers::rpc::{
    DEFAULT_MAX_LINE_BYTES, DEFAULT_TIMEOUT_MS, Event, Framed, LineFramer, Rpc, RpcCode, RpcError,
    RpcOptions, redact,
};
use draggy_providers::sse::Delta;
use draggy_providers::types::{ErrorKind, FinishReason, ProviderError, ProviderState, Usage};
use draggy_testkit::{cases, files};
use serde_json::{Map, Value, json};

/// A value with its keys sorted and its numbers written the same way, so a float and an integer that are equal match.
fn canon(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let sorted: BTreeMap<&String, String> =
                map.iter().map(|(k, v)| (k, canon(v))).collect();
            let parts: Vec<String> = sorted
                .iter()
                .map(|(k, v)| format!("{}:{v}", json!(k)))
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(canon).collect::<Vec<_>>().join(",")
        ),
        Value::Number(number) => match number.as_f64() {
            Some(float) if float.fract() == 0.0 && float.abs() < 9.0e15 => {
                format!("{}", float as i64)
            }
            Some(float) => format!("{float}"),
            None => number.to_string(),
        },
        other => other.to_string(),
    }
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned()
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn opt_text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn pairs(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_owned()))
                .collect()
        })
        .unwrap_or_default()
}

fn messages(value: &Value) -> Vec<Value> {
    value.as_array().cloned().unwrap_or_default()
}

/// A message or input that may be absent: JSON null means absent.
fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}

// ---------------------------------------------------------------------------------------------------------------
// Drivers for the pure functions.

fn run_frames(input: &Value) -> Value {
    let max = input
        .get("maxLineBytes")
        .and_then(Value::as_u64)
        .unwrap_or(64) as usize;
    let mut framer = LineFramer::new(max);
    let mut lines = Vec::new();
    let mut oversize = Vec::new();
    for chunk in input["chunks"].as_array().cloned().unwrap_or_default() {
        let bytes: Vec<u8> = match &chunk {
            Value::String(text) => text.as_bytes().to_vec(),
            Value::Array(list) => list
                .iter()
                .filter_map(|b| b.as_u64())
                .map(|b| b as u8)
                .collect(),
            other => panic!("unknown frame chunk {other:?}"),
        };
        for framed in framer.push(&bytes) {
            match framed {
                Framed::Line(line) => lines.push(json!(line)),
                Framed::Oversize(size) => oversize.push(json!(size)),
            }
        }
    }
    json!({ "lines": lines, "oversize": oversize })
}

fn error_json(error: &RpcError) -> Value {
    let code = match &error.code {
        RpcCode::Closed => json!("closed"),
        RpcCode::Timeout => json!("timeout"),
        RpcCode::Remote(Some(code)) => json!(code),
        RpcCode::Remote(None) => Value::Null,
    };
    json!({ "code": code, "message": error.message, "data": error.data.clone().unwrap_or(Value::Null) })
}

/// The RPC session: calls, input, time and closing, in order. Server requests are answered as the fixture's rule says.
fn run_rpc_session(input: &Value) -> Value {
    let options = RpcOptions {
        jsonrpc: flag(input, "jsonrpc"),
        timeout_ms: input
            .get("timeoutMs")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_TIMEOUT_MS),
        max_line_bytes: input
            .get("maxLineBytes")
            .and_then(Value::as_u64)
            .map_or(DEFAULT_MAX_LINE_BYTES, |n| n as usize),
        handles_requests: flag(input, "handlesRequests"),
    };
    let mut rpc = Rpc::new(options);
    let mut sent: Vec<Value> = Vec::new();
    let mut settled: Vec<Value> = Vec::new();
    let mut notifications: Vec<Value> = Vec::new();
    let mut logs: Vec<Value> = Vec::new();
    let mut results: Vec<Value> = Vec::new();
    let mut call_of_id: BTreeMap<u64, usize> = BTreeMap::new();
    let mut calls = 0usize;
    for op in input["ops"].as_array().cloned().unwrap_or_default() {
        match text(&op, "op").as_str() {
            "call" => {
                calls += 1;
                let timeout = op.get("timeoutMs").and_then(Value::as_u64);
                match rpc.call(&text(&op, "method"), op.get("params").cloned(), timeout) {
                    Ok(id) => {
                        call_of_id.insert(id, calls);
                    }
                    Err(error) => {
                        settled.push(json!({ "call": calls, "error": error_json(&error) }))
                    }
                }
            }
            "notify" => results.push(json!(
                rpc.notify(&text(&op, "method"), op.get("params").cloned())
            )),
            "input" => rpc.feed(text(&op, "text").as_bytes()),
            "advance" => rpc.advance(op.get("ms").and_then(Value::as_u64).unwrap_or(0)),
            "end" => rpc.close(),
            "error" => rpc.close_with(&text(&op, "message")),
            other => panic!("unknown rpc op {other:?}"),
        }
        for event in rpc.take_events() {
            match event {
                Event::Notification { method, params } => {
                    notifications.push(json!([method, params.unwrap_or(Value::Null)]))
                }
                Event::Request {
                    id,
                    method,
                    params: _,
                } => {
                    let answer = match method.as_str() {
                        "ok" => Ok(json!({ "ok": true })),
                        "deny" => Err((Some(-32001), "denied".to_owned())),
                        _ => Err((None, "x".to_owned())),
                    };
                    rpc.answer(id, answer);
                }
                Event::Settled { id, result } => {
                    let call = call_of_id.get(&id).copied().unwrap_or(0);
                    match result {
                        Ok(value) => settled.push(json!({ "call": call, "value": value })),
                        Err(error) => {
                            settled.push(json!({ "call": call, "error": error_json(&error) }))
                        }
                    }
                }
                Event::Log(line) => logs.push(json!(line)),
                Event::Closed(_) => {}
            }
        }
        for line in rpc.take_outbox() {
            sent.push(serde_json::from_str(line.trim_end()).unwrap_or(Value::Null));
        }
    }
    let written = sent.len();
    json!({
        "sent": sent,
        "settled": settled,
        "notifications": notifications,
        "logs": logs,
        "closed": rpc.is_closed(),
        "results": results,
        "rawWrites": written,
    })
}

fn run_env(input: &Value) -> Value {
    let app_data = text(input, "appData");
    let runtime = text(input, "runtime");
    let instance = text(input, "instanceId");
    if input.get("fn").and_then(Value::as_str) == Some("privateHome") {
        return match private_home(&app_data, &runtime, &instance) {
            Ok(home) => json!({ "home": home }),
            Err(error) => json!({ "error": error.to_string() }),
        };
    }
    match account_env(
        &runtime,
        &app_data,
        &instance,
        &pairs(input.get("parent")),
        &pairs(input.get("extra")),
    ) {
        Ok(built) => json!({ "env": built.env, "home": built.home }),
        Err(error) => json!({ "error": error.to_string() }),
    }
}

fn run_threads(input: &Value) -> Value {
    let mut threads = Threads::new(&text(input, "instanceId"), &text(input, "key"));
    let mut out = Vec::new();
    for op in input["ops"].as_array().cloned().unwrap_or_default() {
        let result = match text(&op, "op").as_str() {
            "plan" => {
                let plan = threads.plan(&messages(&op["messages"]));
                json!({ "id": plan.id, "history": plan.history, "input": plan.input.unwrap_or(Value::Null) })
            }
            "stored" => match threads.stored(&messages(&op["messages"])) {
                Some(stored) => {
                    json!({ "state": stored.state, "history": stored.history, "input": stored.input.unwrap_or(Value::Null) })
                }
                None => Value::Null,
            },
            "record" => threads.record(&text(&op, "id"), &messages(&op["messages"])),
            "forget" => {
                threads.forget(&text(&op, "id"));
                Value::Null
            }
            "clear" => {
                threads.clear();
                Value::Null
            }
            other => panic!("unknown threads op {other:?}"),
        };
        out.push(result);
    }
    Value::Array(out)
}

/// A failure as the renderer reads it: the kind and messages, plus the reset time when there is one.
fn failure_json(failure: &AccountFailure) -> Value {
    let mut value = serde_json::to_value(&failure.failure).unwrap_or(Value::Null);
    if let (Some(object), Some(resets_at)) = (value.as_object_mut(), &failure.resets_at) {
        object.insert("resetsAt".to_owned(), resets_at.clone());
    }
    value
}

fn claude_constant(name: &str) -> Value {
    match name {
        "ARGS" => json!(codex::process::ARGS),
        "FEATURES_OFF" => json!(codex::process::FEATURES_OFF),
        "CATALOG_NAME" => json!(codex::process::CATALOG_NAME),
        "FLAGS" => json!(claude::process::FLAGS),
        "QUIET" => json!(
            claude::process::QUIET
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect::<BTreeMap<String, String>>()
        ),
        "TOOL_TIMEOUT_MS" => json!(claude::process::TOOL_TIMEOUT_MS),
        "VERSION" => json!(claude::binary::VERSION),
        _ => Value::Null,
    }
}

fn run_pure(file: &str, input: &Value) -> Value {
    let fname = text(input, "fn");
    match fname.as_str() {
        "redact" => json!(redact(&text(input, "text"))),
        "frames" => run_frames(input),
        "rpcSession" => run_rpc_session(input),
        "accountEnv" | "privateHome" => run_env(input),
        "threads" => run_threads(input),
        "textOf" => json!(claude::adapter::text_of(
            present(input.get("content")).unwrap_or(&Value::Null)
        )),
        "flatten" => json!(claude::adapter::flatten(&messages(&input["history"]))),
        "toContent" => Value::Array(claude::adapter::to_content(
            &messages(&input["history"]),
            present(input.get("input")),
        )),
        "mcpTools" => Value::Array(claude::adapter::mcp_tools(
            input.get("tools").unwrap_or(&Value::Null),
        )),
        "effortOf" => {
            let body = input.get("body").cloned().unwrap_or(Value::Null);
            if file.contains("codex") {
                codex::adapter::effort_of(&body)
            } else {
                claude::adapter::effort_of(&body)
            }
        }
        "listedModels" => Value::Array(claude::adapter::listed_models(&messages(&input["listed"]))),
        "turnFailure" => {
            if file.contains("codex") {
                failure_json(&codex::adapter::turn_failure(
                    present(input.get("error")),
                    present(input.get("limits")),
                ))
            } else {
                failure_json(&claude::adapter::turn_failure(
                    &text(input, "text"),
                    present(input.get("limit")),
                ))
            }
        }
        "toItems" => Value::Array(codex::adapter::to_items(
            input.get("message").unwrap_or(&Value::Null),
        )),
        "toInput" => Value::Array(codex::adapter::to_input(present(input.get("message")))),
        "resetsAtOf" => {
            codex::adapter::resets_at_of(present(input.get("limits"))).unwrap_or(Value::Null)
        }
        "assetFor" => {
            let asset = if file.contains("codex") {
                codex::binary::asset_for(&text(input, "platformName"), &text(input, "arch"))
                    .map(|a| (a.name, a.url, a.sha256, a.size))
            } else {
                let musl = flag(input, "musl");
                claude::binary::asset_for(&text(input, "platformName"), &text(input, "arch"), musl)
                    .map(|a| (a.name, a.url, a.sha256, a.size))
            };
            match asset {
                Some((name, url, sha256, size)) => {
                    json!({ "name": name, "url": url, "sha256": sha256, "size": size })
                }
                None => Value::Null,
            }
        }
        "installDir" => {
            let app = text(input, "appData");
            json!(if file.contains("claude") {
                claude::binary::install_dir(&app)
            } else {
                codex::binary::install_dir(&app)
            })
        }
        "configToml" => {
            let top: Vec<String> = input
                .get("topLevel")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            let tables: Vec<String> = input
                .get("tables")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            json!(codex::process::config_toml(
                &text(input, "catalogPath"),
                &top,
                &tables
            ))
        }
        "workFolder" => {
            let program_data = input
                .get("env")
                .and_then(|env| opt_text(env, "ProgramData"));
            let uid = input.get("uid").and_then(Value::as_u64).unwrap_or(0) as u32;
            json!(claude::process::work_folder(
                &text(input, "instanceId"),
                &text(input, "platformName"),
                program_data.as_deref(),
                uid
            ))
        }
        "sessionArgs" => {
            let model = opt_text(input, "model");
            let effort = opt_text(input, "effort");
            let system = opt_text(input, "systemPrompt");
            let from = opt_text(input, "forkFrom");
            let at = opt_text(input, "at");
            let session = claude::process::SessionArgs {
                model: model.as_deref(),
                effort: effort.as_deref(),
                thinking: input.get("thinking").and_then(Value::as_bool),
                system_prompt: system.as_deref(),
                session_id: &text(input, "sessionId"),
                resume: flag(input, "resume"),
                fork_from: from.as_deref(),
                at: at.as_deref(),
            };
            json!(claude::process::session_args(&session))
        }
        "constants" => claude_constant(&text(input, "name")),
        other => json!({ "unknownDriver": other }),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Gateway: registry, network and accounts as fakes.

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

/// The scripted upstream: each request takes the next reply, and every request is recorded as sent.
#[derive(Default)]
struct Net {
    replies: RefCell<VecDeque<Value>>,
    sent: RefCell<Vec<Value>>,
    leave_on_wait: Cell<bool>,
}

impl HttpClient for Net {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError> {
        let body = request
            .body
            .as_deref()
            .and_then(|b| serde_json::from_str::<Value>(b).ok())
            .unwrap_or(Value::Null);
        // Header names are case-insensitive, so they are compared in lowercase.
        let headers: Map<String, Value> = request
            .headers
            .iter()
            .map(|(k, v)| (k.to_ascii_lowercase(), json!(v)))
            .collect();
        self.sent
            .borrow_mut()
            .push(json!({ "url": request.url, "headers": headers, "body": body }));
        let reply = self.replies.borrow_mut().pop_front().unwrap_or(Value::Null);
        if reply
            .get("readerLeaves")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            self.leave_on_wait.set(true);
        }
        if reply.get("error").and_then(Value::as_bool).unwrap_or(false) {
            return Err(TransportError {
                message: "fetch failed".to_owned(),
                cause_message: Some("ECONNREFUSED".to_owned()),
                code: None,
            });
        }
        let mut headers = BTreeMap::from([(
            "content-type".to_owned(),
            reply
                .get("contentType")
                .and_then(Value::as_str)
                .unwrap_or("application/json")
                .to_owned(),
        )]);
        if let Some(extra) = reply.get("headers").and_then(Value::as_object) {
            for (k, v) in extra {
                headers.insert(k.to_ascii_lowercase(), v.as_str().unwrap_or("").to_owned());
            }
        }
        Ok(HttpResponse {
            status: reply.get("status").and_then(Value::as_u64).unwrap_or(200) as u16,
            headers,
            body: reply
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
        })
    }
}

/// Waits without sleeping. The reader is gone during a wait exactly when the reply that asked for it said so.
struct NoWait<'a>(&'a Net);

impl Sleeper for NoWait<'_> {
    fn wait(&self, _ms: u64) -> bool {
        !self.0.leave_on_wait.get()
    }
}

/// An account runtime that plays its script: deltas, provider state, a finish, or a failure.
struct Scripted {
    script: Vec<Value>,
    calls: RefCell<Vec<Value>>,
}

impl AccountRuntime for Scripted {
    fn stream(
        &self,
        call: &AccountCall<'_>,
        sink: &mut dyn AccountSink,
    ) -> Result<(), Box<AccountFailure>> {
        self.calls
            .borrow_mut()
            .push(json!({ "modelId": call.model_id, "instanceId": call.connection.instance.id }));
        for op in &self.script {
            if let Some(delta) = op.get("delta") {
                sink.delta(Delta {
                    content: opt_text(delta, "content"),
                    reasoning: opt_text(delta, "reasoning"),
                    tool_calls: delta
                        .get("toolCalls")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                });
            }
            if let Some(state) = op.get("providerState") {
                sink.provider_state(&ProviderState {
                    instance_id: text(state, "instanceId"),
                    state: state.get("state").cloned().unwrap_or(Value::Null),
                });
            }
            if let Some(finish) = op.get("finish") {
                let reason: FinishReason = serde_json::from_value(json!(text(finish, "reason")))
                    .unwrap_or(FinishReason::Stop);
                let usage = finish.get("usage").cloned().unwrap_or(Value::Null);
                sink.finish(
                    reason,
                    Usage {
                        prompt_tokens: usage
                            .get("promptTokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        output_tokens: usage
                            .get("outputTokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        ..Usage::default()
                    },
                );
            }
            if let Some(failure) = op.get("throwFailure") {
                let kind: ErrorKind = serde_json::from_value(json!(text(failure, "kind")))
                    .unwrap_or(ErrorKind::UnknownError);
                return Err(Box::new(AccountFailure::from(ProviderError {
                    kind,
                    status: failure
                        .get("status")
                        .and_then(Value::as_u64)
                        .map(|s| s as u16),
                    message: opt_text(failure, "message"),
                    provider_message: opt_text(failure, "providerMessage"),
                    retry_after: None,
                })));
            }
            if let Some(message) = op.get("throwPlain").and_then(Value::as_str) {
                return Err(Box::new(AccountFailure::from(ProviderError {
                    kind: ErrorKind::UnknownError,
                    status: Some(0),
                    message: Some(message.to_owned()),
                    provider_message: Some(String::new()),
                    retry_after: None,
                })));
            }
        }
        Ok(())
    }
}

/// The reply as the renderer reads it: a stream as SSE frames, JSON as its value, anything else as its text.
fn reply_json(status: u16, headers: &BTreeMap<String, String>, body: &str) -> Value {
    let content_type = headers.get("content-type").cloned();
    let mut out = Map::new();
    out.insert("status".to_owned(), json!(status));
    out.insert("contentType".to_owned(), json!(content_type));
    out.insert(
        "allowOrigin".to_owned(),
        json!(headers.get("access-control-allow-origin")),
    );
    match content_type.as_deref() {
        Some(ct) if ct.starts_with("text/event-stream") => {
            let frames: Vec<Value> = body
                .split("\n\n")
                .filter(|frame| !frame.is_empty())
                .map(|frame| {
                    let data = frame.strip_prefix("data: ").unwrap_or(frame);
                    if data == "[DONE]" {
                        return json!("[DONE]");
                    }
                    let mut parsed: Value = serde_json::from_str(data).unwrap_or(Value::Null);
                    if let Some(object) = parsed.as_object_mut() {
                        object.remove("timings");
                    }
                    parsed
                })
                .collect();
            out.insert("frames".to_owned(), Value::Array(frames));
        }
        Some(ct) if ct.starts_with("application/json") => {
            let value = if body.is_empty() {
                Value::Null
            } else {
                serde_json::from_str(body).unwrap_or(Value::Null)
            };
            out.insert("json".to_owned(), value);
        }
        _ => {
            out.insert("text".to_owned(), json!(body));
        }
    }
    Value::Object(out)
}

fn run_gateway(input: &Value) -> Value {
    let mut registry = Registry::new(Kv::default(), Vault::default(), Catalog::bundled());
    for instance in input["instances"].as_array().cloned().unwrap_or_default() {
        let base_url = opt_text(&instance, "baseUrl");
        let added = registry
            .add(AddArgs {
                provider_type: text(&instance, "type"),
                base_url,
                label: None,
                headers: None,
            })
            .expect("fixture instance adds");
        if let Some(key) = opt_text(&instance, "key") {
            registry
                .set_key(&added.id, &key)
                .expect("fixture key stores");
        }
        let enabled = instance
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        registry
            .update(
                &added.id,
                Patch {
                    enabled: Some(enabled),
                    ..Patch::default()
                },
            )
            .expect("fixture instance updates");
    }
    let net = Net::default();
    for reply in input["upstream"].as_array().cloned().unwrap_or_default() {
        net.replies.borrow_mut().push_back(reply);
    }
    let account_protocol = opt_text(input, "accountProtocol");
    let account = Scripted {
        script: input["script"].as_array().cloned().unwrap_or_default(),
        calls: RefCell::new(Vec::new()),
    };
    let accounts: Vec<(&str, &dyn AccountRuntime)> = match &account_protocol {
        Some(protocol) => vec![(protocol.as_str(), &account as &dyn AccountRuntime)],
        None => Vec::new(),
    };
    let allowed = opt_text(input, "allowedOrigin").unwrap_or_default();
    let allowed_origin = move |origin: &str| origin == allowed;
    let engine_port = || 9u16;
    let clock = || 0u64;
    let gateway = Gateway {
        registry: &registry,
        http: &net,
        sleeper: &NoWait(&net),
        accounts: &accounts,
        allowed_origin: &allowed_origin,
        engine_port: &engine_port,
        clock: &clock,
    };
    let request_in = &input["request"];
    let request = GatewayRequest {
        method: request_in
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("POST")
            .to_owned(),
        url: request_in
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("draggy-ai://chat")
            .to_owned(),
        origin: opt_text(request_in, "origin"),
        request_id: opt_text(request_in, "requestId"),
        content_type: opt_text(request_in, "contentType"),
        body: opt_text(request_in, "body").unwrap_or_default(),
    };
    let reply = match gateway.handle(&request) {
        Ok(reply) => reply,
        Err(_) => return json!({ "networkError": true }),
    };
    let mut out = reply_json(reply.status, &reply.headers, &reply.body);
    if let Some(object) = out.as_object_mut() {
        object.insert(
            "upstream".to_owned(),
            Value::Array(net.sent.borrow().clone()),
        );
        object.insert(
            "accountCalls".to_owned(),
            Value::Array(account.calls.borrow().clone()),
        );
    }
    out
}

fn run(file: &str, input: &Value) -> Value {
    match text(input, "fn").as_str() {
        "gatewayRoutes" => run_gateway(input),
        "claudeInstall" => run_claude_install(input),
        "codexInstall" => run_codex_install(input),
        "supervisor" => run_supervisor(input),
        _ => run_pure(file, input),
    }
}

#[test]
fn providers_cli_and_gateway_fixtures_match_the_typescript_reference() {
    let mut failures = Vec::new();
    let mut total = 0;
    for file in files("providers") {
        if !(file.starts_with("providers-cli-") || file.starts_with("providers-gateway-")) {
            continue;
        }
        let area = file.trim_end_matches(".json").to_owned();
        for case in cases("providers", &file) {
            total += 1;
            let name = case["name"].as_str().unwrap_or_default();
            let actual = neutral(canon(&run(&area, &case["input"])));
            let expected = neutral(canon(&case["expected"]));
            if actual != expected {
                failures.push(format!(
                    "{area} / {name}\n  expected {expected}\n  actual   {actual}"
                ));
            }
        }
    }
    assert!(total > 0, "no CLI or gateway fixtures were found");
    assert!(
        failures.is_empty(),
        "{} of {total} fixtures differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Installs: the runtimes' installers against an in-memory folder, with the download, the unpacker and npm as fakes.

const APP: &str = "/data/Draggy";

/// A folder held in memory: its files, its folders and the files with their executable bit.
#[derive(Default)]
struct Folder {
    files: BTreeMap<String, Vec<u8>>,
    dirs: BTreeSet<String>,
    executable: BTreeSet<String>,
}

/// Windows joins write backslashes where the fixtures write slashes; one entry has one key.
fn key(path: &str) -> String {
    path.replace(std::path::MAIN_SEPARATOR, "/")
}

/// A canonical JSON text with Windows' escaped backslash separators read as slashes, on both sides of a comparison.
fn neutral(json: String) -> String {
    let slash = char::from(92u8);
    json.replace(&format!("{slash}{slash}"), "/")
}

fn under(path: &str, root: &str) -> bool {
    path == root || path.starts_with(&format!("{root}/"))
}

impl FileView for Folder {
    fn exists(&self, path: &str) -> bool {
        let path = key(path);
        self.files.contains_key(&path) || self.dirs.contains(&path)
    }

    fn list(&self, dir: &str) -> Option<Vec<String>> {
        let dir = key(dir);
        let dir = dir.as_str();
        let prefix = format!("{dir}/");
        let names: BTreeSet<String> = self
            .dirs
            .iter()
            .chain(self.files.keys())
            .filter_map(|path| path.strip_prefix(&prefix))
            .filter_map(|rest| rest.split('/').next())
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .collect();
        if names.is_empty() && !self.dirs.contains(dir) {
            return None;
        }
        Some(names.into_iter().collect())
    }
}

impl InstallFs for Folder {
    fn write_file(&mut self, path: &str, bytes: &[u8]) {
        self.files.insert(key(path), bytes.to_vec());
    }

    fn append_file(&mut self, path: &str, bytes: &[u8]) {
        self.files
            .entry(key(path))
            .or_default()
            .extend_from_slice(bytes);
    }

    fn make_dir(&mut self, path: &str) {
        self.dirs.insert(key(path));
    }

    fn remove_tree(&mut self, path: &str) {
        let path = key(path);
        let path = path.as_str();
        self.dirs.retain(|d| !under(d, path));
        self.files.retain(|f, _| !under(f, path));
        self.executable.retain(|f| !under(f, path));
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        let (from, to) = (key(from), key(to));
        let (from, to) = (from.as_str(), to.as_str());
        if !self.dirs.contains(from) {
            return Err(format!("no folder {from}"));
        }
        let moved = |p: &str| format!("{to}{}", &p[from.len()..]);
        let dirs: Vec<String> = self
            .dirs
            .iter()
            .filter(|d| under(d, from))
            .cloned()
            .collect();
        for dir in dirs {
            self.dirs.remove(&dir);
            self.dirs.insert(moved(&dir));
        }
        let files: Vec<String> = self
            .files
            .keys()
            .filter(|f| under(f, from))
            .cloned()
            .collect();
        for file in files {
            if let Some(bytes) = self.files.remove(&file) {
                self.files.insert(moved(&file), bytes);
            }
        }
        let modes: Vec<String> = self
            .executable
            .iter()
            .filter(|f| under(f, from))
            .cloned()
            .collect();
        for mode in modes {
            self.executable.remove(&mode);
            self.executable.insert(moved(&mode));
        }
        Ok(())
    }

    fn sha256(&self, path: &str) -> Option<String> {
        self.files.get(&key(path)).map(|bytes| sha256_hex(bytes))
    }

    fn set_executable(&mut self, path: &str) {
        self.executable.insert(key(path));
    }
}

/// A body that hands out fixed chunks.
struct Served(VecDeque<Vec<u8>>);

impl ByteStream for Served {
    fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
        Ok(self.0.pop_front())
    }

    fn cancel(&mut self) {
        self.0.clear();
    }
}

/// A download that serves fixed chunks, or refuses with a message.
struct Feed {
    chunks: Vec<Vec<u8>>,
    refuse: Option<String>,
}

impl Download for Feed {
    fn open(&mut self, _url: &str) -> Result<Box<dyn ByteStream>, TransportError> {
        match &self.refuse {
            Some(message) => Err(TransportError {
                message: message.clone(),
                cause_message: None,
                code: None,
            }),
            None => Ok(Box::new(Served(self.chunks.clone().into()))),
        }
    }
}

/// Writes the app-server file into the folder, as the release archive holds it.
struct Unpacker;

impl codex_binary::Unpack for Unpacker {
    fn unpack(&mut self, _archive: &str, dir: &str, fs: &mut dyn InstallFs) -> Result<(), String> {
        fs.write_file(
            &format!("{dir}/codex-app-server-x86_64-unknown-linux-musl"),
            b"app",
        );
        Ok(())
    }
}

fn text_list(input: &Value, key: &str) -> Vec<String> {
    input[key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn seeded(input: &Value) -> Folder {
    let mut folder = Folder::default();
    for file in text_list(input, "existing") {
        folder.write_file(&format!("{APP}/{file}"), b"old");
    }
    folder
}

fn chunks_of(input: &Value) -> Vec<Vec<u8>> {
    text_list(input, "chunks")
        .into_iter()
        .map(String::into_bytes)
        .collect()
}

/// The folder's files as the fixtures record them: relative, hashed, with their executable bit, and without the
/// lockfile copies the app itself makes.
fn listing(folder: &Folder, skip: &dyn Fn(&str) -> bool) -> Value {
    let files: Vec<Value> = folder
        .files
        .iter()
        .filter_map(|(path, bytes)| {
            let rel = path.strip_prefix(&format!("{APP}/"))?;
            if skip(rel) {
                return None;
            }
            Some(json!({
                "path": rel,
                "sha256": sha256_hex(bytes),
                "executable": folder.executable.contains(path),
            }))
        })
        .collect();
    Value::Array(files)
}

fn relative(value: &str) -> Value {
    let value = key(value);
    json!(value.strip_prefix(&format!("{APP}/")).unwrap_or(&value))
}

fn progress_json(progress: &Progress) -> Value {
    json!({ "completed": progress.completed, "total": progress.total, "percent": progress.percent })
}

/// `table` as the installers take it: each target with its archive name (codex), digest and size.
fn claude_table(input: &Value) -> Vec<(String, String, u64)> {
    input["table"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(target, entry)| {
            (
                target.clone(),
                entry[0].as_str().unwrap_or_default().to_owned(),
                entry[1].as_u64().unwrap_or_default(),
            )
        })
        .collect()
}

fn run_claude_install(input: &Value) -> Value {
    let mut folder = seeded(input);
    let table = claude_table(input);
    let table: Vec<(&str, &str, u64)> = table
        .iter()
        .map(|(target, sha, size)| (target.as_str(), sha.as_str(), *size))
        .collect();
    let mut download = Feed {
        chunks: chunks_of(input),
        refuse: opt_text(input, "refuse"),
    };
    let mut progress = Vec::new();
    let flight = SingleFlight::default();
    let outcome = claude_binary::ensure(
        &flight,
        &table,
        APP,
        text(input, "platformName").as_str(),
        input["arch"].as_str().unwrap_or("x64"),
        input["musl"].as_bool().unwrap_or(false),
        &mut download,
        &mut folder,
        &mut |p| progress.push(progress_json(&p)),
    );
    let (result, error) = match outcome {
        Ok(path) => (
            path.as_deref().map(relative).unwrap_or(Value::Null),
            Value::Null,
        ),
        Err(error) => (Value::Null, json!(error.0)),
    };
    json!({ "result": result, "files": listing(&folder, &|_| false), "progress": progress, "error": error })
}

fn run_codex_install(input: &Value) -> Value {
    let mut folder = seeded(input);
    let table: Vec<(String, String, String, u64)> = input["table"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(target, entry)| {
            (
                target.clone(),
                entry[0].as_str().unwrap_or_default().to_owned(),
                entry[1].as_str().unwrap_or_default().to_owned(),
                entry[2].as_u64().unwrap_or_default(),
            )
        })
        .collect();
    let table: Vec<(&str, &str, &str, u64)> = table
        .iter()
        .map(|(target, name, sha, size)| (target.as_str(), name.as_str(), sha.as_str(), *size))
        .collect();
    let mut download = Feed {
        chunks: chunks_of(input),
        refuse: opt_text(input, "refuse"),
    };
    let mut progress = Vec::new();
    let outcome = codex_binary::install_with(
        &table,
        APP,
        text(input, "platformName").as_str(),
        input["arch"].as_str().unwrap_or("x64"),
        &mut download,
        &mut Unpacker,
        &mut folder,
        &mut |p| progress.push(progress_json(&p)),
    );
    let (result, error) = match outcome {
        Ok(path) => (relative(&path), Value::Null),
        Err(error) => (Value::Null, json!(error.0)),
    };
    json!({ "result": result, "files": listing(&folder, &|_| false), "progress": progress, "error": error })
}

// ---------------------------------------------------------------------------------------------------------------
// The account runtime supervisor: its steps replayed in order, with the runtime a counter and the clock moved by hand.

struct StopCount(Rc<Cell<u32>>);

impl Instance for StopCount {
    fn stop(&mut self) {
        self.0.set(self.0.get() + 1);
    }
}

/// Records each backoff wait, as the supervisor's sleeper is asked for them.
struct Waits(Rc<RefCell<Vec<u64>>>);

impl Sleeper for Waits {
    fn wait(&self, ms: u64) -> bool {
        self.0.borrow_mut().push(ms);
        true
    }
}

fn run_supervisor(input: &Value) -> Value {
    let starts = Rc::new(Cell::new(0_u32));
    let stops = Rc::new(Cell::new(0_u32));
    let failing = Rc::new(Cell::new(input["failStarts"].as_u64().unwrap_or(0) as u32));
    let states = Rc::new(RefCell::new(Vec::<&'static str>::new()));
    let sleeps = Rc::new(RefCell::new(Vec::<u64>::new()));
    let waits = Waits(Rc::clone(&sleeps));
    let start = {
        let starts = Rc::clone(&starts);
        let stops = Rc::clone(&stops);
        let failing = Rc::clone(&failing);
        Box::new(move || -> Result<Box<dyn Instance>, String> {
            starts.set(starts.get() + 1);
            if failing.get() > 0 {
                failing.set(failing.get() - 1);
                return Err("spawn failed".to_owned());
            }
            Ok(Box::new(StopCount(Rc::clone(&stops))))
        })
    };
    let log = Rc::clone(&states);
    let mut supervisor = Supervisor::new(
        start,
        &waits,
        Box::new(move |state: State| log.borrow_mut().push(state.name())),
    );
    let mut now = 0_u64;
    let mut results: Vec<Value> = Vec::new();
    for step in input["ops"].as_array().cloned().unwrap_or_default() {
        match step["op"].as_str().unwrap_or("") {
            "acquire" => match supervisor.acquire(now) {
                Ok(()) => results.push(json!("ok")),
                Err(error) => results.push(json!(error.0)),
            },
            "release" => supervisor.release(now),
            "advance" => {
                now += step["ms"].as_u64().unwrap_or(0);
                supervisor.tick(now);
            }
            "stop" => supervisor.stop(),
            "crash" => {
                if let Some(generation) = supervisor.current_generation() {
                    supervisor.exited(generation);
                }
            }
            "reset" => supervisor.reset(),
            other => panic!("unknown supervisor step {other:?}"),
        }
    }
    json!({
        "results": results,
        "states": *states.borrow(),
        "starts": starts.get(),
        "stops": stops.get(),
        "sleeps": *sleeps.borrow(),
        "state": supervisor.state().name(),
    })
}
