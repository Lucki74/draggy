//! Allowed origins, preflight and the Ollama key switch, through the router.

use std::convert::Infallible;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use draggy_api::server::{
    Backend, BackendError, CompletionRequest, DEFAULT_PORT, Env, ModelEntry, Reply, Sink, router,
};
use draggy_api::settings::ApiSettings;
use serde_json::json;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

const KEY: &str = "draggy-test-key-0123456789";
const SITE: &str = "https://app.example.com";

#[derive(Clone)]
struct TestEnv(ApiSettings);

impl Env for TestEnv {
    fn api_key(&self) -> String {
        KEY.to_owned()
    }
    fn now_unix(&self) -> i64 {
        0
    }
    fn fill_random(&self, buffer: &mut [u8]) {
        buffer.fill(1);
    }
    fn settings(&self) -> ApiSettings {
        self.0.clone()
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

fn settings() -> ApiSettings {
    ApiSettings::from_value(&json!({"allowedOrigins": [SITE]}))
}

async fn send(
    settings: ApiSettings,
    method: &str,
    path: &str,
    origin: Option<&str>,
    key: bool,
) -> axum::response::Response {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", format!("127.0.0.1:{DEFAULT_PORT}"));
    if let Some(origin) = origin {
        builder = builder.header("origin", origin);
    }
    if key {
        builder = builder.header("authorization", format!("Bearer {KEY}"));
    }
    let request = builder
        .body(Body::empty())
        .unwrap_or_else(|e| panic!("{e}"));
    router(DEFAULT_PORT, Quiet, TestEnv(settings))
        .oneshot(request)
        .await
        .unwrap_or_else(|never: Infallible| match never {})
}

fn header<'a>(response: &'a axum::response::Response, name: &str) -> Option<&'a str> {
    response.headers().get(name).and_then(|v| v.to_str().ok())
}

#[tokio::test]
async fn a_listed_origin_passes_with_its_cors_headers() {
    let response = send(settings(), "GET", "/v1/models", Some(SITE), true).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(header(&response, "access-control-allow-origin"), Some(SITE));
    assert_eq!(header(&response, "vary"), Some("Origin"));
}

#[tokio::test]
async fn a_listed_origin_still_needs_the_key() {
    let response = send(settings(), "GET", "/v1/models", Some(SITE), false).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(header(&response, "access-control-allow-origin"), Some(SITE));
}

#[tokio::test]
async fn other_origins_are_refused_and_get_no_cors_headers() {
    for origin in [
        "https://evil.example.com",
        "https://app.example.com.evil.io",
        "HTTPS://APP.EXAMPLE.COM",
    ] {
        let response = send(settings(), "GET", "/v1/models", Some(origin), true).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{origin}");
        assert!(header(&response, "access-control-allow-origin").is_none());
    }
    let response = send(
        ApiSettings::default(),
        "GET",
        "/v1/models",
        Some(SITE),
        true,
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_preflight_needs_a_listed_origin_but_no_key() {
    for path in ["/v1/chat/completions", "/v1/models", "/anything"] {
        let response = send(settings(), "OPTIONS", path, Some(SITE), false).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT, "{path}");
        assert_eq!(header(&response, "access-control-allow-origin"), Some(SITE));
        assert_eq!(
            header(&response, "access-control-allow-methods"),
            Some("GET, POST, DELETE, OPTIONS")
        );
        assert_eq!(
            header(&response, "access-control-allow-headers"),
            Some("authorization, content-type, x-api-key, anthropic-version, openai-beta")
        );
        assert_eq!(header(&response, "access-control-max-age"), Some("600"));
    }
    let other = send(
        settings(),
        "OPTIONS",
        "/v1/models",
        Some("https://evil.example.com"),
        false,
    )
    .await;
    assert_eq!(other.status(), StatusCode::FORBIDDEN);
    let none = send(settings(), "OPTIONS", "/v1/models", None, false).await;
    assert_eq!(none.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn the_host_check_stays_for_a_listed_origin() {
    let request = Request::builder()
        .method("OPTIONS")
        .uri("/v1/models")
        .header("host", "evil.example.com")
        .header("origin", SITE)
        .body(Body::empty())
        .unwrap_or_else(|e| panic!("{e}"));
    let response = router(DEFAULT_PORT, Quiet, TestEnv(settings()))
        .oneshot(request)
        .await
        .unwrap_or_else(|never: Infallible| match never {});
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn ollama_routes_skip_the_key_only_when_asked() {
    let open = ApiSettings::from_value(&json!({"ollamaNoKey": true}));
    // The route is not served yet or is; either way it is not refused for the key.
    let response = send(open.clone(), "GET", "/api/version", None, false).await;
    assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
    let response = send(open, "GET", "/v1/models", None, false).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = send(ApiSettings::default(), "GET", "/api/version", None, false).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[test]
fn wildcards_and_junk_never_reach_the_list() {
    let read = ApiSettings::from_value(
        &json!({"allowedOrigins": ["*", "https://*.x.com", " https://a.com/ ", "a.com", "https://a.com", "bad origin://x", 5, ""]}),
    );
    assert_eq!(read.allowed_origins, vec!["https://a.com".to_owned()]);
    let saved =
        ApiSettings::default().patched(&json!({"allowedOrigins": ["*"], "ollamaNoKey": true}));
    assert!(saved.allowed_origins.is_empty() && saved.ollama_no_key);
}
