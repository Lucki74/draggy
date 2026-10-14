//! Streamable HTTP to a remote MCP server: one POST per message, answered as JSON or as a short event stream. Never started
//! unless the user turns it on.

use std::future::Future;
use std::time::Duration;

use serde_json::{Map, Value, json};
use tracing::{debug, info};

use crate::js::{stringify, text, trim, truthy, utf16_prefix};
use crate::net::{Http, Method, NetError, Request, Response};

/// The protocol version sent on every request.
pub const PROTOCOL_VERSION: &str = "2025-06-18";

/// How long any single request may take before it is given up on.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// The goodbye is best effort and gives up quickly.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

/// How much of an error body is kept, in UTF-16 units.
const ERROR_PREFIX: usize = 200;

/// Where the token and any custom headers come from. Read on every request, so a refreshed token is picked up.
pub trait Credentials: Send + Sync {
    /// The bearer token, if one is held.
    fn token(&self) -> impl Future<Output = Option<String>> + Send;
    /// Headers the user configured, sent on every request.
    fn headers(&self) -> impl Future<Output = Option<Vec<(String, String)>>> + Send;
    /// Called once on a 401. True when a new token is now held and the request should be sent again.
    fn unauthorized(&self) -> impl Future<Output = bool> + Send;
}

/// No token and no custom headers. A 401 is an error at once.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoCredentials;

impl Credentials for NoCredentials {
    fn token(&self) -> impl Future<Output = Option<String>> + Send {
        std::future::ready(None)
    }

    fn headers(&self) -> impl Future<Output = Option<Vec<(String, String)>>> + Send {
        std::future::ready(None)
    }

    fn unauthorized(&self) -> impl Future<Output = bool> + Send {
        std::future::ready(false)
    }
}

/// Why a call failed. The text is what the reference shows the user.
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error(transparent)]
    Net(#[from] NetError),
    #[error("{message}")]
    Status { status: u16, message: String },
    #[error("The server gave no answer to {0}.")]
    NoAnswer(String),
    #[error("{0}")]
    Server(String),
    #[error("invalid json")]
    Json,
}

/// One MCP connection over HTTP: the session it holds and the next request id.
pub struct Transport<H, C> {
    http: H,
    credentials: C,
    url: String,
    session: Option<String>,
    next_id: u64,
}

impl<H: Http, C: Credentials> Transport<H, C> {
    pub fn new(http: H, url: impl Into<String>, credentials: C) -> Self {
        Self {
            http,
            credentials,
            url: url.into(),
            session: None,
            next_id: 1,
        }
    }

    /// The session the server opened, if it opened one.
    pub fn session_id(&self) -> Option<&str> {
        self.session.as_deref()
    }

    /// Sends a request and waits for its answer. An error answer becomes an error, and a missing answer is one too.
    pub async fn send(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, TransportError> {
        let id = self.next_id;
        self.next_id += 1;

        let answer = match self.post(rpc_body(Some(id), method, params)).await? {
            Some(answer) if truthy(Some(&answer)) => answer,
            _ => return Err(TransportError::NoAnswer(method.to_owned())),
        };

        if let Some(error) = answer.get("error").filter(|error| truthy(Some(*error))) {
            let message = match error
                .get("message")
                .filter(|message| truthy(Some(*message)))
            {
                Some(message) => text(Some(message)),
                None => "The server reported an error.".to_owned(),
            };
            return Err(TransportError::Server(message));
        }

        Ok(answer.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Sends a notification. Nothing comes back, so nothing is waited for.
    pub async fn notify(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), TransportError> {
        self.post(rpc_body(None, method, params)).await?;
        Ok(())
    }

    /// Says goodbye when a session is held, so the server can free it. A failed goodbye still ends the session here.
    pub async fn close(&mut self) {
        let Some(session) = self.session.clone() else {
            return;
        };

        info!(target: "mcp", transport = "http", "session reset");

        let custom = self.credentials.headers().await.unwrap_or_default();
        let request = Request {
            method: Method::Delete,
            url: self.url.clone(),
            headers: delete_headers(&session, &custom),
            body: None,
            timeout: CLOSE_TIMEOUT,
        };

        if let Err(error) = self.http.send(request).await {
            debug!(target: "mcp", reason = %error, "nothing to do about a goodbye that did not arrive");
        }
        self.session = None;
    }

    async fn post(&mut self, body: Value) -> Result<Option<Value>, TransportError> {
        let encoded = stringify(&body);
        let mut attempt = 1;

        loop {
            let token = self.credentials.token().await;
            let custom = self.credentials.headers().await.unwrap_or_default();
            let request = Request {
                method: Method::Post,
                url: self.url.clone(),
                headers: post_headers(token.as_deref(), self.session.as_deref(), &custom),
                body: Some(encoded.clone()),
                timeout: DEFAULT_TIMEOUT,
            };

            let response = self.http.send(request).await?;
            debug!(
                target: "mcp",
                transport = "http",
                status = response.status,
                has_session = self.session.is_some(),
                attempt,
                "http answered"
            );

            // The token expired. One refresh and one retry, and then it is an error like any other rather than a loop.
            if response.status == 401 && attempt == 1 && self.credentials.unauthorized().await {
                info!(target: "mcp", transport = "http", attempt = 2, status = response.status, "reconnect attempt");
                attempt = 2;
                continue;
            }

            return self.read_answer(&body, &response);
        }
    }

    fn read_answer(
        &mut self,
        body: &Value,
        response: &Response,
    ) -> Result<Option<Value>, TransportError> {
        if !response.ok() {
            return Err(TransportError::Status {
                status: response.status,
                message: status_error(response.status, &response.body),
            });
        }

        if let Some(session) = session_from_headers(&response.headers) {
            if self.session.as_deref().is_some_and(|held| held != session) {
                info!(target: "mcp", transport = "http", "session re-initialised");
            }
            self.session = Some(session);
        }

        if response.status == 202 {
            return Ok(None);
        }

        if is_event_stream(response.header("content-type")) {
            let messages = parse_event_stream(&response.body);
            return Ok(messages
                .into_iter()
                .find(|message| message.get("id") == body.get("id")));
        }

        if trim(&response.body).is_empty() {
            return Ok(None);
        }

        serde_json::from_str(&response.body)
            .map(Some)
            .map_err(|_| TransportError::Json)
    }
}

/// Whether a response's content type is an event stream.
pub fn is_event_stream(content_type: Option<&str>) -> bool {
    content_type
        .unwrap_or_default()
        .contains("text/event-stream")
}

/// The JSON-RPC messages in a complete event stream. Lines that are not `data:` lines, and data that is not JSON, are
/// skipped. A final event with no blank line after it is dropped, as the reference drops it.
// TS quirk: readEventStream discards whatever is left in its buffer at the end of the stream.
pub fn parse_event_stream(body: &str) -> Vec<Value> {
    let events = split_events(body);
    let complete = &events[..events.len().saturating_sub(1)];

    let mut messages = Vec::new();
    for event in complete {
        for line in event.split('\n') {
            let line = line.strip_suffix('\r').unwrap_or(line);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            if let Ok(message) = serde_json::from_str::<Value>(trim(data)) {
                messages.push(message);
            }
        }
    }
    messages
}

/// The session id a response carries: `Mcp-Session-Id`, else `Session-Id`. An empty value is no id.
pub fn session_from_headers(headers: &[(String, String)]) -> Option<String> {
    ["mcp-session-id", "session-id"]
        .into_iter()
        .find_map(|name| {
            headers
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value.clone())
                .filter(|value| !value.is_empty())
        })
}

/// The headers of a message POST: the defaults, then the user's, then the token and session, which always win.
pub fn post_headers(
    token: Option<&str>,
    session: Option<&str>,
    custom: &[(String, String)],
) -> Vec<(String, String)> {
    let mut headers = vec![
        ("Content-Type".to_owned(), "application/json".to_owned()),
        (
            "Accept".to_owned(),
            "application/json, text/event-stream".to_owned(),
        ),
        (
            "MCP-Protocol-Version".to_owned(),
            PROTOCOL_VERSION.to_owned(),
        ),
    ];
    for (key, value) in custom {
        set_header(&mut headers, key, value);
    }
    if let Some(token) = token.filter(|token| !token.is_empty()) {
        set_header(&mut headers, "Authorization", &format!("Bearer {token}"));
    }
    if let Some(session) = session.filter(|session| !session.is_empty()) {
        set_header(&mut headers, "Mcp-Session-Id", session);
    }
    headers
}

/// The headers of the goodbye: the session, the protocol version and the user's own. No token is sent.
pub fn delete_headers(session: &str, custom: &[(String, String)]) -> Vec<(String, String)> {
    let mut headers = vec![
        ("Mcp-Session-Id".to_owned(), session.to_owned()),
        (
            "MCP-Protocol-Version".to_owned(),
            PROTOCOL_VERSION.to_owned(),
        ),
    ];
    for (key, value) in custom {
        set_header(&mut headers, key, value);
    }
    headers
}

/// The message for an unhappy status, with the start of the body when there is one.
pub fn status_error(status: u16, detail: &str) -> String {
    if detail.is_empty() {
        format!("The server answered {status}.")
    } else {
        format!(
            "The server answered {status}: {}.",
            utf16_prefix(detail, ERROR_PREFIX)
        )
    }
}

/// The JSON-RPC message for a call (with an id) or a notification (without one).
fn rpc_body(id: Option<u64>, method: &str, params: Option<Value>) -> Value {
    let mut body = Map::new();
    body.insert("jsonrpc".to_owned(), json!("2.0"));
    if let Some(id) = id {
        body.insert("id".to_owned(), json!(id));
    }
    body.insert("method".to_owned(), json!(method));
    if let Some(params) = params {
        body.insert("params".to_owned(), params);
    }
    Value::Object(body)
}

/// Sets a header by its exact name, replacing a value already there, as assigning a key on the reference's object does.
fn set_header(headers: &mut Vec<(String, String)>, key: &str, value: &str) {
    match headers.iter_mut().find(|(existing, _)| existing == key) {
        Some(slot) => slot.1 = value.to_owned(),
        None => headers.push((key.to_owned(), value.to_owned())),
    }
}

/// Splits an event stream the way `split(/\r?\n\r?\n/)` does: a blank line ends an event, in LF or CRLF.
fn split_events(body: &str) -> Vec<&str> {
    let bytes = body.as_bytes();
    let mut events = Vec::new();
    let mut start = 0;
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'\n' || (bytes[index] == b'\r' && bytes.get(index + 1) == Some(&b'\n'))
        {
            let newline = if bytes[index] == b'\r' {
                index + 1
            } else {
                index
            };
            let after = newline + 1;
            let end = if bytes.get(after) == Some(&b'\r') && bytes.get(after + 1) == Some(&b'\n') {
                Some(after + 2)
            } else if bytes.get(after) == Some(&b'\n') {
                Some(after + 1)
            } else {
                None
            };
            if let Some(end) = end {
                events.push(&body[start..index]);
                start = end;
                index = end;
                continue;
            }
        }
        index += 1;
    }

    events.push(&body[start..]);
    events
}
