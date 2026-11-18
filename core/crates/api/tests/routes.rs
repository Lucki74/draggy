//! Embeddings and legacy completions through the router, with a fake backend.

use std::convert::Infallible;
use std::sync::{Arc, Mutex, PoisonError};

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use draggy_api::server::{
    Backend, BackendError, ByteStream, CompletionRequest, DEFAULT_PORT, Embedded, Env, ForwardReply, ModelEntry,
    Reply, Sink, router,
};
use futures_util::stream;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

const KEY: &str = "draggy-test-key-0123456789";

struct TestEnv;

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
}

#[derive(Clone, Default)]
struct Fake {
    seen: Arc<Mutex<Vec<Value>>>,
    chunks: Vec<String>,
    status: u16,
}

impl Backend for Fake {
    async fn list_models(&self) -> Result<Vec<ModelEntry>, BackendError> {
        Ok(vec![])
    }
    async fn generate(&self, _: CompletionRequest, _: Sink, _: CancellationToken) -> Result<Reply, BackendError> {
        Ok(Reply::default())
    }
    async fn prepare_model(&self, requested: &str, _: CancellationToken) -> Result<String, BackendError> {
        Ok(if requested.is_empty() { "local".to_owned() } else { requested.to_owned() })
    }
    async fn forward_completions(&self, body: Value, _: CancellationToken) -> Result<ForwardReply, BackendError> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner).push(body);
        let chunks: Vec<Result<Bytes, BackendError>> =
            self.chunks.iter().map(|c| Ok(Bytes::from(c.clone()))).collect();
        let body: ByteStream = Box::pin(stream::iter(chunks));
        Ok(ForwardReply { status: self.status, body })
    }
    async fn embed(&self, _: &str, inputs: Vec<Value>, _: CancellationToken) -> Result<Embedded, BackendError> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner).push(json!(inputs));
        Ok(Embedded {
            model: "nomic-embed-text".to_owned(),
            vectors: inputs.iter().map(|_| vec![1.0, 0.5]).collect(),
        })
    }
}

async fn call(backend: &Fake, path: &str, body: &Value) -> (StatusCode, String) {
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", format!("127.0.0.1:{DEFAULT_PORT}"))
        .header("authorization", format!("Bearer {KEY}"))
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|e| panic!("{e}"));
    let response = router(DEFAULT_PORT, backend.clone(), TestEnv)
        .oneshot(request)
        .await
        .unwrap_or_else(|never: Infallible| match never {});
    let status = response.status();
    let bytes = response.into_body().collect().await.map(|c| c.to_bytes()).unwrap_or_default();
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

fn json_of(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"))
}

#[tokio::test]
async fn embeddings_answer_in_the_openai_shape() {
    let backend = Fake::default();
    let (status, text) = call(&backend, "/v1/embeddings", &json!({"model": "x", "input": ["hello", "hi"]})).await;
    let body = json_of(&text);
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["object"], "list");
    assert_eq!(body["data"][1]["index"], 1);
    assert_eq!(body["data"][0]["embedding"], json!([1.0, 0.5]));
    assert_eq!(body["model"], "nomic-embed-text");
    assert_eq!(body["usage"]["prompt_tokens"], 3);
}

#[tokio::test]
async fn embeddings_take_a_string_token_arrays_and_base64() {
    let backend = Fake::default();
    let (status, text) = call(&backend, "/v1/embeddings", &json!({"input": "one"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&text)["data"].as_array().map(Vec::len), Some(1));
    let (_, text) = call(&backend, "/v1/embeddings", &json!({"input": [[1, 2], [3]], "dimensions": 8})).await;
    assert_eq!(json_of(&text)["usage"]["total_tokens"], 3);
    let (_, text) = call(&backend, "/v1/embeddings", &json!({"input": "a", "encoding_format": "base64"})).await;
    // 1.0 then 0.5 as little-endian f32.
    assert_eq!(json_of(&text)["data"][0]["embedding"], "AACAPwAAAD8=");
}

#[tokio::test]
async fn bad_embedding_requests_are_400() {
    let backend = Fake::default();
    for bad in [json!({}), json!({"input": []}), json!({"input": 5}), json!({"input": "a", "encoding_format": "hex"})] {
        let (status, _) = call(&backend, "/v1/embeddings", &bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
}

#[tokio::test]
async fn completions_are_forwarded_and_named_for_the_local_model() {
    let reply = json!({"id": "cmpl-1", "object": "text_completion", "model": "weights.gguf", "choices": [{"text": "x"}]});
    let backend = Fake { chunks: vec![reply.to_string()], status: 200, ..Fake::default() };
    let (status, text) = call(&backend, "/v1/completions", &json!({"model": "m", "prompt": "fn "})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_of(&text)["model"], "m");
    assert_eq!(backend.seen.lock().unwrap()[0]["prompt"], "fn ");
}

#[tokio::test]
async fn completion_streams_pass_through() {
    let backend = Fake {
        chunks: vec!["data: {\"choices\":[{\"text\":\"a\"}]}\n\n".to_owned(), "data: [DONE]\n\n".to_owned()],
        status: 200,
        ..Fake::default()
    };
    let (status, text) = call(&backend, "/v1/completions", &json!({"prompt": "p", "stream": true})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(text.contains("\"text\":\"a\"") && text.ends_with("data: [DONE]\n\n"));
}

#[tokio::test]
async fn completions_need_a_prompt_and_pass_errors_on() {
    let backend = Fake { chunks: vec!["{\"error\":{\"message\":\"no\"}}".to_owned()], status: 400, ..Fake::default() };
    let (status, _) = call(&backend, "/v1/completions", &json!({"model": "m"})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, text) = call(&backend, "/v1/completions", &json!({"prompt": "p"})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json_of(&text)["error"]["message"], "no");
}
