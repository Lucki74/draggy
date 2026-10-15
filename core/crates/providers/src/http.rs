//! The network as the providers see it: one request in, one answer out. The gateway wave supplies the real client;
//! tests supply a fake. Response header names are stored lowercased.

use std::collections::BTreeMap;

/// The verb a provider call uses. Only GET and POST are ever sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: Method,
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: Option<String>,
    /// How long the call may take before it counts as unreachable; `None` waits as long as the client does.
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

impl HttpHead {
    /// `Response.ok`: a status from 200 to 299.
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

impl HttpResponse {
    /// `Response.ok`: a status from 200 to 299.
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// A header by its lowercase name.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }
}

/// A request that got no answer: refused, unreachable, timed out or cut off.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct TransportError {
    pub message: String,
    pub cause_message: Option<String>,
    pub code: Option<String>,
}

/// An answer's status and headers, sent before any of its body is read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpHead {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
}

/// An answer's body, read a chunk at a time. Cancelling it aborts the upstream request, as the reference's reader does.
pub trait ByteStream {
    /// The next chunk, or None once the body is complete.
    fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError>;
    /// Stops reading and aborts whatever the body was still waiting on.
    fn cancel(&mut self);
}

/// Sends one request. Implementations must not follow the reference's redirects into other hosts.
pub trait HttpClient {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError>;

    /// Sends a request and returns its head, leaving the body to be read chunk by chunk. A client that cannot stream
    /// answers the whole body at once, which is what this default does.
    fn open(
        &self,
        request: &HttpRequest,
    ) -> Result<(HttpHead, Box<dyn ByteStream>), TransportError> {
        let response = self.send(request)?;
        let head = HttpHead {
            status: response.status,
            headers: response.headers,
        };
        let body: Box<dyn ByteStream> = Box::new(Whole(Some(response.body.into_bytes())));
        Ok((head, body))
    }
}

/// A body that arrived whole, handed out as one chunk.
struct Whole(Option<Vec<u8>>);

impl ByteStream for Whole {
    fn next_chunk(&mut self) -> Result<Option<Vec<u8>>, TransportError> {
        Ok(self.0.take().filter(|bytes| !bytes.is_empty()))
    }

    fn cancel(&mut self) {
        self.0 = None;
    }
}

/// Reads a whole body into text, lossily. Used where the reference awaits the full body, such as an error's text.
pub fn read_text(body: &mut dyn ByteStream) -> Result<String, TransportError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = body.next_chunk()? {
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
