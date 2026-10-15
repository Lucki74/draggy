//! Signing in to a remote server, and renewing the token it is called with. The browser, the redirect listener and the
//! vault come in through traits, so tests answer with fakes and nothing opens a socket. The loopback listener itself is
//! the host's to provide; its five-minute deadline and refusal text belong to it.

use serde_json::{Map, Value, json};

use crate::http::loggable;
use crate::js::to_js_string;
use crate::log::{Level, Log};
use crate::names::scope_for;
use crate::net::Http;
use crate::oauth::{
    AuthorizeRequest, ExchangeRequest, RefreshRequest, authorize_url, discover, exchange,
    expiry_of, pkce_from_random, refresh, register,
};
use crate::ports::{BoxFuture, Ports, Vault};

/// What the browser sent back to the redirect listener: the code, and the state it echoed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Callback {
    pub code: String,
    pub state: Option<String>,
}

/// The loopback listener the browser is sent back to. Its three calls are the reference's listenForCode.
pub trait Redirect: Send + Sync {
    /// Starts listening, and resolves with the address the browser is sent back to.
    fn listen(&self) -> BoxFuture<'_, Result<String, String>>;
    /// Waits for the browser's answer. The error is the refusal, or that the sign-in ran out of time.
    fn callback(&self) -> BoxFuture<'_, Result<Callback, String>>;
    /// Stops listening. Safe to call more than once.
    fn close(&self);
}

/// Opens an address in the user's browser.
pub trait Browser: Send + Sync {
    fn open(&self, url: &str) -> BoxFuture<'_, Result<(), String>>;
}

/// One sign-in. The random values come from the caller, so a test can fix them.
#[derive(Debug, Clone, Copy)]
pub struct SignInRequest<'a> {
    pub id: &'a str,
    pub url: &'a str,
    /// The state the redirect must echo back.
    pub state: &'a str,
    /// Random bytes for the PKCE verifier. Thirty-two in production.
    pub pkce_random: &'a [u8],
}

/// The vault key a server's sign-in record is kept under.
pub fn vault_key(id: &str) -> String {
    format!("oauth:{id}")
}

/// The access token a remote server is called with, if one is held.
pub fn access_token(vault: &dyn Vault, id: &str) -> Option<String> {
    tokens_for(vault, id).and_then(|record| text_field(&record, "access_token"))
}

/// Signs in to a remote server. Nothing is stored until a token comes back. The error is the text the interface shows.
pub async fn sign_in<H: Http>(
    http: &H,
    ports: &Ports,
    log: &dyn Log,
    redirect: &dyn Redirect,
    browser: &dyn Browser,
    request: SignInRequest<'_>,
) -> Result<(), String> {
    let outcome = attempt_sign_in(http, ports, log, redirect, browser, request).await;
    redirect.close();
    outcome
}

async fn attempt_sign_in<H: Http>(
    http: &H,
    ports: &Ports,
    log: &dyn Log,
    redirect: &dyn Redirect,
    browser: &dyn Browser,
    request: SignInRequest<'_>,
) -> Result<(), String> {
    let redirect_uri = redirect.listen().await?;
    let metadata = discover(http, request.url)
        .await
        .map_err(|error| error.to_string())?;

    let existing = stored_record(ports.vault.as_ref(), request.id);
    let reusable = existing.as_ref().is_some_and(|record| {
        text_field(record, "client_id").is_some()
            && text_field(record, "redirect_uri").as_deref() == Some(redirect_uri.as_str())
    });
    let registered = if reusable {
        existing.clone()
    } else {
        register(
            http,
            metadata.registration_endpoint.as_deref(),
            &redirect_uri,
        )
        .await
        .and_then(|value| value.as_object().cloned())
    };

    let client_id = registered
        .as_ref()
        .and_then(|record| text_field(record, "client_id"))
        .or_else(|| {
            existing
                .as_ref()
                .and_then(|record| text_field(record, "client_id"))
        });
    let Some(client_id) = client_id else {
        return Err(
            "That server does not offer registration, so Draggy has no client id to sign in with."
                .to_owned(),
        );
    };
    let client_secret = registered
        .as_ref()
        .and_then(|record| string_field(record, "client_secret"));

    let pkce = pkce_from_random(request.pkce_random);
    let scope = scopes_text(&metadata.scopes_supported);
    let address = authorize_url(&AuthorizeRequest {
        endpoint: &metadata.authorization_endpoint,
        client_id: &client_id,
        redirect_uri: &redirect_uri,
        challenge: &pkce.challenge,
        state: request.state,
        scope: scope.as_deref(),
        resource: Some(request.url),
    })
    .map_err(|error| error.to_string())?;

    browser.open(&address).await?;
    let answer = redirect.callback().await?;

    // The state is the only thing tying the redirect to the request Draggy made.
    if answer.state.as_deref() != Some(request.state) {
        return Err("That sign-in did not match this request.".to_owned());
    }

    let tokens = exchange(
        http,
        &ExchangeRequest {
            endpoint: &metadata.token_endpoint,
            client_id: Some(&client_id),
            client_secret: client_secret.as_deref(),
            code: Some(&answer.code),
            redirect_uri: Some(&redirect_uri),
            verifier: Some(&pkce.verifier),
            resource: Some(request.url),
        },
    )
    .await
    .map_err(|error| error.to_string())?;
    // A reply with no access token is not a sign-in: storing it would send later calls out unauthenticated.
    if tokens
        .as_object()
        .and_then(|record| text_field(record, "access_token"))
        .is_none()
    {
        return Err("The sign-in server did not send an access token.".to_owned());
    }

    let expires = expires_value(expiry_of(Some(&tokens), ports.clock.now_ms()));
    let mut record = tokens.as_object().cloned().unwrap_or_default();
    record.insert("client_id".to_owned(), json!(client_id));
    record.insert(
        "client_secret".to_owned(),
        json!(client_secret.unwrap_or_default()),
    );
    record.insert("redirect_uri".to_owned(), json!(redirect_uri));
    record.insert("expiresAt".to_owned(), expires);
    ports
        .vault
        .set(&vault_key(request.id), Value::Object(record));

    log.line(
        Level::Info,
        &scope_for(request.id),
        "signed in",
        json!({"server": request.id, "transport": "http"}),
    );
    Ok(())
}

/// Renews a remote server's token from its refresh token and stores the answer. True when a new token is now held.
/// A failure is logged as a warning, and the old token stays where it was.
pub async fn refresh_tokens<H: Http>(
    http: &H,
    ports: &Ports,
    log: &dyn Log,
    id: &str,
    url: &str,
) -> bool {
    let Some(stored) = tokens_for(ports.vault.as_ref(), id) else {
        return false;
    };
    let Some(refresh_token) = text_field(&stored, "refresh_token") else {
        return false;
    };

    match renew(http, url, &stored, &refresh_token, ports.clock.now_ms()).await {
        Ok(record) => {
            ports.vault.set(&vault_key(id), Value::Object(record));
            log.line(
                Level::Info,
                &scope_for(id),
                "refreshed sign-in",
                json!({"server": id, "transport": "http"}),
            );
            true
        }
        Err(reason) => {
            log.line(
                Level::Warn,
                &scope_for(id),
                "could not refresh sign-in",
                json!({"server": id, "transport": "http", "reason": loggable(&reason)}),
            );
            false
        }
    }
}

/// The record a refresh leaves behind: the old one, with the answer laid over it.
async fn renew<H: Http>(
    http: &H,
    url: &str,
    stored: &Map<String, Value>,
    refresh_token: &str,
    now_ms: f64,
) -> Result<Map<String, Value>, String> {
    let metadata = discover(http, url)
        .await
        .map_err(|error| error.to_string())?;
    let client_id = string_field(stored, "client_id");
    let client_secret = string_field(stored, "client_secret");

    let next = refresh(
        http,
        &RefreshRequest {
            endpoint: &metadata.token_endpoint,
            client_id: client_id.as_deref(),
            client_secret: client_secret.as_deref(),
            refresh_token: Some(refresh_token),
            resource: Some(url),
        },
    )
    .await
    .map_err(|error| error.to_string())?;

    let expires = expires_value(expiry_of(Some(&next), now_ms));
    let mut record = stored.clone();
    if let Some(fields) = next.as_object() {
        for (key, value) in fields {
            record.insert(key.clone(), value.clone());
        }
    }
    // A server that does not send a new refresh token means keep the old one.
    let kept = text_field(&record, "refresh_token").unwrap_or_else(|| refresh_token.to_owned());
    record.insert("refresh_token".to_owned(), json!(kept));
    record.insert("expiresAt".to_owned(), expires);
    Ok(record)
}

/// The record stored for a server, when it holds an access token. Without one, the server is not signed in.
fn tokens_for(vault: &dyn Vault, id: &str) -> Option<Map<String, Value>> {
    stored_record(vault, id).filter(|record| text_field(record, "access_token").is_some())
}

fn stored_record(vault: &dyn Vault, id: &str) -> Option<Map<String, Value>> {
    vault
        .get(&vault_key(id))
        .and_then(|value| value.as_object().cloned())
}

/// A text field that is present and not empty, as a JavaScript truthy check reads it.
fn text_field(record: &Map<String, Value>, key: &str) -> Option<String> {
    string_field(record, key).filter(|text| !text.is_empty())
}

/// A text field that is present, even when empty.
fn string_field(record: &Map<String, Value>, key: &str) -> Option<String> {
    record.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// The stored expiry: a number of milliseconds, or the empty text when the token has no lifetime.
fn expires_value(expires: Option<f64>) -> Value {
    match expires {
        Some(at) => json!(at),
        None => json!(""),
    }
}

/// The scopes joined with spaces, as `(scopes || []).join(" ") || undefined` reads them. Empty is no scope.
fn scopes_text(scopes: &Value) -> Option<String> {
    let joined = scopes
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    if item.is_null() {
                        String::new()
                    } else {
                        to_js_string(item)
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    (!joined.is_empty()).then_some(joined)
}
