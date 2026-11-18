//! Model mode through the router: bodies that go to the model, what comes back, and the wait for a slot. A fake
//! backend stands in for the chat gateway.

use std::convert::Infallible;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::Router;
use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use draggy_api::server::{
    Backend, BackendError, ByteStream, CompletionRequest, DEFAULT_PORT, Env, ForwardReply, Mode,
    ModelEntry, Reply, Sink, router,
};
use draggy_api::settings::ApiSettings;
use futures_util::stream;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

const KEY: &str = "draggy-test-key-0123456789";
const PATH: &str = "/v1/chat/completions";

#[derive(Clone)]
struct TestEnv {
    mode: Mode,
    wait: Duration,
    settings: ApiSettings,
}

impl Env for TestEnv {
    fn api_key(&self) -> String {
        KEY.to_owned()
    }

    fn now_unix(&self) -> i64 {
        1_700_000_000
    }

    fn fill_random(&self, buffer: &mut [u8]) {
        buffer.fill(0xab);
    }

    fn default_mode(&self) -> Mode {
        self.mode
    }

    fn queue_wait(&self) -> Duration {
        self.wait
    }

    fn settings(&self) -> ApiSettings {
        self.settings.clone()
    }
}

fn env() -> TestEnv {
    TestEnv {
        mode: Mode::Agent,
        wait: Duration::from_millis(100),
        settings: ApiSettings::default(),
    }
}

/// Answers a forwarded body with the chunks it is given, and records what it saw.
#[derive(Clone)]
struct Forwarding {
    chunks: Vec<String>,
    status: u16,
    release: Option<watch::Receiver<bool>>,
    forwarded: Arc<Mutex<Vec<Value>>>,
    asked: Arc<Mutex<Vec<String>>>,
    agent_calls: Arc<Mutex<usize>>,
}

impl Forwarding {
    fn replying(chunks: &[&str]) -> Self {
        Self {
            chunks: chunks.iter().map(|chunk| (*chunk).to_owned()).collect(),
            status: 200,
            release: None,
            forwarded: Arc::default(),
            asked: Arc::default(),
            agent_calls: Arc::default(),
        }
    }

    fn json(body: &Value) -> Self {
        Self::replying(&[&body.to_string()])
    }

    fn forwarded(&self) -> Vec<Value> {
        self.forwarded
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl Backend for Forwarding {
    async fn list_models(&self) -> Result<Vec<ModelEntry>, BackendError> {
        Ok(vec![ModelEntry::local("local-model")])
    }

    async fn generate(
        &self,
        _request: CompletionRequest,
        sink: Sink,
        _cancel: CancellationToken,
    ) -> Result<Reply, BackendError> {
        *self
            .agent_calls
            .lock()
            .unwrap_or_else(PoisonError::into_inner) += 1;
        sink.text("agent");
        Ok(Reply {
            model: "local-model".to_owned(),
            content: "agent".to_owned(),
            usage: Default::default(),
        })
    }

    async fn prepare_model(
        &self,
        requested: &str,
        _cancel: CancellationToken,
    ) -> Result<String, BackendError> {
        self.asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(requested.to_owned());
        Ok(if requested == "gpt-4o" || requested.is_empty() {
            "local-model".to_owned()
        } else {
            requested.to_owned()
        })
    }

    async fn forward(
        &self,
        body: Value,
        _cancel: CancellationToken,
    ) -> Result<ForwardReply, BackendError> {
        self.forwarded
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(body);
        if let Some(release) = &self.release {
            let mut release = release.clone();
            let _ = release.wait_for(|open| *open).await;
        }
        let chunks: Vec<Result<Bytes, BackendError>> = self
            .chunks
            .iter()
            .map(|chunk| Ok(Bytes::from(chunk.clone())))
            .collect();
        let body: ByteStream = Box::pin(stream::iter(chunks));
        Ok(ForwardReply {
            status: self.status,
            body,
        })
    }
}

fn post(body: &Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(PATH)
        .header("host", format!("127.0.0.1:{DEFAULT_PORT}"))
        .header("authorization", format!("Bearer {KEY}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|error| panic!("bad test request: {error}"))
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

/// The JSON of each `data:` frame of a stream, and whether `[DONE]` closed it.
fn read_stream(text: &str) -> (Vec<Value>, bool) {
    let mut chunks = Vec::new();
    let mut done = false;
    for frame in text.split("\n\n").filter(|frame| !frame.is_empty()) {
        let data = frame.strip_prefix("data: ").unwrap_or(frame);
        if data == "[DONE]" {
            done = true;
        } else {
            chunks.push(json_of(data));
        }
    }
    (chunks, done)
}

fn app(backend: &Forwarding) -> Router {
    router(DEFAULT_PORT, backend.clone(), env())
}

fn completion() -> Value {
    json!({
        "id": "chatcmpl-up",
        "object": "chat.completion",
        "created": 1,
        "model": "weights.gguf",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": null}],
        "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}
    })
}

#[tokio::test]
async fn a_request_with_tools_goes_to_the_model_untouched() {
    let backend = Forwarding::json(&completion());
    let sent = json!({
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "weather?"}],
        "tools": [{"type": "function", "function": {"name": "get", "parameters": {"type": "object"}}}],
        "tool_choice": "auto",
        "temperature": 0.2,
        "x_unknown": {"keep": [1, 2]}
    });

    let (status, _, text) = send(app(&backend), post(&sent)).await;
    let body = json_of(&text);

    assert_eq!(status, StatusCode::OK);
    let mut expected = sent.clone();
    expected["model"] = json!("local-model");
    assert_eq!(backend.forwarded(), vec![expected]);
    assert_eq!(*backend.agent_calls.lock().unwrap(), 0);
    // Our own model name replaces the engine's, and a missing finish reason reads stop.
    assert_eq!(body["model"], "local-model");
    assert_eq!(body["choices"][0]["finish_reason"], "stop");
    assert_eq!(body["usage"]["total_tokens"], 4);
}

#[tokio::test]
async fn tool_messages_and_null_content_are_accepted() {
    let backend = Forwarding::json(&completion());
    let sent = json!({
        "model": "local-model",
        "messages": [
            {"role": "user", "content": "weather?"},
            {"role": "assistant", "content": null, "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "get", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "sunny"}
        ]
    });

    let (status, _, _) = send(app(&backend), post(&sent)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(backend.forwarded(), vec![sent]);
}

#[tokio::test]
async fn an_image_part_is_accepted() {
    let backend = Forwarding::json(&completion());
    let sent = json!({
        "model": "local-model",
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "what is this?"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]}]
    });

    let (status, _, _) = send(app(&backend), post(&sent)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(backend.forwarded(), vec![sent]);
}

#[tokio::test]
async fn streamed_tool_call_deltas_pass_through_and_done_ends_the_stream() {
    let first = json!({"id": "x", "choices": [{"index": 0, "delta": {"tool_calls": [
        {"index": 0, "id": "c1", "type": "function", "function": {"name": "get", "arguments": ""}}]}, "finish_reason": null}]});
    let second = json!({"id": "x", "choices": [{"index": 0, "delta": {"tool_calls": [
        {"index": 0, "function": {"arguments": "{\"a\":1}"}}]}, "finish_reason": null}]});
    let last = json!({"id": "x", "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]});
    let frames: Vec<String> = [&first, &second, &last]
        .iter()
        .map(|chunk| format!("data: {chunk}\n\n"))
        .collect();
    let refs: Vec<&str> = frames.iter().map(String::as_str).collect();
    // The upstream never sends [DONE].
    let backend = Forwarding::replying(&refs);
    let sent = json!({"model": "local-model", "stream": true, "tools": [{"type": "function"}],
        "messages": [{"role": "user", "content": "go"}]});

    let (status, headers, text) = send(app(&backend), post(&sent)).await;
    let (chunks, done) = read_stream(&text);

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-type"], "text/event-stream");
    assert!(done);
    assert_eq!(chunks.len(), 3);
    assert_eq!(
        chunks[0]["choices"][0]["delta"]["tool_calls"],
        first["choices"][0]["delta"]["tool_calls"]
    );
    assert_eq!(
        chunks[1]["choices"][0]["delta"]["tool_calls"],
        second["choices"][0]["delta"]["tool_calls"]
    );
    assert_eq!(chunks[2]["choices"][0]["finish_reason"], "tool_calls");
    assert!(chunks.iter().all(|chunk| chunk["model"] == "local-model"));
}

#[tokio::test]
async fn include_usage_gets_a_final_usage_chunk_when_the_upstream_sends_none() {
    let text = json!({"id": "x", "choices": [{"index": 0, "delta": {"content": "hi"}, "finish_reason": null}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 1, "total_tokens": 6}});
    let stop = json!({"id": "x", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]});
    let a = format!("data: {text}\n\n");
    let b = format!("data: {stop}\n\ndata: [DONE]\n\n");
    let backend = Forwarding::replying(&[&a, &b]);
    let sent = json!({"model": "local-model", "stream": true, "stream_options": {"include_usage": true},
        "tools": [{"type": "function"}], "messages": [{"role": "user", "content": "go"}]});

    let (_, _, body) = send(app(&backend), post(&sent)).await;
    let (chunks, done) = read_stream(&body);

    assert!(done);
    assert!(body.ends_with("data: [DONE]\n\n"));
    let last = chunks.last().cloned().unwrap_or_default();
    assert_eq!(last["choices"], json!([]));
    assert_eq!(last["usage"]["total_tokens"], 6);
    // Only one [DONE], and it comes after the usage chunk.
    assert_eq!(body.matches("[DONE]").count(), 1);
}

#[tokio::test]
async fn a_usage_chunk_from_the_upstream_is_not_doubled() {
    let text = json!({"id": "x", "choices": [{"index": 0, "delta": {"content": "hi"}, "finish_reason": null}]});
    let usage = json!({"id": "x", "choices": [], "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}});
    let a = format!("data: {text}\n\ndata: {usage}\n\ndata: [DONE]\n\n");
    let backend = Forwarding::replying(&[&a]);
    let sent = json!({"model": "local-model", "stream": true, "stream_options": {"include_usage": true},
        "tools": [{"type": "function"}], "messages": [{"role": "user", "content": "go"}]});

    let (_, _, body) = send(app(&backend), post(&sent)).await;
    let (chunks, _) = read_stream(&body);

    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks[1]["usage"]["total_tokens"], 2);
}

#[tokio::test]
async fn draggy_agent_forces_agent_mode_even_with_tools() {
    let backend = Forwarding::json(&completion());
    let sent = json!({"model": "draggy-agent", "tools": [{"type": "function"}],
        "messages": [{"role": "user", "content": "hi"}]});

    let (status, _, text) = send(app(&backend), post(&sent)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&text)["choices"][0]["message"]["content"], "agent");
    assert!(backend.forwarded().is_empty());
}

#[tokio::test]
async fn a_plain_request_follows_the_default_mode() {
    let backend = Forwarding::json(&completion());
    let sent = json!({"model": "local-model", "messages": [{"role": "user", "content": "hi"}]});
    let model_first = TestEnv {
        mode: Mode::Model,
        wait: Duration::from_millis(100),
        settings: ApiSettings::default(),
    };

    let (_, _, text) = send(
        router(DEFAULT_PORT, backend.clone(), model_first),
        post(&sent),
    )
    .await;
    assert_eq!(json_of(&text)["choices"][0]["message"]["content"], "ok");
    assert_eq!(backend.forwarded().len(), 1);

    let (_, _, text) = send(app(&backend), post(&sent)).await;
    assert_eq!(json_of(&text)["choices"][0]["message"]["content"], "agent");
    assert_eq!(backend.forwarded().len(), 1);
}

#[tokio::test]
async fn max_completion_tokens_is_copied_to_max_tokens() {
    let backend = Forwarding::json(&completion());
    let alias = json!({"model": "local-model", "max_completion_tokens": 77, "tools": [{"type": "function"}],
        "messages": [{"role": "user", "content": "hi"}]});
    let both = json!({"model": "local-model", "max_completion_tokens": 77, "max_tokens": 5,
        "tools": [{"type": "function"}], "messages": [{"role": "user", "content": "hi"}]});

    send(app(&backend), post(&alias)).await;
    send(app(&backend), post(&both)).await;
    let seen = backend.forwarded();

    assert_eq!(seen[0]["max_tokens"], 77);
    assert_eq!(seen[0]["max_completion_tokens"], 77);
    assert_eq!(seen[1]["max_tokens"], 5);
}

#[tokio::test]
async fn a_model_mode_body_gets_a_light_check_only() {
    let backend = Forwarding::json(&completion());
    let bad_role = json!({"model": "m", "tools": [{"type": "function"}],
        "messages": [{"role": "robot", "content": "hi"}]});
    let none = json!({"model": "m", "tools": [{"type": "function"}], "messages": []});

    let (status, _, text) = send(app(&backend), post(&bad_role)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        json_of(&text)["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("messages[0].role")
    );
    let (status, _, _) = send(app(&backend), post(&none)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(backend.forwarded().is_empty());
}

#[tokio::test]
async fn an_upstream_error_keeps_its_status_and_gets_a_type() {
    let mut backend = Forwarding::json(&json!({"error": {"kind": "x", "message": "no model"}}));
    backend.status = 404;
    let sent = json!({"model": "m", "tools": [{"type": "function"}],
        "messages": [{"role": "user", "content": "hi"}]});

    let (status, _, text) = send(app(&backend), post(&sent)).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json_of(&text)["error"]["message"], "no model");
    assert_eq!(json_of(&text)["error"]["type"], "invalid_request_error");
}

fn tools_request() -> Value {
    json!({"model": "local-model", "tools": [{"type": "function"}],
        "messages": [{"role": "user", "content": "hi"}]})
}

#[tokio::test]
async fn a_request_waits_for_a_free_slot_and_is_then_answered() {
    let (release_tx, release_rx) = watch::channel(false);
    let mut backend = Forwarding::json(&completion());
    backend.release = Some(release_rx);
    let waiting = TestEnv {
        mode: Mode::Agent,
        wait: Duration::from_secs(5),
        settings: ApiSettings::default(),
    };
    let app = router(DEFAULT_PORT, backend.clone(), waiting);

    let handles: Vec<_> = (0..3)
        .map(|_| tokio::spawn(app.clone().oneshot(post(&tools_request()))))
        .collect();
    // Two are in the model, and the third is waiting.
    for _ in 0..200 {
        if backend.forwarded().len() == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(backend.forwarded().len(), 2);

    release_tx.send_replace(true);
    for handle in handles {
        let response = handle
            .await
            .unwrap_or_else(|error| panic!("task failed: {error}"))
            .unwrap_or_else(|never: Infallible| match never {});
        assert_eq!(response.status(), StatusCode::OK);
    }
    assert_eq!(backend.forwarded().len(), 3);
}

#[tokio::test]
async fn a_request_that_waits_too_long_gets_429_with_retry_after() {
    let (_release_tx, release_rx) = watch::channel(false);
    let mut backend = Forwarding::json(&completion());
    backend.release = Some(release_rx);
    let app = router(DEFAULT_PORT, backend.clone(), env());

    let _held: Vec<_> = (0..2)
        .map(|_| tokio::spawn(app.clone().oneshot(post(&tools_request()))))
        .collect();
    for _ in 0..200 {
        if backend.forwarded().len() == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }

    let (status, headers, text) = send(app, post(&tools_request())).await;

    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(headers.contains_key("retry-after"));
    assert_eq!(json_of(&text)["error"]["type"], "rate_limit_error");
}

fn with_settings(patch: Value) -> TestEnv {
    TestEnv {
        settings: ApiSettings::default().patched(&patch),
        ..env()
    }
}

fn plain() -> Value {
    json!({"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}], "tools": [{"type": "function"}]})
}

#[tokio::test]
async fn an_alias_is_applied_before_routing() {
    let backend = Forwarding::json(&completion());
    let env = with_settings(json!({"aliases": {"gpt-4o": "qwen"}}));

    send(router(DEFAULT_PORT, backend.clone(), env), post(&plain())).await;

    assert_eq!(backend.asked.lock().unwrap().clone(), vec!["qwen".to_owned()]);
}

#[tokio::test]
async fn the_system_prompt_and_sampling_defaults_reach_the_model() {
    let backend = Forwarding::json(&completion());
    let env = with_settings(json!({
        "systemPrompt": "Be brief.",
        "sampling": {"temperature": 0.3, "top_k": 20}
    }));
    let mut sent = plain();
    sent["temperature"] = json!(1.0);

    send(router(DEFAULT_PORT, backend.clone(), env), post(&sent)).await;

    let seen = backend.forwarded();
    assert_eq!(seen[0]["messages"][0], json!({"role": "system", "content": "Be brief."}));
    assert_eq!(seen[0]["temperature"], json!(1.0));
    assert_eq!(seen[0]["top_k"], json!(20));
}

#[tokio::test]
async fn reasoning_is_stripped_from_a_whole_reply_when_off() {
    let reply = json!({"choices": [{"message": {"role": "assistant", "content": "ok", "reasoning_content": "hm"}}]});
    let backend = Forwarding::json(&reply);

    let (_, _, text) = send(
        router(DEFAULT_PORT, backend.clone(), with_settings(json!({"sendReasoning": false}))),
        post(&plain()),
    )
    .await;
    assert!(json_of(&text)["choices"][0]["message"].get("reasoning_content").is_none());

    let (_, _, text) = send(app(&backend), post(&plain())).await;
    assert_eq!(json_of(&text)["choices"][0]["message"]["reasoning_content"], "hm");
}

#[tokio::test]
async fn reasoning_is_stripped_from_streamed_deltas_when_off() {
    let backend = Forwarding::replying(&[
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hm\",\"content\":\"a\"}}]}

",
        "data: [DONE]

",
    ]);
    let mut sent = plain();
    sent["stream"] = json!(true);

    let (_, _, text) = send(
        router(DEFAULT_PORT, backend, with_settings(json!({"sendReasoning": false}))),
        post(&sent),
    )
    .await;
    let (chunks, done) = read_stream(&text);

    assert!(done);
    assert_eq!(chunks[0]["choices"][0]["delta"], json!({"content": "a"}));
}

#[tokio::test]
async fn a_body_past_the_configured_limit_is_refused() {
    let backend = Forwarding::json(&completion());
    let mut sent = plain();
    sent["pad"] = json!("x".repeat(1024 * 1024 + 10));

    let (status, _, _) = send(app(&backend), post(&sent)).await;
    assert_eq!(status, StatusCode::OK);

    let env = with_settings(json!({"maxBodyMb": 1}));
    let (status, _, _) = send(router(DEFAULT_PORT, backend, env), post(&sent)).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

fn post_to(path: &str, key_header: (&str, String), body: &Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("host", format!("127.0.0.1:{DEFAULT_PORT}"))
        .header(key_header.0, key_header.1)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|error| panic!("bad request: {error}"))
}

#[tokio::test]
async fn responses_route_translates_the_body_and_the_reply() {
    let backend = Forwarding::json(&completion());
    let sent = json!({"model": "gpt-4o", "instructions": "Be brief.", "input": "hi", "store": true});

    let request = post_to("/v1/responses", ("authorization", format!("Bearer {KEY}")), &sent);
    let (status, _, text) = send(app(&backend), request).await;
    let reply: Value = serde_json::from_str(&text).unwrap_or_default();

    assert_eq!(status, StatusCode::OK);
    assert_eq!(reply["object"], "response");
    assert_eq!(reply["output"][0]["content"][0]["text"], "ok");
    assert_eq!(reply["usage"]["total_tokens"], 4);
    let forwarded = backend.forwarded();
    assert_eq!(forwarded[0]["messages"][0], json!({"role": "system", "content": "Be brief."}));
    assert_eq!(forwarded[0]["model"], "local-model");
}

#[tokio::test]
async fn responses_route_streams_events() {
    let chunk = json!({"id": "x", "choices": [{"index": 0, "delta": {"content": "Hi"}, "finish_reason": "stop"}]});
    let usage = json!({"id": "x", "choices": [], "usage": {"prompt_tokens": 2, "completion_tokens": 1}});
    let frames = [format!("data: {chunk}\n\n"), format!("data: {usage}\n\n"), "data: [DONE]\n\n".to_owned()];
    let refs: Vec<&str> = frames.iter().map(String::as_str).collect();
    let backend = Forwarding::replying(&refs);
    let sent = json!({"model": "m", "input": "hi", "stream": true});

    let request = post_to("/v1/responses", ("authorization", format!("Bearer {KEY}")), &sent);
    let (status, _, text) = send(app(&backend), request).await;

    assert_eq!(status, StatusCode::OK);
    assert!(text.starts_with("event: response.created\n"));
    assert!(text.contains("event: response.output_text.delta\n"));
    assert!(text.trim_end().ends_with('}'));
    assert!(text.contains("event: response.completed\n"));
    assert_eq!(backend.forwarded()[0]["stream_options"], json!({"include_usage": true}));
}

#[tokio::test]
async fn responses_route_refuses_previous_response_id() {
    let backend = Forwarding::json(&completion());
    let sent = json!({"model": "m", "input": "hi", "previous_response_id": "resp_1"});

    let request = post_to("/v1/responses", ("authorization", format!("Bearer {KEY}")), &sent);
    let (status, _, text) = send(app(&backend), request).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(text.contains("previous_response_id"));
    assert!(backend.forwarded().is_empty());
}

#[tokio::test]
async fn messages_route_takes_x_api_key_and_answers_in_the_anthropic_shape() {
    let backend = Forwarding::json(&completion());
    let sent = json!({"model": "claude-sonnet-4", "max_tokens": 10, "messages": [{"role": "user", "content": "hi"}]});

    let request = post_to("/v1/messages", ("x-api-key", KEY.to_owned()), &sent);
    let (status, _, text) = send(app(&backend), request).await;
    let reply: Value = serde_json::from_str(&text).unwrap_or_default();

    assert_eq!(status, StatusCode::OK);
    assert_eq!(reply["type"], "message");
    assert_eq!(reply["content"][0], json!({"type": "text", "text": "ok"}));
    assert_eq!(reply["stop_reason"], "end_turn");
    assert_eq!(reply["usage"], json!({"input_tokens": 3, "output_tokens": 1}));
    assert_eq!(backend.asked.lock().unwrap_or_else(PoisonError::into_inner).clone(), vec!["claude-sonnet-4"]);
}

#[tokio::test]
async fn messages_route_errors_use_the_anthropic_shape() {
    let backend = Forwarding::json(&completion());

    let request = post_to("/v1/messages", ("x-api-key", "wrong".to_owned()), &json!({}));
    let (status, _, text) = send(app(&backend), request).await;
    let reply: Value = serde_json::from_str(&text).unwrap_or_default();

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(reply["type"], "error");
    assert_eq!(reply["error"]["type"], "authentication_error");
}

#[tokio::test]
async fn count_tokens_estimates_without_calling_the_model() {
    let backend = Forwarding::json(&completion());
    let sent = json!({"model": "m", "messages": [{"role": "user", "content": "hello there"}]});

    let request = post_to("/v1/messages/count_tokens", ("x-api-key", KEY.to_owned()), &sent);
    let (status, _, text) = send(app(&backend), request).await;
    let reply: Value = serde_json::from_str(&text).unwrap_or_default();

    assert_eq!(status, StatusCode::OK);
    assert!(reply["input_tokens"].as_u64().unwrap_or(0) > 0);
    assert!(backend.forwarded().is_empty());
}

#[tokio::test]
async fn one_model_is_read_by_id() {
    let backend = Forwarding::json(&completion());
    let get = |id: &str| {
        Request::builder()
            .method("GET")
            .uri(format!("/v1/models/{id}"))
            .header("host", format!("127.0.0.1:{DEFAULT_PORT}"))
            .header("authorization", format!("Bearer {KEY}"))
            .body(Body::empty())
            .unwrap_or_else(|error| panic!("bad request: {error}"))
    };

    let (found, _, text) = send(app(&backend), get("local-model")).await;
    let (missing, _, _) = send(app(&backend), get("nope")).await;

    assert_eq!(found, StatusCode::OK);
    assert!(text.contains("\"id\":\"local-model\""));
    assert_eq!(missing, StatusCode::NOT_FOUND);
}
