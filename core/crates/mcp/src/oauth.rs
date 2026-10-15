//! Sign-in for remote servers: OAuth 2.1 with PKCE, discovered metadata and dynamic registration. There is no client secret.
//! Tokens and codes are never logged, not even hashed; only hosts, statuses and flags are.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tracing::{debug, info, warn};
use url::Url;

use crate::js::{number_of, text, truthy, utf16_prefix};
use crate::net::{Http, Method, NetError, Request};

/// The name the authorisation server shows the user when it asks for consent.
pub const CLIENT_NAME: &str = "Draggy";

const METADATA_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const EXCHANGE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// How much of a refusal's body is kept, in UTF-16 units.
const REFUSAL_PREFIX: usize = 200;

/// A verifier and its challenge. The verifier never leaves this machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

/// Where the user signs in and how to exchange the code. `discovered` says whether any of it was answered, or all of it assumed.
#[derive(Debug, Clone, PartialEq)]
pub struct Metadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub scopes_supported: Value,
    pub discovered: bool,
}

/// The parameters of the address the user is sent to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizeRequest<'a> {
    pub endpoint: &'a str,
    pub client_id: &'a str,
    pub redirect_uri: &'a str,
    pub challenge: &'a str,
    pub state: &'a str,
    pub scope: Option<&'a str>,
    pub resource: Option<&'a str>,
}

/// A code exchanged for tokens. A field the reference would leave undefined is None, and the form omits it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExchangeRequest<'a> {
    pub endpoint: &'a str,
    pub client_id: Option<&'a str>,
    pub client_secret: Option<&'a str>,
    pub code: Option<&'a str>,
    pub redirect_uri: Option<&'a str>,
    pub verifier: Option<&'a str>,
    pub resource: Option<&'a str>,
}

/// A refresh token traded for new tokens.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RefreshRequest<'a> {
    pub endpoint: &'a str,
    pub client_id: Option<&'a str>,
    pub client_secret: Option<&'a str>,
    pub refresh_token: Option<&'a str>,
    pub resource: Option<&'a str>,
}

/// Why a sign-in step failed. The text is what the reference reports.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OauthError {
    #[error("Invalid URL")]
    InvalidUrl,
    #[error("The sign-in server answered {status}: {body}")]
    Refused { status: u16, body: String },
    #[error("invalid json")]
    Json,
    #[error("{0}")]
    Net(NetError),
}

/// A verifier from 32 random bytes, and its S256 challenge. The caller supplies the bytes, so tests can fix them.
pub fn pkce_from_random(random: &[u8]) -> Pkce {
    let verifier = base64url(random);
    let challenge = challenge_for(&verifier);
    Pkce {
        verifier,
        challenge,
    }
}

/// The S256 challenge for a verifier: its SHA-256, base64url with no padding.
pub fn challenge_for(verifier: &str) -> String {
    base64url(&Sha256::digest(verifier.as_bytes()))
}

/// Finds where to sign in: the server's protected-resource document, then its authorisation server's metadata, then the
/// OpenID document, and the usual endpoints when none answers.
pub async fn discover<H: Http>(http: &H, server_url: &str) -> Result<Metadata, OauthError> {
    let origin = Url::parse(server_url)
        .map_err(|_| OauthError::InvalidUrl)?
        .origin()
        .ascii_serialization();

    let resource = read_json(
        http,
        &format!("{origin}/.well-known/oauth-protected-resource"),
    )
    .await;

    let issuer = resource
        .as_ref()
        .and_then(|document| document.get("authorization_servers"))
        .and_then(Value::as_array)
        .and_then(|servers| servers.first())
        .and_then(Value::as_str)
        .filter(|server| !server.is_empty())
        .map_or_else(|| origin.clone(), str::to_owned);

    let base = issuer.strip_suffix('/').unwrap_or(&issuer).to_owned();
    let mut metadata = read_json(
        http,
        &format!("{base}/.well-known/oauth-authorization-server"),
    )
    .await;
    if !truthy(metadata.as_ref()) {
        metadata = read_json(http, &format!("{base}/.well-known/openid-configuration")).await;
    }

    let discovered = truthy(metadata.as_ref()) || truthy(resource.as_ref());
    let field = |document: &Option<Value>, key: &str| {
        document.as_ref().and_then(|value| value.get(key)).cloned()
    };

    let authorization_endpoint = truthy_string(field(&metadata, "authorization_endpoint"))
        .unwrap_or_else(|| format!("{issuer}/authorize"));
    let token_endpoint = truthy_string(field(&metadata, "token_endpoint"))
        .unwrap_or_else(|| format!("{issuer}/token"));
    let registration_endpoint = truthy_string(field(&metadata, "registration_endpoint"));
    let scopes_supported = [
        field(&metadata, "scopes_supported"),
        field(&resource, "scopes_supported"),
    ]
    .into_iter()
    .find(|scopes| truthy(scopes.as_ref()))
    .flatten()
    .unwrap_or_else(|| json!([]));

    info!(
        target: "mcp.oauth",
        host = %host_of(&issuer),
        discovered,
        registration = registration_endpoint.is_some(),
        "discovery done"
    );

    Ok(Metadata {
        issuer,
        authorization_endpoint,
        token_endpoint,
        registration_endpoint,
        scopes_supported,
        discovered,
    })
}

/// Registers Draggy with the authorisation server, which gives a desktop app a client id without a dashboard. None when
/// the server offers no registration, refuses it, or answers without a client id.
pub async fn register<H: Http>(
    http: &H,
    registration_endpoint: Option<&str>,
    redirect_uri: &str,
) -> Option<Value> {
    let endpoint = registration_endpoint?;
    let host = host_of(endpoint);

    let body = json!({
        "client_name": CLIENT_NAME,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });

    let request = Request {
        method: Method::Post,
        url: endpoint.to_owned(),
        headers: vec![("Content-Type".to_owned(), "application/json".to_owned())],
        body: Some(body.to_string()),
        timeout: EXCHANGE_TIMEOUT,
    };

    let response = match http.send(request).await {
        Ok(response) => response,
        Err(error) => {
            warn!(target: "mcp.oauth", host = %host, reason = %error, "registration failed");
            return None;
        }
    };

    if !response.ok() {
        warn!(target: "mcp.oauth", host = %host, status = response.status, "registration refused");
        return None;
    }

    let registered: Value = match serde_json::from_str(&response.body) {
        Ok(registered) => registered,
        Err(error) => {
            warn!(target: "mcp.oauth", host = %host, reason = %error, "registration failed");
            return None;
        }
    };

    let has_client_id = truthy(registered.get("client_id"));
    info!(target: "mcp.oauth", host = %host, has_client_id, "registered");
    has_client_id.then_some(registered)
}

/// The address the user is sent to. Its own query is kept; each parameter Draggy sets replaces any earlier one.
pub fn authorize_url(request: &AuthorizeRequest<'_>) -> Result<String, OauthError> {
    let mut url = Url::parse(request.endpoint).map_err(|_| OauthError::InvalidUrl)?;
    // The address goes to the system's opener, so a server that names `file:` or an app's own scheme must not reach it.
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err(OauthError::InvalidUrl);
    }
    let mut pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();

    set_param(&mut pairs, "response_type", "code");
    set_param(&mut pairs, "client_id", request.client_id);
    set_param(&mut pairs, "redirect_uri", request.redirect_uri);
    set_param(&mut pairs, "code_challenge", request.challenge);
    set_param(&mut pairs, "code_challenge_method", "S256");
    set_param(&mut pairs, "state", request.state);
    if let Some(scope) = request.scope.filter(|scope| !scope.is_empty()) {
        set_param(&mut pairs, "scope", scope);
    }
    // Which server the token is for, so one stolen elsewhere is not usable here.
    if let Some(resource) = request.resource.filter(|resource| !resource.is_empty()) {
        set_param(&mut pairs, "resource", resource);
    }

    url.query_pairs_mut().clear().extend_pairs(&pairs);
    Ok(url.to_string())
}

/// Trades an authorisation code for tokens, proving with the verifier that this machine started the sign-in.
pub async fn exchange<H: Http>(
    http: &H,
    request: &ExchangeRequest<'_>,
) -> Result<Value, OauthError> {
    post_form(
        http,
        request.endpoint,
        "authorization_code",
        &[
            ("grant_type", Some("authorization_code")),
            ("code", request.code),
            ("redirect_uri", request.redirect_uri),
            ("client_id", request.client_id),
            ("client_secret", request.client_secret),
            ("code_verifier", request.verifier),
            ("resource", request.resource),
        ],
    )
    .await
}

/// Trades a refresh token for new tokens.
pub async fn refresh<H: Http>(http: &H, request: &RefreshRequest<'_>) -> Result<Value, OauthError> {
    post_form(
        http,
        request.endpoint,
        "refresh_token",
        &[
            ("grant_type", Some("refresh_token")),
            ("refresh_token", request.refresh_token),
            ("client_id", request.client_id),
            ("client_secret", request.client_secret),
            ("resource", request.resource),
        ],
    )
    .await
}

/// Reads a token reply: a 2xx answer must be JSON, and anything else is refused with the start of its body.
pub fn parse_token_response(status: u16, body: &str) -> Result<Value, OauthError> {
    if !(200..300).contains(&status) {
        return Err(OauthError::Refused {
            status,
            body: utf16_prefix(body, REFUSAL_PREFIX),
        });
    }
    serde_json::from_str(body).map_err(|_| OauthError::Json)
}

/// When a token set stops being usable, a minute early. None when it has no lifetime, so it does not expire.
pub fn expiry_of(tokens: Option<&Value>, now_ms: f64) -> Option<f64> {
    let seconds = number_of(tokens.and_then(|tokens| tokens.get("expires_in")));
    if !seconds.is_finite() || seconds <= 0.0 {
        return None;
    }
    Some(now_ms + seconds * 1000.0 - 60000.0)
}

/// Whether a stored expiry has passed. Only a number counts; a missing or text expiry is never stale.
pub fn is_expired(expires_at: Option<&Value>, now_ms: f64) -> bool {
    expires_at
        .and_then(Value::as_f64)
        .is_some_and(|at| at <= now_ms)
}

async fn read_json<H: Http>(http: &H, url: &str) -> Option<Value> {
    let host = host_of(url);
    let request = Request {
        method: Method::Get,
        url: url.to_owned(),
        headers: vec![("Accept".to_owned(), "application/json".to_owned())],
        body: None,
        timeout: METADATA_TIMEOUT,
    };

    let response = match http.send(request).await {
        Ok(response) => response,
        Err(error) => {
            debug!(target: "mcp.oauth", host = %host, reason = %error, "metadata unreadable");
            return None;
        }
    };

    if !response.ok() {
        debug!(target: "mcp.oauth", host = %host, status = response.status, "metadata not served");
        return None;
    }

    match serde_json::from_str(&response.body) {
        Ok(document) => Some(document),
        Err(error) => {
            debug!(target: "mcp.oauth", host = %host, reason = %error, "metadata unreadable");
            None
        }
    }
}

/// The form body for the fields that are set, in order, as `application/x-www-form-urlencoded`.
fn encode_form(fields: &[(&str, Option<&str>)]) -> String {
    let mut form = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in fields {
        if let Some(value) = value {
            form.append_pair(key, value);
        }
    }
    form.finish()
}

async fn post_form<H: Http>(
    http: &H,
    endpoint: &str,
    grant: &str,
    fields: &[(&str, Option<&str>)],
) -> Result<Value, OauthError> {
    // Encoded before the first await: the serializer is not Send, so it must not live across one.
    let body = encode_form(fields);
    let host = host_of(endpoint);
    let request = Request {
        method: Method::Post,
        url: endpoint.to_owned(),
        headers: vec![
            (
                "Content-Type".to_owned(),
                "application/x-www-form-urlencoded".to_owned(),
            ),
            ("Accept".to_owned(), "application/json".to_owned()),
        ],
        body: Some(body),
        timeout: EXCHANGE_TIMEOUT,
    };

    let response = http.send(request).await.map_err(OauthError::Net)?;

    // The body may echo a code or token, so only the status and host are logged.
    if !response.ok() {
        warn!(target: "mcp.oauth", host = %host, status = response.status, grant, "token endpoint refused");
    }
    let tokens = parse_token_response(response.status, &response.body)?;

    let expires_in = number_of(tokens.get("expires_in"));
    let expires_in = (!expires_in.is_nan() && expires_in != 0.0).then_some(expires_in);
    let message = if grant == "refresh_token" {
        "token refreshed"
    } else {
        "token exchanged"
    };
    info!(
        target: "mcp.oauth",
        host = %host,
        refresh_token = truthy(tokens.get("refresh_token")),
        expires_in = ?expires_in,
        "{message}"
    );
    Ok(tokens)
}

/// `URLSearchParams.set`: replaces the first occurrence of a key and drops the others, or appends the key when it is new.
fn set_param(pairs: &mut Vec<(String, String)>, key: &str, value: &str) {
    let mut seen = false;
    pairs.retain_mut(|(existing, current)| {
        if existing != key {
            return true;
        }
        if seen {
            return false;
        }
        seen = true;
        *current = value.to_owned();
        true
    });
    if !seen {
        pairs.push((key.to_owned(), value.to_owned()));
    }
}

fn truthy_string(value: Option<Value>) -> Option<String> {
    value
        .filter(|value| truthy(Some(value)))
        .map(|value| text(Some(&value)))
}

fn base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// The host of a URL for the log. The path and query can carry tokens, so they never go in.
fn host_of(value: &str) -> String {
    match Url::parse(value) {
        Ok(url) => match (url.host_str(), url.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (Some(host), None) => host.to_owned(),
            _ => String::new(),
        },
        Err(_) => "invalid url".to_owned(),
    }
}
