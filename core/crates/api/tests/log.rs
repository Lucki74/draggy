//! The request log through the router.

use std::convert::Infallible;
use std::sync::{Arc, Mutex, PoisonError};

use axum::body::Body;
use axum::http::Request;
use draggy_api::log::LogEntry;
use draggy_api::server::{
    Backend, BackendError, CompletionRequest, DEFAULT_PORT, Env, ModelEntry, Reply, Sink, router,
};
use draggy_api::settings::ApiSettings;
use serde_json::json;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

#[derive(Clone)]
struct TestEnv(ApiSettings, Arc<Mutex<Vec<LogEntry>>>);

impl Env for TestEnv {
    fn api_key(&self) -> String {
        "draggy-test-key-0123456789".to_owned()
    }
    fn now_unix(&self) -> i64 {
        42
    }
    fn fill_random(&self, buffer: &mut [u8]) {
        buffer.fill(1);
    }
    fn settings(&self) -> ApiSettings {
        self.0.clone()
    }
    fn record(&self, entry: LogEntry) {
        self.1
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(entry);
    }
}

struct Quiet;

impl Backend for Quiet {
    async fn list_models(&self) -> Result<Vec<ModelEntry>, BackendError> {
        Ok(vec![ModelEntry::local("m")])
    }
    async fn generate(
        &self,
        _: CompletionRequest,
        _: Sink,
        _: CancellationToken,
    ) -> Result<Reply, BackendError> {
        Ok(Reply::default())
    }
}

async fn get(settings: ApiSettings, auth: bool) -> Vec<LogEntry> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut builder = Request::builder()
        .uri("/v1/models")
        .header("host", format!("127.0.0.1:{DEFAULT_PORT}"))
        .header("user-agent", "tester/1");
    if auth {
        builder = builder.header("authorization", "Bearer draggy-test-key-0123456789");
    }
    let request = builder
        .body(Body::empty())
        .unwrap_or_else(|e| panic!("{e}"));
    let _ = router(DEFAULT_PORT, Quiet, TestEnv(settings, seen.clone()))
        .oneshot(request)
        .await
        .unwrap_or_else(|never: Infallible| match never {});
    std::mem::take(&mut *seen.lock().unwrap_or_else(PoisonError::into_inner))
}

#[tokio::test]
async fn a_request_is_logged_without_its_content() {
    let entries = get(ApiSettings::default(), true).await;
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(
        (entry.method.as_str(), entry.path.as_str(), entry.status),
        ("GET", "/v1/models", 200)
    );
    assert_eq!((entry.client.as_str(), entry.time), ("tester/1", 42));
}

#[tokio::test]
async fn refusals_are_logged_and_the_switch_stops_it() {
    let entries = get(ApiSettings::default(), false).await;
    assert_eq!(entries[0].status, 401);
    let off = ApiSettings::from_value(&json!({"logRequests": false}));
    assert!(get(off, true).await.is_empty());
}
