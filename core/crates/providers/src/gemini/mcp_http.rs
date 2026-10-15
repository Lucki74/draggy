//! Draggy's tools for the Gemini CLI, as the MCP request handler the loopback server calls: one secret route per
//! process, answered over SSE for a call, since the CLI gives a response sixty seconds to send its headers. A call
//! can wait a long time on the user, so the stream's head goes out at once and a keep-alive comment follows every
//! thirty seconds until the call settles. The socket and the clock belong to the shell, which advances the stream.

use serde_json::{Value, json};
use tracing::{debug, warn};

pub const KEEP_ALIVE_MS: u64 = 30_000;
/// The largest request body the reference reads; a longer one is refused as a parse error.
pub const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

/// One tool-serving endpoint: its tool list, and a call that is started and answered later.
pub trait McpEndpoint {
    fn tools(&self) -> Value;
    /// The tool's name as the request gave it; None when the request named none.
    fn call(&self, name: Option<&str>, arguments: &Value) -> Box<dyn PendingCall>;
}

/// A tool call in flight. The shell polls it as the clock moves, and tells it when the client has gone.
pub trait PendingCall {
    /// The call's result, or the failure text when the call could not be made; None while it is still running.
    fn poll(&mut self) -> Option<Result<Value, String>>;
    /// The client went away before the call settled.
    fn closed(&mut self) {}
}

/// A call that has its answer already.
pub fn ready(result: Result<Value, String>) -> Box<dyn PendingCall> {
    Box::new(Ready(Some(result)))
}

struct Ready(Option<Result<Value, String>>);

impl PendingCall for Ready {
    fn poll(&mut self) -> Option<Result<Value, String>> {
        self.0.take()
    }
}

/// The request as the handler reads it: the method, the path, the Host header, an Origin when a browser sent one, and
/// the body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpRequest {
    pub method: String,
    pub path: String,
    pub host: String,
    pub origin: Option<String>,
    pub body: String,
}

/// The answer: a status, the content type it is sent as, and the body (None when there is none).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpReply {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Option<String>,
}

/// What a request opens to: a whole reply, or an event stream for a call that is still to settle.
pub enum Opened {
    Reply(McpReply),
    Events(EventStream),
}

/// A call's answer as an event stream. Its head is sent at once; `advance` yields what to write as time passes.
pub struct EventStream {
    id: Value,
    pending: Box<dyn PendingCall>,
    since_write_ms: u64,
    done: bool,
}

impl EventStream {
    /// The head to send before anything else: an event stream, whatever the call later says.
    // Rust-only: the reference's Node head waits for its first write; this one goes out at once, within the CLI's 60 s.
    pub fn head(&self) -> McpReply {
        reply(200, SSE_TYPE, None)
    }

    /// Moves the stream on by the time the shell's clock has run since the last call. Returns the frames to write now:
    /// one keep-alive comment for each thirty seconds without a write, and the answer once the call has settled.
    pub fn advance(&mut self, elapsed_ms: u64) -> Vec<String> {
        if self.done {
            return Vec::new();
        }
        if let Some(result) = self.pending.poll() {
            self.done = true;
            let result = match result {
                Ok(result) => result,
                Err(text) => {
                    warn!(target: "providers.gemini", "tool call failed");
                    debug!(target: "providers.gemini", reason = %text, "tool call failure detail");
                    json!({ "content": [{ "type": "text", "text": "The call failed." }], "isError": true })
                }
            };
            let answer = json!({ "jsonrpc": "2.0", "id": self.id, "result": result });
            return vec![format!("event: message\ndata: {answer}\n\n")];
        }
        self.since_write_ms += elapsed_ms;
        let mut frames = Vec::new();
        while self.since_write_ms >= KEEP_ALIVE_MS {
            self.since_write_ms -= KEEP_ALIVE_MS;
            frames.push(": keep-alive\n\n".to_owned());
        }
        frames
    }

    /// The client closed the connection: the call is told, and nothing more is written.
    pub fn closed(&mut self) {
        if !self.done {
            self.done = true;
            self.pending.closed();
        }
    }

    pub fn is_done(&self) -> bool {
        self.done
    }
}

/// The server's routes and identity. `expected_host` is the loopback address and port the shell listens on.
pub struct McpServer {
    name: String,
    version: String,
    expected_host: String,
    routes: Vec<(String, Box<dyn McpEndpoint>)>,
}

const JSON_TYPE: &str = "application/json";
const SSE_TYPE: &str = "text/event-stream";

impl McpServer {
    pub fn new(name: &str, version: &str, expected_host: &str) -> Self {
        Self {
            name: name.to_owned(),
            version: version.to_owned(),
            expected_host: expected_host.to_owned(),
            routes: Vec::new(),
        }
    }

    /// Gives an endpoint its route. The route is chosen by the caller, who makes it secret.
    pub fn register(&mut self, route: &str, endpoint: Box<dyn McpEndpoint>) {
        self.routes.push((route.to_owned(), endpoint));
    }

    pub fn close(&mut self, route: &str) {
        self.routes.retain(|(name, _)| name != route);
    }

    pub fn len(&self) -> usize {
        self.routes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.routes.is_empty()
    }

    /// Answers one request. Only the child asks: a browser page sends an Origin, and a rebinding names a foreign Host.
    /// A call opens an event stream; every other request is answered whole.
    pub fn open(&self, request: &McpRequest) -> Opened {
        if request
            .origin
            .as_deref()
            .is_some_and(|origin| !origin.is_empty())
            || request.host != self.expected_host
        {
            return Opened::Reply(empty(403));
        }
        let Some((_, endpoint)) = self.routes.iter().find(|(route, _)| *route == request.path)
        else {
            return Opened::Reply(empty(404));
        };
        if request.method != "POST" {
            return Opened::Reply(empty(405));
        }
        // The reference reads a longer body as unparsable, so the same parse error answers it.
        let parsed = if request.body.len() > MAX_BODY_BYTES {
            Err(())
        } else {
            serde_json::from_str::<Value>(&request.body).map_err(|_| ())
        };
        let message: Value = match parsed {
            Ok(message) => message,
            Err(_) => {
                let body = json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } });
                return Opened::Reply(reply(400, JSON_TYPE, Some(body.to_string())));
            }
        };
        let id = match message.get("id") {
            None | Some(Value::Null) => return Opened::Reply(empty(202)),
            Some(id) => id.clone(),
        };
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        if method == "tools/call" {
            let name = message.pointer("/params/name").and_then(Value::as_str);
            let arguments = message
                .pointer("/params/arguments")
                .cloned()
                .filter(|v| !v.is_null())
                .unwrap_or_else(|| json!({}));
            return Opened::Events(EventStream {
                id,
                pending: endpoint.call(name, &arguments),
                since_write_ms: 0,
                done: false,
            });
        }
        let answer = |result: Value| json!({ "jsonrpc": "2.0", "id": id, "result": result });
        Opened::Reply(match method {
            "initialize" => {
                // An absent protocol version is left out, as JSON.stringify drops the reference's undefined.
                let mut result = serde_json::Map::new();
                if let Some(version) = message.pointer("/params/protocolVersion") {
                    result.insert("protocolVersion".to_owned(), version.clone());
                }
                result.insert("capabilities".to_owned(), json!({ "tools": {} }));
                result.insert(
                    "serverInfo".to_owned(),
                    json!({ "name": self.name, "version": self.version }),
                );
                let result = Value::Object(result);
                reply(200, JSON_TYPE, Some(answer(result).to_string()))
            }
            "tools/list" => reply(
                200,
                JSON_TYPE,
                Some(answer(json!({ "tools": endpoint.tools() })).to_string()),
            ),
            _ => reply(200, JSON_TYPE, Some(answer(json!({})).to_string())),
        })
    }
}

fn empty(status: u16) -> McpReply {
    reply(status, JSON_TYPE, None)
}

fn reply(status: u16, content_type: &'static str, body: Option<String>) -> McpReply {
    McpReply {
        status,
        content_type,
        body,
    }
}
