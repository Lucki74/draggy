//! What the shared fixtures cannot say: the sign-in address goes to the system's opener, so only web addresses reach it.

use draggy_mcp::oauth::{AuthorizeRequest, OauthError, authorize_url};

fn request(endpoint: &str) -> Result<String, OauthError> {
    authorize_url(&AuthorizeRequest {
        endpoint,
        client_id: "client",
        redirect_uri: "http://127.0.0.1:9/callback",
        challenge: "challenge",
        state: "state",
        scope: None,
        resource: None,
    })
}

#[test]
fn https_and_loopback_http_endpoints_are_accepted() {
    assert!(request("https://auth.example.com/authorize").is_ok());
    assert!(request("http://localhost:8080/authorize").is_ok());
    assert!(request("http://127.0.0.1/authorize").is_ok());
}

#[test]
fn other_schemes_and_plain_http_to_a_remote_host_are_refused() {
    for endpoint in [
        "file:///etc/passwd",
        "myapp://authorize",
        "javascript:alert(1)",
        "http://auth.example.com/authorize",
    ] {
        assert!(
            matches!(request(endpoint), Err(OauthError::InvalidUrl)),
            "{endpoint}"
        );
    }
}
