//! The network seam. The MCP, registry and sign-in code talk to this trait, so tests answer with canned responses.

use std::future::Future;
use std::time::Duration;

/// The verbs the MCP code uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Delete,
}

impl Method {
    /// The verb as it is written on the wire.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Delete => "DELETE",
        }
    }
}

/// One outgoing request. The body is already encoded; the timeout is the reference's per-call limit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub timeout: Duration,
}

/// A status, its headers and the whole body. Headers keep the order the server sent them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Response {
    /// A status in the 2xx range, as `Response.ok` reports it.
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// The first value of a header, matched without regard to case.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// Why no response arrived. The text never includes the request URL, so a query cannot leak through it.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum NetError {
    #[error("request timed out")]
    Timeout,
    #[error("{0}")]
    Failed(String),
}

/// Sends one request and returns its response. Implementations must not panic.
pub trait Http: Send + Sync {
    fn send(&self, request: Request) -> impl Future<Output = Result<Response, NetError>> + Send;
}
