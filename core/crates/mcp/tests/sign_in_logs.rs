//! The sign-in code runs against fakes, and nothing it logs carries a code, a token, a secret or a query.

mod support;

use draggy_mcp::oauth::{ExchangeRequest, RefreshRequest, discover, exchange, refresh, register};
use serde_json::json;
use support::{FakeHttp, block_on, capture, json_reply, reply};

const CODE: &str = "code-never-logged";
const VERIFIER: &str = "verifier-never-logged";
const CLIENT_SECRET: &str = "client-secret-never-logged";
const ACCESS: &str = "access-token-never-logged";
const REFRESH: &str = "refresh-token-never-logged";
const QUERY: &str = "query-never-logged";

#[test]
fn no_token_code_or_secret_reaches_the_log() {
    let token_reply =
        json!({ "access_token": ACCESS, "refresh_token": REFRESH, "expires_in": 3600 });
    let http = FakeHttp::queue(vec![
        json_reply(&token_reply),
        json_reply(&token_reply),
        json_reply(&json!({ "client_id": "client-1" })),
    ]);

    let ((), lines) = capture(|| {
        block_on(exchange(
            &http,
            &ExchangeRequest {
                endpoint: "https://auth.example/token",
                client_id: Some("client-1"),
                client_secret: Some(CLIENT_SECRET),
                code: Some(CODE),
                redirect_uri: Some("http://127.0.0.1:9/callback"),
                verifier: Some(VERIFIER),
                resource: None,
            },
        ))
        .unwrap_or_else(|error| panic!("{error}"));

        block_on(refresh(
            &http,
            &RefreshRequest {
                endpoint: "https://auth.example/token",
                client_id: Some("client-1"),
                client_secret: Some(CLIENT_SECRET),
                refresh_token: Some(REFRESH),
                resource: None,
            },
        ))
        .unwrap_or_else(|error| panic!("{error}"));

        block_on(register(
            &http,
            Some("https://auth.example/register"),
            "http://127.0.0.1:9/callback",
        ));
    });

    let joined = lines.join("\n");
    assert!(joined.contains("token exchanged"), "{joined}");
    assert!(joined.contains("token refreshed"), "{joined}");
    for secret in [CODE, VERIFIER, CLIENT_SECRET, ACCESS, REFRESH] {
        assert!(
            !joined.contains(secret),
            "{secret} reached the log:\n{joined}"
        );
    }
}

#[test]
fn a_refused_reply_is_not_logged_with_its_body() {
    let http = FakeHttp::queue(vec![reply(400, "echoed-in-body-never-logged")]);

    let ((), lines) = capture(|| {
        let outcome = block_on(exchange(
            &http,
            &ExchangeRequest {
                endpoint: "https://auth.example/token",
                code: Some(CODE),
                ..ExchangeRequest::default()
            },
        ));
        // The caller still sees what the server said; only the log is kept clean.
        assert!(
            outcome.is_err_and(|error| error.to_string().contains("echoed-in-body-never-logged"))
        );
    });

    let joined = lines.join("\n");
    assert!(joined.contains("token endpoint refused"), "{joined}");
    assert!(!joined.contains("echoed-in-body-never-logged"), "{joined}");
    assert!(!joined.contains(CODE), "{joined}");
}

#[test]
fn discovery_logs_hosts_and_not_queries() {
    let server = format!("https://tools.example/mcp?token={QUERY}");
    let http = FakeHttp::routes(vec![(
        "https://tools.example/.well-known/oauth-authorization-server".to_owned(),
        Ok(draggy_mcp::net::Response {
            status: 200,
            headers: Vec::new(),
            body: json!({ "token_endpoint": "https://auth.example/token" }).to_string(),
        }),
    )]);

    let ((), lines) = capture(|| {
        block_on(discover(&http, &server)).unwrap_or_else(|error| panic!("{error}"));
    });

    let joined = lines.join("\n");
    assert!(joined.contains("discovery done"), "{joined}");
    assert!(!joined.contains(QUERY), "{joined}");
}
