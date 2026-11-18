//! Ollama routes through the router, with a fake backend.

use std::convert::Infallible;
use std::sync::{Arc, Mutex, PoisonError};

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use draggy_api::server::{
    Backend, BackendError, ByteStream, CompletionRequest, DEFAULT_PORT, Embedded, Env, ForwardReply, ModelEntry,
    Reply, Sink, router,
};
use draggy_api::settings::ApiSettings;
use futures_util::stream;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

const KEY: &str = "draggy-test-key-0123456789";

#[derive(Clone)]
struct TestEnv(ApiSettings);

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
    fn settings(&self) -> ApiSettings {
        self.0.clone()
    }
}

#[derive(Clone, Default)]
struct Fake {
    seen: Arc<Mutex<Vec<Value>>>,
    chunks: Vec<String>,
}

impl Backend for Fake {
    async fn list_models(&self) -> Result<Vec<ModelEntry>, BackendError> {
        let mut entry = ModelEntry::local("qwen3:8b");
        entry.context_length = Some(4096);
        Ok(vec![entry])
    }
    async fn generate(&self, _: CompletionRequest, _: Sink, _: CancellationToken) -> Result<Reply, BackendError> {
        Ok(Reply::default())
    }
    async fn prepare_model(&self, requested: &str, _: CancellationToken) -> Result<String, BackendError> {
        Ok(requested.to_owned())
    }
    async fn forward(&self, body: Value, _: CancellationToken) -> Result<ForwardReply, BackendError> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner).push(body);
        let chunks: Vec<Result<Bytes, BackendError>> =
            self.chunks.iter().map(|c| Ok(Bytes::from(c.clone()))).collect();
        let body: ByteStream = Box::pin(stream::iter(chunks));
        Ok(ForwardReply { status: 200, body })
    }
    async fn embed(&self, _: &str, inputs: Vec<Value>, _: CancellationToken) -> Result<Embedded, BackendError> {
        Ok(Embedded { model: "nomic".to_owned(), vectors: inputs.iter().map(|_| vec![1.0, 0.5]).collect() })
    }
}

async fn call(
    backend: &Fake,
    settings: ApiSettings,
    method: &str,
    path: &str,
    body: &Value,
    key: bool,
) -> (StatusCode, String, String) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", format!("127.0.0.1:{DEFAULT_PORT}"));
    if key {
        builder = builder.header("authorization", format!("Bearer {KEY}"));
    }
    let request = builder.body(Body::from(body.to_string())).unwrap_or_else(|e| panic!("{e}"));
    let response = router(DEFAULT_PORT, backend.clone(), TestEnv(settings))
        .oneshot(request)
        .await
        .unwrap_or_else(|never: Infallible| match never {});
    let status = response.status();
    let kind = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let bytes = response.into_body().collect().await.map(|c| c.to_bytes()).unwrap_or_default();
    (status, kind, String::from_utf8_lossy(&bytes).into_owned())
}

fn json_of(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"))
}

fn plain() -> ApiSettings {
    ApiSettings::default()
}

#[tokio::test]
async fn small_routes_answer() {
    let backend = Fake::default();
    let (status, _, text) = call(&backend, plain(), "GET", "/api/version", &json!({}), true).await;
    assert_eq!((status, json_of(&text)["version"].clone()), (StatusCode::OK, json!("0.6.0")));
    let (_, _, text) = call(&backend, plain(), "GET", "/api/tags", &json!({}), true).await;
    assert_eq!(json_of(&text)["models"][0]["name"], "qwen3:8b");
    let (_, _, text) = call(&backend, plain(), "GET", "/api/ps", &json!({}), true).await;
    assert_eq!(json_of(&text), json!({"models": []}));
    let (_, _, text) = call(&backend, plain(), "POST", "/api/show", &json!({"model": "qwen3:8b"}), true).await;
    assert_eq!(json_of(&text)["model_info"]["llama.context_length"], 4096);
    let (status, _, text) = call(&backend, plain(), "POST", "/api/show", &json!({"model": "nope"}), true).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json_of(&text)["error"], "model 'nope' not found");
}

#[tokio::test]
async fn embeds_in_both_shapes() {
    let backend = Fake::default();
    let body = json!({"model": "m", "input": ["a", "b"]});
    let (_, _, text) = call(&backend, plain(), "POST", "/api/embed", &body, true).await;
    assert_eq!(json_of(&text)["embeddings"], json!([[1.0, 0.5], [1.0, 0.5]]));
    let body = json!({"model": "m", "prompt": "a"});
    let (_, _, text) = call(&backend, plain(), "POST", "/api/embeddings", &body, true).await;
    assert_eq!(json_of(&text)["embedding"], json!([1.0, 0.5]));
}

#[tokio::test]
async fn chat_streams_ndjson_by_default() {
    let chunks = [
        json!({"choices": [{"delta": {"content": "Hi"}}]}),
        json!({"choices": [{"delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 3, "completion_tokens": 1}}),
    ];
    let backend = Fake {
        chunks: chunks
            .iter()
            .map(|c| format!("data: {c}\n\n"))
            .chain(["data: [DONE]\n\n".to_owned()])
            .collect(),
        ..Fake::default()
    };
    let body = json!({"model": "qwen3:latest", "messages": [{"role": "user", "content": "hi"}]});
    let (status, kind, text) = call(&backend, plain(), "POST", "/api/chat", &body, true).await;
    assert_eq!((status, kind.as_str()), (StatusCode::OK, "application/x-ndjson"));
    let lines: Vec<Value> = text.lines().map(json_of).collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["message"]["content"], "Hi");
    assert_eq!(lines[1]["done"], true);
    assert_eq!(lines[1]["eval_count"], 1);
    let sent = backend.seen.lock().unwrap_or_else(PoisonError::into_inner)[0].clone();
    assert_eq!(sent["model"], "qwen3");
    assert_eq!(sent["stream"], true);
}

#[tokio::test]
async fn generate_without_stream_is_one_object() {
    let chat = json!({
        "choices": [{"message": {"role": "assistant", "content": "Yo"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 2, "completion_tokens": 1},
    });
    let backend = Fake { chunks: vec![chat.to_string()], ..Fake::default() };
    let body = json!({"model": "m", "prompt": "hi", "stream": false});
    let (status, _, text) = call(&backend, plain(), "POST", "/api/generate", &body, true).await;
    let reply = json_of(&text);
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reply["response"], "Yo");
    assert_eq!(reply["done"], true);
    let body = json!({"model": "m", "prompt": ""});
    let (_, _, text) = call(&backend, plain(), "POST", "/api/generate", &body, true).await;
    assert_eq!(json_of(&text)["done_reason"], "load");
}

#[tokio::test]
async fn the_key_is_skipped_only_when_asked() {
    let backend = Fake::default();
    let (status, _, text) = call(&backend, plain(), "GET", "/api/version", &json!({}), false).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(json_of(&text)["error"].is_string());
    let open = ApiSettings::from_value(&json!({"ollamaNoKey": true}));
    let (status, _, _) = call(&backend, open.clone(), "GET", "/api/version", &json!({}), false).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = call(&backend, open, "GET", "/v1/models", &json!({}), false).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
